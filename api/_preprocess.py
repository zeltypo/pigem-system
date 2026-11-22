"""Targeted OpenCV image enhancement engine.

IMPORTANT:
- 100% OpenCV mathematical image processing (no AI image generation or modification).
- Multi-pass card boundary detection (`detect_card_quad`) + perspective warp (`deskew_crop`),
  90/180/270 orientation correction, specular glare attenuation (`deglare`), gamma shadow lift (`brighten`),
  LAB-channel adaptive contrast (`clahe`), Non-Local Means denoising (`denoise`), and unsharp mask (`sharpen`).
- Also returns a base64 data URL (`preview_data_url`) when OpenCV crops or enhances an image so the Agent portal
  displays the cropped/enhanced ID photo immediately.
"""
import base64
from typing import Any, Dict, List, Optional, Tuple
import cv2
import numpy as np


def _order_quad_points(pts: np.ndarray) -> Optional[np.ndarray]:
    points = pts.reshape(4, 2).astype(np.float32)
    if len(np.unique(points, axis=0)) != 4:
        return None
    relative = points - points.mean(axis=0)
    clockwise = points[np.argsort(np.arctan2(relative[:, 1], relative[:, 0]))]
    return np.roll(clockwise, -int(clockwise.sum(axis=1).argmin()), axis=0)


def _boundary_support(edge_band: np.ndarray, points: np.ndarray) -> List[float]:
    fractions = np.linspace(0.06, 0.94, 36)[:, None]
    support = []
    for start, end in zip(points, np.roll(points, -1, axis=0)):
        samples = np.rint(start + fractions * (end - start)).astype(int)
        hits = edge_band[samples[:, 1], samples[:, 0]] != 0
        support.append(float(hits.reshape(3, 12).mean(axis=1).min()))
    return support


def _has_content_outside(edges: np.ndarray, points: np.ndarray) -> bool:
    exclusion = cv2.fillConvexPoly(np.zeros_like(edges), np.rint(points).astype(np.int32), 255)
    outside = cv2.bitwise_and(edges, cv2.bitwise_not(exclusion))
    edges_total = cv2.countNonZero(edges)
    outside_total = cv2.countNonZero(outside)
    if outside_total > max(65, 0.16 * edges_total):
        return True
    if outside_total < 28:
        return False
    nearby_edges = cv2.boxFilter(outside, cv2.CV_32S, (25, 25), normalize=False)
    return cv2.minMaxLoc(nearby_edges)[1] >= 28 * 255


def detect_card_quad(image: np.ndarray) -> Optional[Dict[str, Any]]:
    """Multi-pass OpenCV contour & boundary detector for Front and Back ID cards (both Portrait and Landscape)."""
    height, width = image.shape[:2]
    frame_area = float(width * height)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    blurred = cv2.GaussianBlur(enhanced, (5, 5), 0)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))

    masks = [
        cv2.Canny(blurred, 20, 65),
        cv2.Canny(blurred, 9, 32),
        cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 21, 5),
        cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1],
        cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1],
    ]
    edges = masks[0]
    edge_band = cv2.dilate(masks[1], kernel)

    best: Optional[Dict[str, Any]] = None
    best_score = 0.0

    for raw_mask in masks:
        mask = cv2.morphologyEx(raw_mask, cv2.MORPH_CLOSE, kernel)
        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:35]:
            area = float(cv2.contourArea(contour))
            if area < frame_area * 0.05 or area > frame_area * 0.95:
                continue
            hull = cv2.convexHull(contour)
            for src in (contour, hull):
                perimeter = cv2.arcLength(src, True)
                if perimeter <= 0:
                    continue
                candidate_quads = []
                for tol in (0.015, 0.022, 0.028, 0.038, 0.05, 0.065):
                    quad = cv2.approxPolyDP(src, tol * perimeter, True)
                    if len(quad) == 4 and cv2.isContourConvex(quad):
                        candidate_quads.append(quad)
                for quad in candidate_quads:
                    ordered = _order_quad_points(quad)
                    if ordered is None:
                        continue
                    if np.any(ordered < 1) or np.any(ordered[:, 0] >= width - 1) or np.any(ordered[:, 1] >= height - 1):
                        continue
                    tl, tr, br, bl = ordered
                    top_w = float(np.linalg.norm(tr - tl))
                    bot_w = float(np.linalg.norm(br - bl))
                    left_h = float(np.linalg.norm(bl - tl))
                    right_h = float(np.linalg.norm(br - tr))
                    w = (top_w + bot_w) / 2.0
                    h = (left_h + right_h) / 2.0
                    if min(w, h) < 70:
                        continue
                    aspect = max(w, h) / max(1.0, min(w, h))
                    if not (1.12 <= aspect <= 2.35):
                        continue
                    if min(top_w, bot_w) / max(top_w, bot_w) < 0.52 or min(left_h, right_h) / max(left_h, right_h) < 0.52:
                        continue
                    if area < w * h * 0.68:
                        continue
                    support = _boundary_support(edge_band, ordered)
                    if min(support) < 0.58 or sum(support) < 3.1:
                        continue
                    quad_area = cv2.contourArea(ordered)
                    score = quad_area * (0.8 + sum(support) / 20.0)
                    if score > best_score:
                        center = ordered.mean(axis=0)
                        padding = 1.10
                        padded = center + (ordered - center) * padding
                        if (
                            np.any(padded < 0)
                            or np.any(padded[:, 0] > width - 1)
                            or np.any(padded[:, 1] > height - 1)
                            or _has_content_outside(edges, padded)
                        ):
                            continue
                        best_score = score
                        best = {
                            "points": padded,
                            "width": int(round(w * padding)),
                            "height": int(round(h * padding)),
                            "area_ratio": round(quad_area / frame_area, 3),
                        }
    return best


def _deskew_and_crop(image: np.ndarray) -> Tuple[np.ndarray, str]:
    scale = min(1.0, 960.0 / max(image.shape[:2]))
    sample = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else image
    found = detect_card_quad(sample)
    if not found:
        return image, "edges_uncertain"
    return _warp_card(image, found, scale), "cropped"


def _warp_card(image: np.ndarray, found: Dict[str, Any], scale: float = 1.0) -> np.ndarray:
    w = max(80, int(found["width"] / scale))
    h = max(80, int(found["height"] / scale))
    target = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
    points = found["points"] / scale
    return cv2.warpPerspective(image, cv2.getPerspectiveTransform(points, target), (w, h), borderMode=cv2.BORDER_REPLICATE)


def _bright_card_quad(image: np.ndarray) -> Optional[Tuple[Dict[str, Any], float]]:
    height, width = image.shape[:2]
    scale = min(1.0, 480 / max(height, width))
    sample = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    gray = cv2.GaussianBlur(cv2.cvtColor(sample, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    rows, cols = gray.shape
    middle, bright = np.percentile(gray, (50, 88))
    if bright - middle < 38:
        return None

    candidates = []
    closing = cv2.getStructuringElement(cv2.MORPH_RECT, (13, 13))
    opening = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    for fraction in (0.55, 0.65, 0.75, 0.85):
        mask = cv2.threshold(gray, middle + fraction * (bright - middle), 255, cv2.THRESH_BINARY)[1]
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, closing)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, opening)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = cv2.contourArea(contour)
            if not 0.14 * gray.size <= area <= 0.74 * gray.size:
                continue
            rect = cv2.minAreaRect(contour)
            w, h = rect[1]
            if min(w, h) < 65 or not 1.25 <= max(w, h) / min(w, h) <= 1.88 or area / (w * h) < 0.62:
                continue
            points = _order_quad_points(cv2.boxPoints(rect))
            if points is not None:
                candidates.append((fraction, points))

    for fraction, points in candidates:
        agreeing = [other for level, other in candidates if level != fraction and
                    cv2.intersectConvexConvex(points, other)[0] >= 0.80 * max(cv2.contourArea(points), cv2.contourArea(other))]
        if len(agreeing) < 2:
            continue
        box = _order_quad_points(cv2.boxPoints(cv2.minAreaRect(np.vstack([points, *agreeing]))))
        if box is None:
            continue
        center = box.mean(axis=0)
        padded = center + (box - center) * 1.17
        if np.any(padded < 0) or np.any(padded >= (cols - 1, rows - 1)):
            continue
        inner = cv2.fillConvexPoly(np.zeros_like(gray), np.rint(box).astype(np.int32), 255)
        outer = cv2.fillConvexPoly(np.zeros_like(gray), np.rint(padded).astype(np.int32), 255)
        if np.median(gray[inner != 0]) - np.median(gray[outer == 0]) < 35:
            continue
        return {
            "points": padded,
            "width": round(float(np.linalg.norm(padded[1] - padded[0]))),
            "height": round(float(np.linalg.norm(padded[3] - padded[0]))),
        }, scale
    return None


def _apply_brighten(image: np.ndarray, gamma: float = 0.72) -> np.ndarray:
    """Apply a gamma curve to luminance without changing the chroma channels."""
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    table = np.uint8(np.rint(((np.arange(256) / 255.0) ** gamma) * 255))
    lab[:, :, 0] = cv2.LUT(lab[:, :, 0], table)
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def _apply_deglare(image: np.ndarray) -> np.ndarray:
    """Tone down specular flash glare in L-channel while preserving dark text strokes."""
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_chan = lab[:, :, 0].astype(np.float32)
    mask = l_chan > 220.0
    l_chan[mask] = 220.0 + (l_chan[mask] - 220.0) * 0.35
    lab[:, :, 0] = np.clip(l_chan, 0, 255).astype(np.uint8)
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def _apply_clahe(image: np.ndarray, strength: float = 1.0) -> np.ndarray:
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    light = lab[:, :, 0]
    adjusted = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(light)
    lab[:, :, 0] = cv2.addWeighted(light, 1.0 - strength, adjusted, strength, 0)
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def _apply_denoise(image: np.ndarray) -> np.ndarray:
    return cv2.fastNlMeansDenoisingColored(image, None, 5, 5, 7, 15)


def _apply_sharpen(image: np.ndarray) -> np.ndarray:
    """Unsharp mask for slightly soft text edges."""
    blurred = cv2.GaussianBlur(image, (0, 0), 1.4)
    return cv2.addWeighted(image, 1.45, blurred, -0.45, 0)


def _make_preview_data_url(image: np.ndarray) -> str:
    h, w = image.shape[:2]
    preview = image
    if max(h, w) > 960:
        scale = 960.0 / max(h, w)
        preview = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    ok, enc = cv2.imencode(".jpg", preview, [cv2.IMWRITE_JPEG_QUALITY, 84])
    if not ok:
        return ""
    return "data:image/jpeg;base64," + base64.b64encode(enc.tobytes()).decode("ascii")


def enhance_targeted(
    data: bytes, ops: Optional[List[str]] = None, *, screening_auto: bool = False
) -> Tuple[bytes, Dict[str, Any]]:
    """Screening uses orientation hints and measures crop and lighting with OpenCV."""
    requested = [str(op).strip() for op in (ops or []) if str(op).strip()]
    if screening_auto:
        requested = [op for op in requested if op in ("rotate_90_cw", "rotate_90_ccw", "rotate_180")]
    if not requested and not screening_auto:
        return data, {
            "bypassed": True,
            "enhanced": False,
            "cropped": False,
            "applied_ops": [],
            "engine": "none",
            "preview_data_url": "",
        }

    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("The uploaded image cannot be opened.")

    height, width = image.shape[:2]
    if max(height, width) > 1800:
        scale = 1800 / max(height, width)
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    applied: List[str] = []
    crop_status = "not_checked"

    if "rotate_90_cw" in requested:
        image = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
        applied.append("rotate_90_cw")
    elif "rotate_90_ccw" in requested:
        image = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
        applied.append("rotate_90_ccw")
    elif "rotate_180" in requested:
        image = cv2.rotate(image, cv2.ROTATE_180)
        applied.append("rotate_180")

    if screening_auto or "deskew_crop" in requested:
        image, crop_status = _deskew_and_crop(image)
        if crop_status == "cropped":
            applied.append("deskew_crop")

    preview_quad = _bright_card_quad(image) if screening_auto and crop_status == "edges_uncertain" else None
    if screening_auto:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        low, median, high = np.percentile(gray[::3, ::3], (2, 50, 98))
        if high - low >= 8 and 12 < median < 105:
            gamma = float(np.clip(np.log(112 / 255) / np.log(median / 255), 0.66, 0.9))
            image = _apply_brighten(image, gamma)
            applied.append("brighten")
        elif high - low >= 12 and low > 135 and 205 < median < high < 252:
            gamma = float(np.clip(np.log(195 / 255) / np.log(median / 255), 1.1, 1.35))
            image = _apply_brighten(image, gamma)
            applied.append("darken")
        if 8 <= high - low < 105 and 15 < median < 245:
            image = _apply_clahe(image, strength=0.55)
            applied.append("clahe")
    if not screening_auto and "deglare" in requested:
        image = _apply_deglare(image)
        applied.append("deglare")
    if not screening_auto and "brighten" in requested:
        image = _apply_brighten(image)
        applied.append("brighten")
    if not screening_auto and "clahe" in requested:
        image = _apply_clahe(image)
        if "clahe" not in applied:
            applied.append("clahe")
    if "denoise" in requested:
        image = _apply_denoise(image)
        applied.append("denoise")
    if "sharpen" in requested:
        image = _apply_sharpen(image)
        if "sharpen" not in applied:
            applied.append("sharpen")

    reading_copy = _warp_card(image, *preview_quad) if preview_quad else None
    if not applied and reading_copy is None:
        return data, {
            "bypassed": True,
            "enhanced": False,
            "cropped": False,
            "crop_status": crop_status,
            "applied_ops": [],
            "engine": "none",
            "preview_data_url": "",
        }

    output = data
    if applied:
        ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 93])
        if not ok:
            raise ValueError("The uploaded image could not be prepared.")
        output = encoded.tobytes()
    return output, {
        "bypassed": False,
        "enhanced": True,
        "cropped": crop_status == "cropped",
        "crop_verified": crop_status == "cropped",
        "suggested_preview_crop": reading_copy is not None,
        "crop_status": crop_status,
        "applied_ops": applied,
        "engine": "opencv",
        "preview_data_url": _make_preview_data_url(reading_copy if reading_copy is not None else image),
    }


def prepare_photo(data: bytes, ops: Optional[List[str]] = None) -> Tuple[bytes, Dict[str, Any]]:
    """Backwards-compatible entry point. When `ops` is None, runs standard deskew_crop + clahe."""
    if ops is not None:
        return enhance_targeted(data, ops)
    return enhance_targeted(data, ["deskew_crop", "clahe"])
