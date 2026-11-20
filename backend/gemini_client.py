import os
import logging
from typing import Optional
from fastapi import Header, HTTPException
from dotenv import load_dotenv
from google import genai

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(ENV_PATH, override=True)
logger = logging.getLogger("gemini_client")

def get_gemini_client(x_gemini_api_key: Optional[str] = Header(default=None)) -> genai.Client:
    """
    Per-request Gemini Client dependency.
    Prioritizes user-supplied Bring-Your-Own-Key (BYOK) from request header X-Gemini-Api-Key.
    Falls back to server environment variable GEMINI_API_KEY.
    Strictly never logs or persists user API keys.
    """
    # Safely extract string if called directly or via FastAPI Header dependency
    raw_key = x_gemini_api_key if isinstance(x_gemini_api_key, str) else None
    cleaned_user_key = (raw_key or "").strip()
    if cleaned_user_key and cleaned_user_key not in ["null", "undefined"]:
        try:
            return genai.Client(api_key=cleaned_user_key)
        except Exception as e:
            logger.error(f"Failed to initialize genai.Client with user key: {e}")
            raise HTTPException(
                status_code=400,
                detail=f"Gemini Client Initialization Error: {str(e)}"
            )

    # Fallback to server environment key
    load_dotenv(ENV_PATH, override=True)
    env_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if env_key and env_key != "your_gemini_api_key_here":
        try:
            return genai.Client(api_key=env_key)
        except Exception as e:
            logger.error(f"Failed to initialize genai.Client with server env key: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Server Gemini Key Initialization Error: {str(e)}"
            )

    # Neither user key nor server key is configured
    raise HTTPException(
        status_code=401,
        detail=(
            "No Gemini API Key provided. Please open 'API Key' settings in MockShift "
            "to paste your Google AI Studio Gemini API Key (BYOK), or configure GEMINI_API_KEY in backend/.env."
        )
    )
