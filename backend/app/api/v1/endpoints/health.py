from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.db.session import get_db
from app.services.s3_service import s3_service
from app.core.config import settings

router = APIRouter()


@router.get("/health")
def health_check(db: Session = Depends(get_db)):
    """Health check endpoint for ECS/EC2 load balancers and orchestrators."""
    db_status = "healthy"
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        db_status = f"unhealthy: {str(e)}"

    s3_status = "configured" if s3_service.is_connected else "simulated"

    return {
        "status": "healthy" if db_status == "healthy" else "degraded",
        "database": db_status,
        "s3_storage": s3_status,
        "region": settings.AWS_REGION,
        "bucket": settings.S3_BUCKET_NAME,
        "environment": settings.ENVIRONMENT,
    }
