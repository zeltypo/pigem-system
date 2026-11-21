import base64
import hashlib
import hmac
import os
import secrets
import time
from urllib.parse import urlsplit
import httpx
import _ai
import _mailer

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
        expected = hmac.new(os.environ["SCREENING_WORKER_SECRET"].encode(),
                            f"{stamp}.{nonce}".encode(), hashlib.sha256).hexdigest()
        return 0 <= time.time() - int(stamp) <= 7200 and len(nonce) == 48 and hmac.compare_digest(expected, signature)
    except (ValueError, KeyError):
        return False

def _rest_headers():
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"}

def rpc(name, data=None):
    response = httpx.post(
        os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/" + name,
        headers=_rest_headers(), json=data or {}, timeout=15,
    )
    response.raise_for_status()
    return response.json()

def download_raw_photo(url):
    allowed = urlsplit(os.environ["SUPABASE_URL"])
    source = urlsplit(url or "")
    prefix = "/storage/v1/object/public/documents/"
    if source.scheme != "https" or source.netloc != allowed.netloc or not source.path.startswith(prefix):
        raise ValueError("Unexpected document location")
    data = bytearray()
    with httpx.stream("GET", url, timeout=20, follow_redirects=False) as response:
        response.raise_for_status()
        for block in response.iter_bytes():
            data.extend(block)
            if len(data) > 12_000_000:
                raise ValueError("Document exceeds screening size limit")
    return bytes(data)

class ScreeningWorker:
    def report_stage(self, job, stage):
        try:
            rpc("pigem_screening_progress", {"job_id": job["id"], "job_attempt": job["attempt"], "stage": stage})
        except httpx.HTTPError:
            pass

    def prepare_preview(self, preparation, job_id, side):
        data_url = preparation.pop("preview_data_url", "")
        if not data_url.startswith("data:image/jpeg;base64,"):
            return
        data = base64.b64decode(data_url.split(",", 1)[1])
        path = f"{job_id}_enhanced_{side}.jpg"
        base = os.environ["SUPABASE_URL"].rstrip("/")
        headers = {**_rest_headers(), "Content-Type": "image/jpeg", "x-upsert": "true"}
        try:
            response = httpx.post(f"{base}/storage/v1/object/documents/{path}", content=data, headers=headers, timeout=15)
            response.raise_for_status()
            preparation["preview_data_url"] = f"{base}/storage/v1/object/public/documents/{path}"
        except httpx.HTTPError:
            preparation["preview_data_url"] = ""

    def findings(self, job):
        payload = job["payload"]
        front = download_raw_photo(payload.get("front"))
        back = download_raw_photo(payload["back"]) if payload.get("back") else None
        result = _ai.run_conditional_screening_pipeline(front, back, payload, check_id=str(job["id"]),
            stage_callback=lambda stage, _: self.report_stage(job, stage))
        extraction = result["ocr"]
        quality = result.get("quality") or {}
        preparation = quality.get("preprocessed") or {}
        for side in ("front", "back"):
            if isinstance(preparation.get(side), dict):
                self.prepare_preview(preparation[side], job["id"], side)
        guidance = result["ai"]
        labels = {"name": "Name", "birth_date": "Birth date", "id_number": "ID number"}
        statuses = {"match": "match", "mismatch": "difference"}
        compared = {item["key"]: item["status"] for item in result["comparisons"]}
        return {
            "route": result.get("route", "good"),
            "triage": result.get("triage", "yellow"),
            "autoNeedsCorrection": bool(guidance.get("auto_needs_correction") and quality.get("confirmed_defects")),
            "manualFallback": not bool(guidance.get("available")) and not bool(guidance.get("auto_needs_correction")),
            "confirmedDefects": quality.get("confirmed_defects") or [],
            "correctionPhotoSides": ["front", "back"] if quality.get("duplicate_front_back") else sorted({d["side"] for d in quality.get("confirmed_defects", [])}),
            "correctionType": guidance.get("correction_type", "none"),
            "targetFields": guidance.get("target_fields") or [],
            "queueSummary": guidance.get("queue_summary", ""),
            "finalRecommendation": guidance.get("final_recommendation", ""),
            "fields": [{"key": key, "label": label, "status": statuses.get(compared.get(key), "unreadable")} for key, label in labels.items()],
            "unclearSides": [side for side, readable in (("Front", extraction.get("front_readable")), ("Back", not back or extraction.get("back_readable"))) if not readable],
            "unavailableSides": [],
            "failedReads": [],
            "duplicatePhotos": bool(quality.get("duplicate_front_back")),
            "photoIssues": quality.get("issues") or [],
            "detectedOtherType": extraction.get("detected_document_type", "") if extraction.get("id_type_matches_declared") is False else "",
            "nlpValidation": result["nlp_validation"],
            "aiRecommendation": guidance.get("recommendation", ""),
            "aiFindings": guidance.get("findings") or [],
            "tamperingFlags": guidance.get("tampering_flags") or [],
            "suggestedPoliteRemark": guidance.get("suggested_polite_remark", ""),
            "stages": {
                "checkId": str(job["id"]),
                "qualityGate": {"model": quality.get("model"), "verdict": quality.get("verdict"), "score": quality.get("quality_score")},
                "photoPreparation": preparation,
                "extraction": {"provider": extraction.get("provider"), "earlyStopped": bool(extraction.get("early_stopped"))},
            },
        }

    def run(self):
        job = rpc("pigem_claim_screening")
        if not job:
            return False
        try:
            result = self.findings(job)
        except Exception as error:
            print(f"screening job={job['id']} failed={type(error).__name__}", flush=True)
            result = None
        finished = bool(rpc("pigem_finish_screening", {
            "job_id": job["id"], "job_attempt": job["attempt"], "findings": result
        }))
        if finished and result and result.get("autoNeedsCorrection") and job.get("customer_email") and _mailer.is_configured():
            try:
                _mailer.send(to=job["customer_email"], subject="PIGEM: Application update needed",
                    message=f"Reference: {job.get('reference_no', '')}\n\n{result['suggestedPoliteRemark']}")
            except Exception:
                # In-app notification and correction status were saved atomically already.
                print(f"screening job={job['id']} correction email unavailable", flush=True)
        return finished

def run_one():
    return ScreeningWorker().run()
