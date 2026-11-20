import os
import json
import logging
import base64
from typing import Optional, Tuple
import pymupdf  # PyMuPDF
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai.errors import APIError

from schemas import ExamPaper

load_dotenv()
logger = logging.getLogger("pdf_parser")

def inspect_pdf_text(pdf_bytes: bytes) -> Tuple[bool, str, int]:
    """
    Inspects PDF locally using PyMuPDF.
    Returns:
        (is_clean_text, extracted_text, total_images)
    """
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        total_pages = len(doc)
        total_images = 0
        full_text_parts = []

        for page_idx in range(total_pages):
            page = doc[page_idx]
            images = page.get_images()
            total_images += len(images)
            text = page.get_text("text").strip()
            if text:
                full_text_parts.append(f"--- PAGE {page_idx + 1} ---\n{text}")

        full_text = "\n\n".join(full_text_parts)
        doc.close()

        # If we have substantial selectable text (avg > 80 chars per page or > 250 chars total)
        # and not a pure image scan, we consider it clean text.
        char_count = len(full_text)
        is_clean_text = char_count > 250 and (char_count / max(1, total_pages) > 75)
        return is_clean_text, full_text, total_images
    except Exception as e:
        logger.warning(f"PyMuPDF inspection failed: {e}. Falling back to multimodal PDF ingestion.")
        return False, "", 0

def extract_and_attach_images(paper: ExamPaper, pdf_bytes: bytes) -> ExamPaper:
    """
    Crops and attaches diagram images to questions as base64 Data URIs.
    Maintains 100% statelessness (zero database, zero disk writes).
    Accurately handles:
      1. Gemini bounding box scale: supports both 0-1000 scale and 0.0-1.0 float scale.
      2. Strict full-page rejection: never crops or displays full scanned pages as diagrams.
      3. Digital PDF embedded images: only isolates genuine sub-page drawings/figures.
      4. Crisp resolution with padding: renders clear 180 DPI pngs.
    """
    if not pdf_bytes or not paper.questions:
        return paper

    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        num_pages = len(doc)

        for q in paper.questions:
            # Check if this question is flagged with an image or references a diagram/figure/table
            has_fig_kw = any(w in q.text.lower() for w in [
                "figure", "diagram", "circuit", "graph", "plot", "shown below",
                "in the figure", "given in the figure", "schematic", "table below",
                "refer to the following table", "refer to the given figure"
            ])
            if not q.has_image and not has_fig_kw and not q.image_bbox:
                continue

            page_num = q.image_page
            # Ensure 1-based page number is valid
            if page_num is None or page_num < 1 or page_num > num_pages:
                # Try to locate question number in page text (for digital text PDFs)
                for p_idx in range(num_pages):
                    p_text = doc[p_idx].get_text()
                    if f"Q.{q.id}" in p_text or f"Question {q.id}" in p_text or f"Q{q.id}" in p_text or f"{q.id}." in p_text:
                        page_num = p_idx + 1
                        break

            if not page_num or page_num < 1 or page_num > num_pages:
                continue

            page = doc[page_num - 1]
            page_w = page.rect.width
            page_h = page.rect.height
            cropped_bytes = None

            # Strategy 1: Bounding box provided by Gemini [ymin, xmin, ymax, xmax]
            # Supports both 0-1000 integer scale (standard Gemini vision grounding) and 0.0-1.0 float scale
            if q.image_bbox and len(q.image_bbox) == 4:
                try:
                    ymin, xmin, ymax, xmax = [float(v) for v in q.image_bbox]

                    # Normalize coordinates to 0.0 - 1.0 float range
                    if any(v > 1.0 for v in [ymin, xmin, ymax, xmax]):
                        if max(ymin, xmin, ymax, xmax) <= 1000.0:
                            # Standard Gemini 0-1000 coordinate scale
                            ymin /= 1000.0
                            xmin /= 1000.0
                            ymax /= 1000.0
                            xmax /= 1000.0
                        elif max(ymax, xmax) <= max(page_h, page_w) * 1.5:
                            # Coordinates in PDF point units
                            ymin /= page_h
                            ymax /= page_h
                            xmin /= page_w
                            xmax /= page_w

                    ymin = max(0.0, min(1.0, ymin))
                    xmin = max(0.0, min(1.0, xmin))
                    ymax = max(0.0, min(1.0, ymax))
                    xmax = max(0.0, min(1.0, xmax))

                    if ymax > ymin and xmax > xmin:
                        bbox_w = xmax - xmin
                        bbox_h = ymax - ymin
                        bbox_area = bbox_w * bbox_h

                        # STRICT ANTI-WHOLE-PAGE FILTER:
                        # Reject bounding boxes that encompass the whole page (>65% area, or >75% height)
                        is_whole_page = (
                            bbox_area > 0.65 or
                            bbox_h > 0.75 or
                            (bbox_w > 0.85 and bbox_h > 0.50) or
                            (ymin <= 0.05 and ymax >= 0.85)
                        )
                        is_too_small = bbox_w < 0.02 or bbox_h < 0.02

                        if is_whole_page:
                            logger.warning(
                                f"Q{q.id} image_bbox rejected as whole-page crop (area={bbox_area:.2f}, h={bbox_h:.2f})."
                            )
                        elif is_too_small:
                            logger.warning(f"Q{q.id} image_bbox rejected as noise/too small.")
                        else:
                            # Valid diagram bounding box: add comfortable padding and crop at 180 DPI
                            pad_x = 6.0
                            pad_y = 6.0
                            rect = pymupdf.Rect(
                                max(0.0, xmin * page_w - pad_x),
                                max(0.0, ymin * page_h - pad_y),
                                min(page_w, xmax * page_w + pad_x),
                                min(page_h, ymax * page_h + pad_y)
                            )
                            pix = page.get_pixmap(clip=rect, dpi=180)
                            cropped_bytes = pix.tobytes("png")
                            logger.info(f"Q{q.id}: Successfully cropped diagram using Gemini bbox: {rect}")
                except Exception as ex:
                    logger.warning(f"Failed to crop bbox for Q{q.id}: {ex}")

            # Strategy 2: If no valid bbox from Gemini, inspect page for genuine embedded isolated images (Digital PDFs only)
            # NEVER pick full-page or near-full-page document scans!
            if not cropped_bytes:
                img_list = page.get_images()
                valid_rects = []
                for img_info in img_list:
                    xref = img_info[0]
                    rects = page.get_image_rects(xref)
                    for r in rects:
                        # Reject full page scans / document scans
                        is_page_scan = (
                            r.height > page_h * 0.55 or
                            r.width > page_w * 0.85 or
                            (r.width * r.height) > (page_w * page_h * 0.35)
                        )
                        if not is_page_scan and r.width >= 40 and r.height >= 40:
                            valid_rects.append(r)

                if valid_rects:
                    # If multiple isolated images exist, find the one closest to the question text if searchable
                    best_rect = valid_rects[0]
                    try:
                        p_text = page.get_text()
                        if p_text.strip():
                            # Find position of question on page
                            q_matches = page.search_for(f"Q.{q.id}") or page.search_for(f"Question {q.id}") or page.search_for(f"{q.id}.")
                            if q_matches:
                                q_y = q_matches[0].y0
                                # Sort rects by distance below question header
                                valid_rects.sort(key=lambda r: abs(r.y0 - q_y))
                                best_rect = valid_rects[0]
                        pix = page.get_pixmap(clip=best_rect, dpi=180)
                        cropped_bytes = pix.tobytes("png")
                        logger.info(f"Q{q.id}: Cropped isolated embedded image: {best_rect}")
                    except Exception as ex:
                        logger.warning(f"Failed to crop embedded image for Q{q.id}: {ex}")

            # Assign cropped image if a genuine diagram was isolated
            if cropped_bytes:
                b64_str = base64.b64encode(cropped_bytes).decode("ascii")
                q.image_data = f"data:image/png;base64,{b64_str}"
                q.has_image = True
                q.image_page = page_num
            else:
                # If no genuine diagram could be cropped, do NOT show full page
                q.image_data = None
                q.has_image = False

        doc.close()
    except Exception as e:
        logger.error(f"Error in extract_and_attach_images: {e}")

    return paper

async def parse_exam_pdf(
    question_pdf_bytes: bytes,
    client: genai.Client,
    answer_key_bytes: Optional[bytes] = None,
    exam_mode: str = "CAT",
    duration_minutes: Optional[int] = None
) -> ExamPaper:
    """
    Parses Question Paper PDF (and optional Answer Key PDF) into an ExamPaper schema
    using gemini-3.5-flash-lite with zero-database, token-efficient extraction.
    Accepts per-request client supporting BYOK (user API key).
    """
    # Step 1: Local PyMuPDF text inspection
    q_is_clean, q_text, q_images = inspect_pdf_text(question_pdf_bytes)
    ak_is_clean, ak_text, ak_images = (False, "", 0)
    if answer_key_bytes:
        ak_is_clean, ak_text, ak_images = inspect_pdf_text(answer_key_bytes)

    # Determine default duration and marks based on exam_mode if not provided
    default_duration = 180
    pos_mark = 3.0
    neg_mark = 1.0

    mode_upper = exam_mode.upper()
    if mode_upper == "CAT":
        default_duration = 120
        pos_mark = 3.0
        neg_mark = 1.0
    elif mode_upper == "GATE":
        default_duration = 180
        pos_mark = 2.0
        neg_mark = 0.66
    elif mode_upper == "JEE":
        default_duration = 180
        pos_mark = 4.0
        neg_mark = 1.0
    elif mode_upper == "NEET":
        default_duration = 200
        pos_mark = 4.0
        neg_mark = 1.0
    elif mode_upper in ["UPSC_GS", "UPSC"]:
        default_duration = 120
        pos_mark = 2.0
        neg_mark = 0.66
    elif mode_upper == "UPSC_CSAT":
        default_duration = 120
        pos_mark = 2.5
        neg_mark = 0.83
    elif mode_upper in ["SSC", "SSC_CGL"]:
        default_duration = 60
        pos_mark = 2.0
        neg_mark = 0.5
    elif mode_upper in ["RAILWAYS", "RRB"]:
        default_duration = 90
        pos_mark = 1.0
        neg_mark = 0.33
    elif mode_upper in ["BANKING", "IBPS", "SBI"]:
        default_duration = 60
        pos_mark = 1.0
        neg_mark = 0.25
    elif mode_upper == "CUET":
        default_duration = 60
        pos_mark = 5.0
        neg_mark = 1.0

    duration = duration_minutes or default_duration

    # Base prompt instructions enforcing strict token-efficiency and math LaTeX rules
    prompt_instructions = f"""
You are an expert exam question paper extractor specializing in Indian competitive examinations (CAT, GATE, JEE, NEET, UPSC, SSC, Railways, Banking, CUET, and Custom).
Your task is to extract all questions from the provided question paper into a structured JSON ExamPaper format.

CRITICAL RULES:
1. TOKEN-OPTIMIZATION CONSTRAINT (DO NOT SOLVE):
   - Extract ONLY the question text, options, question type ('MCQ', 'MSQ', or 'NAT'), section name, and existing answer keys.
   - Do NOT generate solutions, explanations, or step-by-step reasoning at this stage.
   - If an answer key is printed inside the question paper (or in the optional answer key document provided), extract it into 'correct_answer'.
   - If NO answer key is present for a question, strictly set 'correct_answer': null.
2. LATEX & FORMULA ACCURACY:
   - Preserve all mathematical, scientific, and algebraic expressions using standard LaTeX syntax.
   - Wrap inline math in $...$ (e.g., $x^2 + y^2 = r^2$, $\\frac{{a}}{{b}}$, $\\sqrt{{x}}$).
   - Wrap display math in $$...$$.
3. QUESTION TYPES (MCQ vs MSQ vs NAT):
   - You MUST carefully classify each question into one of three strict types:
     a) 'MCQ' (Multiple Choice Question): Exactly ONE option (A, B, C, or D) is correct. Standard single-choice question with 4 options.
     b) 'MSQ' (Multiple Select Question): ONE OR MORE options can be correct simultaneously.
        Common in GATE, JEE Advanced, CUET, and questions that state "Which of the following statement(s) is/are correct?", "Select all that apply", or "One or more than one option is correct".
        For MSQ, 'options' (A, B, C, D) must be provided, and if known, 'correct_answer' MUST be comma-separated letters e.g. "A, C" or "B, C, D".
     c) 'NAT' (Numerical Answer Type / TITA): Questions where candidates must type a numeric value without any multiple-choice options (e.g. "Enter your answer:", or questions with no options A, B, C, D).
        For NAT questions, 'options' MUST be null, and 'correct_answer' is the numerical value.
4. DIAGRAMS, FIGURES, CIRCUITS & TABLES:
   - Carefully inspect each question to see if it includes or references a figure, circuit diagram, graph, schematic, chart, geometry drawing, chemical structure, or data table.
   - If a question has an image/diagram/data-table:
     - Set 'has_image': true.
     - Set 'image_page': <1-based page number in the PDF where the diagram is located>.
     - Set 'image_bbox': [ymin, xmin, ymax, xmax] tightly enclosing ONLY the graphic/diagram/circuit/plot/table.
       * BOUNDING BOX FORMAT: Provide coordinates on either a 0 to 1000 integer scale (e.g. [340, 180, 430, 460]) or a 0.0 to 1.0 float scale (e.g. [0.34, 0.18, 0.43, 0.46]).
       * CRITICAL: Tightly crop ONLY the graphic figure/drawing itself.
       * NEVER return a bounding box for the entire page (e.g. [0, 0, 1000, 1000] is STRICTLY FORBIDDEN).
       * DO NOT include the question text header, question number, formulas, or option text outside the figure.
       * The bounding box height should typically cover only 10% to 50% of the page height.
   - If no diagram or visual figure exists for this question, set 'has_image': false, 'image_page': null, 'image_bbox': null.
5. SECTIONS & MARKS:
   - Identify sections (e.g., 'Verbal Ability & Reading Comprehension', 'Data Interpretation & Logical Reasoning', 'Quantitative Ability', 'General Aptitude', 'Technical Section').
   - Exam mode: '{mode_upper}'
   - Duration minutes: {duration}
   - Assign reasonable positive marks (e.g. {pos_mark}) and negative marks (e.g. {neg_mark} for MCQ, 0 for NAT and MSQ).
"""

    contents = []

    has_diagram_clues = any(k in q_text.lower() for k in [
        "figure", "diagram", "circuit", "graph", "plot", "shown below", "in the figure", "given in the figure", "schematic"
    ])

    # Decide whether to send clean extracted text (saving vision tokens) or raw PDF bytes
    if q_is_clean and q_images == 0 and not has_diagram_clues:
        logger.info("Using clean extracted text for question paper (token-optimized).")
        contents.append(
            f"{prompt_instructions}\n\n=== QUESTION PAPER EXTRACTED TEXT ===\n{q_text}"
        )
    else:
        logger.info("Using native PDF bytes for question paper (multimodal/scanned/diagram-rich).")
        contents.append(prompt_instructions)
        contents.append(
            types.Part.from_bytes(data=question_pdf_bytes, mime_type="application/pdf")
        )

    # Include optional answer key if provided
    if answer_key_bytes:
        if ak_is_clean:
            contents.append(
                f"\n\n=== SEPARATE ANSWER KEY TEXT ===\n"
                f"Please map the correct answers from this key to the respective questions extracted above:\n"
                f"{ak_text}"
            )
        else:
            contents.append(
                "=== SEPARATE ANSWER KEY PDF ===\n"
                "Please map the correct answers from this key PDF to the respective questions extracted above:"
            )
            contents.append(
                types.Part.from_bytes(data=answer_key_bytes, mime_type="application/pdf")
            )

    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=ExamPaper,
        temperature=0.1,
    )

    extract_model = os.getenv("GEMINI_EXTRACT_MODEL", "gemini-3.5-flash-lite")
    fallback_pool = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.8-flash"]
    # Ensure preferred extract_model is tried first, followed by alternates without duplicates
    models_to_try = [extract_model] + [m for m in fallback_pool if m != extract_model]

    last_error = None
    for model_name in models_to_try:
        max_attempts = 2
        for attempt in range(max_attempts):
            try:
                logger.info(f"Attempting PDF parsing with {model_name} (attempt {attempt + 1}/{max_attempts})...")
                response = client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=config,
                )

                paper = None
                if response.parsed:
                    paper = response.parsed
                elif response.text:
                    data = json.loads(response.text)
                    paper = ExamPaper.model_validate(data)

                if paper:
                    # Crop and attach diagram images via PyMuPDF (stateless base64 Data URIs)
                    paper = extract_and_attach_images(paper, question_pdf_bytes)
                    return paper
                else:
                    raise ValueError("Empty response received from Gemini.")
            except Exception as e:
                last_error = e
                err_str = str(e)
                logger.warning(f"Model {model_name} (attempt {attempt + 1}) encountered error: {err_str}")
                if "depleted" in err_str.lower() or "402" in err_str:
                    break
                # If 503 (high demand) or 429 (rate limit), quickly try next model rather than stalling
                if "503" in err_str or "high demand" in err_str.lower() or "unavailable" in err_str.lower():
                    logger.info(f"Model {model_name} is under high demand, immediately falling back to next available model...")
                    break
                if "429" in err_str:
                    if attempt < max_attempts - 1:
                        import time
                        time.sleep(2.0 * (attempt + 1))
                        continue
                break

    if last_error:
        raise last_error
