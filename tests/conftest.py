import asyncio
import os
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
from fastapi.testclient import TestClient

_test_directory = TemporaryDirectory(prefix="keykeep-tests-")
os.environ.update(
    APP_MODE="local",
    DATABASE_URL=os.environ.get("KEYKEEP_TEST_DATABASE_URL", f"sqlite+aiosqlite:///{Path(_test_directory.name) / 'test.db'}"),
    REDIS_URL=os.environ.get("KEYKEEP_TEST_REDIS_URL", "memory://"),
    JWT_SECRET="test-secret-with-more-than-thirty-two-characters",
    REFRESH_COOKIE_SECURE="false",
)

from keykeep.db.base import Base
from keykeep.db.session import engine
from keykeep.main import app


@pytest.fixture
def client():
    async def reset_database():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)

    with TestClient(app) as test_client:
        test_client.portal.call(reset_database)
        yield test_client


def guest(client):
    response = client.post("/api/v1/auth/guest")
    assert response.status_code == 201
    data = response.json()
    return data, {"Authorization": f"Bearer {data['access_token']}"}


def result(**overrides):
    data = {
        "outcome": "abandoned", "waves_completed": 0, "kills": 1,
        "correct_chars": 5, "errors": 1, "max_combo": 5,
        "combo_counts": {"1": 5}, "elapsed_seconds": 1,
        "character_errors": {"а": 1}, "relics": [],
    }
    return {**data, **overrides}
