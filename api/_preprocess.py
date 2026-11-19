"""Targeted OpenCV image enhancement engine.

IMPORTANT:
- Only OpenCV performs image pixel operations (no AI image generation or modification).
- When the Stage 1 Quality Gate (`gpt-6.2-sol`) marks an image as `GOOD`, OpenCV is bypassed completely
  and the original raw bytes are passed directly to Azure Document Intelligence (IDP).
- When marked `FIXABLE`, only the specific requested OpenCV operations (`targeted_opencv_ops`) are run.
"""
from typing import Any, Dict, List, Optional, Tuple
import cv2
import numpy as np


def _deskew_and_crop(image: np.ndarray) -> Tuple[np.ndarray, bool]:
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 25, 90)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:30]:
        if cv2.contourArea(contour) < width * height * 0.08:
            break
        quad = cv2.approxPolyDP(contour, 0.028 * cv2.arcLength(contour, True), True)
        if len(quad) != 4 or not cv2.isContourConvex(quad):
            continue
        points = quad.reshape(4, 2).astype(np.float32)
        sums = points.sum(axis=1)
        diffs = points[:, 0] - points[:, 1]
        order = [sums.argmin(), diffs.argmax(), sums.argmax(), diffs.argmin()]
        if len(set(order)) != 4 or np.any(points < 3) or np.any(points >= [width - 3, height - 3]):
            continue
        tl, tr, br, bl = points[order]
        w = int(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
        h = int(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
        if min(w, h) < 70 or not 1.22 <= max(w, h) / min(w, h) <= 2.1:
            continue
        target = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
        warped = cv2.warpPerspective(image, cv2.getPerspectiveTransform(points[order], target), (w, h))
        return warped, True
    return image, False


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

    # 1. Orientation fixes first
    if "rotate_90_cw" in requested:
        image = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
        applied.append("rotate_90_cw")
    elif "rotate_90_ccw" in requested:
        image = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
        applied.append("rotate_90_ccw")
    elif "rotate_180" in requested:
        image = cv2.rotate(image, cv2.ROTATE_180)
        applied.append("rotate_180")

    # 2. Geometric perspective / boundary crop
    if "deskew_crop" in requested:
        image, did_crop = _deskew_and_crop(image)
        cropped = did_crop
        if did_crop:
            applied.append("deskew_crop")

    # 3. Radiometric & noise adjustments
    if "deglare" in requested:
        image = _apply_deglare(image)
        applied.append("deglare")
    if "brighten" in requested:
        image = _apply_brighten(image)
        applied.append("brighten")
    if "clahe" in requested:
        image = _apply_clahe(image)
        applied.append("clahe")
    if "denoise" in requested:
        image = _apply_denoise(image)
        applied.append("denoise")
    if "sharpen" in requested:
        image = _apply_sharpen(image)
        applied.append("sharpen")

    if not applied:
        return data, {
            "bypassed": True,
            "enhanced": False,
            "cropped": False,
            "applied_ops": [],
            "engine": "none",
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
    }


def prepare_photo(data: bytes, ops: Optional[List[str]] = None) -> Tuple[bytes, Dict[str, Any]]:
    """Backwards-compatible entry point. When `ops` is None, runs standard deskew_crop + clahe."""
    if ops is not None:
        return enhance_targeted(data, ops)
    return enhance_targeted(data, ["deskew_crop", "clahe"])
