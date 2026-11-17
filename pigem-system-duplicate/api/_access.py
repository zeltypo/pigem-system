"""Verify AI access with Supabase Auth, never browser-supplied role or user metadata."""
import json
import os
import re
import urllib.error
import urllib.request


class AccessError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def verify_screening_staff(authorization):
    match = re.fullmatch(r"Bearer ([A-Za-z0-9._-]+)", authorization or "", re.IGNORECASE)
    if not match:
        raise AccessError(401, "A verified staff sign-in is required for AI screening.")
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    key = os.getenv("SUPABASE_ANON_KEY", "").strip()
    if not url or not key:
        raise AccessError(503, "Staff authentication is not configured.")
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
    # Only server-managed app_metadata may grant roles. users.role is still publicly writable.
    if not isinstance(metadata, dict) or metadata.get("role") not in ("agent", "manager"):
        raise AccessError(403, "Only authorized Agents and Managers can run AI screening.")
    if user.get("is_anonymous") or metadata.get("disabled") is True:
        raise AccessError(403, "This staff account cannot run AI screening.")
    return user
