from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.session import get_db
from app.db.models import Album, Media, User
from app.schemas.album import AlbumCreate, AlbumResponse, AlbumUpdate
from app.api.deps import get_current_active_user
from app.services.s3_service import s3_service
from app.services.audit_service import audit_service

router = APIRouter()


@router.get("", response_model=List[AlbumResponse])
def get_albums(
    academic_year: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all batch albums with optional academic year and category filtering."""
    query = db.query(Album).filter(Album.is_archived == False)

    if academic_year and academic_year != "All":
        query = query.filter(Album.academic_year == academic_year)
    if category and category != "All":
        query = query.filter(Album.category == category)

    albums = query.order_by(Album.created_at.desc()).all()

    results = []
    for alb in albums:
        count = (
            db.query(func.count(Media.id))
            .filter(Media.album_id == alb.id, Media.is_deleted == False)
            .scalar()
            or 0
        )

        cover_url = alb.cover_url
        if not cover_url and alb.cover_media_id:
            cover_media = db.query(Media).filter(Media.id == alb.cover_media_id).first()
            if cover_media:
                cover_url = s3_service.generate_presigned_download_url(
                    cover_media.thumb_s3_key or cover_media.preview_s3_key or cover_media.original_s3_key
                )

        resp = AlbumResponse(
            id=alb.id,
            title=alb.title,
            description=alb.description,
            academic_year=alb.academic_year,
            category=alb.category,
            event_date=alb.event_date,
            cover_media_id=alb.cover_media_id,
            cover_url=cover_url,
            visibility_scope=alb.visibility_scope,
            created_by=alb.created_by,
            is_archived=alb.is_archived,
            created_at=alb.created_at,
            media_count=count,
        )
        results.append(resp)

    return results


@router.post("", response_model=AlbumResponse, status_code=status.HTTP_201_CREATED)
def create_album(
    album_in: AlbumCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new batch memory vault album."""
    new_album = Album(
        title=album_in.title.strip(),
        description=album_in.description.strip() if album_in.description else None,
        academic_year=album_in.academic_year,
        category=album_in.category,
        event_date=album_in.event_date,
        visibility_scope=album_in.visibility_scope,
        created_by=current_user.id,
    )
    db.add(new_album)
    db.commit()
    db.refresh(new_album)

    audit_service.log(
        db,
        action="ALBUM_CREATED",
        user_id=current_user.id,
        target_entity="Album",
        target_id=new_album.id,
        details={"title": new_album.title, "academic_year": new_album.academic_year},
    )

    return AlbumResponse(
        id=new_album.id,
        title=new_album.title,
        description=new_album.description,
        academic_year=new_album.academic_year,
        category=new_album.category,
        event_date=new_album.event_date,
        cover_media_id=None,
        cover_url=None,
        visibility_scope=new_album.visibility_scope,
        created_by=new_album.created_by,
        is_archived=new_album.is_archived,
        created_at=new_album.created_at,
        media_count=0,
    )


@router.get("/{album_id}", response_model=AlbumResponse)
def get_album_by_id(
    album_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get single album details."""
    album = db.query(Album).filter(Album.id == album_id).first()
    if not album:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Album not found.",
        )
    count = (
        db.query(func.count(Media.id))
        .filter(Media.album_id == album.id, Media.is_deleted == False)
        .scalar()
        or 0
    )
    return AlbumResponse(
        id=album.id,
        title=album.title,
        description=album.description,
        academic_year=album.academic_year,
        category=album.category,
        event_date=album.event_date,
        cover_media_id=album.cover_media_id,
        cover_url=album.cover_url,
        visibility_scope=album.visibility_scope,
        created_by=album.created_by,
        is_archived=album.is_archived,
        created_at=album.created_at,
        media_count=count,
    )
