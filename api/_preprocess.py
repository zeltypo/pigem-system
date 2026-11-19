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


def _boundary_gradient_support(
    gray: np.ndarray, ordered: np.ndarray, w: float, h: float
) -> Tuple[int, int, np.ndarray]:
    """Verify gradient support along all 4 edges of the candidate quad.

    Returns `(total_support_0_to_12, edges_with_support_0_to_4, center)`.
    """
    rows, cols = gray.shape[:2]
    center = ordered.mean(axis=0)
    step = max(4, int(round(min(w, h) * 0.025)))
    total_support = 0
    edges_supported = 0
    for i in range(4):
        p1 = ordered[i]
        p2 = ordered[(i + 1) % 4]
        edge_hits = 0
        for ratio in (0.2, 0.5, 0.8):
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
            if abs(int(gray[iy1, ix1]) - int(gray[iy2, ix2])) >= 6:
                total_support += 1
                edge_hits += 1
        if edge_hits >= 1:
            edges_supported += 1
    return total_support, edges_supported, center


def _interior_corner_angles_valid(ordered: np.ndarray, min_deg: float = 58.0, max_deg: float = 122.0) -> bool:
    """Ensure all 4 corners of the quadrilateral have realistic perspective angles."""
    for i in range(4):
        prev_pt = ordered[(i - 1) % 4]
        curr_pt = ordered[i]
        next_pt = ordered[(i + 1) % 4]
        v1 = prev_pt - curr_pt
        v2 = next_pt - curr_pt
        n1 = float(np.linalg.norm(v1))
        n2 = float(np.linalg.norm(v2))
        if n1 < 1e-3 or n2 < 1e-3:
            return False
        cos_theta = float(np.clip(np.dot(v1, v2) / (n1 * n2), -1.0, 1.0))
        deg = float(np.degrees(np.arccos(cos_theta)))
        if not (min_deg <= deg <= max_deg):
            return False
    return True


def _quad_from_contour(contour: np.ndarray) -> List[np.ndarray]:
    """Extract candidate 4-corner quadrilaterals from a contour (supports rounded ID card corners via convexHull + minAreaRect)."""
    candidates: List[np.ndarray] = []
    hull = cv2.convexHull(contour)
    for src in (contour, hull):
        peri = cv2.arcLength(src, True)
        if peri <= 0:
            continue
        for tol in (0.015, 0.022, 0.028, 0.036, 0.048, 0.062):
            approx = cv2.approxPolyDP(src, tol * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                ordered = _order_quad_points(approx)
                if ordered is not None:
                    candidates.append(ordered)
                    break
    # Fallback: rotated minimum-area bounding box for rounded-corner ID cards
    rect = cv2.minAreaRect(hull)
    box = cv2.boxPoints(rect)
    ordered_box = _order_quad_points(box)
    if ordered_box is not None:
        candidates.append(ordered_box)
    return candidates


def detect_card_quad(image: np.ndarray) -> Optional[Dict[str, Any]]:
    """Multi-pass OpenCV 4-edge & 4-corner detector for ID cards placed on a table/background.

    Also detects if any of the 4 card edges are clipped/cut off at the frame border.
    """
    height, width = image.shape[:2]
    frame_area = float(width * height)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    blurred = cv2.GaussianBlur(enhanced, (5, 5), 0)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))

    gx = cv2.Sobel(blurred, cv2.CV_16S, 1, 0, ksize=3)
    gy = cv2.Sobel(blurred, cv2.CV_16S, 0, 1, ksize=3)
    grad_mag = cv2.addWeighted(cv2.convertScaleAbs(gx), 0.5, cv2.convertScaleAbs(gy), 0.5, 0)
    _, grad_otsu = cv2.threshold(grad_mag, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)

    masks = [
        cv2.Canny(blurred, 20, 65),
        cv2.Canny(blurred, 9, 32),
        grad_otsu,
        cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 21, 5),
        cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1],
        cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1],
    ]

    best: Optional[Dict[str, Any]] = None
    best_score = 0.0
    border_clipped_edges: List[str] = []

    for raw_mask in masks:
        mask = cv2.morphologyEx(raw_mask, cv2.MORPH_CLOSE, kernel)
        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:35]:
            area = float(cv2.contourArea(contour))
            if area < frame_area * 0.07 or area > frame_area * 0.94:
                continue
            for ordered in _quad_from_contour(contour):
                if not _interior_corner_angles_valid(ordered):
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
                if not (1.16 <= aspect <= 2.18):
                    continue
                if min(top_w, bot_w) / max(top_w, bot_w) < 0.55 or min(left_h, right_h) / max(left_h, right_h) < 0.55:
                    continue
                if area < w * h * 0.68:
                    continue

                margin_px = max(3.0, min(width, height) * 0.008)
                clipped: List[str] = []
                if min(tl[1], tr[1]) < margin_px:
                    clipped.append("top")
                if max(bl[1], br[1]) >= height - margin_px:
                    clipped.append("bottom")
                if min(tl[0], bl[0]) < margin_px:
                    clipped.append("left")
                if max(tr[0], br[0]) >= width - margin_px:
                    clipped.append("right")

                if clipped:
                    if len(clipped) > len(border_clipped_edges):
                        border_clipped_edges = clipped
                    continue

                support, edges_ok, center = _boundary_gradient_support(blurred, ordered, w, h)
                if edges_ok < 3 or support < 6:
                    continue
                score = area * (0.55 + (support / 12.0) + (0.12 if edges_ok == 4 else 0.0))
                if score > best_score:
                    best_score = score
                    padded = np.empty_like(ordered)
                    for idx in range(4):
                        padded[idx, 0] = np.clip(center[0] + (ordered[idx, 0] - center[0]) * 1.032, 0, width - 1)
                        padded[idx, 1] = np.clip(center[1] + (ordered[idx, 1] - center[1]) * 1.032, 0, height - 1)
                    best = {
                        "points": padded,
                        "width": int(round(w * 1.032)),
                        "height": int(round(h * 1.032)),
                        "area_ratio": round(area / frame_area, 3),
                        "four_edges_verified": edges_ok == 4,
                        "edges_supported": edges_ok,
                        "clipped_edges": [],
                    }
        if best is not None and best.get("four_edges_verified"):
            break
    if best is None and border_clipped_edges:
        return {
            "points": None,
            "width": width,
            "height": height,
            "area_ratio": 0.0,
            "four_edges_verified": False,
            "edges_supported": 4 - len(border_clipped_edges),
            "clipped_edges": border_clipped_edges,
        }
    return best


def _deskew_and_crop(image: np.ndarray) -> Tuple[np.ndarray, bool]:
    found = detect_card_quad(image)
    if not found or found.get("points") is None:
        return image, False
    w = max(80, int(found["width"]))
    h = max(80, int(found["height"]))
    if w >= h:
        aspect = w / max(1.0, float(h))
        if 1.38 <= aspect <= 1.78:
            h = int(round(w / 1.585))
    else:
        aspect = h / max(1.0, float(w))
        if 1.38 <= aspect <= 1.78:
            w = int(round(h / 1.585))
    target = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
    warped = cv2.warpPerspective(image, cv2.getPerspectiveTransform(found["points"], target), (w, h))
    wh, ww = warped.shape[:2]
    if wh > ww * 1.15:
        warped = cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE)
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
