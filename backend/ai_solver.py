import os
import json
import logging
from typing import List, Dict, Optional
from dotenv import load_dotenv
from google import genai
from google.genai import types

from schemas import (
    Question,
    ExamPaper,
    AiSolveBatchResponse,
    BatchSolveResult,
    MistakeAutopsyResponse
)

load_dotenv()
logger = logging.getLogger("ai_solver")

async def batch_solve_questions(questions: List[Question], client: genai.Client) -> Dict[str, str]:
    """
    Stage 2 (Submit): Sends ONLY the user's attempted questions that have correct_answer: null
    in batches of 10-15 to gemini-3.8-flash, requesting ONLY the final answer key JSON
    {"q_id": "answer"} — strictly zero explanations to minimize latency & token usage.
    """
    if not questions:
        return {}

    final_answers: Dict[str, str] = {}
    batch_size = 12  # Optimal 10-15 chunk
    solver_model = os.getenv("GEMINI_SOLVER_MODEL", "gemini-3.6-flash")
    fallback_pool = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"]
    models_to_try = [solver_model] + [m for m in fallback_pool if m != solver_model]

    for i in range(0, len(questions), batch_size):
        chunk = questions[i:i + batch_size]
        questions_payload = []

        for q in chunk:
            payload_item = {
                "id": q.id,
                "type": q.type,
                "text": q.text,
            }
            if q.type in ["MCQ", "MSQ"] and q.options:
                payload_item["options"] = q.options.model_dump() if hasattr(q.options, "model_dump") else q.options
            questions_payload.append(payload_item)

        prompt = f"""
You are an expert exam solver. Solve the following competitive exam questions.
Output ONLY the verified final answer for each question ID.

STRICT INSTRUCTIONS:
1. For MCQ questions, the answer must be the exact option letter: 'A', 'B', 'C', or 'D'.
2. For MSQ (Multiple Select Questions), one or more options can be correct. The answer must be the exact comma-separated correct letters in alphabetical order (e.g. 'A, C' or 'B, C, D').
3. For NAT (Numerical Answer Type) questions, the answer must be the exact calculated numerical value (e.g. '42', '12.5', '350', '-4').
4. DO NOT output any explanations, working, steps, or markdown. Only the structured JSON object with key 'answers' mapping string ID to final answer.

Questions to solve:
{json.dumps(questions_payload, indent=2)}
"""

        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=AiSolveBatchResponse,
            temperature=0.0,
        )

        batch_success = False
        last_batch_err = None
        for m_name in models_to_try:
            max_attempts = 2
            for attempt in range(max_attempts):
                try:
                    response = client.models.generate_content(
                        model=m_name,
                        contents=prompt,
                        config=config,
                    )

                    if response.parsed and hasattr(response.parsed, "answers"):
                        for item in response.parsed.answers:
                            final_answers[str(item.q_id)] = item.answer
                    elif response.text:
                        data = json.loads(response.text)
                        if isinstance(data, dict) and "answers" in data:
                            raw_ans = data["answers"]
                            if isinstance(raw_ans, list):
                                for item in raw_ans:
                                    final_answers[str(item.get("q_id"))] = str(item.get("answer"))
                            elif isinstance(raw_ans, dict):
                                final_answers.update({str(k): str(v) for k, v in raw_ans.items()})
                    batch_success = True
                    break
                except Exception as e:
                    last_batch_err = e
                    err_str = str(e)
                    logger.warning(f"Batch solve attempt {attempt + 1} with {m_name} failed: {e}")
                    if "503" in err_str or "high demand" in err_str.lower() or "unavailable" in err_str.lower():
                        logger.info(f"Model {m_name} under high demand, falling back to next model...")
                        break
                    if "429" in err_str:
                        if attempt < max_attempts - 1:
                            import time
                            time.sleep(2.0)
                            continue
                    break
            if batch_success:
                break

        if not batch_success and last_batch_err:
            logger.error(f"Error solving batch [{i} to {i+batch_size}]: {last_batch_err}")
            raise last_batch_err

    return final_answers

async def generate_mistake_autopsy(
    question: Question,
    client: genai.Client,
    user_answer: Optional[str] = None,
    correct_answer: Optional[str] = None
) -> MistakeAutopsyResponse:
    """
    Stage 3 (Review): Generates on-demand deep step-by-step autopsy ONLY when the user
    clicks 'AI Mistake Autopsy' on a specific wrong or skipped question.
    """
    q_info = {
        "id": question.id,
        "section": question.section,
        "type": question.type,
        "text": question.text,
        "options": question.options.model_dump() if hasattr(question.options, "model_dump") else question.options,
        "user_answer": user_answer or "Unattempted / Skipped",
        "verified_correct_answer": correct_answer or question.correct_answer or "Unknown"
    }

    prompt = f"""
You are a master competitive exam mentor analyzing a student's mistake or skipped question.
Perform a surgical "AI Mistake Autopsy" on this question:

{json.dumps(q_info, indent=2)}

Provide:
1. 'root_cause': Root-cause diagnosis of the error (one of: 'Conceptual Gap', 'Sign/Calculation Slip', 'Misread Constraint', 'Distractor Trap', 'Time Trap').
2. 'core_concept': The exact theoretical or mathematical principle/topic tested (e.g. 'Rotational Dynamics', 'Permutations & Combinations').
3. 'formula_used': Crucial formula(s) or theorems used to solve this, formatted in LaTeX ($...$).
4. 'step_by_step_solution': A list of clear, logical, concise steps leading directly to the correct answer with LaTeX math.
5. 'time_saver_shortcut': Exam-hall speed hack, elimination tactic, or sanity check to solve this in under 60 seconds.
6. 'common_trap': An insightful breakdown of why students get this question wrong, distractors that trap test-takers, or calculation/conceptual pitfalls.
"""

    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=MistakeAutopsyResponse,
        temperature=0.2,
    )

    solver_model = os.getenv("GEMINI_SOLVER_MODEL", "gemini-3.6-flash")
    fallback_pool = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"]
    models_to_try = [solver_model] + [m for m in fallback_pool if m != solver_model]

    last_err = None
    for m_name in models_to_try:
        max_attempts = 2
        for attempt in range(max_attempts):
            try:
                response = client.models.generate_content(
                    model=m_name,
                    contents=prompt,
                    config=config,
                )

                if response.parsed:
                    return response.parsed
                elif response.text:
                    data = json.loads(response.text)
                    return MistakeAutopsyResponse.model_validate(data)
                else:
                    raise ValueError("Empty autopsy response.")
            except Exception as e:
                last_err = e
                err_str = str(e)
                logger.warning(f"Autopsy query attempt {attempt + 1} with {m_name} failed: {e}")
                if "503" in err_str or "high demand" in err_str.lower() or "unavailable" in err_str.lower():
                    logger.info(f"Model {m_name} under high demand, falling back to next model...")
                    break
                if "429" in err_str:
                    if attempt < max_attempts - 1:
                        import time
                        time.sleep(2.0)
                        continue
                break
    if last_err:
        logger.error(f"Failed to generate mistake autopsy: {last_err}")
        # Return graceful structured fallback
        return MistakeAutopsyResponse(
            root_cause="Conceptual Gap",
            core_concept="Conceptual Analysis",
            formula_used="Applicable standard formulas",
            step_by_step_solution=[
                f"Verify the question premise: {question.text[:120]}...",
                f"Correct answer is {correct_answer or question.correct_answer or 'indicated in key'}.",
                "Check for sign conventions and boundary constraints."
            ],
            time_saver_shortcut="Plug in boundary values or eliminate dimensional inconsistencies first.",
            common_trap=f"Review question constraints carefully. (AI note: {str(last_err)})"
        )

async def generate_weakness_drill(
    wrong_questions: List[Question],
    client: genai.Client,
    exam_mode: str = "CUSTOM"
) -> ExamPaper:
    """
    Generates a targeted 5-question mini-quiz (10-minute timer) targeting the exact
    concepts missed or skipped by the user, formatted in the standard ExamPaper schema.
    """
    sampled_questions = wrong_questions[:5]
    mistake_context = [
        {
            "section": q.section,
            "type": q.type,
            "text": q.text,
            "correct_answer": q.correct_answer
        }
        for q in sampled_questions
    ]

    prompt = f"""
You are an expert exam setter. A student recently took an exam ({exam_mode}) and made mistakes
or struggled on the following questions:
{json.dumps(mistake_context, indent=2)}

Generate a focused "AI Weakness Drill" containing EXACTLY 5 new, high-yield practice questions
that target the identical concepts, tricky variants, or calculation methods of the questions missed.

REQUIREMENTS:
1. Set 'exam_title' to 'AI Weakness Drill: Adaptive Recovery Test'.
2. Set 'exam_mode' to '{exam_mode}'.
3. Set 'duration_minutes' to 10.
4. Include all sections relevant to the missed questions.
5. Create exactly 5 questions (IDs 1 through 5).
6. Provide accurate 'correct_answer' for each question (e.g., 'A', 'B', 'C', 'D' for MCQ, or number for NAT).
7. Ensure all mathematical expressions are cleanly wrapped in LaTeX ($...$ or $$...$$).
8. For MCQ questions, provide options A, B, C, D. For NAT questions, set options to null.
"""

    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=ExamPaper,
        temperature=0.3,
    )

    solver_model = os.getenv("GEMINI_SOLVER_MODEL", "gemini-3.6-flash")
    fallback_pool = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"]
    models_to_try = [solver_model] + [m for m in fallback_pool if m != solver_model]

    last_err = None
    for m_name in models_to_try:
        max_attempts = 2
        for attempt in range(max_attempts):
            try:
                response = client.models.generate_content(
                    model=m_name,
                    contents=prompt,
                    config=config,
                )

                if response.parsed:
                    return response.parsed
                elif response.text:
                    data = json.loads(response.text)
                    return ExamPaper.model_validate(data)
                else:
                    raise ValueError("Empty response from weakness drill generator.")
            except Exception as e:
                last_err = e
                err_str = str(e)
                logger.warning(f"Weakness drill query attempt {attempt + 1} with {m_name} failed: {e}")
                if "503" in err_str or "high demand" in err_str.lower() or "unavailable" in err_str.lower():
                    logger.info(f"Model {m_name} under high demand, falling back to next model...")
                    break
                if "429" in err_str:
                    if attempt < max_attempts - 1:
                        import time
                        time.sleep(2.0)
                        continue
                break

    if last_err:
        logger.error(f"Failed to generate weakness drill: {last_err}")
        raise last_err
