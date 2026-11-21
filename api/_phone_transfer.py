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
    response = _storage("GET", f"object/authenticated/{BUCKET}/{key}")
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
            if created and time.time() - datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp() > 2 * LIFETIME:
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
    if not 0 <= time.time() - int(stamp) <= LIFETIME:
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


class PhoneLink(BaseModel):
    mode: str
    credential: str
    customer_id: str = ""
    draft: dict | None = None
    path: str = "/apply.html"


class PhoneToken(BaseModel):
    token: str


class PhonePhotos(PhoneToken):
    front: str = ""
    back: str = ""


@router.post("/create")
def create_link(data: PhoneLink, request: Request):
    if not _screening_queue.enabled():
        raise HTTPException(503, "Phone transfer is temporarily unavailable.")
    if data.mode == "application":
        if not _screening_queue.valid_ticket(data.credential):
            raise HTTPException(403, "Complete the security check before creating a phone link.")
        draft = json.dumps(data.draft or {}).encode()
        if not data.draft or len(draft) > 16000:
            raise HTTPException(400, "The application draft could not be transferred.")
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
    })


@router.post("/open")
def open_link(data: PhoneToken):
    stamp, key, mode = _require_token(data.token, ("application", "correction"))
    stored = _read(key + "-pending")
    _write(key + "-opened", b"{}", "This link has already been opened.")
    _delete(key + "-pending")
    if mode == "application":
        return _result({"mode": mode, "draft": stored.json()})
    return _result({"mode": mode, "upload": _token(stamp, key, "upload")})


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
