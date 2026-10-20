from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from keykeep.api.middleware import RequestLoggingMiddleware
from keykeep.api.router import api_router
from keykeep.core.config import get_settings
from keykeep.core.logger import configure_loggin
from keykeep.db.redis import close_redis, redis_client
from keykeep.db.session import engine

settings = get_settings()
configure_loggin(settings.debug)
log = structlog.get_logger()
WEB_ROOT = Path(__file__).resolve().parents[2] / "web"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    log.info("application_started", mode=settings.app_mode)
    yield
    await close_redis()
    await engine.dispose()
    log.info("application_stopped")


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, debug=settings.debug, lifespan=lifespan)
    app.add_middleware(RequestLoggingMiddleware)
    app.include_router(api_router)

    @app.get("/health", tags=["System"])
    async def health() -> dict:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        await redis_client.ping()
        return {"status": "ok", "mode": settings.app_mode}

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(WEB_ROOT / "index.html", headers={"Cache-Control": "no-cache"})

    app.mount("/assets", StaticFiles(directory=WEB_ROOT), name="assets")
    return app


app = create_app()
