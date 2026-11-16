from pathlib import Path

import sys

from typing import Any, Dict, Optional

from fastapi import HTTPException, Depends, FastAPI, Request

from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel

_API_DIRECTORY = str(Path(__file__).resolve().parent)

if _API_DIRECTORY not in sys.path:

    sys.path.insert(0, _API_DIRECTORY)

import _auth

import _ai

import _mailer

import _quality

app = FastAPI(title="PIGEM Cloud Requirements Screening & Notification API")

app.add_middleware(

    CORSMiddleware,

    allow_origins=["*"],

    allow_credentials=False,

    allow_methods=["GET", "POST", "OPTIONS"],

    allow_headers=["*"],

)

class CaptchaVerifyRequest(BaseModel):

    token: str

class EmailRequest(BaseModel):

    to: str

    subject: str

    message: Optional[str] = ""

    html_content: Optional[str] = None

    template_type: Optional[str] = "general"

    payload: Optional[Dict[str, Any]] = None

class PoliteRemarkRequest(BaseModel):

    raw_remark: str

    chosen_field: Optional[str] = "auto"

@app.get("/api/health")

@app.get("/health")

def health():

    openai_ok = _ai.is_available()

    opencv_ok = bool(_quality.is_available())

    smtp_ok = _mailer.is_configured()

    recaptcha_ok = _auth.is_recaptcha_configured()

    return {

        "status": "ok",

        "api": True,

        "openai": openai_ok,
        "provider": "openai",
        "configuration_only": True,

        "opencv": opencv_ok,

        "ocr": False,

        "auto_screening_ready": False,

        "recaptcha": recaptcha_ok,

        "smtp": smtp_ok,

        "supabase_check": _auth.is_configured(),

        "active_screenings": 0,

    }

@app.post("/api/verify-captcha")

@app.post("/verify-captcha")

def verify_captcha(data: CaptchaVerifyRequest, request: Request):

    client_ip = request.client.host if request.client else ""

    return _auth.verify_recaptcha(data.token, client_ip)

@app.post("/api/screen-async")
@app.post("/screen-async")
@app.post("/api/screen")
@app.post("/screen")
def document_screening_retired():
    raise HTTPException(status_code=410, detail="Staff review ID photos by hand.")

@app.post("/api/notify")

@app.post("/notify")

def send_notification(data: EmailRequest, user=Depends(_auth.require_login)):

    return _mailer.send(

        to=data.to,

        subject=data.subject,

        message=data.message or "",

        html_content=data.html_content,

        template_type=data.template_type or "general",

        payload=data.payload,

    )

@app.post("/api/polite-remark")

@app.post("/polite-remark")

def generate_polite_remark(data: PoliteRemarkRequest, user=Depends(_auth.require_screening_staff)):

    return _ai.write_polite_remark(data.raw_remark, data.chosen_field or "auto")

