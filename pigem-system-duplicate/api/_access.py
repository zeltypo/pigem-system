# ============================================================================
# PIGEM STUDY DUPLICATE — api/_access.py (Zero-Trust Staff Session Verifier)
# ============================================================================
# ROLE IN ARCHITECTURE:
#   Verifies that any on-demand AI screening request comes from a real, active
#   Agent or Manager session before calling paid external APIs (OpenAI / Azure).
#
# HOW IT WORKS:
#   - Extracts the `Bearer <token>` header.
#   - If the token starts with `pigem_staff_`, it calls the Supabase RPC
#     `public.pigem_screening_session(session_token)` which checks the SHA-256
#     hash in `pigem_private.screening_staff` and confirms the 2-hour session
#     is still active and belongs to an 'agent' or 'manager'.
# ============================================================================

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


# [STUDY NOTE — verify_screening_staff]: Validates staff Bearer token against pigem_private.screening_staff via the pigem_screening_session RPC.
def verify_screening_staff(authorization):
    match = re.fullmatch(r"Bearer ([A-Za-z0-9._-]+)", authorization or "", re.IGNORECASE)
    if not match:
        raise AccessError(401, "A verified staff sign-in is required for AI screening.")
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    key = os.getenv("SUPABASE_ANON_KEY", "").strip()
    if not url or not key:
        raise AccessError(503, "Staff authentication is not configured.")
    token = match.group(1)
    if re.fullmatch(r"pigem_staff_[0-9a-f]{64}", token):
        request = urllib.request.Request(
            url + "/rest/v1/rpc/pigem_screening_session",
            data=json.dumps({"session_token": token}).encode(),
            headers={"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                staff = json.load(response)
        except (OSError, ValueError):
            raise AccessError(503, "Staff authentication is temporarily unavailable.") from None
        if not isinstance(staff, dict) or not staff.get("id") or staff.get("role") not in ("agent", "manager"):
            raise AccessError(401, "Staff screening session expired or was revoked.")
        return staff
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
