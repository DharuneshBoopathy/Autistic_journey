import pytest
from fastapi.testclient import TestClient
from app.main import app, init_db_seeds
from app.db.session import engine, Base

client = TestClient(app)


@pytest.fixture(scope="module", autouse=True)
def setup_test_db():
    Base.metadata.create_all(bind=engine)
    init_db_seeds()
    yield


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_api_health_endpoint():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["healthy", "degraded"]
    assert "s3_storage" in data


def test_registration_flow():
    # FR-A01: Student registration
    reg_payload = {
        "email": "teststudent@theautisticjourney.com",
        "password": "StudentPassword123!",
        "full_name": "Test Student",
        "roll_number": "23CS999",
        "batch_year": "2023-2027",
        "gender": "Male",
    }
    response = client.post("/api/v1/auth/register", json=reg_payload)
    # Could be 201 or 400 if already exists in local test run
    if response.status_code == 201:
        data = response.json()
        assert data["email"] == "teststudent@theautisticjourney.com"
        assert data["status"] == "PENDING_APPROVAL"  # FR-A02

        # FR-A02: Login before approval should fail
        login_res = client.post(
            "/api/v1/auth/login",
            json={
                "email": "teststudent@theautisticjourney.com",
                "password": "StudentPassword123!",
            },
        )
        assert login_res.status_code == 403
        assert "awaiting administrator approval" in login_res.json()["detail"].lower()


def test_admin_login():
    # Admin was seeded in init_db_seeds
    login_res = client.post(
        "/api/v1/auth/login",
        json={
            "email": "admin@theautisticjourney.com",
            "password": "AdminPass2026!Secure",
        },
    )
    assert login_res.status_code == 200
    token_data = login_res.json()
    assert "access_token" in token_data
    assert token_data["user"]["role"] == "SUPER_ADMIN"


def test_albums_endpoint():
    login_res = client.post(
        "/api/v1/auth/login",
        json={
            "email": "admin@theautisticjourney.com",
            "password": "AdminPass2026!Secure",
        },
    )
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/v1/albums", headers=headers)
    assert res.status_code == 200
    albums = res.json()
    assert isinstance(albums, list)
    assert len(albums) > 0


def test_presign_upload_endpoint():
    login_res = client.post(
        "/api/v1/auth/login",
        json={
            "email": "admin@theautisticjourney.com",
            "password": "AdminPass2026!Secure",
        },
    )
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    albums = client.get("/api/v1/albums", headers=headers).json()
    album_id = albums[0]["id"]

    presign_req = {
        "album_id": album_id,
        "file_name": "test_photo.jpg",
        "file_size_bytes": 1024 * 1024 * 2,  # 2MB
        "mime_type": "image/jpeg",
        "sha256_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    }
    res = client.post("/api/v1/media/presign-upload", json=presign_req, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "upload_url" in data
    assert "original_s3_key" in data


def test_refresh_token_flow():
    # Login to get initial refresh token
    login_res = client.post(
        "/api/v1/auth/login",
        json={
            "email": "admin@theautisticjourney.com",
            "password": "AdminPass2026!Secure",
        },
    )
    assert login_res.status_code == 200
    initial_refresh = login_res.json()["refresh_token"]

    # Exchange refresh token for new access & refresh token pair
    refresh_res = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": initial_refresh},
    )
    assert refresh_res.status_code == 200
    data = refresh_res.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["user"]["email"] == "admin@theautisticjourney.com"

    # Verify the new access token can query /auth/me
    me_res = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {data['access_token']}"},
    )
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "admin@theautisticjourney.com"

