import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    String,
    Boolean,
    Integer,
    BigInteger,
    DateTime,
    ForeignKey,
    Text,
)
from sqlalchemy.orm import relationship
from app.db.session import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(150), nullable=False)
    roll_number = Column(String(50), unique=True, nullable=True, index=True)
    batch_year = Column(String(20), nullable=False, default="2023-2027")
    gender = Column(String(20), nullable=True)
    role = Column(String(30), nullable=False, default="MEMBER")  # SUPER_ADMIN, MODERATOR, MEMBER, READ_ONLY
    status = Column(String(30), nullable=False, default="PENDING_APPROVAL")  # PENDING_APPROVAL, ACTIVE, SUSPENDED
    avatar_url = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    albums = relationship("Album", back_populates="creator")
    media_items = relationship("Media", back_populates="uploader", foreign_keys="[Media.uploader_id]")


class Album(Base):
    __tablename__ = "albums"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    title = Column(String(200), nullable=False, index=True)
    description = Column(Text, nullable=True)
    academic_year = Column(String(50), nullable=False, index=True)  # First Year, Second Year, Third Year, Final Year
    category = Column(String(100), nullable=False, index=True)  # Symposium, Induction, Trips, Hostel, Sports, Culturals, etc.
    event_date = Column(DateTime(timezone=True), nullable=True)
    cover_media_id = Column(String(36), nullable=True)
    cover_url = Column(String(500), nullable=True)
    visibility_scope = Column(String(30), nullable=False, default="BATCH_WIDE")
    created_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    is_archived = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    creator = relationship("User", back_populates="albums")
    media_items = relationship("Media", back_populates="album", cascade="all, delete-orphan")


class Media(Base):
    __tablename__ = "media"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    album_id = Column(String(36), ForeignKey("albums.id", ondelete="CASCADE"), nullable=False, index=True)
    uploader_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    original_s3_key = Column(String(500), nullable=False)
    preview_s3_key = Column(String(500), nullable=True)
    thumb_s3_key = Column(String(500), nullable=True)
    file_name = Column(String(255), nullable=False)
    mime_type = Column(String(100), nullable=False)
    file_size_bytes = Column(BigInteger, nullable=False)
    sha256_hash = Column(String(64), nullable=False, index=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    taken_at = Column(DateTime(timezone=True), nullable=True, index=True)
    uploaded_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    visibility_override = Column(String(30), default="INHERIT")
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    album = relationship("Album", back_populates="media_items")
    uploader = relationship("User", back_populates="media_items", foreign_keys=[uploader_id])


class DeletionRequest(Base):
    __tablename__ = "deletion_requests"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    media_id = Column(String(36), ForeignKey("media.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_by = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reason = Column(Text, nullable=True)
    status = Column(String(30), default="PENDING")  # PENDING, APPROVED, REJECTED
    reviewed_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action = Column(String(100), nullable=False, index=True)
    target_entity = Column(String(50), nullable=True)
    target_id = Column(String(100), nullable=True)
    details = Column(Text, nullable=True)
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(Text, nullable=True)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
