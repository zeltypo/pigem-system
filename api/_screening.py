import base64

from datetime import datetime, timezone

import hashlib

import json

import os

from typing import Any, Dict, List, Optional, Tuple

import urllib.parse

import urllib.request

import _gemini

import _quality

def _supabase_url() -> str:

    return (

        os.getenv("SUPABASE_URL")

        or os.getenv("NEXT_PUBLIC_SUPABASE_URL")

        or "https://wuunqfxyejxwrawtjdrf.supabase.co"

    ).strip().rstrip("/")

def _supabase_key() -> str:

    return (

        os.getenv("SUPABASE_SERVICE_ROLE_KEY")

        or os.getenv("SUPABASE_ANON_KEY")

        or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")

        or ""

    ).strip()

def _headers(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:

    key = _supabase_key()

    base = {

        "apikey": key,

        "Authorization": f"Bearer {key}",

        "Content-Type": "application/json",

    }

    if extra:

        base.update(extra)

    return base

def _fetch_application(application_id: str) -> Optional[Dict[str, Any]]:

    base_url = _supabase_url()

    key = _supabase_key()

    if not base_url or not key:

        return None

    col = "id" if "-" in application_id and len(application_id) >= 32 else "ref_no"

    query = urllib.parse.urlencode({col: f"eq.{application_id}", "select": "*", "limit": "1"})

    url = f"{base_url}/rest/v1/applications?{query}"

    req = urllib.request.Request(url, headers=_headers(), method="GET")

    try:

        with urllib.request.urlopen(req, timeout=10) as resp:

            rows = json.loads(resp.read().decode("utf-8"))

            if isinstance(rows, list) and rows:

                return rows[0]

    except Exception:

        return None

    return None

def _fetch_recent_applications_for_duplicate_check(exclude_app_id: str) -> List[Dict[str, Any]]:

    base_url = _supabase_url()

    key = _supabase_key()

    if not base_url or not key:

        return []

    query = urllib.parse.urlencode({

        "select": "id,ref_no,email,id_type,id_number,screening",

        "order": "created_at.desc",

        "limit": "100",

    })

    url = f"{base_url}/rest/v1/applications?{query}"

    req = urllib.request.Request(url, headers=_headers(), method="GET")

    try:

        with urllib.request.urlopen(req, timeout=8) as resp:

            rows = json.loads(resp.read().decode("utf-8"))

            if isinstance(rows, list):

                return [r for r in rows if str(r.get("id") or "") != str(exclude_app_id)]

    except Exception:

        return []

    return []

def _patch_application(app_uuid: str, fields: Dict[str, Any]) -> bool:

    base_url = _supabase_url()

    key = _supabase_key()

    if not base_url or not key:

        return False

    query = urllib.parse.urlencode({"id": f"eq.{app_uuid}"})

    url = f"{base_url}/rest/v1/applications?{query}"

    body = json.dumps(fields).encode("utf-8")

    req = urllib.request.Request(

        url,

        data=body,

        headers=_headers({"Prefer": "return=minimal"}),

        method="PATCH",

    )

    try:

        with urllib.request.urlopen(req, timeout=10) as resp:

            return 200 <= resp.status < 300

    except Exception:

        return False

def _insert_table_row(table: str, row_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:

    base_url = _supabase_url()

    key = _supabase_key()

    if not base_url or not key:

        return None

    url = f"{base_url}/rest/v1/{table}"

    body = json.dumps(row_data).encode("utf-8")

    req = urllib.request.Request(

        url,

        data=body,

        headers=_headers({"Prefer": "return=representation"}),

        method="POST",

    )

    try:

        with urllib.request.urlopen(req, timeout=10) as resp:

            rows = json.loads(resp.read().decode("utf-8"))

            if isinstance(rows, list) and rows:

                return rows[0]

    except Exception:

        return None

    return None

def _download_image_bytes(url_or_data: str) -> Optional[bytes]:

    raw = (url_or_data or "").strip()

    if not raw:

        return None

    if raw.startswith("data:") and ";base64," in raw:

        try:

            b64_part = raw.split(";base64,", 1)[1]

            return base64.b64decode(b64_part)

        except Exception:

            return None

    if raw.startswith("http://") or raw.startswith("https://"):

        try:

            req = urllib.request.Request(raw, headers={"User-Agent": "PIGEM-Cloud-Screening/1.0"})

            with urllib.request.urlopen(req, timeout=12) as resp:

                return resp.read()

        except Exception:

            return None

    return None

def _upload_cropped_image(app_ref: str, side: str, jpeg_bytes: bytes) -> Optional[str]:

    base_url = _supabase_url()

    key = _supabase_key()

    if not base_url or not key or not jpeg_bytes:

        return None

    safe_ref = "".join(ch for ch in (app_ref or "APP") if ch.isalnum() or ch in ("-", "_"))

    stamp = int(datetime.now(timezone.utc).timestamp() * 1000)

    object_path = f"applications/cropped/{safe_ref}_{side}_{stamp}.jpg"

    upload_url = f"{base_url}/storage/v1/object/documents/{object_path}"

    headers = {

        "apikey": key,

        "Authorization": f"Bearer {key}",

        "Content-Type": "image/jpeg",

        "x-upsert": "true",

    }

    req = urllib.request.Request(upload_url, data=jpeg_bytes, headers=headers, method="POST")

    try:

        with urllib.request.urlopen(req, timeout=12) as resp:

            if 200 <= resp.status < 300:

                return f"{base_url}/storage/v1/object/public/documents/{object_path}"

    except Exception:

        pass

    return None

def _compute_sha256(image_bytes: Optional[bytes]) -> str:

    if not image_bytes:

        return ""

    return hashlib.sha256(image_bytes).hexdigest()

def _check_duplicate_images(

    app_row: Dict[str, Any],

    front_sha256: str,

    back_sha256: str,

) -> Dict[str, Any]:

    issues: List[str] = []

    front_equals_back = False

    same_as_previous_upload = False

    matched_other_refs: List[str] = []

    if front_sha256 and back_sha256 and front_sha256 == back_sha256:

        front_equals_back = True

        issues.append(

            "Duplicate ID Image: The uploaded Front ID and Back ID photos are the exact same image file. Please upload the actual Back side of the Valid ID."

        )

    prev_screening = app_row.get("screening")

    if isinstance(prev_screening, dict):

        prev_front_hash = str(prev_screening.get("front_sha256") or "")

        prev_back_hash = str(prev_screening.get("back_sha256") or "")

        prev_failed = not bool(prev_screening.get("overall_match", True))

        if prev_failed and prev_front_hash and front_sha256 == prev_front_hash:

            if not back_sha256 or (prev_back_hash and back_sha256 == prev_back_hash):

                same_as_previous_upload = True

                issues.append(

                    "Unchanged Re-Uploaded Image: The ID photo is identical to the previously flagged upload. Please capture a new, clearer photo."

                )

    app_uuid = str(app_row.get("id") or "")

    entered_id_num = "".join(ch for ch in str(app_row.get("id_number") or "").upper() if ch.isalnum())

    recent_apps = _fetch_recent_applications_for_duplicate_check(app_uuid)

    for other in recent_apps:

        other_ref = str(other.get("ref_no") or "")

        other_scr = other.get("screening") if isinstance(other.get("screening"), dict) else {}

        other_f_hash = str(other_scr.get("front_sha256") or "")

        other_b_hash = str(other_scr.get("back_sha256") or "")

        if front_sha256 and (front_sha256 in (other_f_hash, other_b_hash)):

            if other_ref and other_ref not in matched_other_refs:

                matched_other_refs.append(other_ref)

        elif back_sha256 and (back_sha256 in (other_f_hash, other_b_hash)):

            if other_ref and other_ref not in matched_other_refs:

                matched_other_refs.append(other_ref)

    if matched_other_refs:

        refs_str = ", ".join(matched_other_refs[:3])

        issues.append(

            f"Duplicate ID Image Across Applications: This exact ID photo was already used in application {refs_str}."

        )

    return {

        "has_duplicate": bool(issues),

        "front_equals_back": front_equals_back,

        "same_as_previous_upload": same_as_previous_upload,

        "matched_other_refs": matched_other_refs,

        "front_sha256": front_sha256,

        "back_sha256": back_sha256,

        "issues": issues,

    }

def _evaluate_front_and_back_quality(

    front_bytes: bytes, back_bytes: Optional[bytes]

) -> Tuple[Dict[str, Any], Optional[bytes], Optional[bytes]]:

    front_quality, cropped_front = _quality.enhance_and_crop(front_bytes)

    cropped_back = None

    back_quality = None

    if back_bytes:

        back_quality, cropped_back = _quality.enhance_and_crop(back_bytes)

    combined = dict(front_quality)

    front_ok = bool(front_quality.get("readable", False))

    combined["front_passed"] = front_ok

    combined["passed"] = front_ok

    combined["front_summary"] = front_quality.get("summary", "")

    if back_quality:

        back_ok = bool(back_quality.get("readable", False))

        combined["back_passed"] = back_ok

        combined["back_summary"] = back_quality.get("summary", "")

        combined["back_metrics"] = back_quality.get("metrics", {})

        if not back_ok:

            combined["passed"] = False

            combined["readable"] = False

            back_issues = [f"Back ID: {msg}" for msg in (back_quality.get("issues") or [])]

            combined["issues"] = list(combined.get("issues") or []) + back_issues

            combined["summary"] = (

                f"Front ID: {front_quality.get('summary', 'Checked')}. "

                f"Back ID: {back_quality.get('summary', 'Needs review')}."

            )

    else:

        combined["back_passed"] = False

        combined["back_summary"] = "Back ID photo not uploaded yet."

    return combined, cropped_front, cropped_back

def run_application_screening(application_id: str) -> Dict[str, Any]:

    app_row = _fetch_application(application_id)

    if not app_row:

        return {

            "screened": False,

            "error": f"Application '{application_id}' was not found in Supabase.",

        }

    app_uuid = str(app_row.get("id") or "")

    app_ref = str(app_row.get("ref_no") or application_id)

    front_url = str(app_row.get("id_image_url") or app_row.get("id_image_data") or "").strip()

    back_url = str(app_row.get("id_back_image_url") or app_row.get("id_back_image_data") or "").strip()

    front_raw_bytes = _download_image_bytes(front_url)

    back_raw_bytes = _download_image_bytes(back_url) if back_url else None

    if not front_raw_bytes:

        return {

            "screened": False,

            "application_id": app_uuid,

            "ref_no": app_ref,

            "error": "Front Valid ID image could not be downloaded for screening.",

        }

    front_sha256 = _compute_sha256(front_raw_bytes)

    back_sha256 = _compute_sha256(back_raw_bytes)

    duplicate_check = _check_duplicate_images(app_row, front_sha256, back_sha256)

    quality_result, cropped_front_bytes, cropped_back_bytes = _evaluate_front_and_back_quality(

        front_raw_bytes, back_raw_bytes

    )

    if duplicate_check.get("has_duplicate"):

        quality_result["passed"] = False

        dup_issues = duplicate_check.get("issues") or []

        quality_result["issues"] = dup_issues + list(quality_result.get("issues") or [])

        quality_result["summary"] = dup_issues[0]

    cropped_front_url = ""

    if cropped_front_bytes:

        cropped_front_url = _upload_cropped_image(app_ref, "front", cropped_front_bytes) or ""

    cropped_back_url = ""

    if cropped_back_bytes:

        cropped_back_url = _upload_cropped_image(app_ref, "back", cropped_back_bytes) or ""

    ocr_front_input = cropped_front_bytes if cropped_front_bytes else front_raw_bytes

    ocr_back_input = (

        cropped_back_bytes

        if cropped_back_bytes

        else (back_raw_bytes if back_raw_bytes else None)

    )

    id_type = str(app_row.get("id_type") or "")

    ocr_result = _gemini.extract_id_text_with_fallback(
        ocr_front_input,
        primary_back=ocr_back_input,
        raw_front=front_raw_bytes,
        raw_back=back_raw_bytes,
        id_type=id_type,
    )

    entered_fields = {

        "full_name": app_row.get("customer_name") or app_row.get("full_name") or "",

        "first_name": app_row.get("first_name") or "",

        "middle_name": app_row.get("middle_name") or "",

        "last_name": app_row.get("last_name") or "",

        "birth_date": app_row.get("birth_date") or "",

        "id_type": id_type,

        "id_number": app_row.get("id_number") or "",

    }

    comparisons = _gemini.compare_fields(entered_fields, ocr_result)

    guidance = _gemini.write_guidance(quality_result, comparisons)

    is_valid_gov_id = ocr_result.get("is_valid_government_id") is not False

    front_readable = bool(quality_result.get("readable", False))

    back_readable = bool(quality_result.get("back_passed", True)) if back_raw_bytes else False

    quality_ok = bool(front_readable and back_readable and bool(back_raw_bytes) and not bool(duplicate_check.get("has_duplicate")) and is_valid_gov_id)

    fields_ok = bool(comparisons) and all(c.get("status") == "match" for c in comparisons)

    overall_match = bool(quality_ok and fields_ok)

    now_iso = datetime.now(timezone.utc).isoformat()

    findings_list = [str(x).strip() for x in (guidance.get("findings") or []) if str(x).strip()]

    guidance_tips = [str(x).strip() for x in (guidance.get("guidance") or []) if str(x).strip()]

    notes_list = list(findings_list)

    for tip in guidance_tips:

        if tip not in notes_list:

            notes_list.append(tip)

    for dup_msg in (duplicate_check.get("issues") or []):

        if dup_msg not in notes_list:

            notes_list.insert(0, dup_msg)

    if not back_raw_bytes:

        notes_list.append("Back of Valid ID has not been uploaded yet.")

    summary_text = (

        duplicate_check["issues"][0]

        if duplicate_check.get("has_duplicate") and duplicate_check.get("issues")

        else (findings_list[0] if findings_list else str(quality_result.get("summary") or "Document checked."))

    )

    screening_payload = {

        "preliminary": True,

        "overall_match": overall_match,

        "quality_passed": quality_ok,

        "fields_matched": fields_ok,

        "summary": summary_text,

        "notes": notes_list,

        "Suggested_remark": summary_text,

        "quality": quality_result,

        "ocr": ocr_result,

        "comparisons": comparisons,

        "duplicate_check": duplicate_check,

        "front_sha256": front_sha256,

        "back_sha256": back_sha256,

        "cropped_front_url": cropped_front_url,

        "cropped_back_url": cropped_back_url,

        "screened_at": now_iso,

    }

    update_fields: Dict[str, Any] = {

        "screening": screening_payload,

        "updated_at": now_iso,

    }

    if cropped_front_url:

        update_fields["id_cropped_url"] = cropped_front_url

    if cropped_back_url:

        update_fields["id_back_cropped_url"] = cropped_back_url

    _patch_application(app_uuid, update_fields)

    doc_row = _insert_table_row(

        "documents",

        {

            "application_id": app_uuid,

            "id_type": id_type,

            "id_number": str(app_row.get("id_number") or ""),

            "front_image_url": front_url,

            "back_image_url": back_url,

            "cropped_front_url": cropped_front_url,

            "cropped_back_url": cropped_back_url,

        },

    )

    doc_id = doc_row.get("id") if isinstance(doc_row, dict) else None

    _insert_table_row(

        "screenings",

        {

            "application_id": app_uuid,

            "document_id": doc_id,

            "quality_passed": quality_ok,

            "overall_match": overall_match,

            "blur_score": float((quality_result.get("metrics") or {}).get("blur_score") or 0),

            "brightness": float((quality_result.get("metrics") or {}).get("brightness") or 0),

            "glare_pct": float((quality_result.get("metrics") or {}).get("glare_pct") or 0),

            "extracted_fields": ocr_result,

            "field_comparisons": comparisons,

            "notes": notes_list,

            "summary": summary_text,

        },

    )

    return {

        "screened": True,

        "preliminary": True,

        "application_id": app_uuid,

        "ref_no": app_ref,

        "overall_match": overall_match,

        "screening": screening_payload,

    }
