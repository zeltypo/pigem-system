import hashlib
import hmac
import os
import secrets
import time
from urllib.parse import urlsplit

import httpx

import _ai
import _preprocess


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


def rpc(name, data=None):
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    response = httpx.post(os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/" + name,
                          headers={"apikey": key, "Authorization": "Bearer " + key},
                          json=data or {}, timeout=12)
    response.raise_for_status()
    return response.json()


def photo(url):
    allowed = urlsplit(os.environ["SUPABASE_URL"])
    source = urlsplit(url)
    if (source.scheme != "https" or source.netloc != allowed.netloc
            or not source.path.startswith("/storage/v1/object/public/documents/applications/")):
        raise ValueError("Unsupported document location")
    data = bytearray()
    with httpx.stream("GET", url, timeout=20, follow_redirects=False) as response:
        response.raise_for_status()
        for block in response.iter_bytes():
            data.extend(block)
            if len(data) > 12_000_000:
                raise ValueError("Photo too large")
    return _preprocess.prepare_photo(bytes(data))


def findings(payload, check_id):
    front, front_info = photo(payload["front"])
    back, back_info = photo(payload["back"]) if payload.get("back") else (None, None)
    result = _ai.run_idp_screening_pipeline(front, back, payload, check_id=check_id)
    extraction = result["ocr"]
    if not extraction.get("available"):
        return None
    labels = {"name": "Name", "birth_date": "Birth date", "id_number": "ID number"}
    statuses = {"match": "match", "mismatch": "difference"}
    compared = {item["key"]: item["status"] for item in result["comparisons"]}
    guidance = result["ai"]
    return {
        "fields": [{"key": key, "label": label, "status": statuses.get(compared.get(key), "unreadable")}
                   for key, label in labels.items()],
        "unclearSides": [side for side, readable in [("Front", extraction.get("front_readable")),
                         ("Back", not back or extraction.get("back_readable"))] if not readable],
        "unavailableSides": [], "failedReads": [],
        "detectedOtherType": extraction.get("detected_document_type", "") if
            extraction.get("id_type_matches_declared") is False else "",
        "nlpValidation": result["nlp_validation"],
        "aiRecommendation": guidance.get("recommendation", ""),
        "tamperingFlags": guidance.get("tampering_flags", []),
        "stages": {"checkId": check_id, "photoPreparation": {"front": front_info, "back": back_info},
                   "extraction": {"provider": extraction.get("provider", "")}},
    }


def run_one():
    job = rpc("pigem_claim_screening")
    if not job:
        return False
    try:
        result = findings(job["payload"], job["id"])
    except Exception as error:
        print(f"screening job={job['id']} failed={type(error).__name__}", flush=True)
        result = None
    return rpc("pigem_finish_screening", {
        "job_id": job["id"], "job_attempt": job["attempt"], "findings": result
    })
