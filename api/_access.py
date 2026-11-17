"""Verify AI access with Supabase Auth or server-verified Supabase staff sessions, never browser-supplied roles."""
import hmac
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request


class AccessError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def _clean_env(name: str) -> str:
    raw = os.getenv(name, "").strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in ('"', "'"):
        raw = raw[1:-1].strip()
    return raw


def _verify_staff_db_session(url: str, key: str, user_id: str, session_token: str) -> dict:
    if len(session_token) < 12:
        raise AccessError(401, "Staff session token is invalid.")
    service_key = _clean_env("SUPABASE_SERVICE_ROLE_KEY") or key
    encoded_id = urllib.parse.quote(user_id, safe="")
    req = urllib.request.Request(
        f"{url}/rest/v1/users?id=eq.{encoded_id}&select=id,username,role,active,session_token",
        headers={
            "apikey": service_key,
            "Authorization": "Bearer " + service_key,
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            rows = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise AccessError(401, "Staff sign-in could not be verified.") from None
        raise AccessError(503, "Staff authentication is temporarily unavailable.") from None
    except (OSError, ValueError):
        raise AccessError(503, "Staff authentication is temporarily unavailable.") from None

    if not isinstance(rows, list) or not rows:
        raise AccessError(401, "Invalid staff sign-in.")
    row = rows[0]
    stored_token = str(row.get("session_token") or "")
    if not stored_token or not hmac.compare_digest(stored_token, session_token):
        raise AccessError(401, "Staff sign-in has expired or is active on another session.")
    if row.get("active") is False:
        raise AccessError(403, "This staff account is disabled.")
    role = str(row.get("role") or "").strip().lower()
    if role not in ("agent", "manager"):
        raise AccessError(403, "Only authorized Agents and Managers can run AI screening.")
    return {
        "id": row.get("id"),
        "username": row.get("username"),
        "role": role,
        "auth_mode": "staff_session",
    }


def verify_screening_staff(authorization):
    url = _clean_env("SUPABASE_URL").rstrip("/")
    key = _clean_env("SUPABASE_ANON_KEY")
    if not url or not key:
        raise AccessError(503, "Staff authentication is not configured.")

    staff_match = re.fullmatch(
        r"Bearer\s+staff:([A-Za-z0-9._-]+):([A-Za-z0-9._-]+)",
        (authorization or "").strip(),
        re.IGNORECASE,
    )
    if staff_match:
        return _verify_staff_db_session(url, key, staff_match.group(1), staff_match.group(2))

    match = re.fullmatch(r"Bearer ([A-Za-z0-9._-]+)", authorization or "", re.IGNORECASE)
    if not match:
        raise AccessError(401, "A verified staff sign-in is required for AI screening.")
    request = urllib.request.Request(url + "/auth/v1/user", headers={
        "apikey": key, "Authorization": "Bearer " + match.group(1)
    })
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            user = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise AccessError(401, "Staff sign-in has expired or is invalid.") from None
        raise AccessError(503, "Staff authentication is temporarily unavailable.") from None
    except (OSError, ValueError):
        raise AccessError(503, "Staff authentication is temporarily unavailable.") from None
    if not isinstance(user, dict) or not user.get("id"):
        raise AccessError(401, "Invalid staff sign-in.")
    metadata = user.get("app_metadata") or {}

    if not isinstance(metadata, dict) or metadata.get("role") not in ("agent", "manager"):
        raise AccessError(403, "Only authorized Agents and Managers can run AI screening.")
    if user.get("is_anonymous") or metadata.get("disabled") is True:
        raise AccessError(403, "This staff account cannot run AI screening.")
    return user
