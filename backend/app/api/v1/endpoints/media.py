import uuid
from typing import List, Optional
from datetime import datetime, timezone
import os
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.db.models import Album, Media, DeletionRequest, User
from app.schemas.album import (
    PresignedUploadRequest,
    PresignedUploadResponse,
    ConfirmUploadRequest,
    MediaResponse,
)
from app.api.deps import get_current_active_user
from app.services.s3_service import s3_service
from app.services.audit_service import audit_service
from app.core.config import settings

router = APIRouter()


@router.post("/presign-upload", response_model=PresignedUploadResponse)
def presign_upload(
    req: PresignedUploadRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Direct S3 Pre-Signed Upload Pipeline (FR-C01) with Client-Side Deduplication (FR-C03)."""
    # 1. Validate Album
    album = db.query(Album).filter(Album.id == req.album_id).first()
    if not album:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target album not found.",
        )

    # 2. Validate Size Limit
    if req.file_size_bytes > settings.MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File exceeds maximum allowed size of {settings.MAX_FILE_SIZE_BYTES // (1024*1024)}MB.",
        )

    # 3. Validate MIME type
    allowed_mimes = settings.ALLOWED_IMAGE_MIMES + settings.ALLOWED_VIDEO_MIMES
    if req.mime_type.lower() not in allowed_mimes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format: {req.mime_type}. Allowed: {', '.join(allowed_mimes)}.",
        )

    # 4. Deduplication Check (FR-C03)
    existing = db.query(Media).filter(
        Media.sha256_hash == req.sha256_hash,
        Media.is_deleted == False,
    ).first()

    if existing:
        return PresignedUploadResponse(
            upload_url="",
            original_s3_key=existing.original_s3_key,
            is_duplicate=True,
            existing_media_id=existing.id,
        )

    # 5. Generate S3 Key and Presigned Upload URL
    media_uuid = str(uuid.uuid4())
    _, ext = os.path.splitext(req.file_name)
    if not ext:
        ext = ".jpg" if req.mime_type.startswith("image/") else ".mp4"

    s3_key = s3_service.build_s3_key(
        academic_year=album.academic_year,
        album_id=album.id,
        media_uuid=media_uuid,
        ext=ext,
    )

    upload_url, headers = s3_service.generate_presigned_upload_url(
        s3_key=s3_key,
        mime_type=req.mime_type,
    )

    return PresignedUploadResponse(
        upload_url=upload_url,
        original_s3_key=s3_key,
        headers=headers,
        is_duplicate=False,
    )


@router.post("/confirm-upload", response_model=MediaResponse, status_code=status.HTTP_201_CREATED)
def confirm_upload(
    req: ConfirmUploadRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Callback after client completes direct S3 upload to record metadata in database."""
    album = db.query(Album).filter(Album.id == req.album_id).first()
    if not album:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Album not found.")

    new_media = Media(
        album_id=album.id,
        uploader_id=current_user.id,
        original_s3_key=req.original_s3_key,
        preview_s3_key=req.original_s3_key,
        thumb_s3_key=req.original_s3_key,
        file_name=req.file_name,
        mime_type=req.mime_type,
        file_size_bytes=req.file_size_bytes,
        sha256_hash=req.sha256_hash,
        width=req.width,
        height=req.height,
        duration_seconds=req.duration_seconds,
        taken_at=req.taken_at or datetime.now(timezone.utc),
    )
    db.add(new_media)
    db.commit()
    db.refresh(new_media)

    # Set as album cover if album has no cover
    if not album.cover_media_id:
        album.cover_media_id = new_media.id
        db.commit()

    audit_service.log(
        db,
        action="MEDIA_UPLOADED",
        user_id=current_user.id,
        target_entity="Media",
        target_id=new_media.id,
        details={"file_name": new_media.file_name, "album_id": album.id, "size": new_media.file_size_bytes},
    )

    thumb_url = s3_service.generate_presigned_download_url(new_media.original_s3_key)
    preview_url = s3_service.generate_presigned_download_url(new_media.original_s3_key)

    return MediaResponse(
        id=new_media.id,
        album_id=new_media.album_id,
        uploader_id=new_media.uploader_id,
        uploader_name=current_user.full_name,
        original_s3_key=new_media.original_s3_key,
        thumb_url=thumb_url,
        preview_url=preview_url,
        original_url=preview_url,
        file_name=new_media.file_name,
        mime_type=new_media.mime_type,
        file_size_bytes=new_media.file_size_bytes,
        sha256_hash=new_media.sha256_hash,
        width=new_media.width,
        height=new_media.height,
        duration_seconds=new_media.duration_seconds,
        taken_at=new_media.taken_at,
        uploaded_at=new_media.uploaded_at,
        is_deleted=new_media.is_deleted,
    )


@router.get("/album/{album_id}", response_model=List[MediaResponse])
def get_album_media(
    album_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Retrieve all active media items in an album with temporary signed delivery URLs (FR-D02)."""
    items = (
        db.query(Media)
        .filter(Media.album_id == album_id, Media.is_deleted == False)
        .order_by(Media.taken_at.desc(), Media.uploaded_at.desc())
        .all()
    )

    results = []
    for item in items:
        uploader = db.query(User).filter(User.id == item.uploader_id).first()
        uploader_name = uploader.full_name if uploader else "Batch Member"

        thumb_url = s3_service.generate_presigned_download_url(item.thumb_s3_key or item.original_s3_key)
        preview_url = s3_service.generate_presigned_download_url(item.preview_s3_key or item.original_s3_key)
        original_url = s3_service.generate_presigned_download_url(item.original_s3_key)

        results.append(
            MediaResponse(
                id=item.id,
                album_id=item.album_id,
                uploader_id=item.uploader_id,
                uploader_name=uploader_name,
                original_s3_key=item.original_s3_key,
                thumb_s3_key=item.thumb_s3_key,
                preview_s3_key=item.preview_s3_key,
                thumb_url=thumb_url,
                preview_url=preview_url,
                original_url=original_url,
                file_name=item.file_name,
                mime_type=item.mime_type,
                file_size_bytes=item.file_size_bytes,
                sha256_hash=item.sha256_hash,
                width=item.width,
                height=item.height,
                duration_seconds=item.duration_seconds,
                taken_at=item.taken_at,
                uploaded_at=item.uploaded_at,
                is_deleted=item.is_deleted,
            )
        )

    return results


@router.post("/{media_id}/delete-request", status_code=status.HTTP_202_ACCEPTED)
def request_deletion(
    media_id: str,
    reason: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Member submits a soft-deletion request for review by administrator (FR-E01)."""
    media = db.query(Media).filter(Media.id == media_id, Media.is_deleted == False).first()
    if not media:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found.")

    del_req = DeletionRequest(
        media_id=media.id,
        requested_by=current_user.id,
        reason=reason,
        status="PENDING",
    )
    db.add(del_req)
    db.commit()

    audit_service.log(
        db,
        action="MEDIA_DELETION_REQUESTED",
        user_id=current_user.id,
        target_entity="Media",
        target_id=media.id,
        details={"reason": reason},
    )

    return {"message": "Deletion request submitted for administrator review."}
