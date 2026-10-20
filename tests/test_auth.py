from conftest import guest


def test_guest_refresh_rotation_and_logout(client):
    data, headers = guest(client)
    assert data["user"]["is_guest"] is True
    assert "refresh_token" not in data
    cookie = client.cookies.get("refresh_token")
    assert cookie
    response = client.post("/api/v1/auth/refresh")
    assert response.status_code == 200
    assert client.cookies.get("refresh_token") != cookie
    # A consumed refresh token cannot be used twice.
    assert client.post("/api/v1/auth/refresh", headers={"Cookie": f"refresh_token={cookie}"}).status_code == 401
    current_cookie = client.cookies.get("refresh_token")
    client.post("/api/v1/auth/logout")
    assert client.post("/api/v1/auth/refresh", headers={"Cookie": f"refresh_token={current_cookie}"}).status_code == 401
    assert client.get("/api/v1/auth/me", headers=headers).json()["id"] == data["user"]["id"]


def test_register_login_duplicate_and_wrong_password(client):
    payload = {"email": "keeper@example.com", "password": "test-password-123", "first_name": "Антон", "last_name": ""}
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 201
    assert response.json()["user"]["profile"]["first_name"] == "Антон"
    assert "password_hash" not in response.text
    assert client.post("/api/v1/auth/register", json=payload).status_code == 409
    assert client.post("/api/v1/auth/login", json={"email": payload["email"], "password": "wrong"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": payload["email"], "password": payload["password"]}).status_code == 200


def test_claim_preserves_identity_and_allows_login(client):
    data, headers = guest(client)
    payload = {"email": "keeper@example.com", "password": "test-password-123", "first_name": "Хранитель", "last_name": ""}
    response = client.post("/api/v1/auth/claim", json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json()["id"] == data["user"]["id"]
    assert response.json()["is_guest"] is False
    assert client.post("/api/v1/auth/claim", json=payload, headers=headers).status_code == 409
    response = client.post("/api/v1/auth/login", json={"email": payload["email"], "password": payload["password"]})
    assert response.json()["user"]["id"] == data["user"]["id"]


def test_protected_endpoints_and_profile(client):
    assert client.get("/api/v1/stats/me").status_code in {401, 403}
    _, headers = guest(client)
    response = client.patch("/api/v1/profile/me", headers=headers, json={"first_name": "Дозорный"})
    assert response.status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers).json()["profile"]["first_name"] == "Дозорный"
    assert client.patch("/api/v1/profile/me", headers=headers, json={"first_name": ""}).status_code == 422
