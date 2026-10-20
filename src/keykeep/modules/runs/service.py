from datetime import datetime, timezone
from secrets import randbelow
from uuid import UUID

import structlog
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from keykeep.models import Run
from keykeep.modules.game.catalog import CATALOG
from keykeep.modules.runs.exceptions import InvalidRunResultError, RunNotFoundError
from keykeep.modules.runs.schemas import RunCreate, RunFinish

log = structlog.get_logger(component="runs.service")


async def create_run(db: AsyncSession, user_id: UUID, data: RunCreate) -> Run:
    run = Run(user_id=user_id, seed=randbelow(2**31 - 1), **data.model_dump())
    db.add(run)
    await db.commit()
    await db.refresh(run)
    log.info("run_created", run_id=str(run.id), user_id=str(user_id), mode=run.mode)
    return run


async def get_run(db: AsyncSession, run_id: UUID, user_id: UUID) -> Run:
    run = await db.scalar(select(Run).where(Run.id == run_id, Run.user_id == user_id))
    if run is None:
        raise RunNotFoundError
    return run


async def finish_run(db: AsyncSession, run_id: UUID, user_id: UUID, data: RunFinish) -> Run:
    run = await get_run(db, run_id, user_id)
    # A retry after a lost response returns the original result without granting XP twice.
    if run.finished_at is not None:
        return run

    now = datetime.now(timezone.utc)
    started = run.started_at.replace(tzinfo=timezone.utc) if run.started_at.tzinfo is None else run.started_at
    wall_seconds = max(0, (now - started).total_seconds())
    allowed_relics = {r["id"] for r in CATALOG["relics"]}
    if (
        data.elapsed_seconds > wall_seconds + 5
        or data.correct_chars + data.errors > data.elapsed_seconds * 35 + 20
        or not set(data.relics) <= allowed_relics
    ):
        raise InvalidRunResultError

    attempts = data.correct_chars + data.errors
    xp = data.correct_chars * 2 + data.kills * 15 + data.waves_completed * 60
    if data.outcome == "victory":
        xp += 300
    if "scholar" in data.relics:
        xp = int(xp * 1.3)

    values = {
        **data.model_dump(),
        "finished_at": now,
        "cpm": round(data.correct_chars / data.elapsed_seconds * 60, 1),
        "accuracy": round(data.correct_chars / attempts * 100, 1) if attempts else 100,
        "xp": xp,
        "score": sum(int(k) * v * 10 for k, v in data.combo_counts.items()) + data.kills * 100 + data.waves_completed * 500,
    }
    await db.execute(
        update(Run)
        .where(Run.id == run_id, Run.user_id == user_id, Run.finished_at.is_(None))
        .values(**values),
    )
    await db.commit()
    await db.refresh(run)
    log.info("run_finished", run_id=str(run.id), outcome=run.outcome, xp=run.xp)
    return run


async def list_runs(db: AsyncSession, user_id: UUID, limit: int, offset: int) -> list[Run]:
    rows = await db.scalars(
        select(Run).where(Run.user_id == user_id, Run.finished_at.is_not(None))
        .order_by(Run.finished_at.desc(), Run.id.desc()).limit(limit).offset(offset),
    )
    return list(rows.all())
