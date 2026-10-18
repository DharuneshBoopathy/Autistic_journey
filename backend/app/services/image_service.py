import io
import os
import logging
from pathlib import Path
from typing import Optional
from PIL import Image, ImageOps

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

from app.core.config import settings
from app.services.s3_service import s3_service

logger = logging.getLogger("taj_api.image_service")

# Determine cache directory
CACHE_DIR = Path(os.environ.get("THUMBNAIL_CACHE_DIR", "/opt/taj-backend/cache/thumbs"))
try:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    CACHE_DIR = Path("./cache/thumbs")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

THUMB_SIZES = {
    "thumb": (360, 360),
    "preview": (1440, 1080),
}


class ImageService:
    @staticmethod
    def get_thumbnail_path(media_id: str, size: str = "thumb") -> Path:
        target_size = size if size in THUMB_SIZES else "thumb"
        return CACHE_DIR / f"{media_id}_{target_size}.webp"

    @classmethod
    def get_or_create_thumbnail(
        cls,
        media_id: str,
        s3_key: str,
        size: str = "thumb",
    ) -> Optional[Path]:
        """Fetch image, resize, convert to WebP, cache on disk, and return file path."""
        target_size = size if size in THUMB_SIZES else "thumb"
        max_dims = THUMB_SIZES[target_size]
        cache_file = CACHE_DIR / f"{media_id}_{target_size}.webp"

        # Return immediately if cached
        if cache_file.exists() and cache_file.stat().st_size > 0:
            return cache_file

        try:
            # 1. Fetch original file from S3 or local disk
            image_bytes = None

            # Check local file if in dev
            local_candidate = Path(r"C:\Projects\insta\Instagram_Consolidated") / Path(s3_key).name
            if local_candidate.exists():
                with open(local_candidate, "rb") as f:
                    image_bytes = f.read()

            # Otherwise download from S3
            if not image_bytes and s3_service.s3_client:
                try:
                    resp = s3_service.s3_client.get_object(
                        Bucket=s3_service.bucket_name,
                        Key=s3_key,
                    )
                    image_bytes = resp["Body"].read()
                except Exception as e:
                    logger.warning(f"S3 key {s3_key} not accessible yet (sync in progress): {e}")

            if not image_bytes:
                return None

            # 2. Open image with Pillow (handles JPEG, PNG, WEBP, and HEIC via pillow_heif)
            with Image.open(io.BytesIO(image_bytes)) as img:
                # Correct EXIF orientation (crucial for phone photos)
                try:
                    img = ImageOps.exif_transpose(img)
                except Exception:
                    pass

                # Convert to RGB if needed (handling RGBA, CMYK, Palette modes)
                if img.mode in ("RGBA", "LA") and target_size == "thumb":
                    # Keep transparency or flatten if needed
                    pass
                elif img.mode != "RGB":
                    img = img.convert("RGB")

                # Thumbnail preserving aspect ratio
                img.thumbnail(max_dims, Image.Resampling.LANCZOS)

                # Save as optimized WebP
                quality = 78 if target_size == "thumb" else 84
                img.save(cache_file, "WEBP", quality=quality, method=4)

            return cache_file

        except Exception as e:
            logger.error(f"Failed to generate thumbnail for media_id={media_id}, s3_key={s3_key}: {e}")
            return None


image_service = ImageService()
