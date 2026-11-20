import os
import sys
import json
import logging
from typing import Optional

# Ensure backend directory is in sys.path for robust module resolution
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from google.genai.errors import APIError

from schemas import (
    ExamPaper,
    SolveBatchRequest,
    BatchSolveResult,
    MistakeAutopsyRequest,
    MistakeAutopsyResponse,
    WeaknessDrillRequest
)
from gemini_client import get_gemini_client
from pdf_parser import parse_exam_pdf
from ai_solver import (
    batch_solve_questions,
    generate_mistake_autopsy,
    generate_weakness_drill
)

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(ENV_PATH, override=True)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mockshift")

app = FastAPI(
    title="MockShift API",
    description="Bring-Your-Own-Paper (BYOP) CBT Exam Simulator Backend with Google Sign-In, BYOK, & Drive Support",
    version="1.1.0"
)

# Enable CORS for seamless local and remote dev
cors_origins_env = os.getenv("CORS_ORIGINS", "*").strip()
cors_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Path to static frontend files
FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
SAMPLE_PAPER_PATH = os.path.join(os.path.dirname(__file__), "sample_paper.json")
FULL_PAPER_PATH = os.path.join(os.path.dirname(__file__), "full_cat_mock_paper.json")

def handle_gemini_error(ae: Exception) -> HTTPException:
    err_str = str(ae)
    code = getattr(ae, "code", None)
    msg = getattr(ae, "message", None) or err_str

    if "503" in err_str or "high demand" in err_str.lower() or "unavailable" in err_str.lower():
        return HTTPException(
            status_code=503,
            detail="Google AI Studio is experiencing temporary high demand right now. Spikes in public API traffic usually clear within 10–20 seconds. Please wait a moment and click Upload & Parse again!"
        )
    elif "429" in err_str or "quota" in err_str.lower() or "rate" in err_str.lower():
        return HTTPException(
            status_code=429,
            detail="Gemini API rate limit reached. Please wait a few seconds before retrying or provide a personal API key in Key settings."
        )
    elif "400" in err_str and ("key" in err_str.lower() or "api_key" in err_str.lower()):
        return HTTPException(
            status_code=400,
            detail="Gemini API Key appears invalid. Please verify your API key in MockShift settings or Google AI Studio."
        )

    # Return the actual exception message from google-genai without masking
    status_code = code if isinstance(code, int) and code in [400, 401, 402, 403, 404, 429, 503] else 500
    return HTTPException(status_code=status_code, detail=f"Gemini API Error: {msg}")

@app.get("/health")
async def cloud_health_check():
    """Fast cloud platform health check endpoint (Render, Railway, Cloud Run)."""
    return {"status": "ok", "service": "MockShift"}

@app.get("/api/health")
async def health_check(x_gemini_api_key: Optional[str] = Header(default=None)):
    load_dotenv(ENV_PATH, override=True)
    user_key = (x_gemini_api_key or "").strip()
    env_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    has_user_key = bool(user_key and user_key != "null" and user_key != "undefined")
    has_env_key = bool(env_key and env_key != "your_gemini_api_key_here")

    return {
        "status": "healthy",
        "gemini_configured": has_user_key or has_env_key,
        "key_source": "user_byok" if has_user_key else ("server_env" if has_env_key else "none"),
        "message": "MockShift backend is active and 100% stateless."
    }

@app.post("/api/verify-key")
async def verify_key(x_gemini_api_key: Optional[str] = Header(default=None)):
    """
    Validates a user-supplied or server Gemini API key by making a lightweight query.
    Allows frontend BYOK modal to provide instant user feedback.
    """
    client = get_gemini_client(x_gemini_api_key)
    try:
        # Step 1: Verify key authenticity with Google models API
        list(client.models.list())
    except Exception as e:
        logger.error(f"API key authentication failed: {e}")
        raise HTTPException(
            status_code=401,
            detail=f"Gemini API authentication failed: {str(e)}"
        )

    # Step 2: Probe generation quota / prepayment credits
    try:
        model_name = os.getenv("GEMINI_EXTRACT_MODEL", "gemini-3.5-flash-lite")
        client.models.generate_content(
            model=model_name,
            contents="Respond with only: OK",
        )
        return {
            "valid": True,
            "source": "user_byok" if x_gemini_api_key else "server_env",
            "message": "Gemini API key is active and fully authorized!"
        }
    except Exception as e:
        err_str = str(e)
        logger.warning(f"Key verification generation probe note: {err_str}")
        if "402" in err_str or "prepayment credits are depleted" in err_str.lower():
            return {
                "valid": True,
                "warning": True,
                "source": "user_byok" if x_gemini_api_key else "server_env",
                "message": "Key is valid & authenticated, but this Google AI Studio project has depleted its prepayment credits ($0 balance). Add credits or use a free-tier key."
            }
        elif "429" in err_str or "quota" in err_str.lower():
            return {
                "valid": True,
                "warning": True,
                "source": "user_byok" if x_gemini_api_key else "server_env",
                "message": "Key is valid & authenticated, but the temporary rate limit was reached. You can still proceed once the window resets."
            }
        return {
            "valid": True,
            "source": "user_byok" if x_gemini_api_key else "server_env",
            "message": "Gemini API key verified!"
        }

@app.get("/api/sample-paper", response_model=ExamPaper)
async def get_sample_paper():
    """
    Returns a built-in benchmark mock paper (12 questions with diverse math & question types)
    allowing immediate testing with 0 API calls and zero network latency.
    """
    if os.path.exists(SAMPLE_PAPER_PATH):
        try:
            with open(SAMPLE_PAPER_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            return ExamPaper.model_validate(data)
        except Exception as e:
            logger.error(f"Failed to read sample paper: {e}")
            raise HTTPException(status_code=500, detail="Sample paper could not be read.")
    raise HTTPException(status_code=404, detail="Sample paper file not found.")

@app.get("/api/full-paper", response_model=ExamPaper)
async def get_full_paper():
    """
    Returns the full authentic 68-question CAT Mock Paper (VARC: 24, DILR: 22, QA: 22)
    from the original CBT exam suite with 0 API calls.
    """
    if os.path.exists(FULL_PAPER_PATH):
        try:
            with open(FULL_PAPER_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            return ExamPaper.model_validate(data)
        except Exception as e:
            logger.error(f"Failed to read full paper: {e}")
            raise HTTPException(status_code=500, detail="Full paper could not be read.")
    raise HTTPException(status_code=404, detail="Full paper file not found.")

@app.post("/api/parse-pdf", response_model=ExamPaper)
async def api_parse_pdf(
    question_pdf: UploadFile = File(...),
    answer_key_pdf: Optional[UploadFile] = File(None),
    exam_mode: str = Form("CAT"),
    duration_minutes: Optional[int] = Form(None),
    x_gemini_api_key: Optional[str] = Header(default=None)
):
    """
    Stage 1: Parses an uploaded PDF question paper (plus optional separate answer key PDF)
    into an ExamPaper JSON schema using PyMuPDF local text check + gemini-3.5-flash-lite.
    Zero server database, token-optimized (does not solve unkeyed questions).
    Accepts user BYOK via X-Gemini-Api-Key header.
    """
    client = get_gemini_client(x_gemini_api_key)

    try:
        q_bytes = await question_pdf.read()
        if not q_bytes:
            raise HTTPException(status_code=400, detail="Uploaded Question Paper PDF is empty.")

        ak_bytes = None
        if answer_key_pdf:
            ak_bytes = await answer_key_pdf.read()

        paper = await parse_exam_pdf(
            question_pdf_bytes=q_bytes,
            client=client,
            answer_key_bytes=ak_bytes,
            exam_mode=exam_mode,
            duration_minutes=duration_minutes
        )
        return paper
    except HTTPException:
        raise
    except APIError as ae:
        raise handle_gemini_error(ae)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error parsing PDF: {e}")
        raise handle_gemini_error(e)

@app.post("/api/solve-batch", response_model=BatchSolveResult)
async def api_solve_batch(
    payload: SolveBatchRequest,
    x_gemini_api_key: Optional[str] = Header(default=None)
):
    """
    Stage 2: Batches attempted questions that have missing answers (batches of 10-15)
    to gemini-3.8-flash, returning ONLY the final answer keys (no verbose solutions).
    Accepts user BYOK via X-Gemini-Api-Key header.
    """
    client = get_gemini_client(x_gemini_api_key)

    try:
        answers = await batch_solve_questions(payload.questions, client=client)
        return BatchSolveResult(answers=answers)
    except HTTPException:
        raise
    except APIError as ae:
        raise handle_gemini_error(ae)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in batch solve: {e}")
        raise handle_gemini_error(e)

@app.post("/api/mistake-autopsy", response_model=MistakeAutopsyResponse)
async def api_mistake_autopsy(
    payload: MistakeAutopsyRequest,
    x_gemini_api_key: Optional[str] = Header(default=None)
):
    """
    Stage 3: On-demand AI Mistake Autopsy for a single wrong or skipped question.
    Generates core concept, formula in LaTeX, step-by-step solution, and common traps.
    Accepts user BYOK via X-Gemini-Api-Key header.
    """
    client = get_gemini_client(x_gemini_api_key)

    try:
        autopsy = await generate_mistake_autopsy(
            question=payload.question,
            client=client,
            user_answer=payload.user_answer,
            correct_answer=payload.correct_answer
        )
        return autopsy
    except HTTPException:
        raise
    except APIError as ae:
        raise handle_gemini_error(ae)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error generating autopsy: {e}")
        raise handle_gemini_error(e)

@app.post("/api/generate-drill", response_model=ExamPaper)
@app.post("/api/weakness-drill", response_model=ExamPaper)
async def api_weakness_drill(
    payload: WeaknessDrillRequest,
    x_gemini_api_key: Optional[str] = Header(default=None)
):
    """
    Generates an adaptive 5-question mini-quiz (10 minutes) targeting the exact concepts
    the student struggled with during the exam.
    Accepts user BYOK via X-Gemini-Api-Key header.
    """
    client = get_gemini_client(x_gemini_api_key)

    try:
        drill_paper = await generate_weakness_drill(
            wrong_questions=payload.wrong_questions,
            client=client,
            exam_mode=payload.exam_mode or "CUSTOM"
        )
        return drill_paper
    except HTTPException:
        raise
    except APIError as ae:
        raise handle_gemini_error(ae)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in weakness drill generation: {e}")
        raise handle_gemini_error(e)

# Mount frontend directory to serve index.html and all static assets (styles, js, etc.)
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
