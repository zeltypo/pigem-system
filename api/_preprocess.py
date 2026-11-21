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
    sums = points.sum(axis=1)
    diffs = points[:, 0] - points[:, 1]
    order = [int(sums.argmin()), int(diffs.argmax()), int(sums.argmax()), int(diffs.argmin())]
    if len(set(order)) != 4:
        return None
    return points[order]


def _boundary_gradient_support(gray: np.ndarray, ordered: np.ndarray, w: float, h: float) -> Tuple[int, np.ndarray]:
    rows, cols = gray.shape[:2]
    center = ordered.mean(axis=0)
    step = max(4, int(round(min(w, h) * 0.025)))
    support = 0
    for i in range(4):
        p1 = ordered[i]
        p2 = ordered[(i + 1) % 4]
        for ratio in (0.25, 0.5, 0.75):
            pt = p1 + ratio * (p2 - p1)
            vec = center - pt
            norm = float(np.hypot(vec[0], vec[1]))
            if norm < 1e-3:
                continue
            dx = vec[0] * step / norm
            dy = vec[1] * step / norm
            ix1 = int(np.clip(round(pt[0] + dx), 0, cols - 1))
            iy1 = int(np.clip(round(pt[1] + dy), 0, rows - 1))
            ix2 = int(np.clip(round(pt[0] - dx), 0, cols - 1))
            iy2 = int(np.clip(round(pt[1] - dy), 0, rows - 1))
            if abs(int(gray[iy1, ix1]) - int(gray[iy2, ix2])) >= 5:
                support += 1
    return support, center


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
                if not candidate_quads and 0.06 * frame_area <= area <= 0.90 * frame_area:
                    rect = cv2.minAreaRect(src)
                    rw, rh = rect[1]
                    if rw > 70 and rh > 70 and (area / float(rw * rh)) >= 0.78:
                        box = cv2.boxPoints(rect).reshape(4, 1, 2).astype(np.float32)
                        candidate_quads.append(box)
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
                    support, center = _boundary_gradient_support(blurred, ordered, w, h)
                    if support < 5:
                        continue
                    score = area * (0.6 + support / 12.0)
                    if score > best_score:
                        best_score = score
                        padded = np.empty_like(ordered)
                        for idx in range(4):
                            padded[idx, 0] = np.clip(center[0] + (ordered[idx, 0] - center[0]) * 1.035, 0, width - 1)
                            padded[idx, 1] = np.clip(center[1] + (ordered[idx, 1] - center[1]) * 1.035, 0, height - 1)
                        best = {
                            "points": padded,
                            "width": int(round(w * 1.035)),
                            "height": int(round(h * 1.035)),
                            "area_ratio": round(area / frame_area, 3),
                        }
        if best is not None:
            break
    return best


def _deskew_and_crop(image: np.ndarray) -> Tuple[np.ndarray, bool]:
    found = detect_card_quad(image)
    if not found:
        return image, False
    w = max(80, int(found["width"]))
    h = max(80, int(found["height"]))
    target = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
    warped = cv2.warpPerspective(image, cv2.getPerspectiveTransform(found["points"], target), (w, h))
    return warped, True


def _apply_brighten(image: np.ndarray) -> np.ndarray:
    """Gamma correction (gamma < 1.0) to lift dark shadows without blowing out highlights."""
    gamma = 0.72
    table = np.array([((i / 255.0) ** gamma) * 255 for i in np.arange(0, 256)]).astype("uint8")
    return cv2.LUT(image, table)


def _apply_deglare(image: np.ndarray) -> np.ndarray:
    """Tone down specular flash glare in L-channel while preserving dark text strokes."""
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_chan = lab[:, :, 0].astype(np.float32)
    mask = l_chan > 220.0
    l_chan[mask] = 220.0 + (l_chan[mask] - 220.0) * 0.35
    lab[:, :, 0] = np.clip(l_chan, 0, 255).astype(np.uint8)
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def _apply_clahe(image: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lab[:, :, 0] = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(lab[:, :, 0])
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


def enhance_targeted(data: bytes, ops: Optional[List[str]] = None) -> Tuple[bytes, Dict[str, Any]]:
    """Run ONLY the specified OpenCV enhancement methods.

    If `ops` is empty or None, bypass OpenCV completely and return the untouched original bytes.
    """
    requested = [str(op).strip() for op in (ops or []) if str(op).strip()]
    if not requested:
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
    cropped = False

    if "rotate_90_cw" in requested:
        image = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
        applied.append("rotate_90_cw")
    elif "rotate_90_ccw" in requested:
        image = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
        applied.append("rotate_90_ccw")
    elif "rotate_180" in requested:
        image = cv2.rotate(image, cv2.ROTATE_180)
        applied.append("rotate_180")

    if "deskew_crop" in requested:
        image, did_crop = _deskew_and_crop(image)
        cropped = did_crop
        if did_crop:
            applied.append("deskew_crop")

    if "deglare" in requested:
        image = _apply_deglare(image)
        applied.append("deglare")
    if "brighten" in requested:
        image = _apply_brighten(image)
        applied.append("brighten")
    if "clahe" in requested:
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

    if not applied:
        return data, {
            "bypassed": True,
            "enhanced": False,
            "cropped": False,
            "applied_ops": [],
            "engine": "none",
            "preview_data_url": "",
        }

    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 93])
    if not ok:
        raise ValueError("The uploaded image could not be prepared.")
    return encoded.tobytes(), {
        "bypassed": False,
        "enhanced": True,
        "cropped": cropped,
        "applied_ops": applied,
        "engine": "opencv",
        "preview_data_url": _make_preview_data_url(image),
    }


def prepare_photo(data: bytes, ops: Optional[List[str]] = None) -> Tuple[bytes, Dict[str, Any]]:
    """Backwards-compatible entry point. When `ops` is None, runs standard deskew_crop + clahe."""
    if ops is not None:
        return enhance_targeted(data, ops)
    return enhance_targeted(data, ["deskew_crop", "clahe"])
