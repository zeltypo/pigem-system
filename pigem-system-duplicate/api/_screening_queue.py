# ============================================================================
# PIGEM STUDY DUPLICATE — api/_screening_queue.py (Durable Background Queue Worker)
# ============================================================================
# ROLE IN ARCHITECTURE:
#   Manages the asynchronous background screening queue stored in Supabase
#   (`pigem_private.screening_jobs`).
#
# HOW IT WORKS:
#   1. `intake_ticket()` / `valid_ticket()`: Creates and verifies HMAC-SHA256 signed
#      tickets (valid for 20 minutes) after reCAPTCHA verification.
#   2. `download_raw_photo(url)`: Downloads raw ID bytes from any of the 11 allowed
#      Supabase Storage buckets (`documents`, `documents-1` .. `documents-10`) or
#      decodes `data:image/...;base64,...` fallback URLs.
#   3. `findings(payload, check_id, app_id)`: Runs the 4-stage conditional pipeline
#      in a stateless context (`prev_resp_id = ""`) and updates live stage progress
#      on the application row so Agents/Admins see real-time progress.
#   4. `run_one()`: Claims 1 job via `pigem_claim_screening`, runs `findings()`,
#      saves results via `pigem_finish_screening`, and posts an in-app notification
#      for Agents.
# ============================================================================

import hashlib
import hmac
import os
import secrets
import time
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

import httpx

import _ai
import _mailer

FIELD_LABELS = {
    "id_photo": "Clearer Valid ID Photo Upload",
    "name": "Applicant Name Update",
    "birth_date": "Birth Date Confirmation",
    "id_number": "Primary ID Number Verification",
}


def enabled():
    return all(os.getenv(key, "").strip() for key in (
        "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SCREENING_WORKER_SECRET"
    ))


def intake_ticket():
    if not enabled():
        return ""
    value = f"{int(time.time())}.{secrets.token_hex(24)}"
    signature = hmac.new(os.environ["SCREENING_WORKER_SECRET"].encode(), value.encode(), hashlib.sha256)
    return value + "." + signature.hexdigest()


def valid_ticket(ticket):
    try:
        stamp, nonce, signature = ticket.split(".")
        age = time.time() - int(stamp)
        expected = hmac.new(os.environ["SCREENING_WORKER_SECRET"].encode(),
                            f"{stamp}.{nonce}".encode(), hashlib.sha256).hexdigest()
        return 0 <= age <= 7200 and len(nonce) == 48 and hmac.compare_digest(expected, signature)
    except (ValueError, KeyError):
        return False


def _rest_headers() -> Dict[str, str]:
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    }


def rpc(name, data=None):
    response = httpx.post(
        os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/" + name,
        headers=_rest_headers(),
        json=data or {},
        timeout=12,
    )
    response.raise_for_status()
    return response.json()


def _get_application_row(app_id: str) -> Optional[Dict[str, Any]]:
    if not app_id or not enabled():
        return None
    try:
        url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/applications"
        resp = httpx.get(
            url,
            headers=_rest_headers(),
            params={
                "id": f"eq.{app_id}",
                "select": (
                    "id,ref_no,reference_no,full_name,birth_date,id_number,id_type,"
                    "id_image_url,id_front_path,id_back_image_url,id_back_path,"
                    "email,status,screening,corrected_copy,ai_log,created_at,updated_at"
                ),
            },
            timeout=10,
        )
        if resp.status_code == 200:
            rows = resp.json()
            if isinstance(rows, list) and rows:
                return rows[0]
    except Exception:
        pass
    return None


def _find_app_id_by_front_url(front_url: str) -> str:
    if not front_url or not enabled():
        return ""
    try:
        url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/applications"
        resp = httpx.get(
            url,
            headers=_rest_headers(),
            params={
                "or": f"(id_image_url.eq.{front_url},id_front_path.eq.{front_url})",
                "select": "id",
                "order": "updated_at.desc",
                "limit": "1",
            },
            timeout=8,
        )
        if resp.status_code == 200:
            rows = resp.json()
            if isinstance(rows, list) and rows:
                return str(rows[0].get("id") or "")
    except Exception:
        pass
    return ""


def _mark_manual_review_fallback(app_id: str, reason: str = "") -> None:
    if not app_id or not enabled():
        return
    row = _get_application_row(app_id)
    scr = dict((row.get("screening") or {}) if isinstance(row, dict) else {})
    msg = reason or "Automated screening unavailable — switched to Manual Agent Review. Inspect the ID photos and details manually."
    scr.update({
        "state": "manual_fallback",
        "background_state": "failed",
        "manual_fallback": True,
        "phase": "Manual Agent Review (Fallback Active)",
        "summary": msg,
        "final_recommendation": msg,
        "eta_seconds": 0,
    })
    _patch_application_row(app_id, {"screening": scr})


def _patch_application_row(app_id: str, patch_body: Dict[str, Any]) -> bool:
    if not app_id or not enabled():
        return False
    try:
        url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/applications"
        headers = _rest_headers()
        headers["Prefer"] = "return=minimal"
        resp = httpx.patch(
            url,
            headers=headers,
            params={"id": f"eq.{app_id}"},
            json=patch_body,
            timeout=10,
        )
        return resp.status_code in (200, 204)
    except Exception:
        return False


def _insert_notification(notif: Dict[str, Any]) -> None:
    if not enabled():
        return
    try:
        url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/notifications"
        headers = _rest_headers()
        headers["Prefer"] = "return=minimal"
        httpx.post(url, headers=headers, json=notif, timeout=8)
    except Exception:
        pass


_ALLOWED_STORAGE_PREFIXES = tuple(
    f"/storage/v1/object/public/{b}/{folder}/"
    for b in (
        "documents",
        "documents-1",
        "documents-2",
        "documents-3",
        "documents-4",
        "documents-5",
        "documents-6",
        "documents-7",
        "documents-8",
        "documents-9",
        "documents-10",
    )
    for folder in ("applications", "qr_sessions")
)


# [STUDY NOTE — download_raw_photo]: Downloads raw ID bytes from any of the 11 allowed Supabase Storage buckets (documents, documents-1..10) or decodes a Base64 Data URL.
def download_raw_photo(url: str) -> bytes:
    """Download raw ID image bytes from Supabase Storage (multi-bucket) or data URL WITHOUT running OpenCV."""
    if isinstance(url, str) and url.startswith("data:image/"):
        import base64
        parts = url.split(",", 1)
        if len(parts) == 2:
            raw_bytes = base64.b64decode(parts[1])
            if len(raw_bytes) > 12_000_000:
                raise ValueError("Photo too large")
            return raw_bytes
    allowed = urlsplit(os.environ["SUPABASE_URL"])
    source = urlsplit(url)
    if (source.scheme != "https" or source.netloc != allowed.netloc
            or not source.path.startswith(_ALLOWED_STORAGE_PREFIXES)):
        raise ValueError("Unsupported document location")
    data = bytearray()
    with httpx.stream("GET", url, timeout=20, follow_redirects=False) as response:
        response.raise_for_status()
        for block in response.iter_bytes():
            data.extend(block)
            if len(data) > 12_000_000:
                raise ValueError("Photo too large")
    return bytes(data)


# [STUDY NOTE — findings]: Runs the stateless 4-stage screening pipeline for a queued job and builds the structured findings JSON saved to the application.
def findings(payload: Dict[str, Any], check_id: str, app_id: str = "") -> Optional[Dict[str, Any]]:
    front_raw = download_raw_photo(payload["front"])
    back_raw = download_raw_photo(payload["back"]) if payload.get("back") else None

    app_row = _get_application_row(app_id) if app_id else None
    existing_scr = (app_row.get("screening") or {}) if isinstance(app_row, dict) else {}
    # Always run stateless per upload/revision to prevent cross-upload AI hallucination
    prev_resp_id = ""

    def on_stage(stage_name: str, quality_rep: Dict[str, Any]):
        if not app_row:
            return
        merged_scr = dict(existing_scr)
        merged_scr.update({
            "background_state": "running",
            "state": "layer2_running",
            "phase": "Quality Gate Complete — Verifying ID Details",
            "quality_gate": {
                "verdict": quality_rep.get("verdict"),
                "score": quality_rep.get("quality_score"),
                "issues": quality_rep.get("issues") or [],
            },
            "eta_seconds": 12,
        })
        _patch_application_row(app_id, {"screening": merged_scr})

    result = _ai.run_conditional_screening_pipeline(
        front_raw,
        back_raw,
        payload,
        check_id=check_id,
        previous_response_id=prev_resp_id,
        stage_callback=on_stage,
    )

    extraction = result["ocr"]
    if not extraction.get("available"):
        return None

    labels = {"name": "Name", "birth_date": "Birth date", "id_number": "ID number"}
    statuses = {"match": "match", "mismatch": "difference"}
    compared = {item["key"]: item["status"] for item in result["comparisons"]}
    guidance = result["ai"]
    quality_info = result.get("quality") or {}
    prep_info = quality_info.get("preprocessed") or {}

    built_findings = {
        "route": result.get("route", "good"),
        "triage": result.get("triage", guidance.get("triage", "yellow")),
        "autoNeedsCorrection": bool(guidance.get("auto_needs_correction")),
        "correctionType": guidance.get("correction_type", "none"),
        "targetFields": guidance.get("target_fields") or [],
        "queueSummary": guidance.get("queue_summary", ""),
        "finalRecommendation": guidance.get("final_recommendation", ""),
        "fields": [
            {"key": key, "label": label, "status": statuses.get(compared.get(key), "unreadable")}
            for key, label in labels.items()
        ],
        "unclearSides": [
            side
            for side, readable in [
                ("Front", extraction.get("front_readable")),
                ("Back", not back_raw or extraction.get("back_readable")),
            ]
            if not readable
        ],
        "unavailableSides": [],
        "failedReads": [],
        "duplicatePhotos": bool(quality_info.get("duplicate_front_back")),
        "photoIssues": quality_info.get("issues") or [],
        "detectedOtherType": (
            extraction.get("detected_document_type", "")
            if extraction.get("id_type_matches_declared") is False
            else ""
        ),
        "nlpValidation": result["nlp_validation"],
        "aiRecommendation": guidance.get("recommendation", ""),
        "aiFindings": guidance.get("findings") or [],
        "tamperingFlags": guidance.get("tampering_flags", []),
        "suggestedPoliteRemark": guidance.get("suggested_polite_remark", ""),
        "openaiResponseId": result.get("openai_response_id", ""),
        "stages": {
            "checkId": check_id,
            "qualityGate": {
                "model": quality_info.get("model", "gpt-6.2-sol"),
                "verdict": quality_info.get("verdict", "good"),
                "score": quality_info.get("quality_score", 85),
            },
            "photoPreparation": prep_info,
            "extraction": {
                "provider": extraction.get("provider", ""),
                "earlyStopped": bool(extraction.get("early_stopped")),
            },
        },
    }

    # Persist enhanced screening state & automatic RED Needs Correction directly on the application row
    if app_row:
        _apply_screening_outcome_to_application(app_row, built_findings, result)

    return built_findings


def _apply_screening_outcome_to_application(
    app_row: Dict[str, Any], built_findings: Dict[str, Any], raw_result: Dict[str, Any]
) -> None:
    app_id = app_row.get("id")
    if not app_id:
        return
    latest_row = _get_application_row(app_id) or app_row
    scr = dict(latest_row.get("screening") or {})
    triage = built_findings.get("triage", "yellow")
    auto_corr_enabled = (os.getenv("SCREENING_AUTO_CORRECTION", "true").strip().lower() not in ("false", "0", "off", "no"))
    should_auto_correct = bool(built_findings.get("autoNeedsCorrection") and triage == "red" and auto_corr_enabled)

    polite_msg = (
        built_findings.get("suggestedPoliteRemark")
        or "Hello! Thank you for applying with PIGEM. Please sign in to your Customer Account to review and update the highlighted details or upload a clearer Valid ID photo."
    )
    target_fields = built_findings.get("targetFields") or ["id_photo"]

    corr = latest_row.get("corrected_copy") if isinstance(latest_row.get("corrected_copy"), dict) else None
    revision_stamp = str((corr.get("submitted_at") or corr.get("resubmitted_at")) if corr else (latest_row.get("created_at") or ""))

    scr.update({
        "state": "completed",
        "background_state": "completed",
        "background_revision": revision_stamp,
        "background_findings": built_findings,
        "manual_fallback": False,
        "triage": triage,
        "route": built_findings.get("route", "good"),
        "summary": built_findings.get("queueSummary") or "",
        "final_recommendation": built_findings.get("finalRecommendation") or "",
        "review_recommended": triage != "green",
        "overall_match": triage == "green",
        "Suggested_remark": polite_msg if triage != "green" else "",
        "openai_response_id": built_findings.get("openaiResponseId") or scr.get("openai_response_id") or "",
        "eta_seconds": 0,
        "browser_check": {
            "reader_version": 5,
            "revision": revision_stamp,
            "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "findings": built_findings,
        },
    })

    ai_result_obj = {
        "overall_status": "Verified" if triage == "green" else ("Needs Correction" if triage == "red" else "Needs Review"),
        "triage": triage,
        "route": built_findings.get("route", "good"),
        "blur_score": (raw_result.get("quality") or {}).get("quality_score", 85),
        "name_match": any(f["key"] == "name" and f["status"] == "match" for f in built_findings["fields"]),
        "birth_date_match": any(f["key"] == "birth_date" and f["status"] == "match" for f in built_findings["fields"]),
        "id_number_match": any(f["key"] == "id_number" and f["status"] == "match" for f in built_findings["fields"]),
        "issues": (built_findings.get("aiFindings") or []) + (built_findings.get("tamperingFlags") or []),
    }

    ai_log = list(latest_row.get("ai_log") or [])
    ai_log.append({
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "who": f"Stage 1 ({(raw_result.get('quality') or {}).get('model', 'gpt-6.2-sol')}) + Stage 4 (gpt-5.4)",
        "text": built_findings.get("finalRecommendation") or built_findings.get("queueSummary") or "Screening completed.",
    })

    patch_payload: Dict[str, Any] = {
        "screening": scr,
        "ai_result": ai_result_obj,
        "ai_log": ai_log,
    }

    current_status = str(latest_row.get("status") or "Pending Review")
    if should_auto_correct and current_status in ("Pending Review", "Under Agent Review", "Needs Correction"):
        scr.update({
            "auto_correction_sent": True,
            "auto_correction_type": "pigem_screening",
            "auto_correction_reason": built_findings.get("queueSummary") or "Automatic PIGEM Screening Needs Correction",
            "correction_fields": target_fields,
            "correction_findings": built_findings,
        })
        patch_payload.update({
            "status": "Needs Correction",
            "agent_remarks": polite_msg,
            "correction_note": polite_msg,
            "customer_instruction": polite_msg,
            "has_correction": False,
        })

    _patch_application_row(app_id, patch_payload)

    if should_auto_correct and current_status in ("Pending Review", "Under Agent Review"):
        corr_copy = latest_row.get("corrected_copy") or {}
        recipient_email = (corr_copy.get("contact_email") if isinstance(corr_copy, dict) else "") or latest_row.get("email") or ""
        ref_no = latest_row.get("reference_no") or latest_row.get("ref_no") or ""
        full_name = latest_row.get("full_name") or "Applicant"
        target_label = ", ".join(FIELD_LABELS.get(f, f) for f in target_fields) or "Valid ID & Application Details"

        if recipient_email:
            _insert_notification({
                "email": recipient_email,
                "role": "customer",
                "title": f"Update Needed for Application ({ref_no})",
                "message": polite_msg,
                "target_tab": "tab-apps",
                "target_id": app_id,
            })
            try:
                _mailer.send(
                    to=recipient_email,
                    subject=f"Action Needed: Update Your PIGEM Application ({ref_no})",
                    message=polite_msg,
                    template_type="correction",
                    payload={
                        "customer_name": full_name,
                        "ref_no": ref_no,
                        "reference_no": ref_no,
                        "status": "Needs Correction",
                        "remarks": polite_msg,
                        "target_summary": target_label,
                    },
                )
            except Exception:
                pass


def ensure_application_screened(app_id: str) -> bool:
    """Directly screen an application (including Needs Correction resubmissions) if the SQL queue skipped or did not complete it."""
    if not app_id or not enabled():
        return False
    row = _get_application_row(app_id)
    if not row:
        return False
    scr = row.get("screening") if isinstance(row.get("screening"), dict) else {}
    corr = row.get("corrected_copy") if isinstance(row.get("corrected_copy"), dict) else None
    current_rev = str((corr.get("submitted_at") or corr.get("resubmitted_at")) if corr else (row.get("created_at") or ""))

    if (
        scr.get("background_state") == "completed"
        and scr.get("background_findings")
        and (not current_rev or scr.get("background_revision") == current_rev or (scr.get("browser_check") or {}).get("revision") == current_rev)
    ):
        return True

    front_url = str((corr.get("id_image_url") or corr.get("id_front_path")) if corr else (row.get("id_image_url") or row.get("id_front_path") or "")).strip()
    if not front_url:
        front_url = str(row.get("id_image_url") or row.get("id_front_path") or "").strip()
    back_url = str((corr.get("id_back_image_url") or corr.get("id_back_path")) if corr else (row.get("id_back_image_url") or row.get("id_back_path") or "")).strip()
    if not back_url:
        back_url = str(row.get("id_back_image_url") or row.get("id_back_path") or "").strip()

    if not front_url:
        _mark_manual_review_fallback(app_id, "No Front ID image found — switched to Manual Agent Review.")
        return False

    payload = {
        "front": front_url,
        "back": back_url,
        "full_name": str((corr.get("full_name") if corr else None) or row.get("full_name") or ""),
        "birth_date": str((corr.get("birth_date") if corr else None) or row.get("birth_date") or ""),
        "id_number": str((corr.get("id_number") if corr else None) or row.get("id_number") or ""),
        "id_type": str((corr.get("id_type") if corr else None) or row.get("id_type") or ""),
    }
    try:
        res = findings(payload, f"direct-{app_id[:8]}", app_id=app_id)
        if not res:
            _mark_manual_review_fallback(app_id)
            return False
        return True
    except Exception as error:
        print(f"screening direct app={app_id} failed={type(error).__name__}", flush=True)
        _mark_manual_review_fallback(app_id)
        return False


# [STUDY NOTE — run_one]: Claims the next queued job from pigem_private.screening_jobs, runs screening, saves findings, and notifies Agents.
def run_one():
    max_jobs = 1
    try:
        max_jobs = max(1, min(5, int(os.getenv("SCREENING_WORKER_CONCURRENCY", "2") or 2)))
    except ValueError:
        max_jobs = 2

    processed_any = False
    for _ in range(max_jobs):
        job = rpc("pigem_claim_screening")
        if not job:
            break
        payload = job.get("payload") or {}
        app_id = str(job.get("application_id") or payload.get("application_id") or "")
        if not app_id and payload.get("front"):
            app_id = _find_app_id_by_front_url(str(payload["front"]))
        try:
            result = findings(payload, str(job["id"]), app_id=app_id)
        except Exception as error:
            print(f"screening job={job['id']} failed={type(error).__name__}", flush=True)
            result = None
        if result is None and app_id:
            _mark_manual_review_fallback(app_id)
        rpc("pigem_finish_screening", {
            "job_id": job["id"],
            "job_attempt": job["attempt"],
            "findings": result,
        })
        processed_any = True
    return processed_any
