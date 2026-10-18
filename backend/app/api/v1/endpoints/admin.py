from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.session import get_db
from app.db.models import User, Album, Media, AuditLog, DeletionRequest
from app.schemas.auth import UserResponse
from app.api.deps import get_current_admin
from app.services.audit_service import audit_service
from app.core.config import settings

router = APIRouter()


@router.get("/pending-users", response_model=List[UserResponse])
def get_pending_users(
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin),
):
    """Retrieve all student accounts awaiting approval (FR-M01)."""
    return (
        db.query(User)
        .filter(User.status == "PENDING_APPROVAL")
        .order_by(User.created_at.asc())
        .all()
    )


@router.post("/users/{user_id}/approve", response_model=UserResponse)
def approve_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin),
):
    """Administrator approves pending user account (FR-M01)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    user.status = "ACTIVE"
    db.commit()
    db.refresh(user)

    audit_service.log(
        db,
        action="USER_APPROVED",
        user_id=admin_user.id,
        target_entity="User",
        target_id=user.id,
        details={"approved_user": user.full_name, "email": user.email, "admin": admin_user.full_name},
    )

    return user


@router.post("/users/{user_id}/reject")
def reject_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin),
):
    """Administrator rejects pending registration (FR-M01)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    email = user.email
    full_name = user.full_name
    db.delete(user)
    db.commit()

    audit_service.log(
        db,
        action="USER_REJECTED",
        user_id=admin_user.id,
        target_entity="User",
        target_id=user_id,
        details={"rejected_user": full_name, "email": email, "admin": admin_user.full_name},
    )

    return {"message": f"Registration for {full_name} ({email}) has been rejected."}


@router.get("/users", response_model=List[UserResponse])
def get_all_users(
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin),
):
    """Retrieve full batch member directory."""
    return db.query(User).order_by(User.created_at.desc()).all()


@router.get("/audit-logs")
def get_audit_logs(
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin),
):
    """Retrieve immutable audit ledger records (FR-E03)."""
    logs = (
        db.query(AuditLog)
        .order_by(AuditLog.timestamp.desc())
        .limit(limit)
        .all()
    )
    results = []
    for l in logs:
        actor = "System Kernel"
        if l.user_id:
            u = db.query(User).filter(User.id == l.user_id).first()
            if u:
                actor = u.full_name
        results.append(
            {
                "id": l.id,
                "action": l.action,
                "actor": actor,
                "target": f"{l.target_entity or ''} {l.target_id or ''}".strip(),
                "time": l.timestamp.isoformat(),
                "status": "SUCCESS",
            }
        )
    return results


@router.get("/telemetry")
def get_telemetry(
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin),
):
    """Retrieve real-time S3 storage consumption and vault metrics (FR-M04)."""
    total_bytes = (
        db.query(func.sum(Media.file_size_bytes))
        .filter(Media.is_deleted == False)
        .scalar()
        or 0
    )
    total_media = (
        db.query(func.count(Media.id))
        .filter(Media.is_deleted == False)
        .scalar()
        or 0
    )
    total_albums = db.query(func.count(Album.id)).filter(Album.is_archived == False).scalar() or 0
    total_users = db.query(func.count(User.id)).filter(User.status == "ACTIVE").scalar() or 0
    pending_users = db.query(func.count(User.id)).filter(User.status == "PENDING_APPROVAL").scalar() or 0

    return {
        "storage_bucket": settings.S3_BUCKET_NAME,
        "region": settings.AWS_REGION,
        "total_bytes_stored": total_bytes,
        "total_media_count": total_media,
        "total_albums_count": total_albums,
        "active_users_count": total_users,
        "pending_users_count": pending_users,
        "max_capacity_gb": 400,
        "percent_utilized": round((total_bytes / (400 * 1024 * 1024 * 1024)) * 100, 2),
    }
