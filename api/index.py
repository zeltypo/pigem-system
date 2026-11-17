from os import getenv
from pathlib import Path
import sys
from typing import Any, Dict, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

_API_DIRECTORY = str(Path(__file__).resolve().parent)
if _API_DIRECTORY not in sys.path:
    sys.path.insert(0, _API_DIRECTORY)

import _ai
import _auth
import _idp
import _mailer
import _openai_client

app = FastAPI(title="PIGEM Cloud IDP Screening & Notification API")

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
    idp_ok = _idp.is_configured()
    smtp_ok = _mailer.is_configured()
    recaptcha_ok = _auth.is_recaptcha_configured()

    return {
        "status": "ok",
        "api": True,
        "openai": openai_ok,
        "openai_model": _openai_client.configured_model(),
        "provider": "openai",
        "idp": idp_ok,
        "idp_provider": _idp.provider_name(),
        "opencv": True,
        "ocr": idp_ok,
        "auto_screening_ready": idp_ok,
        "recaptcha": recaptcha_ok,
        "recaptcha_site_key": (getenv("RECAPTCHA_SITE_KEY") or "").strip(),
        "smtp": smtp_ok,
        "supabase_check": _auth.is_configured(),
        "active_screenings": 0,
    }


@app.post("/api/verify-captcha")
@app.post("/verify-captcha")
def verify_captcha(data: CaptchaVerifyRequest, request: Request):
    client_ip = request.client.host if request.client else ""
    return _auth.verify_recaptcha(data.token, client_ip)


@app.post("/api/screen")
@app.post("/screen")
async def screen_document(
    id_front: UploadFile = File(...),
    id_back: Optional[UploadFile] = File(default=None),
    full_name: str = Form(default=""),
    first_name: str = Form(default=""),
    middle_name: str = Form(default=""),
    last_name: str = Form(default=""),
    birth_date: str = Form(default=""),
    id_type: str = Form(default=""),
    id_number: str = Form(default=""),
    user=Depends(_auth.require_screening_staff),
):
    front_bytes = await id_front.read()
    back_bytes = await id_back.read() if id_back else None
    if not front_bytes:
        raise HTTPException(status_code=400, detail="Front ID image is required.")
    entered = {
        "full_name": full_name,
        "first_name": first_name,
        "middle_name": middle_name,
        "last_name": last_name,
        "birth_date": birth_date,
        "id_type": id_type,
        "id_number": id_number,
    }
    return _ai.run_idp_screening_pipeline(front_bytes, back_bytes, entered)


@app.post("/api/screen-async")
@app.post("/screen-async")
def document_screening_async_notice():
    return {
        "screened": False,
        "queued": False,
        "detail": "Screening runs on demand via the 4-step OpenCV + IDP + NLP + GPT-5.4 pipeline.",
    }


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
