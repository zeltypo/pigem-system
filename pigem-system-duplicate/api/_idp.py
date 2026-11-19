# ============================================================================
# PIGEM STUDY DUPLICATE — api/_idp.py (Stage 3 Azure Document Intelligence OCR)
# ============================================================================
# ROLE IN ARCHITECTURE:
#   Extracts printed text and structured identity fields from the OpenCV-prepared
#   Front and Back ID photos using Microsoft Azure AI Document Intelligence:
#   - Primary Model: `prebuilt-idDocument` (extracts FirstName, LastName, DateOfBirth,
#     DocumentNumber, Address, CountryRegion, ExpirationDate).
#   - Fallback/Supplement Model: `prebuilt-read` (high-accuracy OCR text lines for
#     Philippine government IDs whose layout differs from standard passport/driver cards).
# ============================================================================

from concurrent.futures import ThreadPoolExecutor
"""Step 2 (IDP Extraction): Azure AI Document Intelligence, Nanonets OCR-3 / ID Analyzer, with GPT-5.4 IDP fallback."""
import base64
import json
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple
import httpx

import _openai_client


def _azure_endpoint() -> str:
    return (
        os.getenv("AZURE_DI_ENDPOINT")
        or os.getenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT")
        or os.getenv("AZURE_FORM_RECOGNIZER_ENDPOINT")
        or ""
    ).strip().rstrip("/")


def _azure_key() -> str:
    return (
        os.getenv("AZURE_DI_KEY")
        or os.getenv("AZURE_DOCUMENT_INTELLIGENCE_KEY")
        or os.getenv("AZURE_FORM_RECOGNIZER_KEY")
        or ""
    ).strip()


def _nanonets_key() -> str:
    return (os.getenv("NANONETS_API_KEY") or "").strip()


def _nanonets_model() -> str:
    return (os.getenv("NANONETS_MODEL_ID") or "").strip()


def _id_analyzer_key() -> str:
    return (
        os.getenv("ID_ANALYZER_API_KEY")
        or os.getenv("IDANALYZER_API_KEY")
        or ""
    ).strip()


def is_configured() -> bool:
    return bool(
        (_azure_endpoint() and _azure_key())
        or _nanonets_key()
        or _id_analyzer_key()
        or _openai_client.is_configured()
    )


def provider_name() -> str:
    if _azure_endpoint() and _azure_key():
        return "azure_document_intelligence"
    if _nanonets_key():
        return "nanonets_ocr3"
    if _id_analyzer_key():
        return "id_analyzer"
    if _openai_client.is_configured():
        return "gpt-5.4-idp"
    return "unconfigured"


_PH_LABELS = {
    "first_name": re.compile(
        r"^(?:given\s*names?|first\s*name|mga\s*pangalan)\s*[:.\-–—]?\s*(.*)$", re.I
    ),
    "middle_name": re.compile(
        r"^(?:middle\s*name|gitnang\s*apelyido)\s*[:.\-–—]?\s*(.*)$", re.I
    ),
    "last_name": re.compile(
        r"^(?:last\s*name|surname|family\s*name|apelyido)\s*[:.\-–—]?\s*(.*)$", re.I
    ),
    "full_name": re.compile(
        r"^(?:full\s*name|name|pangalan)\s*[:.\-–—]\s*(.*)$", re.I
    ),
    "birth_date": re.compile(
        r"^(?:date\s*of\s*birth|birth\s*date|birthdate|d\.?o\.?b\.?|petsa\s*ng\s*kapanganakan|petsa\s*ng\s*pagsilang)\s*[:.\-–—]?\s*(.*)$",
        re.I,
    ),
    "expiry_date": re.compile(
        r"^(?:date\s*of\s*expir(?:y|ation)|expir(?:y|ation)\s*date|valid\s*until|valid\s*thru|validity)\s*[:.\-–—]?\s*(.*)$",
        re.I,
    ),
    "id_number": re.compile(
        r"^(?:(?:student\s*id|id\s*card|id|student|license|passport|document|pcn|crn|psn|prn|tin)\s*(?:number|no\.?|#)|pcn|crn|psn|license\s*no\.?)\s*[:.\-–—]?\s*(.*)$",
        re.I,
    ),
}

_STANDALONE_ID_PATTERNS = [
    re.compile(r"\b\d{4}-\d{4}-\d{4}-\d{4}\b"),
    re.compile(r"\b[A-Z]\d{2}-\d{2}-\d{6}\b", re.I),
    re.compile(r"\b(?:CRN[-\s]?)?\d{4}-\d{7}-\d\b", re.I),
    re.compile(r"\b[A-Z]\d{7}[A-Z]\b", re.I),
    re.compile(r"\b[A-Z]{2}\d{7}\b", re.I),
    re.compile(r"\b\d{3}-\d{3}-\d{3}(?:-\d{3,5})?\b"),
]


def _extract_labeled_fallbacks(lines: List[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "first_name": "",
        "middle_name": "",
        "last_name": "",
        "full_name": "",
        "birth_date": "",
        "expiry_date": "",
        "id_number": "",
        "alternate_ids": [],
    }
    clean_lines = [str(ln or "").strip() for ln in lines if str(ln or "").strip()]
    any_label = re.compile(
        r"^(?:given\s*names?|first\s*name|mga\s*pangalan|middle\s*name|gitnang\s*apelyido|"
        r"last\s*name|surname|family\s*name|apelyido|full\s*name|name|pangalan|"
        r"date\s*of\s*birth|birth\s*date|birthdate|d\.?o\.?b\.?|petsa\s*ng\s*kapanganakan|"
        r"date\s*of\s*expir|expir(?:y|ation)\s*date|valid\s*until|sex|gender|address|"
        r"nationality|blood\s*type|marital\s*status|date\s*of\s*issue)\b",
        re.I,
    )
    for idx, line in enumerate(clean_lines):
        for key, regex in _PH_LABELS.items():
            m = regex.match(line)
            if m:
                val = (m.group(1) or "").strip()
                if not val and idx + 1 < len(clean_lines) and not any_label.match(clean_lines[idx + 1]):
                    val = clean_lines[idx + 1].strip()
                if val and not out.get(key):
                    out[key] = val
        for pat in _STANDALONE_ID_PATTERNS:
            for found in pat.findall(line):
                code = found.strip()
                if code and code not in out["alternate_ids"]:
                    out["alternate_ids"].append(code)
    if not out["id_number"] and out["alternate_ids"]:
        out["id_number"] = out["alternate_ids"][0]
    if not out["full_name"] and (out["first_name"] or out["last_name"]):
        out["full_name"] = " ".join(
            p for p in [out["first_name"], out["middle_name"], out["last_name"]] if p
        )
    return out


def _analyze_bytes_azure(image_bytes: bytes, model="prebuilt-idDocument") -> Optional[Dict[str, Any]]:
    endpoint = _azure_endpoint()
    key = _azure_key()
    if not endpoint or not key or not image_bytes:
        return None

    b64_source = base64.b64encode(image_bytes).decode("ascii")
    api_paths = [
        (f"{endpoint}/documentintelligence/documentModels/{model}:analyze?api-version=2024-11-30", {"base64Source": b64_source}),
        (f"{endpoint}/formrecognizer/documentModels/{model}:analyze?api-version=2023-07-31", {"base64Source": b64_source}),
    ]
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/json",
    }

    with httpx.Client(timeout=25.0) as client:
        op_location = ""
        for url, payload in api_paths:
            try:
                resp = client.post(url, headers=headers, json=payload)
                print(f"azure_idp model={model} status={resp.status_code}", flush=True)
                if resp.status_code in (200, 202):
                    if resp.status_code == 200:
                        return resp.json()
                    op_location = (
                        resp.headers.get("Operation-Location")
                        or resp.headers.get("operation-location")
                        or ""
                    )
                    if op_location:
                        break
            except Exception:
                continue

        if not op_location:
            return None

        poll_headers = {"Ocp-Apim-Subscription-Key": key}
        deadline = time.time() + 24.0
        while time.time() < deadline:
            time.sleep(0.9)
            try:
                poll_resp = client.get(op_location, headers=poll_headers)
                if poll_resp.status_code != 200:
                    continue
                data = poll_resp.json()
                status = str(data.get("status") or "").lower()
                if status == "succeeded":
                    return data
                if status in ("failed", "canceled"):
                    return None
            except Exception:
                break
    return None


def _field_str_and_conf(fields: Dict[str, Any], name: str) -> Tuple[str, float]:
    f = fields.get(name)
    if not isinstance(f, dict):
        return "", 0.0
    val = (
        f.get("valueString")
        or f.get("valueDate")
        or f.get("valueCountryRegion")
        or f.get("content")
        or ""
    )
    if isinstance(val, dict):
        val = val.get("content") or ""
    conf = float(f.get("confidence") or 0.0)
    return str(val).strip(), conf


def _parse_azure_analyze_result(raw: Dict[str, Any]) -> Dict[str, Any]:
    analyze = raw.get("analyzeResult") or raw
    pages = analyze.get("pages") or []
    lines: List[str] = []
    word_confidences: List[float] = []
    for page in pages:
        for ln in page.get("lines") or []:
            txt = str(ln.get("content") or "").strip()
            if txt:
                lines.append(txt)
        for wd in page.get("words") or []:
            if "confidence" in wd:
                word_confidences.append(float(wd["confidence"]))

    docs = analyze.get("documents") or []
    fields: Dict[str, Any] = {}
    doc_type = ""
    doc_confidence = 0.0
    if docs:
        primary_doc = docs[0]
        doc_type = str(primary_doc.get("docType") or "")
        doc_confidence = float(primary_doc.get("confidence") or 0.0)
        fields = primary_doc.get("fields") or {}

    first_name, c_first = _field_str_and_conf(fields, "FirstName")
    middle_name, c_mid = _field_str_and_conf(fields, "MiddleName")
    last_name, c_last = _field_str_and_conf(fields, "LastName")
    doc_number, c_num = _field_str_and_conf(fields, "DocumentNumber")
    dob, c_dob = _field_str_and_conf(fields, "DateOfBirth")
    expiry, c_exp = _field_str_and_conf(fields, "DateOfExpiration")
    issue_date, _ = _field_str_and_conf(fields, "DateOfIssue")
    sex, _ = _field_str_and_conf(fields, "Sex")
    country, _ = _field_str_and_conf(fields, "CountryRegion")
    address, _ = _field_str_and_conf(fields, "Address")

    mrz_raw = ""
    mrz_field = fields.get("MachineReadableZone")
    if isinstance(mrz_field, dict):
        mrz_raw = str(mrz_field.get("content") or "").strip()
        mrz_obj = mrz_field.get("valueObject") or {}
        if not first_name:
            first_name, c_first = _field_str_and_conf(mrz_obj, "FirstName")
        if not last_name:
            last_name, c_last = _field_str_and_conf(mrz_obj, "LastName")
        if not doc_number:
            doc_number, c_num = _field_str_and_conf(mrz_obj, "DocumentNumber")
        if not dob:
            dob, c_dob = _field_str_and_conf(mrz_obj, "DateOfBirth")
        if not expiry:
            expiry, c_exp = _field_str_and_conf(mrz_obj, "DateOfExpiration")

    labeled = _extract_labeled_fallbacks(lines)
    if not first_name and labeled["first_name"]:
        first_name = labeled["first_name"]
    if not middle_name and labeled["middle_name"]:
        middle_name = labeled["middle_name"]
    if not last_name and labeled["last_name"]:
        last_name = labeled["last_name"]
    if not dob and labeled["birth_date"]:
        dob = labeled["birth_date"]
    if not expiry and labeled["expiry_date"]:
        expiry = labeled["expiry_date"]
    if not doc_number and labeled["id_number"]:
        doc_number = labeled["id_number"]

    full_name = " ".join(p for p in [first_name, middle_name, last_name] if p).strip()
    if not full_name and labeled["full_name"]:
        full_name = labeled["full_name"]

    alt_ids = list(labeled["alternate_ids"])
    if doc_number and doc_number not in alt_ids:
        alt_ids.insert(0, doc_number)

    avg_word_conf = (
        sum(word_confidences) / len(word_confidences) if word_confidences else 0.0
    )
    field_confidences = {
        "name": round(max(c_first, c_last, avg_word_conf), 3),
        "birth_date": round(c_dob or avg_word_conf, 3),
        "id_number": round(c_num or avg_word_conf, 3),
        "expiry_date": round(c_exp or avg_word_conf, 3),
        "document": round(doc_confidence or avg_word_conf, 3),
    }

    return {
        "doc_type": doc_type,
        "doc_confidence": round(doc_confidence or avg_word_conf, 3),
        "first_name": first_name,
        "middle_name": middle_name,
        "last_name": last_name,
        "full_name": full_name,
        "birth_date": dob,
        "expiry_date": expiry,
        "issue_date": issue_date,
        "id_number": doc_number,
        "alternate_ids": alt_ids,
        "sex": sex,
        "country": country,
        "address": address,
        "mrz_text": mrz_raw,
        "field_confidences": field_confidences,
        "lines": lines,
    }


def _analyze_bytes_nanonets(image_bytes: bytes) -> Optional[Dict[str, Any]]:
    key = _nanonets_key()
    model_id = _nanonets_model()
    if not key or not image_bytes:
        return None
    url = (
        f"https://app.nanonets.com/api/v2/OCR/Model/{model_id}/LabelFile/"
        if model_id
        else "https://app.nanonets.com/api/v2/OCR/FullText"
    )
    try:
        with httpx.Client(timeout=25.0) as client:
            resp = client.post(
                url,
                auth=(key, ""),
                files={"file": ("id.jpg", image_bytes, "image/jpeg")},
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
    except Exception:
        return None

    results = data.get("result") or []
    lines: List[str] = []
    fields_map: Dict[str, Tuple[str, float]] = {}
    for res in results:
        raw_text = str(res.get("raw_text") or "")
        if raw_text:
            lines.extend([ln.strip() for ln in raw_text.splitlines() if ln.strip()])
        for pred in res.get("prediction") or []:
            lbl = str(pred.get("label") or "").lower()
            txt = str(pred.get("ocr_text") or "").strip()
            score = float(pred.get("score") or 0.85)
            if txt:
                lines.append(txt)
                fields_map[lbl] = (txt, score)

    if not lines and not fields_map:
        return None

    labeled = _extract_labeled_fallbacks(lines)
    first_name = fields_map.get("first_name", (labeled["first_name"], 0.85))[0]
    middle_name = fields_map.get("middle_name", (labeled["middle_name"], 0.85))[0]
    last_name = fields_map.get("last_name", (labeled["last_name"], 0.85))[0]
    full_name = (
        fields_map.get("full_name", ("", 0.0))[0]
        or fields_map.get("name", ("", 0.0))[0]
        or " ".join(p for p in [first_name, middle_name, last_name] if p)
        or labeled["full_name"]
    )
    dob = (
        fields_map.get("date_of_birth", ("", 0.0))[0]
        or fields_map.get("birth_date", ("", 0.0))[0]
        or fields_map.get("dob", ("", 0.0))[0]
        or labeled["birth_date"]
    )
    expiry = (
        fields_map.get("expiry_date", ("", 0.0))[0]
        or fields_map.get("date_of_expiry", ("", 0.0))[0]
        or labeled["expiry_date"]
    )
    doc_number = (
        fields_map.get("id_number", ("", 0.0))[0]
        or fields_map.get("document_number", ("", 0.0))[0]
        or labeled["id_number"]
    )
    alt_ids = list(labeled["alternate_ids"])
    if doc_number and doc_number not in alt_ids:
        alt_ids.insert(0, doc_number)

    return {
        "doc_type": "idDocument.nanonets",
        "doc_confidence": 0.88 if lines else 0.0,
        "first_name": first_name,
        "middle_name": middle_name,
        "last_name": last_name,
        "full_name": full_name,
        "birth_date": dob,
        "expiry_date": expiry,
        "issue_date": "",
        "id_number": doc_number,
        "alternate_ids": alt_ids,
        "sex": "",
        "country": "PHL",
        "address": "",
        "mrz_text": "",
        "field_confidences": {
            "name": 0.88 if full_name else 0.0,
            "birth_date": 0.88 if dob else 0.0,
            "id_number": 0.88 if doc_number else 0.0,
            "expiry_date": 0.88 if expiry else 0.0,
            "document": 0.88 if lines else 0.0,
        },
        "lines": lines,
    }


def _analyze_bytes_id_analyzer(
    front_bytes: bytes, back_bytes: Optional[bytes] = None
) -> Optional[Dict[str, Any]]:
    key = _id_analyzer_key()
    if not key or not front_bytes:
        return None
    b64_front = base64.b64encode(front_bytes).decode("ascii")
    payload: Dict[str, Any] = {
        "document": b64_front,
        "profile": "security_medium",
    }
    if back_bytes:
        payload["documentback"] = base64.b64encode(back_bytes).decode("ascii")

    try:
        with httpx.Client(timeout=25.0) as client:
            resp = client.post(
                "https://api2.idanalyzer.com/scan",
                headers={"X-API-KEY": key, "Content-Type": "application/json"},
                json=payload,
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
    except Exception:
        return None

    result = data.get("data") or data.get("result") or {}
    if not isinstance(result, dict) or not result:
        return None

    def _val(field_key: str) -> str:
        item = result.get(field_key)
        if isinstance(item, list) and item:
            item = item[0]
        if isinstance(item, dict):
            return str(item.get("value") or "").strip()
        return str(item or "").strip()

    first_name = _val("firstName")
    middle_name = _val("middleName")
    last_name = _val("lastName")
    full_name = _val("fullName") or " ".join(p for p in [first_name, middle_name, last_name] if p)
    dob = _val("dob")
    expiry = _val("expiry")
    doc_number = _val("documentNumber") or _val("personalNumber")
    doc_type = _val("documentName") or _val("documentType") or "idDocument.idAnalyzer"
    lines = [x for x in [doc_type, full_name, dob, doc_number, expiry] if x]

    return {
        "doc_type": doc_type,
        "doc_confidence": 0.90 if (full_name or doc_number) else 0.0,
        "first_name": first_name,
        "middle_name": middle_name,
        "last_name": last_name,
        "full_name": full_name,
        "birth_date": dob,
        "expiry_date": expiry,
        "issue_date": _val("issued"),
        "id_number": doc_number,
        "alternate_ids": [doc_number] if doc_number else [],
        "sex": _val("sex"),
        "country": _val("nationality") or "PHL",
        "address": _val("address1"),
        "mrz_text": _val("mrz"),
        "field_confidences": {
            "name": 0.90 if full_name else 0.0,
            "birth_date": 0.90 if dob else 0.0,
            "id_number": 0.90 if doc_number else 0.0,
            "expiry_date": 0.90 if expiry else 0.0,
            "document": 0.90 if (full_name or doc_number) else 0.0,
        },
        "lines": lines,
    }


_GPT_IDP_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "is_valid_government_id": {"type": "BOOLEAN"},
        "detected_document_type": {"type": "STRING"},
        "first_name": {"type": "STRING"},
        "middle_name": {"type": "STRING"},
        "last_name": {"type": "STRING"},
        "full_name": {"type": "STRING"},
        "birth_date": {"type": "STRING"},
        "expiry_date": {"type": "STRING"},
        "id_number": {"type": "STRING"},
        "alternate_ids": {"type": "ARRAY", "items": {"type": "STRING"}},
        "mrz_text": {"type": "STRING"},
        "doc_confidence": {"type": "NUMBER"},
        "front_readable": {"type": "BOOLEAN"},
        "back_readable": {"type": "BOOLEAN"},
        "authenticity_flags": {"type": "ARRAY", "items": {"type": "STRING"}},
        "lines": {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": [
        "is_valid_government_id",
        "detected_document_type",
        "first_name",
        "middle_name",
        "last_name",
        "full_name",
        "birth_date",
        "expiry_date",
        "id_number",
        "alternate_ids",
        "mrz_text",
        "doc_confidence",
        "front_readable",
        "back_readable",
        "authenticity_flags",
        "lines",
    ],
}


def _detect_mime(image_bytes: bytes) -> str:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image_bytes.startswith(b"RIFF") and b"WEBP" in image_bytes[:16]:
        return "image/webp"
    return "image/jpeg"


def _analyze_bytes_gpt_idp(
    front_bytes: bytes, back_bytes: Optional[bytes] = None, declared_id_type: str = ""
) -> Optional[Dict[str, Any]]:
    if not _openai_client.is_configured() or not front_bytes:
        return None
    parts = [
        {
            "text": (
                f"Declared ID Type: {declared_id_type or 'Government ID'}. "
                "Extract structured IDP fields from the uploaded ID image(s). "
                "Normalize birth_date and expiry_date to YYYY-MM-DD when visible. "
                "Include all visible printed lines in `lines`, and flag any screen recapture, tampering, or severe blur in `authenticity_flags`."
            )
        },
        {
            "inline_data": {
                "mime_type": _detect_mime(front_bytes),
                "data": base64.b64encode(front_bytes).decode("ascii"),
            }
        },
    ]
    if back_bytes:
        parts.append(
            {
                "inline_data": {
                    "mime_type": _detect_mime(back_bytes),
                    "data": base64.b64encode(back_bytes).decode("ascii"),
                }
            }
        )

    raw = _openai_client.complete(
        parts=parts,
        expect_json=True,
        max_tokens=700,
        response_schema=_GPT_IDP_SCHEMA,
        system_instruction="You are an Intelligent Document Processing (IDP) extraction engine for Philippine IDs. Return only strict JSON.",
        effort_override="low",
    )
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        conf = float(parsed.get("doc_confidence") or 0.85)
        return {
            "doc_type": str(parsed.get("detected_document_type") or ""),
            "doc_confidence": conf,
            "is_valid_government_id": bool(parsed.get("is_valid_government_id", True)),
            "first_name": str(parsed.get("first_name") or "").strip(),
            "middle_name": str(parsed.get("middle_name") or "").strip(),
            "last_name": str(parsed.get("last_name") or "").strip(),
            "full_name": str(parsed.get("full_name") or "").strip(),
            "birth_date": str(parsed.get("birth_date") or "").strip(),
            "expiry_date": str(parsed.get("expiry_date") or "").strip(),
            "issue_date": "",
            "id_number": str(parsed.get("id_number") or "").strip(),
            "alternate_ids": [str(x).strip() for x in (parsed.get("alternate_ids") or []) if str(x).strip()],
            "mrz_text": str(parsed.get("mrz_text") or "").strip(),
            "front_readable": bool(parsed.get("front_readable", True)),
            "back_readable": bool(parsed.get("back_readable", True)),
            "authenticity_flags": [str(x).strip() for x in (parsed.get("authenticity_flags") or []) if str(x).strip()],
            "field_confidences": {
                "name": conf if parsed.get("full_name") else 0.0,
                "birth_date": conf if parsed.get("birth_date") else 0.0,
                "id_number": conf if parsed.get("id_number") else 0.0,
                "expiry_date": conf if parsed.get("expiry_date") else 0.0,
                "document": conf,
            },
            "lines": [str(x).strip() for x in (parsed.get("lines") or []) if str(x).strip()],
        }
    except Exception:
        return None


def extract_id_document(
    front_bytes: bytes, back_bytes: Optional[bytes] = None, declared_id_type: str = ""
) -> Dict[str, Any]:
    """Run Step 2 IDP Extraction on Front (and optional Back) ID image bytes."""
    if not is_configured() or not front_bytes:
        return {
            "available": False,
            "provider": provider_name(),
            "is_valid_government_id": False,
            "id_type_matches_declared": True,
            "detected_document_type": "",
            "extracted_name": "",
            "extracted_first_name": "",
            "extracted_middle_name": "",
            "extracted_last_name": "",
            "extracted_birth_date": "",
            "extracted_expiry_date": "",
            "extracted_id_number": "",
            "alternate_id_numbers": [],
            "unreadable_or_occluded_fields": ["name", "birth_date", "id_number"],
            "confidence": "low",
            "field_confidences": {},
            "authenticity_flags": ["IDP service is not configured."],
            "lines": [],
            "front_readable": False,
            "back_readable": True,
        }

    front_parsed: Optional[Dict[str, Any]] = None
    back_parsed: Optional[Dict[str, Any]] = None
    used_provider = provider_name()

    if _azure_endpoint() and _azure_key():
        def read_azure_side(image, model):
            raw = _analyze_bytes_azure(image, model)
            if raw:
                parsed = _parse_azure_analyze_result(raw)
                if parsed.get("lines") or parsed.get("id_number") or parsed.get("full_name"):
                    return parsed
            if model != "prebuilt-read":
                return read_azure_side(image, "prebuilt-read")
            return None

        with ThreadPoolExecutor(max_workers=2) as executor:
            front = executor.submit(read_azure_side, front_bytes, "prebuilt-idDocument")
            back = executor.submit(read_azure_side, back_bytes, "prebuilt-read") if back_bytes else None
            front_parsed = front.result()
            back_parsed = back.result() if back else None

    if not front_parsed and _nanonets_key():
        front_parsed = _analyze_bytes_nanonets(front_bytes)
        if front_parsed:
            used_provider = "nanonets_ocr3"
            if back_bytes:
                back_parsed = _analyze_bytes_nanonets(back_bytes)

    if not front_parsed and _id_analyzer_key():
        front_parsed = _analyze_bytes_id_analyzer(front_bytes, back_bytes)
        if front_parsed:
            used_provider = "id_analyzer"

    if not front_parsed and not (_azure_endpoint() and _azure_key()) and _openai_client.is_configured():
        front_parsed = _analyze_bytes_gpt_idp(front_bytes, back_bytes, declared_id_type)
        if front_parsed:
            used_provider = "gpt-5.4-idp"

    if not front_parsed or (back_bytes and not back_parsed and used_provider != "id_analyzer"):
        return {
            "available": False,
            "provider": used_provider,
            "is_valid_government_id": False,
            "id_type_matches_declared": True,
            "detected_document_type": "",
            "extracted_name": "",
            "extracted_first_name": "",
            "extracted_middle_name": "",
            "extracted_last_name": "",
            "extracted_birth_date": "",
            "extracted_expiry_date": "",
            "extracted_id_number": "",
            "alternate_id_numbers": [],
            "unreadable_or_occluded_fields": ["name", "birth_date", "id_number"],
            "confidence": "low",
            "field_confidences": {},
            "authenticity_flags": ["IDP request failed or timed out."],
            "lines": [],
            "front_readable": False,
            "back_readable": False if back_bytes else True,
        }

    primary = front_parsed or back_parsed or {}
    secondary = back_parsed if front_parsed and back_parsed else {}

    combined_lines = list(primary.get("lines") or []) + [
        ln for ln in (secondary.get("lines") or []) if ln not in (primary.get("lines") or [])
    ]
    combined_labeled = _extract_labeled_fallbacks(combined_lines)

    first_name = primary.get("first_name") or secondary.get("first_name") or combined_labeled["first_name"]
    middle_name = primary.get("middle_name") or secondary.get("middle_name") or combined_labeled["middle_name"]
    last_name = primary.get("last_name") or secondary.get("last_name") or combined_labeled["last_name"]
    full_name = (
        primary.get("full_name")
        or secondary.get("full_name")
        or " ".join(p for p in [first_name, middle_name, last_name] if p)
        or combined_labeled["full_name"]
    )
    birth_date = primary.get("birth_date") or secondary.get("birth_date") or combined_labeled["birth_date"]
    expiry_date = primary.get("expiry_date") or secondary.get("expiry_date") or combined_labeled["expiry_date"]
    id_number = primary.get("id_number") or secondary.get("id_number") or combined_labeled["id_number"]
    mrz_text = primary.get("mrz_text") or secondary.get("mrz_text") or ""

    alt_ids: List[str] = []
    for candidate in (
        list(primary.get("alternate_ids") or [])
        + list(secondary.get("alternate_ids") or [])
        + list(combined_labeled["alternate_ids"])
    ):
        if candidate and candidate not in alt_ids:
            alt_ids.append(candidate)

    f_conf = dict(primary.get("field_confidences") or {})
    s_conf = dict(secondary.get("field_confidences") or {})
    merged_conf = {
        k: max(float(f_conf.get(k, 0.0)), float(s_conf.get(k, 0.0)))
        for k in ("name", "birth_date", "id_number", "expiry_date", "document")
    }

    unreadable: List[str] = []
    if not full_name or merged_conf.get("name", 0.0) < 0.45:
        unreadable.append("name")
    if not birth_date or merged_conf.get("birth_date", 0.0) < 0.45:
        unreadable.append("birth_date")
    if not id_number or merged_conf.get("id_number", 0.0) < 0.45:
        unreadable.append("id_number")

    authenticity_flags: List[str] = list(primary.get("authenticity_flags") or [])
    doc_conf = merged_conf.get("document", 0.0)
    if len(combined_lines) < 2 and not full_name and not id_number:
        authenticity_flags.append("No readable identification text or document structure detected.")
    elif doc_conf > 0 and doc_conf < 0.55:
        authenticity_flags.append(
            f"Low IDP document confidence ({int(doc_conf * 100)}%) — check for image tampering, glare, or screen recapture."
        )
    low_conf_fields = [
        label
        for key, label in (("name", "Name"), ("birth_date", "Birth Date"), ("id_number", "ID Number"))
        if 0.0 < merged_conf.get(key, 0.0) < 0.60
    ]
    if low_conf_fields:
        authenticity_flags.append(
            f"Low extraction confidence on {', '.join(low_conf_fields)} — verify printed characters visually."
        )

    is_gov_id = bool(
        primary.get("is_valid_government_id", True)
        and (len(combined_lines) >= 1 or full_name or id_number or birth_date)
    )
    conf_label = "high" if doc_conf >= 0.80 else ("medium" if doc_conf >= 0.55 else "low")

    return {
        "available": True,
        "provider": used_provider,
        "azure_doc_type": primary.get("doc_type") or secondary.get("doc_type") or "",
        "is_valid_government_id": is_gov_id,
        "id_type_matches_declared": True,
        "detected_document_type": primary.get("doc_type") if not str(primary.get("doc_type") or "").startswith("idDocument.") else "",
        "extracted_name": full_name,
        "extracted_first_name": first_name,
        "extracted_middle_name": middle_name,
        "extracted_last_name": last_name,
        "extracted_birth_date": birth_date,
        "extracted_expiry_date": expiry_date,
        "extracted_id_number": id_number,
        "alternate_id_numbers": alt_ids,
        "mrz_text": mrz_text,
        "unreadable_or_occluded_fields": unreadable,
        "confidence": conf_label,
        "field_confidences": merged_conf,
        "authenticity_flags": authenticity_flags,
        "lines": combined_lines,
        "front_readable": bool(primary.get("front_readable", len(primary.get("lines") or []) >= 1 or bool(full_name or id_number))),
        "back_readable": True if not back_bytes else bool(secondary.get("back_readable", True) if secondary else primary.get("back_readable", True)),
    }
