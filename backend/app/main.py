import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.db.session import engine, Base, SessionLocal
from app.db.models import User, Album
from app.core.security import get_password_hash
from app.api.v1.api import api_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("taj_api")


def init_db_seeds():
    """Ensure database tables and initial seed collections exist."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # Check if an admin exists
        admin = db.query(User).filter(User.email == "admin@theautisticjourney.com").first()
        if not admin:
            logger.info("Seeding initial super administrator (.com)...")
            admin_user = User(
                email="admin@theautisticjourney.com",
                hashed_password=get_password_hash("AdminPass2026!Secure"),
                full_name="Batch Administrator",
                roll_number="ADMIN001",
                batch_year="2023-2027",
                role="SUPER_ADMIN",
                status="ACTIVE",
            )
            db.add(admin_user)
            db.commit()

        admin_me = db.query(User).filter(User.email == "admin@theautisticjourney.me").first()
        if not admin_me:
            logger.info("Seeding initial super administrator (.me)...")
            admin_user_me = User(
                email="admin@theautisticjourney.me",
                hashed_password=get_password_hash("AdminPass2026!Secure"),
                full_name="Batch Administrator",
                roll_number="ADMIN002",
                batch_year="2023-2027",
                role="SUPER_ADMIN",
                status="ACTIVE",
            )
            db.add(admin_user_me)
            db.commit()

        # Seed initial standard albums if empty
        album_count = db.query(Album).count()
        if album_count == 0:
            logger.info("Seeding initial batch vault albums...")
            default_albums = [
                Album(
                    id="album-2023-first-year",
                    title="2023: The Journey Begins",
                    description="First year orientation, induction, campus exploration, and early memories (Sep - Dec 2023).",
                    academic_year="First Year",
                    category="Timeline",
                ),
                Album(
                    id="album-2024-second-year",
                    title="2024: Sophomore Chronicles",
                    description="Second year college sessions, campus life, festivals, and batch outings (Jan - Dec 2024).",
                    academic_year="Second Year",
                    category="Timeline",
                ),
                Album(
                    id="album-2025-third-year",
                    title="2025: Pre-Final Year Memories",
                    description="Third year projects, cultural fests, sports, and memorable hangouts (Jan - Dec 2025).",
                    academic_year="Third Year",
                    category="Timeline",
                ),
                Album(
                    id="album-2026-final-year",
                    title="2026: Senior Year Milestones",
                    description="Final year countdown, senior fest celebrations, campus farewell moments, and legacy (Jan - Aug 2026).",
                    academic_year="Final Year",
                    category="Timeline",
                ),
            ]
            db.add_all(default_albums)
            db.commit()
            logger.info(f"Seeded {len(default_albums)} initial vault albums.")
    except Exception as e:
        logger.error(f"Error during db initialization: {e}")
        db.rollback()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing The Autistic Journey API...")
    init_db_seeds()
    yield
    logger.info("Shutting down API...")


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    openapi_url=f"{settings.API_V1_STR}/openapi.json" if settings.DEBUG else None,
    docs_url=f"{settings.API_V1_STR}/docs" if settings.DEBUG else None,
    redoc_url=None,
    lifespan=lifespan,
)

# CORS Middleware (Locking down origins in production with localhost dynamic port support)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# Include API Router
app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/", tags=["Root"])
def root_status():
    return {
        "status": "online",
        "app": settings.PROJECT_NAME,
        "version": "1.0.0",
        "api_v1_prefix": settings.API_V1_STR,
        "health_check": "/health",
        "frontend_gallery": "https://gallery.theautisticjourney.me",
    }


@app.get(settings.API_V1_STR, tags=["Root"])
def api_v1_root():
    return {
        "status": "online",
        "version": "v1",
        "endpoints": {
            "auth": f"{settings.API_V1_STR}/auth",
            "albums": f"{settings.API_V1_STR}/albums",
            "media": f"{settings.API_V1_STR}/media",
            "admin": f"{settings.API_V1_STR}/admin",
        },
    }


@app.get("/health", tags=["Health"])
def root_health():
    """Root health check for AWS ALB / Target Groups."""
    return {"status": "ok", "app": settings.PROJECT_NAME}
