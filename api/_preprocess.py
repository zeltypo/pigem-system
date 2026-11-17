import cv2
import numpy as np


def prepare_photo(data):
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("The uploaded image cannot be opened.")
    height, width = image.shape[:2]
    if max(height, width) > 1800:
        scale = 1800 / max(height, width)
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 25, 90)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    cropped = False
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
        image = cv2.warpPerspective(image, cv2.getPerspectiveTransform(points[order], target), (w, h))
        cropped = True
        break
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lab[:, :, 0] = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(lab[:, :, 0])
    enhanced = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    ok, encoded = cv2.imencode(".jpg", enhanced, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        raise ValueError("The uploaded image could not be prepared.")
    return encoded.tobytes(), {"cropped": cropped, "enhanced": True}
