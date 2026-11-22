from io import BytesIO

from PIL import Image, ImageOps


PHOTO_ERRORS = (OSError, ValueError, Image.DecompressionBombError)


def decode_photo(data: bytes) -> Image.Image:
    with Image.open(BytesIO(data)) as source:
        return ImageOps.exif_transpose(source).convert("RGB")


def jpeg_bytes(image: Image.Image, quality: int) -> bytes:
    output = BytesIO()
    image.save(output, format="JPEG", quality=quality)
    return output.getvalue()
