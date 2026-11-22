"""Prepare separate ID reading copies with Dynamsoft Document Normalizer."""

import base64
import logging
from os import getenv
from threading import Lock
from time import monotonic

from PIL import Image, ImageStat

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


def _padded_quad(sdk, quad, width: int, height: int):
    points = list(quad.points)
    margin = max(2, round(min(width, height) * 0.015))
    if len(points) != 4 or quad.get_area() < width * height * 0.18:
        return None
    center_x = sum(point.x for point in points) / 4
    center_y = sum(point.y for point in points) / 4
    padded = [
        sdk.Point(round(center_x + (point.x - center_x) * 1.08), round(center_y + (point.y - center_y) * 1.08))
        for point in points
    ]
    if any(not (margin <= point.x < width - margin and margin <= point.y < height - margin) for point in padded):
        return None
    result = sdk.Quadrilateral()
    result.points = padded
    return result


def _normalizer_image(sdk, photo: Image.Image):
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
        detection_settings.timeout = 6500
        detection_settings.document_settings.min_quadrilateral_area_ratio = 20
        code, _ = router.update_settings(detect, detection_settings)
        if code:
            raise RuntimeError("Document detection settings rejected")
        detected = router.capture(source, detect)
        if detected.get_error_code():
            raise RuntimeError("Document detection failed")
        documents = detected.get_processed_document_result()
        quads = documents.get_detected_quad_result_items() if documents else []
        width, height = photo.size
        location = _padded_quad(sdk, quads[0].get_location(), width, height) if len(quads) == 1 else None

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
            return b"", False, []

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
        return bytes(encoded), location is not None, ops
    finally:
        del router


def prepare_photo(data: bytes, rotation: int = 0):
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
        encoded, cropped, ops = _normalizer_image(sdk, photo)
        if rotation in _rotations:
            ops.insert(0, f"rotate_{rotation}")
            encoded = encoded or jpeg_bytes(photo, 92)
        if not encoded:
            return data, {**metadata, "crop_status": "edges_uncertain"}
        preview = decode_photo(encoded)
        preview.thumbnail((960, 960), Image.Resampling.LANCZOS)
        url = "data:image/jpeg;base64," + base64.b64encode(jpeg_bytes(preview, 86)).decode("ascii")
        return encoded, {
            "bypassed": False, "enhanced": True, "cropped": cropped, "crop_verified": cropped,
            "crop_status": "cropped" if cropped else "edges_uncertain", "applied_ops": ops,
            "engine": "dynamsoft", "preview_data_url": url,
        }
    except (ImportError, RuntimeError, TypeError, AttributeError, *PHOTO_ERRORS) as error:
        _logger.warning("document_normalizer stage=prepare status=%s", type(error).__name__)
        return data, {**metadata, "crop_status": "normalizer_unavailable"}
