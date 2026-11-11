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

            candidate_dates = self._extract_dates(" ".join(lines))

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
            "lines": {
                "type": "ARRAY",
                "items": {"type": "STRING"},
            },
        },
        "required": [
            "is_valid_government_id",
            "detected_document_type",
            "extracted_name",
            "extracted_first_name",
            "extracted_middle_name",
            "extracted_last_name",
            "extracted_birth_date",
            "extracted_id_number",
            "alternate_id_numbers",
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

        model = (getenv("GEMINI_MODEL") or "gemini-flash-latest").strip()

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

        max_tokens: int = 600,

        temperature: float = 0.0,

        response_schema: dict = None,

    ) -> str:

        api_key, primary_model = self._get_config()

        if not api_key:

            return ""

        gen_cfg = {"temperature": temperature, "maxOutputTokens": max_tokens}

        if expect_json:

            gen_cfg["responseMimeType"] = "application/json"

            if response_schema:

                gen_cfg["responseSchema"] = response_schema

        payload = {

            "contents": [{"parts": parts}],

            "generationConfig": gen_cfg,

        }

        headers = {

            "Content-Type": "application/json",

            "X-goog-api-key": api_key,

        }

        models_to_try = [primary_model]

        for fallback_model in ("gemini-2.5-flash", "gemini-2.0-flash"):

            if fallback_model not in models_to_try:

                models_to_try.append(fallback_model)

        for model_name in models_to_try:

            url = f"{self._API_BASE}/{model_name}:generateContent"

            try:

                reply = httpx.post(url, headers=headers, json=payload, timeout=25)

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

    def extract_id_text(self, front_bytes: bytes, back_bytes: bytes = None, id_type: str = "") -> dict:

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

        parts.append({

            "inline_data": {

                "mime_type": self._detect_mime_type(front_bytes),

                "data": front_b64,

            }

        })

        if back_bytes:

            back_b64 = base64.b64encode(back_bytes).decode("ascii")

            parts.append({

                "inline_data": {

                    "mime_type": self._detect_mime_type(back_bytes),

                    "data": back_b64,

                }

            })

        declared_type_hint = (

            f"The applicant selected ID type: '{id_type}'. " if id_type else ""

        )

        side_hint = (

            "Both FRONT and BACK images of the same Philippine identification card are attached. "

            if back_bytes

            else "The FRONT image of a Philippine identification card is attached. "

        )

        prompt = (

            side_hint

            + declared_type_hint

            + "Read every visible printed character with extreme character-by-character precision:\n"

            "1. Do NOT guess blurred or covered characters and do NOT judge legal authenticity.\n"

            "2. Separate the cardholder's printed First/Given Name (`Pangalan`), Middle Name (`Gitnang Apelyido`), "

            "and Last Name/Surname (`Apelyido`), and set `extracted_name` to `First Middle Last`.\n"

            "3. For `extracted_birth_date`, extract ONLY the cardholder's Date of Birth (`Petsa ng Kapanganakan` / `Date of Birth`), "

            "NEVER the Date of Issue or Expiration Date, normalized strictly to `YYYY-MM-DD` (or empty string if unreadable).\n"

            "4. For `extracted_id_number`, extract the primary card/license/ID number exactly as printed. "

            "If a secondary number is also printed on the front or back (for example PhilSys 16-digit PCN and 12-digit PSN, "

            "or CRN and serial number), include all secondary numbers in `alternate_id_numbers`.\n"

            "5. Put every readable text line from the card in `lines`.\n"
            "6. Set `is_valid_government_id` to `true` ONLY if the image clearly shows a physical or digital official Philippine government-issued ID card (or official paper/ePhilID); set `false` for selfies, landscapes, blank images, receipts, random screenshots, or unreadable pictures, and summarize what is shown in `detected_document_type`."
        )

        parts.append({"text": prompt})

        raw = self._call_gemini(

            parts=parts,

            expect_json=True,

            max_tokens=650,

            temperature=0.0,

            response_schema=self._OCR_RESPONSE_SCHEMA,

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

                "note": "Vision OCR service did not return a response.",

            }

        try:

            parsed = self._parse_json_text(raw)

            raw_lines = parsed.get("lines") or []

            clean_lines = [str(x).strip() for x in raw_lines if str(x).strip()]

            alt_nums = [str(x).strip() for x in (parsed.get("alternate_id_numbers") or []) if str(x).strip()]

            return {
                "available": True,
                "is_valid_government_id": bool(parsed.get("is_valid_government_id", True)),
                "detected_document_type": str(parsed.get("detected_document_type") or "").strip(),
                "lines": clean_lines,
                "line_count": len(clean_lines),
                "extracted_name": str(parsed.get("extracted_name") or "").strip(),
                "extracted_first_name": str(parsed.get("extracted_first_name") or "").strip(),
                "extracted_middle_name": str(parsed.get("extracted_middle_name") or "").strip(),
                "extracted_last_name": str(parsed.get("extracted_last_name") or "").strip(),
                "extracted_birth_date": str(parsed.get("extracted_birth_date") or "").strip(),
                "extracted_id_number": str(parsed.get("extracted_id_number") or "").strip(),
                "alternate_id_numbers": alt_nums,
            }

        except Exception:

            fallback_lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]

            return {

                "available": True,

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

            "Do NOT mention technical words like AI, Gemini, OCR, or OpenCV. "

            "State the specific discrepancy clearly so the Agent can verify it quickly. "

            'Return ONLY valid JSON: {"findings": ["short point"], "guidance": ["short action tip for the agent"]}.\n\n'

            "Checks:\n" + json.dumps(summary_data)

        )

        raw = self._call_gemini(parts=[{"text": prompt}], expect_json=True, max_tokens=280, temperature=0.1)

        if raw:

            try:

                parsed = self._parse_json_text(raw)

                f_list = [self._sanitize_plain_text(str(x)) for x in (parsed.get("findings") or []) if str(x).strip()]

                g_list = [self._sanitize_plain_text(str(x)) for x in (parsed.get("guidance") or []) if str(x).strip()]

                if f_list and g_list:

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

def compare_fields(entered: dict, ocr_payload: dict) -> list:

    return _matcher.compare(entered, ocr_payload)

def write_guidance(quality: dict, comparisons: list) -> dict:

    return _gemini_service.write_guidance(quality, comparisons)

def write_polite_remark(raw_remark: str, chosen_field: str = "") -> dict:

    return _gemini_service.write_polite_remark(raw_remark, chosen_field)
