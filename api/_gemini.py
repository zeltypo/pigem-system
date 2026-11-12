import base64

from difflib import SequenceMatcher

import json

from os import getenv

import re

import unicodedata

import httpx

MONTH_MAP = {

    "JAN": "01", "JANUARY": "01", "ENE": "01", "ENERO": "01",

    "FEB": "02", "FEBRUARY": "02", "PEB": "02", "PEBRERO": "02",

    "MAR": "03", "MARCH": "03", "MARSO": "03",

    "APR": "04", "APRIL": "04", "ABR": "04", "ABRIL": "04",

    "MAY": "05", "MAYO": "05",

    "JUN": "06", "JUNE": "06", "HUN": "06", "HUNYO": "06",

    "JUL": "07", "JULY": "07", "HUL": "07", "HULYO": "07",

    "AUG": "08", "AUGUST": "08", "AGO": "08", "AGOSTO": "08",

    "SEP": "09", "SEPT": "09", "SEPTEMBER": "09", "SET": "09", "SETYEMBRE": "09",

    "OCT": "10", "OCTOBER": "10", "OKT": "10", "OKTUBRE": "10",

    "NOV": "11", "NOVEMBER": "11", "NOB": "11", "NOBYEMBRE": "11",

    "DEC": "12", "DECEMBER": "12", "DIS": "12", "DISYEMBRE": "12",

}

NAME_SUFFIXES = {"JR", "SR", "II", "III", "IV", "V"}

class BaseTextMatcher:

    _NON_ALNUM_REGEX = re.compile(r"[^A-Z0-9\s]")

    _MULTI_SPACE_REGEX = re.compile(r"\s+")

    _COMPACT_ID_REGEX = re.compile(r"[^A-Z0-9]")

    _ID_PREFIX_REGEX = re.compile(r"^(?:PSN|PCN|CRN|PRN|VIN|TIN|SSS|GSIS|DLNO|IDNO|NO)")

    _ISO_DATE_REGEX = re.compile(r"\b(19\d{2}|20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b")

    _NUMERIC_DATE_REGEX = re.compile(r"\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|[12]\d|3[01])[-/.](19\d{2}|20\d{2})\b")

    _WORD_DATE_1_REGEX = re.compile(r"\b([A-Z]{3,9})\.?\s+(0?[1-9]|[12]\d|3[01]),?\s+(19\d{2}|20\d{2})\b")

    _WORD_DATE_2_REGEX = re.compile(r"\b(0?[1-9]|[12]\d|3[01])\s+([A-Z]{3,9})\.?,?\s+(19\d{2}|20\d{2})\b")

    _OCR_LOOKALIKE_GROUPS = (

        {"0", "O", "Q", "D"},

        {"1", "I", "L"},

        {"2", "Z"},

        {"5", "S"},

        {"8", "B"},

    )

    def compare(self, entered: dict, ocr_payload: dict) -> list:

        raise NotImplementedError("Subclasses must implement compare().")

    def _strip_accents(self, text: str) -> str:

        raw = str(text or "")

        decomposed = unicodedata.normalize("NFKD", raw)

        return decomposed.encode("ascii", "ignore").decode("ascii")

    def _standardize_filipino_compounds(self, clean_upper: str) -> str:

        s = " " + clean_upper + " "

        replacements = (

            (" DE LA ", " DELA "),

            (" DE LOS ", " DELOS "),

            (" DE LAS ", " DELAS "),

            (" STO ", " SANTO "),

            (" STA ", " SANTA "),

        )

        for src, dst in replacements:

            s = s.replace(src, dst)

        return self._MULTI_SPACE_REGEX.sub(" ", s).strip()

    def _clean_words(self, text: str) -> str:

        ascii_upper = self._strip_accents(text).upper()

        alnum = self._NON_ALNUM_REGEX.sub(" ", ascii_upper)

        compact_spaces = self._MULTI_SPACE_REGEX.sub(" ", alnum).strip()

        return self._standardize_filipino_compounds(compact_spaces)

    def _normalize_id_code(self, text: str) -> str:

        ascii_upper = self._strip_accents(text).upper()

        compact = self._COMPACT_ID_REGEX.sub("", ascii_upper)

        return compact

    def _chars_are_lookalikes(self, ch_a: str, ch_b: str) -> bool:

        if ch_a == ch_b:

            return True

        for group in self._OCR_LOOKALIKE_GROUPS:

            if ch_a in group and ch_b in group:

                return True

        return False

    def _extract_dates(self, text: str) -> set:

        upper = self._strip_accents(text).upper()

        dates = set()

        for y, m, d in self._ISO_DATE_REGEX.findall(upper):

            dates.add(f"{int(y):04d}-{int(m):02d}-{int(d):02d}")

        for p1, p2, y in self._NUMERIC_DATE_REGEX.findall(upper):

            n1, n2 = int(p1), int(p2)

            if 1 <= n1 <= 12 and 1 <= n2 <= 31:

                dates.add(f"{int(y):04d}-{n1:02d}-{n2:02d}")

            if 1 <= n2 <= 12 and 1 <= n1 <= 31:

                dates.add(f"{int(y):04d}-{n2:02d}-{n1:02d}")

        for mon, day, yr in self._WORD_DATE_1_REGEX.findall(upper):

            if mon in MONTH_MAP:

                dates.add(f"{int(yr):04d}-{MONTH_MAP[mon]}-{int(day):02d}")

        for day, mon, yr in self._WORD_DATE_2_REGEX.findall(upper):

            if mon in MONTH_MAP:

                dates.add(f"{int(yr):04d}-{MONTH_MAP[mon]}-{int(day):02d}")

        return dates

class FieldComparisonEngine(BaseTextMatcher):

    def _token_matches_list(self, token: str, candidate_words: list, min_ratio: float = 0.86) -> bool:

        if token in candidate_words:

            return True

        for word in candidate_words:

            if len(word) >= 3 and len(token) >= 3:

                if SequenceMatcher(None, token, word).ratio() >= min_ratio:

                    return True

        return False

    def _compare_name(self, entered: dict, ext_name: str, ext_first: str, ext_middle: str, ext_last: str, all_ocr_words: list) -> dict:

        entered_full = (entered.get("full_name") or "").strip()

        first_raw = (entered.get("first_name") or "").strip()

        middle_raw = (entered.get("middle_name") or "").strip()

        last_raw = (entered.get("last_name") or "").strip()

        id_name_chunk = " ".join(filter(None, [ext_name, ext_first, ext_middle, ext_last]))

        id_name_words = self._clean_words(id_name_chunk).split() if id_name_chunk else []

        search_words = id_name_words if id_name_words else all_ocr_words

        if not search_words:

            return {

                "field": "Full Name",

                "key": "name",

                "entered": entered_full,

                "found_on_id": "Not clearly visible",

                "status": "partial",

                "note": "Applicant name could not be clearly read from the ID photo.",

            }

        if first_raw and last_raw:

            req_tokens = [

                t for t in (self._clean_words(first_raw).split() + self._clean_words(last_raw).split())

                if len(t) > 1 and t not in NAME_SUFFIXES

            ]

            mid_clean = self._clean_words(middle_raw)

            mid_tokens = [

                t for t in mid_clean.split()

                if t not in ("NA", "N", "NONE") and t not in NAME_SUFFIXES

            ]

            missing_core = [t for t in req_tokens if not self._token_matches_list(t, search_words, 0.86)]

            middle_conflict = False

            if mid_tokens and ext_middle:

                ext_mid_tokens = [t for t in self._clean_words(ext_middle).split() if t not in NAME_SUFFIXES]

                if ext_mid_tokens:

                    first_entered_mid = mid_tokens[0]

                    first_id_mid = ext_mid_tokens[0]

                    if len(first_id_mid) == 1:

                        if first_id_mid != first_entered_mid[0]:

                            middle_conflict = True

                    elif not self._token_matches_list(first_entered_mid, ext_mid_tokens, 0.84):

                        middle_conflict = True

            if not missing_core and not middle_conflict:

                status = "match"

                note = "Applicant first name, middle name/initial, and surname match the ID."

            elif len(missing_core) == len(req_tokens):

                status = "mismatch"

                note = "Entered name does not match the name printed on the ID."

            else:

                status = "mismatch"

                if middle_conflict and not missing_core:

                    note = f"Middle name on form ({middle_raw}) differs from middle name on ID ({ext_middle})."

                else:

                    note = f"Name discrepancy detected on: {', '.join(missing_core)}."

            return {

                "field": "Full Name",

                "key": "name",

                "entered": entered_full,

                "found_on_id": ext_name or " ".join(search_words[:6]),

                "status": status,

                "note": note,

            }

        name_parts = [

            p for p in self._clean_words(entered_full).split()

            if len(p) > 1 and p != "NA" and p not in NAME_SUFFIXES

        ]

        matched_parts = [p for p in name_parts if self._token_matches_list(p, search_words, 0.86)]

        ratio = (len(matched_parts) / len(name_parts)) if name_parts else 0.0

        if ratio >= 0.99:

            status, note = "match", "All name parts match the uploaded ID."

        else:

            status = "mismatch"

            note = f"Entered name ({entered_full}) differs from name read on ID ({ext_name or 'check ID'})."

        return {

            "field": "Full Name",

            "key": "name",

            "entered": entered_full,

            "found_on_id": ext_name or (" ".join(matched_parts) if matched_parts else "Not clearly visible"),

            "status": status,

            "note": note,

        }

    def _compare_birth_date(self, entered_dob: str, ext_dob: str, lines: list) -> dict:

        clean_entered = (entered_dob or "").strip()

        ext_dob_dates = self._extract_dates(ext_dob) if ext_dob else set()

        if ext_dob and re.match(r"^\d{4}-\d{2}-\d{2}$", ext_dob):

            ext_dob_dates.add(ext_dob)

        if ext_dob_dates:

            if clean_entered in ext_dob_dates:

                return {

                    "field": "Birth Date",

                    "key": "birth_date",

                    "entered": clean_entered,

                    "found_on_id": clean_entered,

                    "status": "match",

                    "note": "Birth date matches the date printed on the ID.",

                }

            dob_found = sorted(ext_dob_dates)[0]

            return {

                "field": "Birth Date",

                "key": "birth_date",

                "entered": clean_entered,

                "found_on_id": dob_found,

                "status": "mismatch",

                "note": f"Entered birth date ({clean_entered}) differs from ID birth date ({dob_found}).",

            }

        dob_context_lines = []

        for idx, ln in enumerate(lines):

            upper_ln = ln.upper()

            if any(k in upper_ln for k in ("BIRTH", "DOB", "KAPANGANAKAN", "BORN")):

                dob_context_lines.append(ln)

                if idx + 1 < len(lines):

                    dob_context_lines.append(lines[idx + 1])

        candidate_dates = self._extract_dates(" ".join(dob_context_lines))

        if not candidate_dates:

            non_issue_lines = [
                ln for ln in lines
                if not any(k in ln.upper() for k in ("ISSUED", "ISSUE", "EXPIR", "VALID UNTIL", "VALIDITY"))
            ]

            candidate_dates = self._extract_dates(" ".join(non_issue_lines))

        if clean_entered in candidate_dates:

            return {

                "field": "Birth Date",

                "key": "birth_date",

                "entered": clean_entered,

                "found_on_id": clean_entered,

                "status": "match",

                "note": "Birth date matches the date printed on the ID.",

            }

        if candidate_dates:

            dob_found = sorted(candidate_dates)[0]

            return {

                "field": "Birth Date",

                "key": "birth_date",

                "entered": clean_entered,

                "found_on_id": dob_found,

                "status": "mismatch",

                "note": f"Entered birth date ({clean_entered}) differs from ID date ({dob_found}).",

            }

        return {

            "field": "Birth Date",

            "key": "birth_date",

            "entered": clean_entered,

            "found_on_id": "Not clearly visible",

            "status": "partial",

            "note": "Birth date could not be clearly read from the ID photo.",

        }

    def _codes_match_strictly(self, entered_code: str, candidate_code: str) -> tuple:

        if not entered_code or not candidate_code:

            return False, ""

        c_clean = self._ID_PREFIX_REGEX.sub("", candidate_code)

        e_clean = self._ID_PREFIX_REGEX.sub("", entered_code)

        for cand in (candidate_code, c_clean):

            if not cand:

                continue

            if e_clean == cand or entered_code == cand:

                return True, "exact"

            if len(entered_code) == 4 and len(cand) >= 4 and cand.endswith(entered_code):

                return True, "last4"

            if len(entered_code) == len(cand) and len(entered_code) >= 8:

                diffs = 0

                all_lookalike = True

                for ca, cb in zip(entered_code, cand):

                    if ca != cb:

                        diffs += 1

                        if not self._chars_are_lookalikes(ca, cb):

                            all_lookalike = False

                            break

                if diffs == 1 and all_lookalike:

                    return True, "lookalike"

        return False, ""

    def _compare_id_number(self, entered_id: str, ext_id: str, alt_ids: list, compact_ocr: str) -> dict:

        clean_entered_raw = (entered_id or "").strip()

        compact_entered = self._normalize_id_code(clean_entered_raw)

        candidates_raw = []

        if ext_id:

            candidates_raw.append(ext_id)

        for item in alt_ids or []:

            if item and str(item).strip() not in candidates_raw:

                candidates_raw.append(str(item).strip())

        for raw_cand in candidates_raw:

            compact_cand = self._normalize_id_code(raw_cand)

            matched, mode = self._codes_match_strictly(compact_entered, compact_cand)

            if matched:

                return {

                    "field": "ID Number",

                    "key": "id_number",

                    "entered": clean_entered_raw,

                    "found_on_id": raw_cand,

                    "status": "match",

                    "note": "ID number matches the number printed on the uploaded ID.",

                }

        if len(compact_entered) >= 6 and compact_entered in compact_ocr:

            return {

                "field": "ID Number",

                "key": "id_number",

                "entered": clean_entered_raw,

                "found_on_id": ext_id or clean_entered_raw,

                "status": "match",

                "note": "ID number matches the uploaded document.",

            }

        if candidates_raw:

            primary_found = candidates_raw[0]

            return {

                "field": "ID Number",

                "key": "id_number",

                "entered": clean_entered_raw,

                "found_on_id": primary_found,

                "status": "mismatch",

                "note": f"Entered ID number ({clean_entered_raw}) does not match the number on the ID ({primary_found}).",

            }

        return {

            "field": "ID Number",

            "key": "id_number",

            "entered": clean_entered_raw,

            "found_on_id": "Not clearly visible",

            "status": "partial",

            "note": "ID number could not be clearly read from the uploaded photo; manual Agent check advised.",

        }

    def compare(self, entered: dict, ocr_payload: dict) -> list:

        lines = list(ocr_payload.get("lines") or [])

        ext_name = str(ocr_payload.get("extracted_name") or "").strip()

        ext_first = str(ocr_payload.get("extracted_first_name") or "").strip()

        ext_middle = str(ocr_payload.get("extracted_middle_name") or "").strip()

        ext_last = str(ocr_payload.get("extracted_last_name") or "").strip()

        ext_dob = str(ocr_payload.get("extracted_birth_date") or "").strip()

        ext_id = str(ocr_payload.get("extracted_id_number") or "").strip()

        alt_ids = list(ocr_payload.get("alternate_id_numbers") or [])

        combined_chunks = list(lines) + [ext_name, ext_dob, ext_id] + [str(x) for x in alt_ids]

        raw_joined = " ".join(x for x in combined_chunks if x)

        all_ocr_words = self._clean_words(raw_joined).split()

        compact_ocr = self._normalize_id_code(raw_joined)

        results = []

        if ocr_payload.get("is_valid_government_id") is False:

            detected_doc = str(ocr_payload.get("detected_document_type") or "Non-ID or unreadable image").strip()

            results.append({
                "field": "Document Authenticity Check",
                "key": "document_type",
                "entered": str(entered.get("id_type") or "Government ID").strip(),
                "found_on_id": detected_doc,
                "status": "mismatch",
                "note": f"Uploaded image does not appear to be a valid government-issued ID ({detected_doc}).",
            })

        elif ocr_payload.get("id_type_matches_declared") is False:

            detected_doc = str(ocr_payload.get("detected_document_type") or "Different ID type").strip()

            entered_doc = str(entered.get("id_type") or "Selected ID").strip()

            results.append({
                "field": "ID Type Match",
                "key": "id_type",
                "entered": entered_doc,
                "found_on_id": detected_doc,
                "status": "mismatch",
                "note": f"Selected ID type ({entered_doc}) does not match the uploaded document ({detected_doc}).",
            })

        if (entered.get("full_name") or "").strip():

            results.append(

                self._compare_name(entered, ext_name, ext_first, ext_middle, ext_last, all_ocr_words)

            )

        if (entered.get("birth_date") or "").strip():

            results.append(

                self._compare_birth_date(entered.get("birth_date") or "", ext_dob, lines)

            )

        if (entered.get("id_number") or "").strip():

            results.append(

                self._compare_id_number(entered.get("id_number") or "", ext_id, alt_ids, compact_ocr)

            )

        return results

class BaseLanguageClient:

    _TECH_TERMS_REGEX = re.compile(

        r"\b(OpenCV|Gemini|Google\s+AI|CLAHE|Laplacian|OCR|LLM|Artificial\s+Intelligence|AI)\b",

        re.IGNORECASE,

    )

    _CODE_FENCE_REGEX = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)

    def is_available(self) -> bool:

        raise NotImplementedError("Subclasses must implement is_available().")

    def _sanitize_plain_text(self, text: str) -> str:

        cleaned = self._TECH_TERMS_REGEX.sub("screening", text or "")

        return re.sub(r"\s{2,}", " ", cleaned).strip()

    def _parse_json_text(self, raw_text: str) -> dict:

        stripped = self._CODE_FENCE_REGEX.sub("", (raw_text or "").strip()).strip()

        start = stripped.find("{")

        end = stripped.rfind("}")

        if start != -1 and end != -1 and end > start:

            stripped = stripped[start : end + 1]

        return json.loads(stripped)

class GeminiScreeningService(BaseLanguageClient):

    _API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

    _OCR_RESPONSE_SCHEMA = {
        "type": "OBJECT",
        "properties": {
            "is_valid_government_id": {"type": "BOOLEAN"},
            "id_type_matches_declared": {"type": "BOOLEAN"},
            "detected_document_type": {"type": "STRING"},
            "extracted_name": {"type": "STRING"},
            "extracted_first_name": {"type": "STRING"},
            "extracted_middle_name": {"type": "STRING"},
            "extracted_last_name": {"type": "STRING"},
            "extracted_birth_date": {"type": "STRING"},
            "extracted_id_number": {"type": "STRING"},
            "alternate_id_numbers": {
                "type": "ARRAY",
                "items": {"type": "STRING"},
            },
            "unreadable_or_occluded_fields": {
                "type": "ARRAY",
                "items": {"type": "STRING"},
            },
            "confidence": {"type": "STRING"},
            "lines": {
                "type": "ARRAY",
                "items": {"type": "STRING"},
            },
        },
        "required": [
            "is_valid_government_id",
            "id_type_matches_declared",
            "detected_document_type",
            "extracted_name",
            "extracted_first_name",
            "extracted_middle_name",
            "extracted_last_name",
            "extracted_birth_date",
            "extracted_id_number",
            "alternate_id_numbers",
            "unreadable_or_occluded_fields",
            "confidence",
            "lines",
        ],
    }

    _FIELD_PATTERNS = [

        ("id_photo", re.compile(r"(blur|unclear|dark|glare|flash|unreadable|photo|image|id\s*copy|crop|cut\s*off)", re.I)),

        ("name", re.compile(r"(name|surname|first\s*name|middle\s*name|last\s*name|spelling)", re.I)),

        ("birth_date", re.compile(r"(birth|birthday|dob|date\s*of\s*birth)", re.I)),

        ("id_number", re.compile(r"(id\s*no|id\s*number|card\s*number|license\s*number|psn|pcn|crn)", re.I)),

        ("email", re.compile(r"(email|gmail|already\s*registered|existing\s*email|duplicate\s*email)", re.I)),

        ("phone", re.compile(r"(mobile|phone|contact\s*number|cellphone)", re.I)),

        ("address", re.compile(r"(address|street|barangay|landmark|house|location|pin)", re.I)),

    ]

    def _get_config(self) -> tuple:

        api_key = (getenv("GEMINI_API_KEY") or "").strip()

        model = (getenv("GEMINI_MODEL") or "gemini-2.5-flash").strip()

        return api_key, model

    def is_available(self) -> bool:

        api_key, _ = self._get_config()

        return bool(api_key)

    def _detect_mime_type(self, image_bytes: bytes) -> str:

        if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):

            return "image/png"

        if image_bytes.startswith(b"RIFF") and b"WEBP" in image_bytes[:16]:

            return "image/webp"

        return "image/jpeg"

    def _call_gemini(

        self,

        parts: list,

        expect_json: bool = True,

        max_tokens: int = 2048,

        temperature: float = 0.0,

        response_schema: dict = None,

        system_instruction: str = "",

        model_override: str = "",

    ) -> str:

        api_key, primary_model = self._get_config()

        if not api_key:

            return ""

        gen_cfg = {
            "temperature": temperature,
            "topP": 0.1,
            "topK": 1,
            "maxOutputTokens": max_tokens,
        }

        if expect_json:

            gen_cfg["responseMimeType"] = "application/json"

            if response_schema:

                gen_cfg["responseSchema"] = response_schema

        payload = {

            "contents": [{"parts": parts}],

            "generationConfig": gen_cfg,

        }

        if system_instruction:

            payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}

        headers = {

            "Content-Type": "application/json",

            "X-goog-api-key": api_key,

        }

        models_to_try = [model_override.strip() or primary_model]

        for fallback_model in ("gemini-2.5-flash", "gemini-2.5-pro", "gemini-flash-latest"):

            if fallback_model not in models_to_try:

                models_to_try.append(fallback_model)

        for model_name in models_to_try:

            url = f"{self._API_BASE}/{model_name}:generateContent"

            model_payload = dict(payload)

            model_cfg = dict(gen_cfg)

            if "2.5-flash" in model_name:

                model_cfg["thinkingConfig"] = {"thinkingBudget": 0}

            model_payload["generationConfig"] = model_cfg

            try:

                reply = httpx.post(url, headers=headers, json=model_payload, timeout=18)

                if reply.status_code == 200:

                    data = reply.json()

                    candidates = data.get("candidates") or []

                    if candidates:

                        content = candidates[0].get("content") or {}

                        out_parts = content.get("parts") or []

                        texts = [str(p.get("text") or "") for p in out_parts if p.get("text")]

                        joined = "\n".join(texts).strip()

                        if joined:

                            return joined

            except Exception:

                continue

        return ""

    def _build_id_type_guide(self, id_type: str) -> str:

        t = (id_type or "").lower()

        if "passport" in t:

            return "LAYOUT HINT (Philippine Passport): Read visual bio page fields (`Surname`, `Given Names`, `Middle Name`, `Date of Birth`) AND verify against the bottom 2 MRZ lines (`P<PHL...` and passport number + `YYMMDD` DOB). Ignore Date of Issue / Expiry. "

        if "driver" in t or "lto" in t:

            return "LAYOUT HINT (Philippine Driver's License): Name prints as `LAST NAME, FIRST NAME MIDDLE NAME`. Extract `Date of Birth` (`YYYY/MM/DD` or `YYYY-MM-DD`), NEVER `Expiration Date`. License No. starts with 1 letter + 10 digits (e.g. `N01-23-456789`). "

        if "national" in t or "philsys" in t or "ephilid" in t:

            return "LAYOUT HINT (Philippine National ID / PhilSys / ePhilID): Look for `Apelyido/Last Name`, `Mga Pangalan/Given Names`, `Gitnang Apelyido/Middle Name`, `Petsa ng Kapanganakan/Date of Birth`, 16-digit `PCN` (xxxx-xxxx-xxxx-xxxx) on front, and 12-digit `PSN` or QR label on back/bottom. "

        if "unified" in t or "umid" in t:

            return "LAYOUT HINT (UMID Card): CRN is the 12-digit number near the top right (`CRN-XXXX-XXXXXXX-X`). Extract Surname, Given Name, Middle Name, and Date of Birth; ignore issue stamps. "

        if "sss" in t or "gsis" in t:

            return "LAYOUT HINT (SSS / My.SSS / GSIS ID): Look for SS Number (10 digits), CRN (12 digits), or GSIS BP/ID number (11 digits) and cardholder birth date if printed. "

        if "philhealth" in t:

            return "LAYOUT HINT (PhilHealth ID): PIN is 12 digits (`XX-XXXXXXXXX-X`). Digitized or laminated versions may print name as `LAST, FIRST MIDDLE`. "

        if "postal" in t:

            return "LAYOUT HINT (Postal ID): PRN is the 12-13 character reference code (often starting with `PRN`). Extract Date of Birth, NOT Valid Until date. "

        if "tin" in t:

            return "LAYOUT HINT (TIN ID with photo): TIN is 9 to 12 digits (`XXX-XXX-XXX-000`). Extract Birth Date carefully; ignore Date Issued. "

        if "voter" in t or "comelec" in t:

            return "LAYOUT HINT (Voter's / COMELEC ID): VIN is printed at the top (`XXXX-XXXXA-...`). Extract Surname, First, Middle, and Date of Birth. "

        if "police clearance" in t:

            return "LAYOUT HINT (National Police Clearance): Usually portrait layout. Extract applicant name, DOB, and Clearance Reference No., ignoring issue/validity dates. "

        if "credit card" in t:

            return "LAYOUT HINT (Locally-issued Credit Card): Name is embossed/printed on card; DOB and Middle Name may not be printed (mark missing ones in `unreadable_or_occluded_fields` instead of guessing). For `extracted_id_number`, extract ONLY visible last 4 digits or printed non-CVV reference if unmasked. "

        if "company" in t or "student" in t or "barangay" in t or "senior" in t:

            return "LAYOUT HINT (Company / Student / Barangay / Senior Citizen ID): These may be portrait or custom layouts and DOB may be on the back side; read both Front and Back carefully without guessing unprinted fields. "

        if "alien" in t or "acr" in t or "firearms" in t or "prc" in t or "afp" in t or "pnp" in t or "air force" in t:

            return "LAYOUT HINT (Government/Service Credential): Read License/Serial/Registration/ACR number cleanly, distinguish Date of Birth from Date Issued/Expiry, and inspect both front and back sides. "

        return ""

    def extract_id_text(self, front_bytes: bytes, back_bytes: bytes = None, id_type: str = "", model_override: str = "") -> dict:

        if not front_bytes or not self.is_available():

            return {

                "available": False,

                "lines": [],

                "extracted_name": "",

                "extracted_first_name": "",

                "extracted_middle_name": "",

                "extracted_last_name": "",

                "extracted_birth_date": "",

                "extracted_id_number": "",

                "alternate_id_numbers": [],

                "note": "Vision text extraction is not configured.",

            }

        parts = []

        front_b64 = base64.b64encode(front_bytes).decode("ascii")

        parts.append({"text": "IMAGE 1 (FRONT OF ID):"})

        parts.append({

            "inline_data": {

                "mime_type": self._detect_mime_type(front_bytes),

                "data": front_b64,

            }

        })

        if back_bytes:

            back_b64 = base64.b64encode(back_bytes).decode("ascii")

            parts.append({"text": "IMAGE 2 (BACK OF ID):"})

            parts.append({

                "inline_data": {

                    "mime_type": self._detect_mime_type(back_bytes),

                    "data": back_b64,

                }

            })

        declared_type_hint = (

            f"The applicant selected ID type: '{id_type}'. " if id_type else ""

        )

        layout_guide = self._build_id_type_guide(id_type)

        side_hint = (

            "Both FRONT (Image 1) and BACK (Image 2) images of the same applicant identification credential are attached. "

            if back_bytes

            else "The FRONT image (Image 1) of an applicant identification credential is attached. "

        )

        system_rules = (
            "You are a strict forensic document transcription engine for Philippine telecom KYC verification. "
            "Never guess, infer, hallucinate, or auto-complete obscured, blurry, cropped, or missing characters. "
            "Every character you output in structured fields MUST be directly supported by visible printed text in the image and included in `lines`. "
            "If a field cannot be read with certainty or is not printed on this card type, output an empty string and list the field in `unreadable_or_occluded_fields`."
        )

        prompt = (

            side_hint

            + declared_type_hint

            + layout_guide

            + "Read every visible printed character with extreme character-by-character precision:\n"

            "1. ANTI-HALLUCINATION: Do NOT guess blurred, glare-washed, shaded, or covered characters, and do NOT invent placeholder values.\n"

            "2. Separate the cardholder's printed First/Given Name (`Pangalan`), Middle Name/Initial (`Gitnang Apelyido`), "

            "and Last Name/Surname (`Apelyido`), and set `extracted_name` to `First Middle Last`. Watch for `LAST, FIRST MIDDLE` format on LTO Driver's Licenses, Passports, UMID, PRC, and Police Clearances.\n"

            "3. For `extracted_birth_date`, extract ONLY the cardholder's Date of Birth (`Petsa ng Kapanganakan` / `Date of Birth`), "

            "NEVER the Date of Issue or Expiration Date, normalized strictly to `YYYY-MM-DD` (or empty string if unreadable or not printed on the card).\n"

            "4. For `extracted_id_number`, extract the primary card/license/ID number exactly as printed. "

            "Use cardholder conventions: National ID / PhilSys (16-digit PCN front or 12-digit PSN), Driver's License (LTO format e.g. N01-23-456789), Passport (9 chars + MRZ), UMID (12-digit CRN), SSS/My.SSS (10 digits), GSIS (11 digits), Postal ID (PRN), PhilHealth (12 digits), TIN (9-12 digits), ACR I-Card, Firearms License, PRC, Voter's/Comelec, Senior Citizen's, Barangay, Police Clearance, AFP/PNP/Air Force, Company ID, Student ID, or Locally-issued Credit Card. "

            "Include any secondary printed numbers in `alternate_id_numbers`.\n"

            "5. Put every readable printed text line verbatim in `lines`.\n"

            "6. Set `is_valid_government_id` to `true` if the image clearly shows an authentic physical or digital accepted ID credential (Philippine government ID, National ID/ePhilID, LTO/Passport/UMID/SSS/GSIS/PRC/IBP/OFW/Diplomat/AFP/PNP/Air Force/Postal/PhilHealth/Voter's/Senior Citizen/Barangay/TIN/Firearms/ACR, verifiable Police Clearance, Company ID, Student ID, or Locally-issued Credit Card). Set `false` ONLY for selfies, landscapes, blank images, receipts, random screenshots, or non-ID photos, and describe what is shown in `detected_document_type`.\n"

            "7. Set `id_type_matches_declared` to `false` ONLY if you clearly detect a DIFFERENT specific ID card type than the applicant's selected type (otherwise `true`). Treat variants like 'National ID' / 'Philippine National ID (PhilSys)', 'Digitized' vs 'Laminated' Postal/PhilHealth, or 'SSS ID' / 'My.SSS ID' / 'SSS/GSIS with photo' as matching.\n"

            "8. List any blurry, cut-off, shadowed, or absent target fields among `[\"name\", \"birth_date\", \"id_number\"]` in `unreadable_or_occluded_fields`, and set `confidence` to `\"high\"`, `\"medium\"`, or `\"low\"`."
        )

        parts.append({"text": prompt})

        raw = self._call_gemini(

            parts=parts,

            expect_json=True,

            max_tokens=2048,

            temperature=0.0,

            response_schema=self._OCR_RESPONSE_SCHEMA,

            system_instruction=system_rules,

            model_override=model_override,

        )

        if not raw:

            return {

                "available": False,

                "lines": [],

                "extracted_name": "",

                "extracted_first_name": "",

                "extracted_middle_name": "",

                "extracted_last_name": "",

                "extracted_birth_date": "",

                "extracted_id_number": "",

                "alternate_id_numbers": [],

                "unreadable_fields": [],

                "ungrounded_fields": [],

                "confidence": "low",

                "note": "Vision OCR service did not return a response.",

            }

        try:

            parsed = self._parse_json_text(raw)

            raw_lines = parsed.get("lines") or []

            clean_lines = [str(x).strip() for x in raw_lines if str(x).strip()]

            alt_nums = [str(x).strip() for x in (parsed.get("alternate_id_numbers") or []) if str(x).strip()]

            unreadable = [str(x).strip().lower() for x in (parsed.get("unreadable_or_occluded_fields") or []) if str(x).strip()]

            ext_name = str(parsed.get("extracted_name") or "").strip()

            ext_first = str(parsed.get("extracted_first_name") or "").strip()

            ext_middle = str(parsed.get("extracted_middle_name") or "").strip()

            ext_last = str(parsed.get("extracted_last_name") or "").strip()

            ext_dob = str(parsed.get("extracted_birth_date") or "").strip()

            ext_id = str(parsed.get("extracted_id_number") or "").strip()

            ungrounded = []

            if "name" in unreadable:

                ext_name, ext_first, ext_middle, ext_last = "", "", "", ""

            if "birth_date" in unreadable:

                ext_dob = ""

            if "id_number" in unreadable:

                ext_id = ""

            if clean_lines:

                compact_lines = _matcher._normalize_id_code(" ".join(clean_lines))

                clean_words = _matcher._clean_words(" ".join(clean_lines)).split()

                if ext_id:

                    compact_id = _matcher._normalize_id_code(ext_id)

                    id_core = _matcher._ID_PREFIX_REGEX.sub("", compact_id)

                    if len(id_core) >= 4 and id_core not in compact_lines and compact_id not in compact_lines:

                        ext_id = ""

                        ungrounded.append("id_number")

                if alt_nums:

                    verified_alts = []

                    for alt_val in alt_nums:

                        c_alt = _matcher._normalize_id_code(alt_val)

                        c_core = _matcher._ID_PREFIX_REGEX.sub("", c_alt)

                        if c_alt and (len(c_core) < 4 or c_core in compact_lines or c_alt in compact_lines):

                            verified_alts.append(alt_val)

                    alt_nums = verified_alts

                if ext_dob:

                    dob_year_match = re.match(r"^(\d{4})-", ext_dob)

                    if dob_year_match and dob_year_match.group(1) not in " ".join(clean_lines):

                        ext_dob = ""

                        ungrounded.append("birth_date")

                if ext_last and clean_words:

                    last_tokens = [t for t in _matcher._clean_words(ext_last).split() if len(t) >= 3]

                    if last_tokens and not any(_matcher._token_matches_list(tok, clean_words, 0.80) for tok in last_tokens):

                        ext_name, ext_first, ext_middle, ext_last = "", "", "", ""

                        ungrounded.append("name")

            return {
                "available": True,
                "is_valid_government_id": bool(parsed.get("is_valid_government_id", True)),
                "id_type_matches_declared": bool(parsed.get("id_type_matches_declared", True)),
                "detected_document_type": str(parsed.get("detected_document_type") or "").strip(),
                "confidence": str(parsed.get("confidence") or "medium").strip().lower(),
                "unreadable_fields": unreadable,
                "ungrounded_fields": ungrounded,
                "lines": clean_lines,
                "line_count": len(clean_lines),
                "extracted_name": ext_name,
                "extracted_first_name": ext_first,
                "extracted_middle_name": ext_middle,
                "extracted_last_name": ext_last,
                "extracted_birth_date": ext_dob,
                "extracted_id_number": ext_id,
                "alternate_id_numbers": alt_nums,
            }

        except Exception:

            fallback_lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]

            return {

                "available": True,

                "is_valid_government_id": True,

                "id_type_matches_declared": True,

                "confidence": "low",

                "unreadable_fields": ["name", "birth_date", "id_number"],

                "ungrounded_fields": [],

                "lines": fallback_lines,

                "line_count": len(fallback_lines),

                "extracted_name": "",

                "extracted_first_name": "",

                "extracted_middle_name": "",

                "extracted_last_name": "",

                "extracted_birth_date": "",

                "extracted_id_number": "",

                "alternate_id_numbers": [],

            }

    def detect_target_fields(self, raw_remark: str, chosen_field: str = "") -> list:

        fields = []

        if chosen_field and chosen_field != "auto":

            fields.append(chosen_field)

        for field_key, regex in self._FIELD_PATTERNS:

            if regex.search(raw_remark or "") and field_key not in fields:

                fields.append(field_key)

        return fields or ["general"]

    def _build_rule_guidance(self, quality: dict, comparisons: list) -> dict:

        findings = []

        guidance = []

        for issue in quality.get("issues", []):

            findings.append(issue)

            guidance.append("Ask the customer to upload a clear, well-lit photo of the original Valid ID.")

        for comp in comparisons:

            field_name = comp.get("field", "Detail")

            status = comp.get("status", "")

            note = comp.get("note", "")

            if status == "mismatch":

                findings.append(note or f"{field_name} entered on the form does not match the uploaded ID.")

                guidance.append(f"Inspect the ID and confirm whether the customer should update their {field_name.lower()}.")

            elif status == "partial":

                findings.append(note or f"{field_name} could only be partially verified from the ID photo.")

                guidance.append(f"Visually verify the {field_name.lower()} on the ID before forwarding for encoding.")

        if not findings:

            findings.append("Document photo is clear and entered details match the uploaded ID.")

            guidance.append("Ready for Agent review and provider encoding preparation.")

        return {"findings": findings[:4], "guidance": guidance[:4]}

    def write_guidance(self, quality: dict, comparisons: list) -> dict:

        fallback = self._build_rule_guidance(quality, comparisons)

        if not self.is_available():

            return {"available": False, **fallback}

        has_any_concern = bool(quality.get("issues")) or any(

            c.get("status") in ("mismatch", "partial") for c in comparisons

        )

        if not has_any_concern:

            return {"available": True, **fallback}

        summary_data = {

            "image_issues": quality.get("issues", []),

            "field_checks": [

                {

                    "field": c.get("field"),

                    "entered": c.get("entered"),

                    "found_on_id": c.get("found_on_id"),

                    "status": c.get("status"),

                    "note": c.get("note"),

                }

                for c in comparisons

            ],

        }

        prompt = (

            "You are an application screening co-pilot assisting a human Verification Agent at an internet service company. "

            "STRICT FACTUALITY: Mention ONLY discrepancies and facts explicitly present in the Checks JSON below. "

            "Do NOT invent numbers, fields, or issues that do not appear in Checks, and do NOT mention AI, Gemini, OCR, or OpenCV. "

            'Return ONLY valid JSON: {"findings": ["short point"], "guidance": ["short action tip for the agent"]}.\n\n'

            "Checks:\n" + json.dumps(summary_data)

        )

        raw = self._call_gemini(parts=[{"text": prompt}], expect_json=True, max_tokens=512, temperature=0.0)

        if raw:

            try:

                parsed = self._parse_json_text(raw)

                f_list = [self._sanitize_plain_text(str(x)) for x in (parsed.get("findings") or []) if str(x).strip()]

                g_list = [self._sanitize_plain_text(str(x)) for x in (parsed.get("guidance") or []) if str(x).strip()]

                checks_blob = json.dumps(summary_data)

                out_blob = " ".join(f_list + g_list)

                cited_numbers = re.findall(r"\d{5,}", out_blob)

                if f_list and g_list and all(num in checks_blob for num in cited_numbers):

                    return {"available": True, "findings": f_list[:4], "guidance": g_list[:4]}

            except Exception:

                pass

        return {"available": True, **fallback}

    def write_polite_remark(self, raw_remark: str, chosen_field: str = "") -> dict:

        clean_note = (raw_remark or "").strip()

        target_fields = self.detect_target_fields(clean_note, chosen_field)

        primary = target_fields[0]

        polite_defaults = {

            "id_photo": (

                "Hello! Thank you for applying with PIGEM. Could you please upload a clearer, well-lit photo "

                "of your valid ID without glare so our team can verify your details and continue processing your application?"

            ),

            "name": (

                "Hello! Thank you for applying with PIGEM. We noticed a slight difference between the name on your form "

                "and your valid ID—please review and update your name in your Customer Account so it matches your ID."

            ),

            "birth_date": (

                "Hello! Thank you for applying with PIGEM. Please check and update your date of birth in your Customer Account "

                "so it matches the birth date printed on your valid ID."

            ),

            "id_number": (

                "Hello! Thank you for applying with PIGEM. Please review and update your ID number in your Customer Account "

                "so it matches the number printed on your submitted valid ID."

            ),

            "email": (

                "Hello! Thank you for applying with PIGEM. It looks like your Gmail address already has an active registration "

                "with the provider—could you please provide an alternative @gmail.com address to continue processing?"

            ),

            "phone": (

                "Hello! Thank you for applying with PIGEM. Please review or provide an active mobile number in your "

                "Customer Account so our team can reach you smoothly regarding your installation."

            ),

            "address": (

                "Hello! Thank you for applying with PIGEM. Could you please confirm or update your complete installation "

                "address and nearest landmark in your Customer Account so we can verify fiber coverage accurately?"

            ),

            "general": (

                "Hello! Thank you for applying with PIGEM. Please sign in to your Customer Account to review and update "

                "the highlighted details on your application so we can continue processing your request right away."

            ),

        }

        fallback_msg = polite_defaults.get(primary, polite_defaults["general"])

        if not clean_note or not self.is_available():

            return {

                "available": self.is_available(),

                "polite_message": fallback_msg,

                "target_fields": target_fields,

            }

        prompt = (

            "Rewrite the staff verification note below into a warm, polite, plain-English 2-sentence message "

            "to a home internet applicant asking them to update the specific detail in their Customer Account. "

            "Do NOT include sensitive ID numbers in the message and do NOT mention AI, Gemini, OCR, or technical terms. "

            "Start with 'Hello!'.\n\n"

            f"Verification note: {clean_note}\n"

            f"Target field: {primary}\n"

            'Return ONLY valid JSON: {"polite_message": "..."}'

        )

        raw = self._call_gemini(parts=[{"text": prompt}], expect_json=True, max_tokens=200, temperature=0.15)

        if raw:

            try:

                parsed = self._parse_json_text(raw)

                msg = self._sanitize_plain_text(str(parsed.get("polite_message") or ""))

                if len(msg) >= 25:

                    return {

                        "available": True,

                        "polite_message": msg,

                        "target_fields": target_fields,

                    }

            except Exception:

                pass

        return {

            "available": True,

            "polite_message": fallback_msg,

            "target_fields": target_fields,

        }

_matcher = FieldComparisonEngine()

_gemini_service = GeminiScreeningService()

def is_available() -> bool:

    return _gemini_service.is_available()

def extract_id_text(front_bytes: bytes, back_bytes: bytes = None, id_type: str = "") -> dict:

    return _gemini_service.extract_id_text(front_bytes, back_bytes=back_bytes, id_type=id_type)

def extract_id_text_with_fallback(
    primary_front: bytes,
    primary_back: bytes = None,
    raw_front: bytes = None,
    raw_back: bytes = None,
    id_type: str = "",
) -> dict:

    first_pass = _gemini_service.extract_id_text(primary_front, back_bytes=primary_back, id_type=id_type)

    if not first_pass.get("available"):

        return first_pass

    missing_core = not (
        first_pass.get("extracted_name")
        and first_pass.get("extracted_birth_date")
        and first_pass.get("extracted_id_number")
    )

    low_conf = first_pass.get("confidence") == "low"

    has_ungrounded = bool(first_pass.get("ungrounded_fields"))

    needs_escalation = bool(missing_core or low_conf or has_ungrounded or first_pass.get("is_valid_government_id") is False)

    if not needs_escalation:

        return first_pass

    retry_front = raw_front if raw_front else primary_front

    retry_back = raw_back if raw_back else primary_back

    _, configured_model = _gemini_service._get_config()

    escalate_model = "gemini-2.5-pro" if "pro" not in configured_model else ""

    if retry_front == primary_front and not escalate_model:

        return first_pass

    second_pass = _gemini_service.extract_id_text(
        retry_front,
        back_bytes=retry_back,
        id_type=id_type,
        model_override=escalate_model,
    )

    if not second_pass.get("available"):

        return first_pass

    score_1 = sum(1 for k in ("extracted_name", "extracted_birth_date", "extracted_id_number") if first_pass.get(k))

    score_2 = sum(1 for k in ("extracted_name", "extracted_birth_date", "extracted_id_number") if second_pass.get(k))

    if (second_pass.get("is_valid_government_id") and not first_pass.get("is_valid_government_id")) or score_2 > score_1:

        return second_pass

    if score_2 == score_1 and first_pass.get("confidence") == "low" and second_pass.get("confidence") != "low":

        return second_pass

    return first_pass

def compare_fields(entered: dict, ocr_payload: dict) -> list:

    return _matcher.compare(entered, ocr_payload)

def write_guidance(quality: dict, comparisons: list) -> dict:

    return _gemini_service.write_guidance(quality, comparisons)

def write_polite_remark(raw_remark: str, chosen_field: str = "") -> dict:

    return _gemini_service.write_polite_remark(raw_remark, chosen_field)
