from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class AlbumBase(BaseModel):
    title: str
    description: Optional[str] = None
    academic_year: str  # First Year, Second Year, Third Year, Final Year
    category: str  # Symposium, Induction, Trips, Hostel, Sports, Culturals, etc.
    event_date: Optional[datetime] = None
    visibility_scope: str = "BATCH_WIDE"


class AlbumCreate(AlbumBase):
    pass


class AlbumUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    academic_year: Optional[str] = None
    category: Optional[str] = None
    event_date: Optional[datetime] = None
    visibility_scope: Optional[str] = None
    cover_media_id: Optional[str] = None


class AlbumResponse(AlbumBase):
    id: str
    cover_media_id: Optional[str] = None
    cover_url: Optional[str] = None
    created_by: Optional[str] = None
    is_archived: bool = False
    created_at: datetime
    media_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class PresignedUploadRequest(BaseModel):
    album_id: str
    file_name: str
    file_size_bytes: int
    mime_type: str
    sha256_hash: str


class PresignedUploadResponse(BaseModel):
    upload_url: str
    original_s3_key: str
    fields: Optional[dict] = None
    headers: Optional[dict] = None
    is_duplicate: bool = False
    existing_media_id: Optional[str] = None


class ConfirmUploadRequest(BaseModel):
    album_id: str
    original_s3_key: str
    file_name: str
    mime_type: str
    file_size_bytes: int
    sha256_hash: str
    width: Optional[int] = None
    height: Optional[int] = None
    duration_seconds: Optional[int] = None
    taken_at: Optional[datetime] = None


class MediaResponse(BaseModel):
    id: str
    album_id: str
    uploader_id: Optional[str] = None
    uploader_name: Optional[str] = None
    original_s3_key: str
    preview_s3_key: Optional[str] = None
    thumb_s3_key: Optional[str] = None
    thumb_url: Optional[str] = None
    preview_url: Optional[str] = None
    original_url: Optional[str] = None
    file_name: str
    mime_type: str
    file_size_bytes: int
    sha256_hash: str
    width: Optional[int] = None
    height: Optional[int] = None
    duration_seconds: Optional[int] = None
    taken_at: Optional[datetime] = None
    uploaded_at: datetime
    is_deleted: bool = False

    model_config = ConfigDict(from_attributes=True)
