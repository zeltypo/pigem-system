from pathlib import Path

import sys

from typing import Any, Dict, Optional

from fastapi import Depends, FastAPI, File, Form, Request, UploadFile

from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel

_API_DIRECTORY = str(Path(__file__).resolve().parent)

if _API_DIRECTORY not in sys.path:

    sys.path.insert(0, _API_DIRECTORY)

import _auth

import _gemini

import _mailer

import _quality

import _screening

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

class AsyncScreenRequest(BaseModel):

    application_id: str

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

    gemini_ok = _gemini.is_available()

    opencv_ok = bool(_quality.is_available())

    smtp_ok = _mailer.is_configured()

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

@app.post("/api/verify-captcha")

@app.post("/verify-captcha")

def verify_captcha(data: CaptchaVerifyRequest, request: Request):

    client_ip = request.client.host if request.client else ""

    return _auth.verify_recaptcha(data.token, client_ip)

@app.post("/api/screen-async")

@app.post("/screen-async")

def screen_document_async(data: AsyncScreenRequest, user=Depends(_auth.require_login)):

    return _screening.run_application_screening(data.application_id)

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

    front_bytes = await id_front.read()

    back_bytes = await id_back.read() if id_back is not None else None

    quality_result, cropped_front = _quality.enhance_and_crop(front_bytes)

    ocr_front_input = cropped_front if cropped_front else front_bytes

    ocr_back_input = None

    if back_bytes:

        _, cropped_back = _quality.enhance_and_crop(back_bytes)

        ocr_back_input = cropped_back if cropped_back else back_bytes

    ocr_result = _gemini.extract_id_text(ocr_front_input, ocr_back_input, id_type=id_type)

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

def generate_polite_remark(data: PoliteRemarkRequest, user=Depends(_auth.require_login)):

    return _gemini.write_polite_remark(data.raw_remark, data.chosen_field or "auto")
