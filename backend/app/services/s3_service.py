import logging
from typing import Optional, Tuple
from datetime import datetime, timezone
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError, NoCredentialsError
from app.core.config import settings

logger = logging.getLogger(__name__)


class S3Service:
    def __init__(self):
        self.bucket_name = settings.S3_BUCKET_NAME
        self.region = settings.AWS_REGION
        self.expiry_seconds = settings.S3_PRESIGNED_EXPIRY_SECONDS

        boto_config = Config(
            region_name=self.region,
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
        )

        client_kwargs = {
            "service_name": "s3",
            "region_name": self.region,
            "config": boto_config,
        }

        if settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY:
            client_kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
            client_kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY

        try:
            self.s3_client = boto3.client(**client_kwargs)
            self.is_connected = True
        except Exception as e:
            logger.warning(f"S3 client initialization failed: {e}. Falling back to simulated storage.")
            self.s3_client = None
            self.is_connected = False

    def generate_presigned_upload_url(
        self,
        s3_key: str,
        mime_type: str,
    ) -> Tuple[str, dict]:
        """Generate a single-use presigned PUT URL for direct client upload to S3."""
        headers = {"Content-Type": mime_type}

        if self.s3_client:
            try:
                url = self.s3_client.generate_presigned_url(
                    ClientMethod="put_object",
                    Params={
                        "Bucket": self.bucket_name,
                        "Key": s3_key,
                        "ContentType": mime_type,
                    },
                    ExpiresIn=self.expiry_seconds,
                )
                return url, headers
            except (ClientError, NoCredentialsError) as e:
                logger.warning(f"Using fallback upload URL due to AWS credentials: {e}")

        # Fallback for local testing when AWS credentials are not yet active
        fallback_url = f"https://{self.bucket_name}.s3.{self.region}.amazonaws.com/{s3_key}"
        return fallback_url, headers

    def generate_presigned_download_url(
        self,
        s3_key: Optional[str],
        expiry_seconds: Optional[int] = None,
    ) -> Optional[str]:
        """Generate a secure, short-lived presigned GET URL for media access (FR-D02)."""
        if not s3_key:
            return None

        # If CloudFront is configured and media is in public/CDN distribution
        if settings.CLOUDFRONT_DOMAIN:
            return f"https://{settings.CLOUDFRONT_DOMAIN}/{s3_key}"

        if self.s3_client:
            try:
                url = self.s3_client.generate_presigned_url(
                    ClientMethod="get_object",
                    Params={
                        "Bucket": self.bucket_name,
                        "Key": s3_key,
                    },
                    ExpiresIn=expiry_seconds or self.expiry_seconds,
                )
                return url
            except (ClientError, NoCredentialsError) as e:
                logger.warning(f"Using fallback download URL due to AWS credentials: {e}")

        # Fallback URL format
        return f"https://{self.bucket_name}.s3.{self.region}.amazonaws.com/{s3_key}"

    def build_s3_key(
        self,
        academic_year: str,
        album_id: str,
        media_uuid: str,
        ext: str,
    ) -> str:
        """S3 Key hierarchy matching PRD Section 5.1."""
        year_slug = academic_year.lower().replace(" ", "-")
        clean_ext = ext.lstrip(".")
        return f"originals/{year_slug}/{album_id}/{media_uuid}.{clean_ext}"


s3_service = S3Service()
