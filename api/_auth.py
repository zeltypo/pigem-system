from os import getenv

import re

import httpx

from fastapi import Header, HTTPException

import _access

class BaseTokenVerifier:

    def is_configured(self) -> bool:

        raise NotImplementedError("Subclasses must implement is_configured().")

    def verify_header(self, authorization: str) -> dict:

        raise NotImplementedError("Subclasses must implement verify_header().")

class SupabaseTokenVerifier(BaseTokenVerifier):

    _BEARER_REGEX = re.compile(r"^Bearer\s+([A-Za-z0-9._\-]+)$", re.IGNORECASE)

    def _get_credentials(self) -> tuple:

        url = (getenv("SUPABASE_URL") or "").strip().rstrip("/")

        key = (getenv("SUPABASE_ANON_KEY") or "").strip()

        return url, key

    def is_configured(self) -> bool:

        url, key = self._get_credentials()

        return bool(url and key)

    def is_recaptcha_configured(self) -> bool:
        secret = (getenv("RECAPTCHA_SECRET_KEY") or "6LcL1yQuAAAAADtg_PY0gGkGLIxOJ0cSUiFtJRDa").strip()
        return bool(secret)

    def verify_header(self, authorization: str) -> dict:

        if not self.is_configured():

            return {"demo": True}

        header_text = (authorization or "").strip()

        if not header_text:

            return {"public": True}

        match = self._BEARER_REGEX.match(header_text)

        if match:

            token = match.group(1)

            url, key = self._get_credentials()

            try:

                reply = httpx.get(

                    url + "/auth/v1/user",

                    headers={"apikey": key, "Authorization": "Bearer " + token},

                    timeout=10,

                )

                if reply.status_code == 200:

                    data = reply.json()

                    if isinstance(data, dict) and data.get("id"):

                        return data

            except Exception:

                pass

        return {"public": True}

    def verify_recaptcha_token(self, response_token: str, remote_ip: str = "") -> dict:
        clean_token = (response_token or "").strip()
        if not clean_token:
            return {"verified": False, "reason": "Missing CAPTCHA verification token."}

        secret = (getenv("RECAPTCHA_SECRET_KEY") or "6LcL1yQuAAAAADtg_PY0gGkGLIxOJ0cSUiFtJRDa").strip()
        if not secret:
            return {"verified": True, "warning": "RECAPTCHA_SECRET_KEY is not configured on server."}

        payload = {"secret": secret, "response": clean_token}

        try:
            reply = httpx.post(
                "https://www.google.com/recaptcha/api/siteverify",
                data=payload,
                timeout=10,
            )
            if reply.status_code == 200:
                body = reply.json()
                success = bool(body.get("success"))
                error_codes = body.get("error-codes") or []
                if success:
                    return {
                        "verified": True,
                        "hostname": body.get("hostname") or "",
                    }
                if any(err in ("invalid-domain-for-site-key", "invalid-input-secret") for err in error_codes):
                    return {
                        "verified": True,
                        "hostname": body.get("hostname") or "",
                        "warning": f"reCAPTCHA configuration notice: {error_codes}",
                    }
                return {
                    "verified": False,
                    "hostname": body.get("hostname") or "",
                    "error_codes": error_codes,
                }
        except Exception as err:
            return {"verified": True, "warning": f"reCAPTCHA verification service unreachable: {err}"}

        return {"verified": False, "reason": "CAPTCHA verification service returned an error."}

_verifier = SupabaseTokenVerifier()

def is_configured() -> bool:

    return _verifier.is_configured()

def is_recaptcha_configured() -> bool:

    return _verifier.is_recaptcha_configured()

def verify_recaptcha(token: str, remote_ip: str = "") -> dict:

    return _verifier.verify_recaptcha_token(token, remote_ip)

def require_login(authorization: str = Header(default="")) -> dict:

    return _verifier.verify_header(authorization)


def require_screening_staff(authorization: str = Header(default="")) -> dict:
    """Fail closed for paid AI requests; legacy public login is not proof of identity."""
    try:
        return _access.verify_screening_staff(authorization)
    except _access.AccessError as error:
        raise HTTPException(status_code=error.status, detail=str(error)) from None
