# ============================================================================
# PIGEM STUDY DUPLICATE — api/index.py (FastAPI Main Entry Point & Router)
# ============================================================================
# ROLE IN ARCHITECTURE:
#   This is the main Vercel Serverless Python entry point. All `/api/*` requests
#   from the browser or Supabase pg_cron are routed here via `vercel.json`.
#
# KEY ENDPOINTS TO KNOW FOR DEFENSE:
#   1. GET  /api/health         -> Checks live status of OpenAI (gpt-6.2-sol + gpt-5.4),
#                                  Azure Document Intelligence, OpenCV, reCAPTCHA, SMTP,
#                                  Supabase, and the background screening worker.
#   2. POST /api/verify-captcha -> Verifies Google reCAPTCHA v2 token and issues a
#                                  signed HMAC `screening_ticket` for application intake.
#   3. POST /api/screen/queue   -> Enqueues a new application or customer resubmission
#                                  into `pigem_private.screening_jobs` and immediately
#                                  triggers one background worker pass (`run_one()`).
#   4. POST /api/screen/worker  -> Called every 1 minute by Supabase pg_cron (authenticated
#                                  with `SCREENING_WORKER_SECRET`) to process queued IDs.
#   5. POST /api/screen         -> On-demand staff screening endpoint (requires verified
#                                  Agent/Manager session token).
#   6. POST /api/notify         -> Sends transactional HTML emails via Gmail SMTP
#                                  (Port 465 SSL with Port 587 STARTTLS automatic fallback).
#   7. POST /api/polite-remark  -> Uses GPT-5.4 to rewrite raw Agent correction notes into
#                                  a polite, customer-friendly correction message.
# ============================================================================

from hmac import compare_digest
from uuid import uuid4
from os import getenv
from pathlib import Path
import sys
from typing import Any, Dict, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel

_API_DIRECTORY = str(Path(__file__).resolve().parent)
if _API_DIRECTORY not in sys.path:
    sys.path.insert(0, _API_DIRECTORY)

import _ai
import _auth
import _idp
import _mailer
import _openai_client
import _screening_queue

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
    application_intake: bool = False


class ScreeningIntake(BaseModel):
    application_id: str
    ticket: Optional[str] = ""
    resubmission: bool = False


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
# [STUDY NOTE — health]: Health-check endpoint returning configuration & readiness flags for OpenAI, Azure DI, OpenCV, reCAPTCHA, SMTP, and Supabase.
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
        "openai_quality_model": _openai_client.configured_quality_model(),
        "provider": "openai",
        "idp": idp_ok,
        "idp_provider": _idp.provider_name(),
        "opencv": True,
        "ocr": idp_ok,
        "auto_screening_ready": idp_ok and openai_ok,
        "recaptcha": recaptcha_ok,
        "recaptcha_site_key": (getenv("RECAPTCHA_SITE_KEY") or "").strip(),
        "smtp": smtp_ok,
        "supabase_check": _auth.is_configured(),
        "background_screening": _screening_queue.enabled(),
        "active_screenings": 0,
    }


@app.post("/api/verify-captcha")
@app.post("/verify-captcha")
# [STUDY NOTE — verify_captcha]: Verifies Google reCAPTCHA v2 token and attaches a signed intake ticket when called from the application form.
def verify_captcha(data: CaptchaVerifyRequest, request: Request):
    client_ip = request.client.host if request.client else ""
    result = _auth.verify_recaptcha(data.token, client_ip)
    if result.get("verified") is True and data.application_intake:
        result["screening_ticket"] = _screening_queue.intake_ticket()
    return result


@app.post("/api/screen/queue")
# [STUDY NOTE — enqueue_screening]: Enqueues an application (or customer resubmission) into the durable Postgres queue and immediately runs one worker pass.
def enqueue_screening(data: ScreeningIntake):
    if not _screening_queue.enabled():
        raise HTTPException(status_code=503, detail="Background screening is not configured.")
    ticket_str = (data.ticket or "").strip()
    if data.resubmission and not ticket_str:
        ticket_str = _screening_queue.intake_ticket()
    if len(ticket_str) > 150 or not _screening_queue.valid_ticket(ticket_str):
        raise HTTPException(status_code=403, detail="Application verification expired.")
    queued = False
    try:
        queued = bool(_screening_queue.rpc("pigem_enqueue_screening", {
            "app_id": data.application_id,
            "intake_ticket": ticket_str.split(".")[1],
        }))
    except Exception:
        queued = False
    # Kick off one background pass immediately, and also directly screen this application if the SQL queue skipped it
    # (e.g. on customer Needs Correction resubmissions or Under Agent Review status).
    try:
        if queued:
            _screening_queue.run_one()
        _screening_queue.ensure_application_screened(data.application_id)
    except Exception:
        pass
    return {"queued": True}


@app.post("/api/screen/worker")
# [STUDY NOTE — run_screening_worker]: Cron worker endpoint called every minute by Supabase pg_cron using SCREENING_WORKER_SECRET.
def run_screening_worker(request: Request):
    if not _screening_queue.enabled():
        raise HTTPException(status_code=503, detail="Background screening is not configured.")
    expected = "Bearer " + getenv("SCREENING_WORKER_SECRET", "")
    if not compare_digest(request.headers.get("authorization", "").encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Worker authorization required.")
    return {"processed": _screening_queue.run_one()}


@app.get("/api/screen/session")
# [STUDY NOTE — screening_session]: Checks whether the current Agent/Manager holds a verified private screening session token.
def screening_session(request: Request):
    try:
        _auth.require_screening_staff(request.headers.get("authorization", ""))
    except HTTPException as error:
        print(f"screening stage=session status={error.status_code}", flush=True)
        raise
    print("screening stage=session status=verified", flush=True)
    return {"verified": True}


@app.post("/api/screen")
@app.post("/screen")
# [STUDY NOTE — screen_document]: On-demand staff screening endpoint that runs the 4-stage conditional pipeline in a background threadpool.
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
    previous_response_id: str = Form(default=""),
    browser_prepared_front: bool = Form(default=False),
    browser_prepared_back: bool = Form(default=False),
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
    check_id = uuid4().hex
    print(f"screening check={check_id} stage=upload accepted", flush=True)

    def run_check():
        try:
            result = _ai.run_conditional_screening_pipeline(
                front_bytes,
                back_bytes,
                entered,
                check_id=check_id,
                previous_response_id=previous_response_id,
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None
        result["check_id"] = check_id
        return result

    return await run_in_threadpool(run_check)


@app.post("/api/screen-async")
@app.post("/screen-async")
def document_screening_async_notice():
    return {
        "queued": False,
        "screened": False,
        "reason": "Document screening runs through the conditional background queue or when an authorized Agent opens an application.",
    }


@app.post("/api/notify")
@app.post("/notify")
# [STUDY NOTE — send_notification]: Dispatches transactional HTML emails through Gmail SMTP (Port 465 SSL / Port 587 STARTTLS fallback).
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
# [STUDY NOTE — generate_polite_remark]: Uses GPT-5.4 to turn rough Agent notes into a polite, clear customer correction message.
def generate_polite_remark(data: PoliteRemarkRequest, user=Depends(_auth.require_screening_staff)):
    return _ai.write_polite_remark(data.raw_remark, data.chosen_field or "auto")
