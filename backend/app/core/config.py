import json
from typing import List, Union
from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "The Autistic Journey API"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    API_V1_STR: str = "/api/v1"

    # Security
    SECRET_KEY: str = "taj-insecure-dev-secret-key-change-in-production-only-min-32-chars"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:8000",
        "http://localhost:8080",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000",
        "https://theautisticjourney.com",
        "https://api.theautisticjourney.com",
        "https://theautisticjourney.me",
        "https://gallery.theautisticjourney.me",
        "https://api.theautisticjourney.me",
    ]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return parsed
            except Exception:
                return [i.strip() for i in v.split(",") if i.strip()]
        return v

    # Database
    DATABASE_URL: str = "sqlite:///./taj_dev.db"

    # AWS S3
    AWS_REGION: str = "ap-south-1"
    S3_BUCKET_NAME: str = "the-autistic-journey-vault-ap-south-1"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    S3_PRESIGNED_EXPIRY_SECONDS: int = 900  # 15 minutes (FR-D02)
    CLOUDFRONT_DOMAIN: str = ""

    # Media limits
    MAX_FILE_SIZE_BYTES: int = 500 * 1024 * 1024  # 500 MB
    ALLOWED_IMAGE_MIMES: List[str] = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
    ]
    ALLOWED_VIDEO_MIMES: List[str] = [
        "video/mp4",
        "video/quicktime",
    ]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()
