import asyncio
from datetime import timedelta
from time import monotonic

from redis.asyncio import Redis

from keykeep.core.config import get_settings


class LocalSessionStore:
    """Explicit single-process local adapter. Production always uses Redis."""

    def __init__(self) -> None:
        self._values: dict[str, tuple[str, float]] = {}
        self._lock = asyncio.Lock()

    async def set(self, key: str, value: str, ex: timedelta) -> None:
        async with self._lock:
            now = monotonic()
            self._values = {k: v for k, v in self._values.items() if v[1] > now}
            self._values[key] = (value, now + ex.total_seconds())

    async def getdel(self, key: str) -> str | None:
        async with self._lock:
            item = self._values.pop(key, None)
            return item[0] if item and item[1] > monotonic() else None

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._values.pop(key, None)

    async def ping(self) -> bool:
        return True

    async def aclose(self) -> None:
        self._values.clear()


SessionStore = Redis | LocalSessionStore
settings = get_settings()
redis_client: SessionStore = (
    LocalSessionStore()
    if settings.redis_url == "memory://"
    else Redis.from_url(settings.redis_url, decode_responses=True)
)


async def get_redis() -> SessionStore:
    return redis_client


async def close_redis() -> None:
    await redis_client.aclose()
