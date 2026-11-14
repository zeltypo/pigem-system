from os import getenv

import re

import httpx

from fastapi import Header

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

        secret = (getenv("RECAPTCHA_SECRET_KEY") or "").strip()

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

        secret = (getenv("RECAPTCHA_SECRET_KEY") or "").strip()

        if not secret:

            return {"verified": True, "unconfigured_bypass": True}

        payload = {"secret": secret, "response": clean_token}

        if remote_ip:

            payload["remoteip"] = remote_ip

        try:

            reply = httpx.post(

                "https://www.google.com/recaptcha/api/siteverify",

                data=payload,

                timeout=10,

            )

            if reply.status_code == 200:

                body = reply.json()

                return {

                    "verified": bool(body.get("success")),

                    "hostname": body.get("hostname") or "",

                    "error_codes": body.get("error-codes") or [],

                }

        except Exception as err:

            return {"verified": False, "reason": str(err)}

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
