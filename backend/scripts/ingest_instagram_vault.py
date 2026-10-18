"""Ingestion script for The Autistic Journey consolidated Instagram media vault.

Scans C:\\Projects\\insta\\Instagram_Consolidated, registers all photos and videos
into the production SQLite database, associates them with chronological Timeline albums,
and prepares the S3 media keys.
"""

import os
import re
import sys
import uuid
import hashlib
from datetime import datetime, timezone
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from app.db.session import engine, SessionLocal, Base
from app.db.models import User, Album, Media
from app.core.security import get_password_hash

SOURCE_DIR = Path(r"C:\Projects\insta\Instagram_Consolidated")

MIME_MAP = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".mp4": "video/mp4",
    ".dng": "image/x-adobe-dng",
}

ALBUMS_CONFIG = [
    {
        "id": "album-2023-first-year",
        "title": "2023: The Journey Begins",
        "description": "First year orientation, induction, campus exploration, and early memories (Sep - Dec 2023).",
        "academic_year": "First Year",
        "category": "Timeline",
        "year": 2023,
    },
    {
        "id": "album-2024-second-year",
        "title": "2024: Sophomore Chronicles",
        "description": "Second year college sessions, campus life, festivals, and batch outings (Jan - Dec 2024).",
        "academic_year": "Second Year",
        "category": "Timeline",
        "year": 2024,
    },
    {
        "id": "album-2025-third-year",
        "title": "2025: Pre-Final Year Memories",
        "description": "Third year projects, cultural fests, sports, and memorable hangouts (Jan - Dec 2025).",
        "academic_year": "Third Year",
        "category": "Timeline",
        "year": 2025,
    },
    {
        "id": "album-2026-final-year",
        "title": "2026: Senior Year Milestones",
        "description": "Final year countdown, senior fest celebrations, campus farewell moments, and legacy (Jan - Aug 2026).",
        "academic_year": "Final Year",
        "category": "Timeline",
        "year": 2026,
    },
]


def fast_file_sha256(filepath: Path) -> str:
    """Compute SHA-256 for media identity."""
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        # Read in 1MB chunks
        while chunk := f.read(1048576):
            hasher.update(chunk)
    return hasher.hexdigest()


def parse_media_date(filename: str) -> datetime:
    """Extract captured timestamp from filename pattern (e.g. 000001__2023-09-05_091849.251...)."""
    match = re.search(r"(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})", filename)
    if match:
        year, month, day, hour, minute, second = map(int, match.groups())
        try:
            return datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)
        except ValueError:
            pass
    # Fallback to date without time
    date_match = re.search(r"(\d{4})-(\d{2})-(\d{2})", filename)
    if date_match:
        year, month, day = map(int, date_match.groups())
        try:
            return datetime(year, month, day, 12, 0, 0, tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def main():
    if not SOURCE_DIR.exists():
        print(f"Error: Source directory {SOURCE_DIR} does not exist!")
        return

    print("Initializing database tables...")
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        # Ensure Super Admin exists
        admin = db.query(User).filter(User.role == "SUPER_ADMIN").first()
        if not admin:
            admin = User(
                email="admin@theautisticjourney.com",
                hashed_password=get_password_hash("AdminPass2026!Secure"),
                full_name="Batch Administrator",
                roll_number="ADMIN001",
                batch_year="2023-2027",
                role="SUPER_ADMIN",
                status="ACTIVE",
            )
            db.add(admin)
            db.commit()

        admin_me = db.query(User).filter(User.email == "admin@theautisticjourney.me").first()
        if not admin_me:
            admin_me = User(
                email="admin@theautisticjourney.me",
                hashed_password=get_password_hash("AdminPass2026!Secure"),
                full_name="Batch Administrator",
                roll_number="ADMIN002",
                batch_year="2023-2027",
                role="SUPER_ADMIN",
                status="ACTIVE",
            )
            db.add(admin_me)
            db.commit()
            print("Created Super Admin users.")

        # Clear old dummy media items and albums to fulfill user request:
        # 'remove the images and update the db/ storage with images and videos from C:\Projects\insta\Instagram_Consolidated'
        # 'also remove the hardcoded groups like department,farewell,etc'
        print("Clearing old legacy albums and media entries...")
        db.query(Media).delete()
        db.query(Album).delete()
        db.commit()

        # Create the 4 Master Timeline Albums
        album_map = {}
        for cfg in ALBUMS_CONFIG:
            album = Album(
                id=cfg["id"],
                title=cfg["title"],
                description=cfg["description"],
                academic_year=cfg["academic_year"],
                category=cfg["category"],
                visibility_scope="BATCH_WIDE",
                created_by=admin.id,
            )
            db.add(album)
            album_map[cfg["year"]] = album
        db.commit()
        print(f"Created {len(ALBUMS_CONFIG)} clean Timeline albums.")

        # Scan all consolidated files
        print(f"Scanning media files from {SOURCE_DIR}...")
        all_files = sorted(os.listdir(SOURCE_DIR))
        print(f"Found {len(all_files)} total files.")

        media_records = []
        album_covers = {}

        for idx, filename in enumerate(all_files):
            file_path = SOURCE_DIR / filename
            if not file_path.is_file():
                continue

            ext = file_path.suffix.lower()
            mime_type = MIME_MAP.get(ext, "application/octet-stream")
            file_size = file_path.stat().st_size
            taken_at = parse_media_date(filename)
            year = taken_at.year

            # Select target album by year
            target_album = album_map.get(year, album_map[2026])

            # Generate S3 key
            s3_key = f"media/{filename}"

            # Compute fast hash based on filename and size for rapid ingestion
            # (or full SHA256 if needed)
            sha_hash = hashlib.sha256(f"{filename}-{file_size}".encode()).hexdigest()

            media_id = str(uuid.uuid4())
            is_video = ext == ".mp4"

            media_item = Media(
                id=media_id,
                album_id=target_album.id,
                uploader_id=admin.id,
                original_s3_key=s3_key,
                preview_s3_key=s3_key,
                thumb_s3_key=s3_key,
                file_name=filename,
                mime_type=mime_type,
                file_size_bytes=file_size,
                sha256_hash=sha_hash,
                taken_at=taken_at,
                uploaded_at=taken_at,
                visibility_override="INHERIT",
                is_deleted=False,
            )
            media_records.append(media_item)

            # Pick the first non-video photo as the album cover
            if not is_video and target_album.id not in album_covers:
                album_covers[target_album.id] = media_id

            if (idx + 1) % 500 == 0 or idx == len(all_files) - 1:
                print(f"Processed {idx + 1}/{len(all_files)} media items...")

        # Bulk save media
        print(f"Saving {len(media_records)} media items into database...")
        db.bulk_save_objects(media_records)
        db.commit()

        # Update album cover media IDs
        for album_id, cover_id in album_covers.items():
            db.query(Album).filter(Album.id == album_id).update({"cover_media_id": cover_id})
        db.commit()

        print("=== INGESTION SUCCESSFUL ===")
        for cfg in ALBUMS_CONFIG:
            count = db.query(Media).filter(Media.album_id == cfg["id"]).count()
            videos = db.query(Media).filter(Media.album_id == cfg["id"], Media.mime_type == "video/mp4").count()
            photos = count - videos
            print(f"- {cfg['title']} [{cfg['academic_year']}]: {count} total ({photos} photos, {videos} videos)")

        total_in_db = db.query(Media).count()
        print(f"Total media items in database: {total_in_db}")

    except Exception as e:
        print(f"Error during ingestion: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
