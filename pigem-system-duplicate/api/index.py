"""
================================================================================
FILE: api/index.py
PURPOSE:
  Main Cloud Serverless FastAPI Entrypoint hosted on Vercel's Python Runtime.
  Whenever the frontend website (https://pigem-system-web.vercel.app) calls any
  "/api/..." URL, Vercel routes that HTTPS request directly to the `app` object
  defined in this file—no local computer or manual server is needed.

ENDPOINTS PROVIDED:
  1. GET  /api/health         -> Checks live status of FastAPI, Gemini, OpenCV,
                                 reCAPTCHA, Gmail SMTP, and Supabase Cloud.
  2. POST /api/verify-captcha -> Verifies Google reCAPTCHA v2 checkbox tokens.
  3. POST /api/screen-async   -> Runs Two-Stage OpenCV + Gemini Vision ID
                                 screening on a saved application (Front & Back).
  4. POST /api/screen         -> Runs direct ID file screening for testing/review.
  5. POST /api/notify         -> Sends clean HTML emails via Gmail SMTP strictly
                                 to @gmail.com Customer accounts.
  6. POST /api/polite-remark  -> Rewrites staff notes into polite plain English.
================================================================================
"""

# ------------------------------------------------------------------------------
# IMPORTS EXPLANATION (Why each library is imported in the cloud):
# ------------------------------------------------------------------------------
# `Path` (from standard `pathlib`) locates this `api/` folder inside Vercel's
# Linux container so sibling helper modules (`_auth`, `_gemini`, etc.) load cleanly.
from pathlib import Path

# `sys` adds the `api/` directory to Python's module search list (`sys.path`)
# so Vercel Serverless Functions can import `_auth`, `_gemini`, `_mailer`, etc.
import sys

# Standard Python type hints (`Any`, `Dict`, `Optional`) document the expected
# JSON fields inside incoming HTTP request bodies.
from typing import Any, Dict, Optional

# `FastAPI` creates the cloud REST web application; `Depends` runs auth checks;
# `File`, `Form`, and `UploadFile` parse uploaded ID images; `Request` reads
# basic HTTP metadata such as the visitor's IP address for reCAPTCHA validation.
from fastapi import Depends, FastAPI, File, Form, Request, UploadFile

# `CORSMiddleware` allows the browser frontend pages to call `/api/*` securely
# over HTTPS without Cross-Origin Resource Sharing (CORS) browser blocks.
from fastapi.middleware.cors import CORSMiddleware

# `BaseModel` (from `pydantic`) automatically validates incoming JSON payloads
# (for example checking that `application_id` or `token` is a string).
from pydantic import BaseModel

# Register the `api/` folder in `sys.path` inside the Vercel serverless container
# before importing our five internal helper modules prefixed with `_`.
_API_DIRECTORY = str(Path(__file__).resolve().parent)
if _API_DIRECTORY not in sys.path:
    sys.path.insert(0, _API_DIRECTORY)

# Import internal project modules (prefixed with `_` so Vercel treats only
# `api/index.py` as the single serverless entrypoint):
# - `_auth`      : Validates Supabase login tokens and Google reCAPTCHA v2 tokens.
import _auth

# - `_gemini`    : Performs Google Gemini Vision OCR, deterministic Python field
#                  matching (Name, Birth Date, ID Number), and polite phrasing.
import _gemini

# - `_mailer`    : Builds clean HTML emails and dispatches them via Gmail SMTP
#                  strictly to @gmail.com Customer addresses.
import _mailer

# - `_quality`   : Uses OpenCV to check blur, glare, brightness, and contrast,
#                  and creates a 4-corner cropped working copy of the Valid ID.
import _quality

# - `_screening` : Coordinates the end-to-end Two-Stage cloud screening workflow
#                  between Supabase Storage/PostgreSQL, OpenCV, and Gemini.
import _screening


# ------------------------------------------------------------------------------
# FASTAPI APPLICATION & CORS CONFIGURATION
# ------------------------------------------------------------------------------
# Vercel's Python runtime automatically detects this `app` variable and serves
# it online 24/7 as an ASGI serverless function.
app = FastAPI(title="PIGEM Cloud Requirements Screening & Notification API")

# Configure CORS headers so `fetch('/api/...')` calls from the web portals
# succeed across desktop and mobile browsers.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------------------
# REQUEST DATA MODELS (Pydantic Schemas for JSON Validation)
# ------------------------------------------------------------------------------
class CaptchaVerifyRequest(BaseModel):
    """JSON body sent by the browser after the user checks 'I'm not a robot'."""
    token: str


class AsyncScreenRequest(BaseModel):
    """JSON body sent after an application is saved to trigger cloud ID screening."""
    application_id: str


class EmailRequest(BaseModel):
    """JSON body used to send a transactional or promotional email to a Customer."""
    to: str
    subject: str
    message: Optional[str] = ""
    html_content: Optional[str] = None
    template_type: Optional[str] = "general"
    payload: Optional[Dict[str, Any]] = None


class PoliteRemarkRequest(BaseModel):
    """JSON body sent when an Agent clicks 'Compose Polite Message'."""
    raw_remark: str
    chosen_field: Optional[str] = "auto"


# ------------------------------------------------------------------------------
# 1. LIVE CLOUD HEALTH CHECK ENDPOINT
# ------------------------------------------------------------------------------
@app.get("/api/health")
@app.get("/health")
def health():
    """
    Returns live readiness flags for every cloud integration so the Admin Console
    can monitor whether Gemini, OpenCV, reCAPTCHA, Gmail SMTP, and Supabase are active.
    """
    # Check if GEMINI_API_KEY is configured in Vercel Environment Variables
    gemini_ok = _gemini.is_available()
    # Check if headless OpenCV (`cv2`) loaded properly in the cloud container
    opencv_ok = bool(_quality.is_available())
    # Check if Gmail SMTP (`SMTP_USER` and `SMTP_PASSWORD`) is configured
    smtp_ok = _mailer.is_configured()
    # Check if Google reCAPTCHA (`RECAPTCHA_SECRET_KEY`) is configured
    recaptcha_ok = _auth.is_recaptcha_configured()

    return {
        "status": "ok",
        "api": True,
        "gemini": gemini_ok,
        "opencv": opencv_ok,
        "ocr": gemini_ok,
        "auto_screening_ready": bool(opencv_ok and gemini_ok),
        "recaptcha": recaptcha_ok,
        "smtp": smtp_ok,
        "supabase_check": _auth.is_configured(),
        "active_screenings": 0,
    }


# ------------------------------------------------------------------------------
# 2. GOOGLE RECAPTCHA V2 SERVER-SIDE VERIFICATION ENDPOINT
# ------------------------------------------------------------------------------
@app.post("/api/verify-captcha")
@app.post("/verify-captcha")
def verify_captcha(data: CaptchaVerifyRequest, request: Request):
    """
    Validates the user's Google reCAPTCHA v2 token with Google's SiteVerify API
    so bots cannot bypass the Application Form or Login pages.
    """
    client_ip = request.client.host if request.client else ""
    return _auth.verify_recaptcha(data.token, client_ip)


# ------------------------------------------------------------------------------
# 3. ASYNCHRONOUS APPLICATION REQUIREMENTS SCREENING ENDPOINT
# ------------------------------------------------------------------------------
@app.post("/api/screen-async")
@app.post("/screen-async")
def screen_document_async(data: AsyncScreenRequest, user=Depends(_auth.require_login)):
    """
    Triggered right after a Customer submits or updates an application.
    Downloads Front & Back ID images from Supabase Storage, runs OpenCV quality
    and cropping, extracts printed ID text via Gemini Vision, compares fields,
    and saves preliminary findings for human Agent confirmation.
    """
    return _screening.run_application_screening(data.application_id)


# ------------------------------------------------------------------------------
# 4. DIRECT FILE SCREENING ENDPOINT
# ------------------------------------------------------------------------------
@app.post("/api/screen")
@app.post("/screen")
async def screen_document(
    id_front: UploadFile = File(...),
    id_back: Optional[UploadFile] = File(None),
    full_name: str = Form(""),
    first_name: str = Form(""),
    middle_name: str = Form(""),
    last_name: str = Form(""),
    birth_date: str = Form(""),
    id_type: str = Form(""),
    id_number: str = Form(""),
    user=Depends(_auth.require_login),
):
    """
    Accepts uploaded Valid ID image file(s) directly via multipart/form-data,
    runs OpenCV readability/cropping + Gemini Vision OCR + deterministic field
    comparison, and returns structured preliminary results.
    """
    front_bytes = await id_front.read()
    back_bytes = await id_back.read() if id_back is not None else None

    # Stage 1 & 2: Check readability and create an enhanced cropped working copy
    quality_result, cropped_front = _quality.enhance_and_crop(front_bytes)
    ocr_front_input = cropped_front if cropped_front else front_bytes

    ocr_back_input = None
    if back_bytes:
        _, cropped_back = _quality.enhance_and_crop(back_bytes)
        ocr_back_input = cropped_back if cropped_back else back_bytes

    # Extract printed text from Front (and Back if provided) using Gemini Vision
    ocr_result = _gemini.extract_id_text(ocr_front_input, ocr_back_input, id_type=id_type)

    # Compare Customer-entered fields against OCR-extracted ID text
    entered = {
        "full_name": full_name,
        "first_name": first_name,
        "middle_name": middle_name,
        "last_name": last_name,
        "birth_date": birth_date,
        "id_type": id_type,
        "id_number": id_number,
    }
    comparisons = _gemini.compare_fields(entered, ocr_result)
    notes = _gemini.write_guidance(quality_result, comparisons)

    return {
        "preliminary": True,
        "quality": quality_result,
        "ocr": ocr_result,
        "comparisons": comparisons,
        "ai": notes,
    }


# ------------------------------------------------------------------------------
# 5. CUSTOMER EMAIL NOTIFICATION ENDPOINT (GMAIL SMTP)
# ------------------------------------------------------------------------------
@app.post("/api/notify")
@app.post("/notify")
def send_notification(data: EmailRequest, user=Depends(_auth.require_login)):
    """
    Sends clean, RA 10173 privacy-safe HTML emails via Gmail SMTP strictly to
    @gmail.com Customer addresses (skips internal username-only staff accounts).
    """
    return _mailer.send(
        to=data.to,
        subject=data.subject,
        message=data.message or "",
        html_content=data.html_content,
        template_type=data.template_type or "general",
        payload=data.payload,
    )


# ------------------------------------------------------------------------------
# 6. POLITE CUSTOMER MESSAGE COMPOSER ENDPOINT
# ------------------------------------------------------------------------------
@app.post("/api/polite-remark")
@app.post("/polite-remark")
def generate_polite_remark(data: PoliteRemarkRequest, user=Depends(_auth.require_login)):
    """
    Converts a raw Agent or Validator note (for example 'blurry ID' or 'wrong DOB')
    into a polite, plain-English 2-sentence instruction for the Customer.
    """
    return _gemini.write_polite_remark(data.raw_remark, data.chosen_field or "auto")
