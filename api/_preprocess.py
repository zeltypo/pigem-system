"""Prepare separate ID reading copies with Dynamsoft Document Normalizer."""

import base64
import logging
from os import getenv
from threading import Lock
from time import monotonic

from PIL import Image, ImageDraw, ImageFilter, ImageOps, ImageStat

from _photo import PHOTO_ERRORS, decode_photo, jpeg_bytes


_logger = logging.getLogger(__name__)
_license_lock = Lock()
_license_ready = False
_license_retry_after = 0.0
_rotations = {
    90: Image.Transpose.ROTATE_270,
    180: Image.Transpose.ROTATE_180,
    270: Image.Transpose.ROTATE_90,
}


def is_configured() -> bool:
    return bool((getenv("DYNAMSOFT_SERVER_LICENSE") or "").strip())


def _activate_license(sdk) -> bool:
    global _license_ready, _license_retry_after
    with _license_lock:
        if _license_ready:
            return True
        if monotonic() < _license_retry_after:
            return False
        _license_retry_after = monotonic() + 60
        code, _ = sdk.LicenseManager.init_license(getenv("DYNAMSOFT_SERVER_LICENSE", "").strip())
        _license_ready = code in (sdk.EnumErrorCode.EC_OK, sdk.EnumErrorCode.EC_LICENSE_CACHE_USED)
        if not _license_ready:
            _logger.warning("document_normalizer stage=license status=%s", code)
        return _license_ready


def _padded_quad(sdk, quad, width: int, height: int, minimum_ratio: float = 0.18, *, reading_copy=False):
    points = list(quad.points)
    margin = max(2, round(min(width, height) * 0.015))
    if len(points) != 4 or quad.get_area() < width * height * minimum_ratio:
        return None
    tl, tr, br, bl = points
    horizontal = abs(tr.x - tl.x) + abs(tr.y - tl.y) + abs(br.x - bl.x) + abs(br.y - bl.y)
    vertical = abs(bl.x - tl.x) + abs(bl.y - tl.y) + abs(br.x - tr.x) + abs(br.y - tr.y)
    x_pad, y_pad = (0.05, 0.16) if vertical > horizontal else (0.16, 0.05)
    if not reading_copy:
        x_pad = y_pad = 0.035
    padded = [
        sdk.Point(
            round(point.x + (point.x - across.x) * x_pad + (point.x - down.x) * y_pad),
            round(point.y + (point.y - across.y) * x_pad + (point.y - down.y) * y_pad),
        )
        for point, across, down in ((tl, tr, bl), (tr, tl, br), (br, bl, tr), (bl, br, tl))
    ]
    if any(not (margin <= point.x < width - margin and margin <= point.y < height - margin) for point in padded):
        return None
    result = sdk.Quadrilateral()
    result.points = padded
    return result


def _detect_quad(router, source, template):
    captured = router.capture(source, template)
    if captured.get_error_code():
        raise RuntimeError("Document detection failed")
    documents = captured.get_processed_document_result()
    items = documents.get_detected_quad_result_items() if documents else []
    return items[0].get_location() if len(items) == 1 else None


def _corners_from_outline(points):
    def cross(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    ordered = sorted(set(points))
    hull = []
    for sequence in (ordered, reversed(ordered)):
        half = []
        for point in sequence:
            while len(half) >= 2 and cross(half[-2], half[-1], point) <= 0:
                half.pop()
            half.append(point)
        hull.extend(half[:-1])
    while len(hull) > 4:
        index = min(range(len(hull)), key=lambda i: cross(hull[i - 1], hull[i], hull[(i + 1) % len(hull)]))
        hull.pop(index)
    if len(hull) != 4:
        return ()
    start = min(range(4), key=lambda i: sum(hull[i]))
    return hull[start:] + hull[:start]


def _light_card_candidate(sdk, gray, threshold):
    width, height = gray.size
    mask = gray.point(lambda pixel: 255 if pixel >= threshold else 0)
    mask = mask.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))
    for ratio_x, ratio_y in ((0.53, 0.55), (0.50, 0.50), (0.56, 0.60)):
        seed = round(width * ratio_x), round(height * ratio_y)
        if mask.getpixel(seed) != 255:
            continue
        ImageDraw.floodfill(mask, seed, 128)
        component = mask.point(lambda pixel: 255 if pixel == 128 else 0)
        area = component.histogram()[255]
        if not 0.10 * width * height <= area <= 0.45 * width * height:
            continue
        left, top, right, bottom = component.getbbox()
        if min(left, top, width - right, height - bottom) < 3:
            continue
        samples = []
        for y in range(top, bottom):
            span = component.crop((left, y, right, y + 1)).getbbox()
            if span:
                samples.extend(((left + span[0], y), (left + span[2] - 1, y)))
        corners = _corners_from_outline(samples)
        if not corners:
            continue
        quad = sdk.Quadrilateral()
        quad.points = [sdk.Point(x, y) for x, y in corners]
        coverage = area / max(1, quad.get_area())
        aspect = max(right - left, bottom - top) / min(right - left, bottom - top)
        if 0.86 <= coverage <= 1.12 and 1.20 <= aspect <= 3.2:
            return quad
    return None


def _find_light_card(sdk, photo):
    gray = photo.convert("L")
    gray.thumbnail((320, 320), Image.Resampling.LANCZOS)
    width, height = gray.size
    median, high = ImageStat.Stat(gray).median[0], 0
    remaining = width * height * 0.055
    for level, count in reversed(list(enumerate(gray.histogram()))):
        remaining -= count
        if remaining <= 0:
            high = level
            break
    if high - median < 45:
        return None
    candidates = [
        _light_card_candidate(sdk, gray, round(median + (high - median) * fraction))
        for fraction in (0.39, 0.47)
    ]
    first, second = candidates
    if first is None or second is None or any(
        min((point.x - other.x) ** 2 + (point.y - other.y) ** 2 for other in second.points) > (min(width, height) * 0.05) ** 2
        for point in first.points
    ):
        return None
    selected = max(candidates, key=lambda q: q.get_area())
    projected = sdk.Quadrilateral()
    projected.points = [sdk.Point(round(p.x * photo.width / width), round(p.y * photo.height / height)) for p in selected.points]
    return _padded_quad(sdk, projected, photo.width, photo.height, minimum_ratio=0.09, reading_copy=True)


def _find_card(sdk, router, image_io, source, photo, template):
    width, height = photo.size
    quad = _detect_quad(router, source, template)
    if quad:
        padded = _padded_quad(sdk, quad, width, height, minimum_ratio=0.12, reading_copy=True)
        if padded is not None:
            return padded

    # Alternate framing and luminance for detection, then normalize the
    # unfiltered source using two agreeing sets of whole-card coordinates.
    locations = []
    for x_inset, y_inset, contrast_detection in (
        (0.08, 0.06, False), (0.16, 0.10, False),
        (0.11, 0.07, True), (0.17, 0.08, True),
    ):
        left, top = round(width * x_inset), round(height * y_inset)
        region = photo.crop((left, top, width - left, height - top))
        detection_image = ImageOps.autocontrast(region.convert("L"), cutoff=1) if contrast_detection else region
        code, region_source = image_io.read_from_memory(jpeg_bytes(detection_image, 95))
        if code or region_source is None:
            continue
        try:
            candidate = _detect_quad(router, region_source, template)
        except RuntimeError:
            continue
        if not candidate or _padded_quad(sdk, candidate, region.width, region.height) is None:
            continue
        projected = sdk.Quadrilateral()
        projected.points = [sdk.Point(p.x + left, p.y + top) for p in candidate.points]
        padded = _padded_quad(sdk, projected, width, height, minimum_ratio=0.09, reading_copy=True)
        if padded is None:
            continue
        max_offset_squared = (min(width, height) * 0.035) ** 2
        for previous in locations:
            if all(min((p.x - q.x) ** 2 + (p.y - q.y) ** 2 for q in previous.points) <= max_offset_squared
                   for p in padded.points):
                return max((previous, padded), key=lambda item: item.get_area())
        locations.append(padded)
    return None


def _normalizer_image(sdk, photo: Image.Image, side: str):
    # ImageIO works on a metadata-free transport copy in memory.
    image_io = sdk.ImageIO()
    code, source = image_io.read_from_memory(jpeg_bytes(photo, 95))
    if code or source is None:
        raise RuntimeError("Document input unavailable")
    router = sdk.CaptureVisionRouter()
    try:
        detect = sdk.EnumPresetTemplate.PT_DETECT_DOCUMENT_BOUNDARIES.value
        normalize = sdk.EnumPresetTemplate.PT_NORMALIZE_DOCUMENT.value
        code, _, detection_settings = router.get_simplified_settings(detect)
        if code:
            raise RuntimeError("Document detection settings unavailable")
        detection_settings.timeout = 4000
        detection_settings.document_settings.min_quadrilateral_area_ratio = 20
        code, _ = router.update_settings(detect, detection_settings)
        if code:
            raise RuntimeError("Document detection settings rejected")
        width, height = photo.size
        location = _find_card(sdk, router, image_io, source, photo, detect)
        suggested = False
        if location is None and side == "back":
            location = _find_light_card(sdk, photo)
            suggested = location is not None

        lighting_sample = photo
        if location is not None:
            x = [point.x for point in location.points]
            y = [point.y for point in location.points]
            lighting_sample = photo.crop((min(x), min(y), max(x) + 1, max(y) + 1))
        luminance = lighting_sample.convert("L")
        luminance.thumbnail((320, 320))
        stats = ImageStat.Stat(luminance)
        median = stats.median[0]
        brightness = min(22, max(0, round((118 - median) / 4)))
        contrast = 10 if stats.stddev[0] < 42 else 0
        if location is None and brightness == 0 and contrast == 0:
            return b"", False, [], False

        code, _, settings = router.get_simplified_settings(normalize)
        if code:
            raise RuntimeError("Document normalization settings unavailable")
        settings.timeout = 6500
        settings.document_settings.colour_mode = sdk.EnumImageColourMode.ICM_COLOUR
        settings.document_settings.brightness = brightness
        settings.document_settings.contrast = contrast
        if location is None:
            location_full = sdk.Quadrilateral()
            location_full.points = [
                sdk.Point(0, 0), sdk.Point(width - 1, 0),
                sdk.Point(width - 1, height - 1), sdk.Point(0, height - 1),
            ]
            settings.roi = location_full
        else:
            settings.roi = location
        settings.roi_measured_in_percentage = 0
        code, _ = router.update_settings(normalize, settings)
        if code:
            raise RuntimeError("Document normalization settings rejected")
        normalized = router.capture(source, normalize)
        if normalized.get_error_code():
            raise RuntimeError("Document normalization failed")
        documents = normalized.get_processed_document_result()
        images = documents.get_enhanced_image_result_items() if documents else []
        if len(images) != 1:
            raise RuntimeError("Reading copy unavailable")
        code, encoded = image_io.save_to_memory(images[0].get_image_data(), sdk.EnumImageFileFormat.IFF_JPEG)
        if code or not encoded:
            raise RuntimeError("Reading copy encoding failed")
        ops = ["deskew_crop"] if location is not None else []
        if brightness:
            ops.append("brightness")
        if contrast:
            ops.append("contrast")
        return bytes(encoded), location is not None, ops, suggested
    finally:
        del router


def prepare_photo(data: bytes, rotation: int = 0, *, side: str = "front"):
    metadata = {
        "bypassed": True, "enhanced": False, "cropped": False, "crop_verified": False,
        "crop_status": "not_checked", "applied_ops": [], "engine": "none", "preview_data_url": "",
    }
    if not is_configured():
        return data, {**metadata, "crop_status": "normalizer_unavailable"}
    try:
        import dynamsoft_capture_vision_bundle as sdk

        if not _activate_license(sdk):
            return data, {**metadata, "crop_status": "normalizer_unavailable"}
        photo = decode_photo(data)
        photo.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        if rotation in _rotations:
            photo = photo.transpose(_rotations[rotation])
        encoded, cropped, ops, suggested = _normalizer_image(sdk, photo, side)
        if rotation in _rotations:
            ops.insert(0, f"rotate_{rotation}")
            encoded = encoded or jpeg_bytes(photo, 92)
        if not encoded:
            return data, {**metadata, "crop_status": "edges_uncertain"}
        preview = decode_photo(encoded)
        preview.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
        url = "data:image/jpeg;base64," + base64.b64encode(jpeg_bytes(preview, 90)).decode("ascii")
        return data if suggested else encoded, {
            "bypassed": False, "enhanced": True, "cropped": cropped, "crop_verified": cropped and not suggested,
            "crop_revision": 2,
            "suggested_preview_crop": suggested,
            "crop_status": "suggested_crop" if suggested else "cropped" if cropped else "edges_uncertain",
            "applied_ops": ops,
            "engine": "dynamsoft", "preview_data_url": url,
        }
    except (ImportError, RuntimeError, TypeError, AttributeError, *PHOTO_ERRORS) as error:
        _logger.warning("document_normalizer stage=prepare status=%s", type(error).__name__)
        return data, {**metadata, "crop_status": "normalizer_unavailable"}
