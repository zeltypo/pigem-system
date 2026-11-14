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

    cropped_back = None

    ocr_back_input = None

    if back_bytes:

        _, cropped_back = _quality.enhance_and_crop(back_bytes)

        ocr_back_input = cropped_back if cropped_back else back_bytes

    cropped_front_url = (
        _screening._upload_cropped_image("PRE", "front", cropped_front) or ""
        if cropped_front
        else ""
    )

    cropped_back_url = (
        _screening._upload_cropped_image("PRE", "back", cropped_back) or ""
        if cropped_back
        else ""
    )

    ocr_result = _gemini.extract_id_text_with_fallback(
        ocr_front_input,
        primary_back=ocr_back_input,
        raw_front=front_bytes,
        raw_back=back_bytes,
        id_type=id_type,
    )

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

        "cropped_front_url": cropped_front_url,

        "cropped_back_url": cropped_back_url,

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

@app.get("/api/tester-sync")

@app.get("/tester-sync")

def get_tester_sync():

    import json as _json
    import urllib.request as _ureq

    base_url = _screening._supabase_url()
    key = _screening._supabase_key()
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Cache-Control": "no-cache"}
    try:
        req = _ureq.Request(f"{base_url}/rest/v1/qa_tester_sync?id=eq.master_v3&select=state,updated_at", headers=headers, method="GET")
        with _ureq.urlopen(req, timeout=6) as resp:
            rows = _json.loads(resp.read().decode("utf-8"))
            if isinstance(rows, list) and rows and isinstance(rows[0].get("state"), dict):
                return {"ok": True, "source": "qa_tester_sync", "state": rows[0]["state"], "updated_at": rows[0].get("updated_at")}
    except Exception:
        pass
    try:
        req2 = _ureq.Request(f"{base_url}/storage/v1/object/authenticated/documents/qa_tester_isolated/state.json", headers=headers, method="GET")
        with _ureq.urlopen(req2, timeout=6) as resp2:
            state_obj = _json.loads(resp2.read().decode("utf-8"))
            if isinstance(state_obj, dict):
                return {"ok": True, "source": "isolated_storage", "state": state_obj}
    except Exception:
        pass
    return {"ok": True, "source": "empty", "state": {}}

@app.post("/api/tester-sync")

@app.post("/tester-sync")

async def save_tester_sync(request: Request):

    import json as _json
    import urllib.request as _ureq

    body_bytes = await request.body()
    try:
        payload = _json.loads(body_bytes.decode("utf-8") or "{}")
    except Exception:
        payload = {}
    state_obj = payload.get("state") if isinstance(payload.get("state"), dict) else payload
    base_url = _screening._supabase_url()
    key = _screening._supabase_key()
    saved_sources = []
    try:
        row_bytes = _json.dumps({"id": "master_v3", "state": state_obj}).encode("utf-8")
        req = _ureq.Request(
            f"{base_url}/rest/v1/qa_tester_sync",
            data=row_bytes,
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            method="POST",
        )
        with _ureq.urlopen(req, timeout=6) as resp:
            if 200 <= resp.status < 300:
                saved_sources.append("qa_tester_sync")
    except Exception:
        pass
    try:
        raw_state = _json.dumps(state_obj).encode("utf-8")
        req2 = _ureq.Request(
            f"{base_url}/storage/v1/object/documents/qa_tester_isolated/state.json",
            data=raw_state,
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "x-upsert": "true",
                "Cache-Control": "no-cache, no-store, must-revalidate",
            },
            method="POST",
        )
        with _ureq.urlopen(req2, timeout=6) as resp2:
            if 200 <= resp2.status < 300:
                saved_sources.append("isolated_storage")
    except Exception:
        pass
    return {"ok": bool(saved_sources), "saved_to": saved_sources}

