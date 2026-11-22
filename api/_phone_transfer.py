import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from datetime import datetime

import httpx
import qrcode
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from qrcode.image.svg import SvgPathFillImage

import _screening_queue

router = APIRouter(prefix="/api/phone-transfer")
BUCKET = "pigem-phone-transfers"
LIFETIME = 15 * 60
APPLICATION_LIFETIME = 2 * 60 * 60
MAX_PHOTOS = 3_500_000


def _storage(method, path, **kwargs):
    try:
        response = httpx.request(
            method, os.environ["SUPABASE_URL"].rstrip("/") + "/storage/v1/" + path,
            headers={**_screening_queue._rest_headers(), **kwargs.pop("headers", {})},
            timeout=15, **kwargs
        )
    except (httpx.RequestError, KeyError):
        raise HTTPException(503, "Phone transfer is temporarily unavailable.") from None
    return response


def _ensure_bucket():
    found = _storage("GET", f"bucket/{BUCKET}")
    if found.is_success and found.json().get("public") is False:
        return
    if not found.is_success and found.status_code in (400, 404):
        created = _storage("POST", "bucket", json={"id": BUCKET, "name": BUCKET, "public": False})
        if created.is_success:
            return
        found = _storage("GET", f"bucket/{BUCKET}")
        if found.is_success and found.json().get("public") is False:
            return
    raise HTTPException(503, "Private phone transfer storage is unavailable.")


def _object(key):
    return f"object/{BUCKET}/{key}"


def _write(key, data, conflict_message):
    response = _storage("POST", _object(key), content=data, headers={"x-upsert": "false"})
    if response.is_success:
        return
    if response.status_code == 409 or (
        response.status_code == 400 and str(response.json().get("statusCode")) == "409"
    ):
        raise HTTPException(409, conflict_message)
    raise HTTPException(503, "Could not save the phone transfer. Please try again.")


def _read(key):
    response = _storage("GET", f"object/authenticated/{BUCKET}/{key}", headers={"Cache-Control": "no-cache"})
    if response.is_success:
        return response
    if response.status_code == 404 or (
        response.status_code == 400 and str(response.json().get("statusCode")) == "404"
    ):
        raise HTTPException(404, "This phone transfer is no longer available.")
    raise HTTPException(503, "Could not open the phone transfer. Please try again.")


def _delete(key):
    try:
        _storage("DELETE", _object(key))
    except HTTPException:
        pass


def _remove_expired_files():
    try:
        response = _storage("POST", f"object/list/{BUCKET}", json={
            "prefix": "", "limit": 25, "sortBy": {"column": "created_at", "order": "asc"},
        })
        if not response.is_success:
            return
        for item in response.json():
            created = item.get("created_at")
            if created and time.time() - datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp() > APPLICATION_LIFETIME + LIFETIME:
                _delete(item["name"])
    except (HTTPException, ValueError, KeyError):
        pass


def _signature(value):
    return hmac.new(os.environ["SCREENING_WORKER_SECRET"].encode(),
                    ("phone-transfer:" + value).encode(), hashlib.sha256).hexdigest()


def _token(stamp, key, mode):
    value = f"{stamp}.{key}.{mode}"
    return f"{value}.{_signature(value)}"


def _require_token(token, modes):
    if not _screening_queue.enabled():
        raise HTTPException(503, "Phone transfer is temporarily unavailable.")
    match = re.fullmatch(r"(\d{10})\.([0-9a-f]{32})\.([a-z]+)\.([0-9a-f]{64})", token)
    if not match:
        raise HTTPException(400, "Invalid phone link.")
    stamp, key, mode, signature = match.groups()
    if mode not in modes or not hmac.compare_digest(signature, _signature(token.rsplit(".", 1)[0])):
        raise HTTPException(403, "Invalid phone link.")
    lifetime = APPLICATION_LIFETIME if mode in ("watch", "edit") else LIFETIME
    if not 0 <= time.time() - int(stamp) <= lifetime:
        raise HTTPException(410, "This link expired. Create a new QR code on your computer.")
    return stamp, key, mode


def _verify_customer(user_id, token):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{8,100}", user_id) or not re.fullmatch(r"[a-zA-Z0-9_-]{20,128}", token):
        raise HTTPException(401, "Sign in to send photos from your phone.")
    try:
        response = httpx.get(
            os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/users",
            headers=_screening_queue._rest_headers(),
            params={"role": "eq.customer", "active": "eq.true", "id": "eq." + user_id,
                    "select": "session_token", "limit": 1},
            timeout=10,
        )
        response.raise_for_status()
    except (httpx.HTTPError, KeyError):
        raise HTTPException(503, "Could not confirm your sign-in. Please try again.") from None
    rows = response.json()
    if not rows or not hmac.compare_digest(rows[0].get("session_token") or "", token):
        raise HTTPException(401, "Sign in again to send photos from your phone.")


def _result(payload):
    return JSONResponse(payload, headers={"Cache-Control": "no-store"})


class ApplicationSnapshot(BaseModel):
    draft: dict | None = None
    front: str = ""
    back: str = ""


class PhoneLink(ApplicationSnapshot):
    mode: str
    credential: str
    customer_id: str = ""
    path: str = "/apply.html"


class PhoneToken(BaseModel):
    token: str


class ApplicationUpdate(PhoneToken, ApplicationSnapshot):
    status: str
    percent: int = 0
    reference: str = ""


class PhonePhotos(PhoneToken):
    front: str = ""
    back: str = ""


def _application_snapshot(data):
    if not data.draft or len(json.dumps(data.draft).encode()) > 16000:
        raise HTTPException(400, "The application draft could not be transferred.")
    if len(data.front) + len(data.back) > MAX_PHOTOS:
        raise HTTPException(400, "The ID photos are too large for this transfer.")
    for photo in (data.front, data.back):
        if photo and not re.fullmatch(r"data:image/jpeg;base64,/9j/[A-Za-z0-9+/=]+", photo):
            raise HTTPException(400, "Choose a JPG photo for this transfer.")
    return {"draft": data.draft, "front": data.front, "back": data.back}


def _read_optional(key):
    try:
        return _read(key).json()
    except HTTPException as error:
        if error.status_code == 404:
            return None
        raise


@router.post("/create")
def create_link(data: PhoneLink, request: Request):
    if not _screening_queue.enabled():
        raise HTTPException(503, "Phone transfer is temporarily unavailable.")
    if data.mode == "application":
        if not _screening_queue.valid_ticket(data.credential):
            raise HTTPException(403, "Complete the security check before creating a phone link.")
        draft = json.dumps(_application_snapshot(data)).encode()
    elif data.mode == "correction":
        _verify_customer(data.customer_id, data.credential)
        draft = b"{}"
    else:
        raise HTTPException(400, "Invalid phone transfer.")
    _ensure_bucket()
    if secrets.randbelow(10) == 0:
        _remove_expired_files()
    stamp = int(time.time())
    key = secrets.token_hex(16)
    _write(key + "-pending", draft, "Please create another link.")
    path = data.path if data.path in ("/html/apply.html", "/web/html/apply.html") else "/apply.html"
    url = str(request.base_url).rstrip("/") + path + "#phone=" + _token(stamp, key, data.mode)
    qr = qrcode.make(url, image_factory=SvgPathFillImage).to_string()
    return _result({
        "url": url, "qr": "data:image/svg+xml;base64," + base64.b64encode(qr).decode(),
        "receiver": _token(stamp, key, "receive") if data.mode == "correction" else "",
        "watch": _token(stamp, key, "watch") if data.mode == "application" else "",
    })


@router.post("/open")
def open_link(data: PhoneToken):
    stamp, key, mode = _require_token(data.token, ("application", "correction"))
    stored = _read(key + "-pending")
    _write(key + "-opened", b"{}", "This link has already been opened.")
    _delete(key + "-pending")
    if mode == "application":
        snapshot = stored.json()
        if "draft" not in snapshot:
            snapshot = {"draft": snapshot}
        return _result({**snapshot, "mode": mode, "edit": _token(stamp, key, "edit"),
                        "screening_ticket": _screening_queue.intake_ticket()})
    return _result({"mode": mode, "upload": _token(stamp, key, "upload")})


@router.post("/application/state")
def application_state(data: PhoneToken):
    stamp, key, _ = _require_token(data.token, ("watch",))
    result = _read_optional(key + "-result")
    if result:
        return _result(result)
    progress = _read_optional(key + "-progress")
    if progress:
        return _result(progress)
    opened = _read_optional(key + "-opened")
    if opened is not None:
        if opened.get("cancelled"):
            return _result({"status": "cancelled", **(_read_optional(key + "-pending") or {})})
        return _result({"status": "editing"})
    return _result({"status": "waiting" if time.time() - int(stamp) <= LIFETIME else "expired"})


@router.post("/application/update")
def update_application(data: ApplicationUpdate):
    _, key, _ = _require_token(data.token, ("edit",))
    if data.status == "editing":
        payload = {"status": "editing", "percent": min(99, max(0, data.percent))}
        response = _storage("POST", _object(key + "-progress"), content=json.dumps(payload).encode(),
                            headers={"x-upsert": "true", "Cache-Control": "max-age=0"})
        if not response.is_success:
            raise HTTPException(503, "Could not update the application progress.")
    elif data.status in ("returned", "submitted"):
        payload = {"status": data.status}
        if data.status == "returned":
            payload.update(_application_snapshot(data))
        elif re.fullmatch(r"PIGEM-[A-Z0-9-]{1,32}", data.reference):
            payload["reference"] = data.reference
        try:
            _write(key + "-result", json.dumps(payload).encode(), "This phone transfer has already finished.")
        except HTTPException as error:
            if error.status_code != 409 or (_read_optional(key + "-result") or {}).get("status") != data.status:
                raise
    else:
        raise HTTPException(400, "Invalid application status.")
    return _result({"saved": True})


@router.post("/application/cancel")
def cancel_application(data: PhoneToken):
    _, key, _ = _require_token(data.token, ("watch",))
    try:
        _write(key + "-opened", b'{"cancelled":true}', "The phone already opened this application. Return it from the phone.")
    except HTTPException as error:
        if error.status_code != 409 or not (_read_optional(key + "-opened") or {}).get("cancelled"):
            raise
    return _result(_read_optional(key + "-pending") or {})


@router.post("/application/ack")
def acknowledge_application(data: PhoneToken):
    _, key, _ = _require_token(data.token, ("watch",))
    result = _storage("PUT", _object(key + "-result"), content=b'{"status":"closed"}')
    if not result.is_success and _read_optional(key + "-result") is not None:
        raise HTTPException(503, "Could not clear the transferred draft.")
    _delete(key + "-pending")
    _delete(key + "-progress")
    return _result({"received": True})


@router.post("/photos")
def send_photos(data: PhonePhotos):
    _, key, _ = _require_token(data.token, ("upload",))
    if not (data.front or data.back) or len(data.front) + len(data.back) > MAX_PHOTOS:
        raise HTTPException(400, "Choose at least one photo. Use smaller photos if the upload is too large.")
    for photo in (data.front, data.back):
        if photo and not re.fullmatch(r"data:image/jpeg;base64,/9j/[A-Za-z0-9+/=]+", photo):
            raise HTTPException(400, "Choose a valid JPG photo.")
    payload = json.dumps({"front": data.front, "back": data.back}).encode()
    _write(key + "-photos", payload, "Photos were already sent from this link.")
    return _result({"sent": True})


@router.post("/receive")
def receive_photos(data: PhoneToken):
    _, key, _ = _require_token(data.token, ("receive",))
    try:
        response = _read(key + "-photos")
    except HTTPException as error:
        if error.status_code == 404:
            return _result({})
        raise
    return _result(response.json())


@router.post("/finish")
def finish_photos(data: PhoneToken):
    _, key, _ = _require_token(data.token, ("receive",))
    result = _storage("PUT", _object(key + "-photos"), content=b"{}")
    if not result.is_success:
        raise HTTPException(503, "Could not clear the transferred photos.")
    return _result({"received": True})
