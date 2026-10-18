import json
from typing import Optional, Any
from sqlalchemy.orm import Session
from app.db.models import AuditLog


class AuditService:
    @staticmethod
    def log(
        db: Session,
        action: str,
        user_id: Optional[str] = None,
        target_entity: Optional[str] = None,
        target_id: Optional[str] = None,
        details: Optional[Any] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> AuditLog:
        details_str = json.dumps(details) if details and not isinstance(details, str) else details
        entry = AuditLog(
            user_id=user_id,
            action=action,
            target_entity=target_entity,
            target_id=str(target_id) if target_id else None,
            details=details_str,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return entry


audit_service = AuditService()
