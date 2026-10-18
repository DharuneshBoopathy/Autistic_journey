from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.db.models import User
from app.schemas.auth import UserCreate, UserLogin, UserResponse, Token, TokenRefreshRequest
from app.core.security import verify_password, get_password_hash, create_access_token, create_refresh_token, decode_token
from app.services.audit_service import audit_service
from app.api.deps import get_current_user


router = APIRouter()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(
    user_in: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    """Admin-Gated Registration (FR-A01, FR-A02). Account starts in PENDING_APPROVAL status."""
    existing_email = db.query(User).filter(User.email == user_in.email.lower()).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email address already exists.",
        )

    if user_in.roll_number:
        existing_roll = db.query(User).filter(User.roll_number == user_in.roll_number.upper()).first()
        if existing_roll:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A user with this roll number already exists.",
            )

    new_user = User(
        email=user_in.email.lower(),
        hashed_password=get_password_hash(user_in.password),
        full_name=user_in.full_name.strip(),
        roll_number=user_in.roll_number.upper() if user_in.roll_number else None,
        batch_year=user_in.batch_year,
        gender=user_in.gender,
        role="MEMBER",
        status="PENDING_APPROVAL",
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    audit_service.log(
        db,
        action="USER_REGISTERED",
        user_id=new_user.id,
        target_entity="User",
        target_id=new_user.id,
        details={"email": new_user.email, "fullName": new_user.full_name},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return new_user


@router.post("/login", response_model=Token)
def login(
    login_in: UserLogin,
    request: Request,
    db: Session = Depends(get_db),
):
    """Authenticate with email and password (FR-A03). Returns JWT access and refresh tokens."""
    user = db.query(User).filter(User.email == login_in.email.lower()).first()
    if not user or not verify_password(login_in.password, user.hashed_password):
        audit_service.log(
            db,
            action="AUTH_LOGIN_FAILED",
            target_entity="User",
            details={"attempted_email": login_in.email},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials. Please verify your email and password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.status == "PENDING_APPROVAL":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is awaiting administrator approval. Please wait for an admin to verify your registration.",
        )

    if user.status == "SUSPENDED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been suspended.",
        )

    access_token = create_access_token(subject=user.id)
    refresh_token = create_refresh_token(subject=user.id)

    audit_service.log(
        db,
        action="AUTH_LOGIN_SUCCESS",
        user_id=user.id,
        target_entity="User",
        target_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        user=user,
    )


@router.get("/me", response_model=UserResponse)
def get_me(
    current_user: User = Depends(get_current_user),
):
    """Get current authenticated user profile."""
    return current_user


@router.post("/refresh", response_model=Token)
def refresh_token_endpoint(
    refresh_in: TokenRefreshRequest,
    db: Session = Depends(get_db),
):
    """Renew access token using valid refresh token (FR-A03)."""
    payload = decode_token(refresh_in.refresh_token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is not a refresh token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
        )
    if user.status == "SUSPENDED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been suspended.",
        )
    if user.status == "PENDING_APPROVAL":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is awaiting administrator approval.",
        )

    new_access_token = create_access_token(subject=user.id)
    new_refresh_token = create_refresh_token(subject=user.id)

    return Token(
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        user=user,
    )

