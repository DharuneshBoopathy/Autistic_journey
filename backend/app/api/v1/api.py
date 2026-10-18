from fastapi import APIRouter
from app.api.v1.endpoints import auth, albums, media, admin, health

api_router = APIRouter()

api_router.include_router(health.router, tags=["Health"])
api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(albums.router, prefix="/albums", tags=["Albums"])
api_router.include_router(media.router, prefix="/media", tags=["Media"])
api_router.include_router(admin.router, prefix="/admin", tags=["Administration"])
