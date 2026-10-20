import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import update

from conftest import guest, result
from keykeep.db.session import session_factory
from keykeep.models import Run


def test_result_server_metrics_idempotency_and_stats(client):
    _, headers = guest(client)
    run = client.post("/api/v1/runs", headers=headers, json={}).json()
    response = client.post(f"/api/v1/runs/{run['id']}/finish", headers=headers, json=result())
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["cpm"] == 300
    assert saved["accuracy"] == 83.3
    assert saved["xp"] == 25
    assert saved["score"] == 150
    # A changed retry cannot replace a previously committed result.
    retry = client.post(f"/api/v1/runs/{run['id']}/finish", headers=headers, json=result(kills=5))
    assert retry.json() == saved
    stats = client.get("/api/v1/stats/me", headers=headers).json()
    assert stats["runs"] == 1
    assert stats["total_xp"] == 25
    assert stats["character_errors"] == {"а": 1}
    assert stats["achievements"][0]["unlocked"] is True
    assert len(client.get("/api/v1/runs", headers=headers).json()) == 1


def test_other_users_cannot_read_or_finish_a_run(client):
    _, owner = guest(client)
    run = client.post("/api/v1/runs", headers=owner, json={}).json()
    _, attacker = guest(client)
    assert client.get(f"/api/v1/runs/{run['id']}", headers=attacker).status_code == 404
    assert client.post(f"/api/v1/runs/{run['id']}/finish", headers=attacker, json=result()).status_code == 404
    assert client.get("/api/v1/runs", headers=attacker).json() == []
    assert client.get("/api/v1/stats/me", headers=attacker).json()["runs"] == 0


def test_impossible_results_are_rejected_without_finishing(client):
    _, headers = guest(client)
    run = client.post("/api/v1/runs", headers=headers, json={}).json()
    for bad in [
        result(elapsed_seconds=9000),
        result(correct_chars=5000, combo_counts={"1": 5000}),
        result(errors=2), result(max_combo=50),
        result(relics=["unknown"], waves_completed=1),
        result(outcome="victory", waves_completed=0),
        result(combo_counts={"2": -5, "1": 10}),
    ]:
        response = client.post(f"/api/v1/runs/{run['id']}/finish", headers=headers, json=bad)
        assert response.status_code == 422, response.text
    assert client.get(f"/api/v1/runs/{run['id']}", headers=headers).json()["finished_at"] is None


def test_code_and_symbols_use_english_content(client):
    _, headers = guest(client)
    for mode in ["code", "symbols"]:
        response = client.post("/api/v1/runs", headers=headers, json={"mode": mode, "language": "ru"})
        assert response.status_code == 201
        assert response.json()["language"] == "en"


def test_leaderboard_qualification_filters_and_guest_claim(client):
    _, headers = guest(client)
    run = client.post("/api/v1/runs", headers=headers, json={}).json()

    async def age_run():
        async with session_factory() as db:
            await db.execute(update(Run).values(started_at=datetime.now(timezone.utc) - timedelta(seconds=30)))
            await db.commit()
    client.portal.call(age_run)

    response = client.post(f"/api/v1/runs/{run['id']}/finish", headers=headers, json=result(
        correct_chars=60, combo_counts={"1": 9, "2": 15, "3": 25, "5": 11}, max_combo=60, elapsed_seconds=20,
    ))
    assert response.status_code == 200
    assert client.get("/api/v1/leaderboard").json() == []
    client.post("/api/v1/auth/claim", headers=headers, json={"email": "rank@example.com", "password": "password-123", "first_name": "Лидер", "last_name": ""})
    rows = client.get("/api/v1/leaderboard").json()
    assert len(rows) == 1
    assert rows[0]["name"] == "Лидер"
    assert rows[0]["value"] == 180
    assert client.get("/api/v1/leaderboard?language=en").json() == []
    assert client.get("/api/v1/leaderboard?difficulty=hard").json() == []
    assert client.get("/api/v1/leaderboard?mode=code").json() == []
    assert client.get("/api/v1/stats/me", headers=headers).json()["total_chars"] == 60
    assert client.get("/api/v1/leaderboard?metric=accuracy&period=today").json()[0]["value"] == 98.4


def test_health_and_request_correlation(client):
    response = client.get("/health", headers={"X-Request-ID": "test-request-123"})
    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "test-request-123"
    assert client.get("/api/v1/game/catalog").json()["total_waves"] == 8
