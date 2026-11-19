"""Stage 1 Image Quality Assessment Gate (`gpt-6.2-sol`) + OpenCV sanity metrics.

Inspects raw ID images BEFORE OpenCV or Azure IDP runs.
- `GOOD`: Bypass OpenCV completely; keep original ID bytes untouched.
- `FIXABLE`: Run OpenCV using ONLY the targeted mathematical operations needed.
- `UNFIXABLE`: Stop early (`NEEDS_CORRECTION`) without wasting OpenCV or Azure IDP calls.

Note: AI never alters, generates, or modifies image pixels. Only OpenCV performs image enhancement.
"""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

import _openai_client
import _preprocess

ALLOWED_OPS = {
    "rotate_90_cw",
    "rotate_90_ccw",
    "rotate_180",
    "deskew_crop",
    "clahe",
    "brighten",
    "deglare",
    "denoise",
    "sharpen",
}

_QUALITY_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "verdict": {
            "type": "STRING",
            "enum": ["good", "fixable", "unfixable"],
        },
        "quality_score": {"type": "INTEGER"},
        "is_id_document": {"type": "BOOLEAN"},
        "side_matches_expected": {"type": "BOOLEAN"},
        "rotation_degrees": {
            "type": "INTEGER",
            "enum": [0, 90, 180, 270],
        },
        "issues": {
            "type": "ARRAY",
            "items": {
                "type": "STRING",
                "enum": [
                    "severe_blur",
                    "mild_blur",
                    "severe_glare_over_text",
                    "mild_glare",
                    "cut_off_text_or_corners",
                    "occluded_by_finger_or_object",
                    "too_dark",
                    "low_contrast",
                    "tilted_or_wide_background",
                    "rotated_orientation",
                    "not_an_id_card",
                    "wrong_side_uploaded",
                    "tiny_or_unreadable_resolution",
                ],
            },
        },
        "targeted_opencv_ops": {
            "type": "ARRAY",
            "items": {
                "type": "STRING",
                "enum": [
                    "rotate_90_cw",
                    "rotate_90_ccw",
                    "rotate_180",
                    "deskew_crop",
                    "clahe",
                    "brighten",
                    "deglare",
                    "denoise",
                    "sharpen",
                ],
            },
        },
        "customer_issue_summary": {"type": "STRING"},
    },
}

_QUALITY_SYSTEM_PROMPT = (
    "You are the Stage 1 Image Quality Assessment Gate for PIGEM Fiber Internet ID verification. "
    "Inspect ONLY the visual and photographic quality of the uploaded identification card image before OCR runs. "
    "Do NOT transcribe or repeat personal names, ID numbers, or birth dates. "
    "Classify into one of three verdicts:\n"
    "1. 'good': The ID card is upright (rotation 0), well-framed, well-lit, sharp, and all printed text regions "
    "(Name, Birth Date, ID Number) are clearly legible as-is. `targeted_opencv_ops` MUST be empty `[]` so OpenCV is bypassed.\n"
    "2. 'fixable': All key printed fields are present and not cut off, but the photo has recoverable defects such as "
    "90/180/270 degree rotation, tilted card with wide table background needing `deskew_crop`, dim lighting (`brighten`), "
    "flat contrast (`clahe`), mild glare not erasing text (`deglare`), sensor noise (`denoise`), or slight softness (`sharpen`). "
    "List ONLY the specific `targeted_opencv_ops` required.\n"
    "3. 'unfixable': Key printed text (Name, Birth Date, or ID Number) is blurred beyond human legibility (`severe_blur`), "
    "washed out by a flash hotspot directly over key text (`severe_glare_over_text`), covered by a finger/object, "
    "cut off at the edges, or the image is not an ID card (`is_id_document=false`). Set `quality_score` < 20 when severely unusable. "
    "Provide a clear, polite 1-sentence `customer_issue_summary` when verdict is 'unfixable' or 'fixable' (empty string if 'good')."
)


def _detect_mime(image_bytes: bytes) -> str:
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image_bytes.startswith(b"RIFF") and b"WEBP" in image_bytes[:16]:
        return "image/webp"
    return "image/jpeg"


def _compute_cv_metrics(image_bytes: bytes) -> Dict[str, Any]:
    """Deterministic OpenCV signal check (resolution, Laplacian sharpness, brightness, glare ratio, card boundary)."""
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return {
            "valid": False,
            "width": 0,
            "height": 0,
            "blur_score": 0.0,
            "brightness": 0.0,
            "glare_pct": 0.0,
            "has_crop_background": False,
            "card_area_ratio": 1.0,
        }
    h, w = img.shape[:2]
    scale = min(1.0, 640.0 / max(w, h, 1))
    sample = cv2.resize(img, (max(16, int(w * scale)), max(16, int(h * scale))), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(sample, cv2.COLOR_BGR2GRAY)
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    sh, sw = gray.shape[:2]
    center = gray[int(sh * 0.25) : int(sh * 0.75), int(sw * 0.25) : int(sw * 0.75)]
    center_lap = float(cv2.Laplacian(center, cv2.CV_64F).var()) if center.size else lap_var
    mean_b = float(np.mean(gray))
    glare_pct = float(np.sum(gray > 246) * 100.0 / max(1, gray.size))

    quad = _preprocess.detect_card_quad(sample)
    has_points = bool(quad and quad.get("points") is not None)
    card_ratio = float(quad["area_ratio"]) if has_points else 1.0
    has_bg = bool(has_points and 0.07 <= card_ratio <= 0.88)
    four_edges_ok = bool(quad.get("four_edges_verified")) if quad else False
    clipped_edges = list(quad.get("clipped_edges") or []) if quad else []
    is_portrait = bool(h > w * 1.18)

    return {
        "valid": True,
        "width": int(w),
        "height": int(h),
        "blur_score": round(max(lap_var, center_lap), 1),
        "brightness": round(mean_b, 1),
        "glare_pct": round(glare_pct, 2),
        "has_crop_background": has_bg,
        "card_area_ratio": round(card_ratio, 3),
        "four_edges_verified": four_edges_ok,
        "clipped_edges": clipped_edges,
        "is_portrait": is_portrait,
    }


def _strip_exif_reencode(image_bytes: bytes) -> bytes:
    """Strip EXIF/GPS metadata before sending raw image to the vision quality gate while keeping pixels intact."""
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return image_bytes
    h, w = img.shape[:2]
    if max(h, w) > 1600:
        scale = 1600.0 / max(h, w)
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return enc.tobytes() if ok else image_bytes


def assess_single_side(
    image_bytes: bytes,
    side_label: str = "FRONT",
    declared_id_type: str = "",
    previous_response_id: str = "",
) -> Dict[str, Any]:
    """Assess a single ID side using `gpt-6.2-sol` + OpenCV physical metrics."""
    metrics = _compute_cv_metrics(image_bytes)
    if not metrics.get("valid"):
        return {
            "side": side_label,
            "verdict": "unfixable",
            "quality_score": 0,
            "is_id_document": False,
            "side_matches_expected": False,
            "rotation_degrees": 0,
            "issues": ["not_an_id_card"],
            "targeted_opencv_ops": [],
            "customer_issue_summary": f"The uploaded {side_label.lower()} ID image file could not be opened.",
            "metrics": metrics,
            "model": _openai_client.configured_quality_model(),
            "response_id": "",
        }

    # Immediate physical guard for corrupted / microscopic thumbnails
    if metrics["width"] < 200 or metrics["height"] < 130:
        return {
            "side": side_label,
            "verdict": "unfixable",
            "quality_score": 10,
            "is_id_document": False,
            "side_matches_expected": True,
            "rotation_degrees": 0,
            "issues": ["tiny_or_unreadable_resolution"],
            "targeted_opencv_ops": [],
            "customer_issue_summary": f"The {side_label.lower()} ID photo resolution is too small to read printed details.",
            "metrics": metrics,
            "model": _openai_client.configured_quality_model(),
            "response_id": "",
        }

    quality_model = _openai_client.configured_quality_model()
    effort = (os.getenv("OPENAI_QUALITY_EFFORT", "") or "medium").strip().lower()
    sanitized_bytes = _strip_exif_reencode(image_bytes)

    prompt_context = {
        "expected_side": side_label.upper(),
        "declared_id_type": declared_id_type or "Philippine Valid ID",
        "opencv_signal_hints": {
            "width": metrics["width"],
            "height": metrics["height"],
            "laplacian_sharpness": metrics["blur_score"],
            "mean_brightness_0_255": metrics["brightness"],
            "overexposed_glare_percent": metrics["glare_pct"],
            "detected_surrounding_background_needing_crop": metrics["has_crop_background"],
            "four_edges_verified": metrics.get("four_edges_verified", False),
            "clipped_edges": metrics.get("clipped_edges", []),
            "card_to_frame_area_ratio": metrics["card_area_ratio"],
            "is_portrait_rotated": metrics["is_portrait"],
        },
    }

    parts = [
        {"text": json.dumps(prompt_context, ensure_ascii=False)},
        {
            "inline_data": {
                "mime_type": _detect_mime(sanitized_bytes),
                "data": base64.b64encode(sanitized_bytes).decode("ascii"),
            }
        },
    ]

    meta = _openai_client.complete_with_meta(
        parts=parts,
        expect_json=True,
        max_tokens=450,
        response_schema=_QUALITY_SCHEMA,
        system_instruction=_QUALITY_SYSTEM_PROMPT,
        effort_override=effort,
        model_override=quality_model,
        previous_response_id=previous_response_id,
        store_response=bool(previous_response_id),
        image_detail="high",
        retries=1,
    )

    raw_text = meta.get("text") or ""
    resp_id = meta.get("response_id") or ""
    used_model = meta.get("model") or quality_model

    if raw_text:
        try:
            parsed = json.loads(raw_text)
            verdict = str(parsed.get("verdict") or "good").lower()
            score = int(parsed.get("quality_score") if parsed.get("quality_score") is not None else 85)
            is_id = bool(parsed.get("is_id_document", True))
            side_ok = bool(parsed.get("side_matches_expected", True))
            rot = int(parsed.get("rotation_degrees") or 0)
            issues = [str(x) for x in (parsed.get("issues") or []) if str(x)]
            ops = [str(op) for op in (parsed.get("targeted_opencv_ops") or []) if str(op) in ALLOWED_OPS]

            if rot == 90 and "rotate_90_cw" not in ops and "rotate_90_ccw" not in ops:
                ops.insert(0, "rotate_90_cw")
            elif rot == 180 and "rotate_180" not in ops:
                ops.insert(0, "rotate_180")
            elif rot == 270 and "rotate_90_ccw" not in ops:
                ops.insert(0, "rotate_90_ccw")

            # Enforce strict consistency:
            # 1) Extreme physical blur or not an ID -> unfixable
            if not is_id or score < 20 or metrics["blur_score"] < 14.0:
                verdict = "unfixable"
                score = min(score, 18)
                ops = []
                if metrics["blur_score"] < 14.0 and "severe_blur" not in issues:
                    issues.insert(0, "severe_blur")
            else:
                # 2) If OpenCV detected a physical ID boundary on a table/background, ensure deskew_crop runs!
                if metrics.get("has_crop_background"):
                    if "deskew_crop" not in ops:
                        ops.insert(0, "deskew_crop")
                    if "tilted_or_wide_background" not in issues:
                        issues.append("tilted_or_wide_background")
                    verdict = "fixable"
                if metrics.get("is_portrait") and not any(r in ops for r in ("rotate_90_cw", "rotate_90_ccw", "deskew_crop")):
                    ops.insert(0, "rotate_90_cw")
                    verdict = "fixable"

                if verdict == "good" and not ops:
                    ops = []
                elif verdict == "fixable" and not ops:
                    if "too_dark" in issues or metrics["brightness"] < 75.0:
                        ops.append("brighten")
                    if "low_contrast" in issues:
                        ops.append("clahe")
                    if "mild_glare" in issues or metrics["glare_pct"] > 18.0:
                        ops.append("deglare")
                    if "tilted_or_wide_background" in issues:
                        ops.append("deskew_crop")
                    if "mild_blur" in issues or metrics["blur_score"] < 55.0:
                        ops.append("sharpen")
                    if not ops:
                        verdict = "good"

            return {
                "side": side_label,
                "verdict": verdict,
                "quality_score": max(0, min(100, score)),
                "is_id_document": is_id,
                "side_matches_expected": side_ok,
                "rotation_degrees": rot,
                "issues": issues,
                "targeted_opencv_ops": ops,
                "customer_issue_summary": str(parsed.get("customer_issue_summary") or "").strip(),
                "metrics": metrics,
                "model": used_model,
                "response_id": resp_id,
            }
        except Exception:
            pass

    # Deterministic OpenCV fallback only if OpenAI is unreachable
    issues: List[str] = []
    ops: List[str] = []
    score = 88
    verdict = "good"

    if metrics["blur_score"] < 18.0:
        verdict = "unfixable"
        score = 15
        issues.append("severe_blur")
    elif metrics["blur_score"] < 42.0:
        verdict = "fixable"
        score = 62
        issues.append("mild_blur")
        ops.append("sharpen")

    if verdict != "unfixable":
        if metrics.get("has_crop_background"):
            verdict = "fixable"
            issues.append("tilted_or_wide_background")
            if "deskew_crop" not in ops:
                ops.insert(0, "deskew_crop")
        if metrics.get("is_portrait") and "deskew_crop" not in ops:
            verdict = "fixable"
            ops.insert(0, "rotate_90_cw")
        if metrics["brightness"] < 70.0:
            verdict = "fixable"
            score = min(score, 65)
            issues.append("too_dark")
            ops.extend(["brighten", "clahe"])
        elif metrics["glare_pct"] > 22.0:
            verdict = "fixable"
            score = min(score, 60)
            issues.append("mild_glare")
            ops.append("deglare")

    summary = ""
    if verdict == "unfixable":
        summary = f"The uploaded {side_label.lower()} ID photo is too blurry or unclear to read the printed text."
    elif verdict == "fixable":
        summary = f"The {side_label.lower()} ID photo needed minor lighting or sharpness enhancement."

    return {
        "side": side_label,
        "verdict": verdict,
        "quality_score": score,
        "is_id_document": True,
        "side_matches_expected": True,
        "rotation_degrees": 0,
        "issues": issues,
        "targeted_opencv_ops": ops if verdict == "fixable" else [],
        "customer_issue_summary": summary,
        "metrics": metrics,
        "model": used_model,
        "response_id": resp_id,
    }


def assess_document_uploads(
    front_bytes: bytes,
    back_bytes: Optional[bytes] = None,
    declared_id_type: str = "",
    previous_response_id: str = "",
) -> Dict[str, Any]:
    """Run Stage 1 Image Quality Assessment on Front (and optional Back) ID uploads."""
    front_sha = hashlib.sha256(front_bytes).hexdigest() if front_bytes else ""
    back_sha = hashlib.sha256(back_bytes).hexdigest() if back_bytes else ""
    duplicate_front_back = bool(front_sha and back_sha and front_sha == back_sha)

    with ThreadPoolExecutor(max_workers=2) as executor:
        fut_front = executor.submit(
            assess_single_side,
            front_bytes,
            "FRONT",
            declared_id_type,
            previous_response_id,
        )
        fut_back = (
            executor.submit(assess_single_side, back_bytes, "BACK", declared_id_type, "")
            if back_bytes and not duplicate_front_back
            else None
        )
        front_assessment = fut_front.result()
        back_assessment = fut_back.result() if fut_back else None

    if duplicate_front_back:
        back_assessment = {
            "side": "BACK",
            "verdict": "unfixable",
            "quality_score": 0,
            "is_id_document": True,
            "side_matches_expected": False,
            "rotation_degrees": 0,
            "issues": ["wrong_side_uploaded"],
            "targeted_opencv_ops": [],
            "customer_issue_summary": "The Front and Back ID uploads are the exact same photo.",
            "metrics": front_assessment.get("metrics") or {},
            "model": front_assessment.get("model") or _openai_client.configured_quality_model(),
            "response_id": "",
        }

    # Combine overall verdict
    verdicts = [front_assessment["verdict"]]
    if back_assessment:
        verdicts.append(back_assessment["verdict"])

    # Note: Front is mandatory; if Front is unfixable or duplicate front/back, overall is unfixable.
    # If Back is unfixable because of severe blur/wrong side when back was uploaded, also flag unfixable.
    if "unfixable" in verdicts or duplicate_front_back:
        overall_verdict = "unfixable"
    elif "fixable" in verdicts:
        overall_verdict = "fixable"
    else:
        overall_verdict = "good"

    scores = [front_assessment["quality_score"]]
    if back_assessment:
        scores.append(back_assessment["quality_score"])

    issues_combined: List[str] = []
    for side_obj in (front_assessment, back_assessment):
        if not side_obj:
            continue
        lbl = side_obj["side"].capitalize()
        if side_obj["customer_issue_summary"]:
            issues_combined.append(f"{lbl} ID: {side_obj['customer_issue_summary']}")

    return {
        "verdict": overall_verdict,
        "quality_score": min(scores) if scores else 0,
        "duplicate_front_back": duplicate_front_back,
        "front_sha256": front_sha,
        "back_sha256": back_sha,
        "front": front_assessment,
        "back": back_assessment,
        "issues": issues_combined,
        "model": front_assessment.get("model") or _openai_client.configured_quality_model(),
        "response_id": front_assessment.get("response_id") or "",
    }
