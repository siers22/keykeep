from collections import Counter
from datetime import timezone
from math import isqrt
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from keykeep.models import Run
from keykeep.modules.stats.schemas import Achievement, StatsResponse


async def get_stats(db: AsyncSession, user_id: UUID) -> StatsResponse:
    runs = list((await db.scalars(
        select(Run).where(Run.user_id == user_id, Run.finished_at.is_not(None))
        .order_by(Run.finished_at),
    )).all())
    chars = sum(r.correct_chars for r in runs)
    errors = sum(r.errors for r in runs)
    xp = sum(r.xp for r in runs)
    victories = sum(r.outcome == "victory" for r in runs)
    best_cpm = max((r.cpm for r in runs), default=0)
    best_combo = max((r.max_combo for r in runs), default=0)
    # Level n starts at 250 * (n - 1)^2 XP.
    level = isqrt(xp // 250) + 1
    character_errors: Counter = Counter()
    for run in runs:
        character_errors.update(run.character_errors)

    goals = [
        ("first", "Первый рубеж", "Заверши первый забег", len(runs), 1),
        ("combo", "Без осечки", "Набери 100 правильных символов подряд", best_combo, 100),
        ("speed", "Быстрее ветра", "Достигни 200 символов в минуту", int(best_cpm), 200),
        ("thousand", "Мастер рун", "Напечатай 1000 правильных символов", chars, 1000),
        ("victory", "Хранитель крепости", "Победи в одном забеге", victories, 1),
        ("regular", "Снова в дозор", "Заверши 10 забегов", len(runs), 10),
    ]
    return StatsResponse(
        runs=len(runs), victories=victories,
        total_seconds=round(sum(r.elapsed_seconds for r in runs), 1),
        total_chars=chars, total_xp=xp, level=level,
        level_progress=xp - 250 * (level - 1)**2,
        level_target=250 * level**2 - 250 * (level - 1)**2,
        best_cpm=best_cpm,
        accuracy=round(chars / (chars + errors) * 100, 1) if chars + errors else 0,
        best_combo=best_combo,
        best_wave=max((r.waves_completed for r in runs), default=0),
        character_errors=dict(character_errors.most_common(10)),
        history=[{
            "date": r.finished_at.replace(tzinfo=timezone.utc).isoformat(), "cpm": r.cpm, "accuracy": r.accuracy,
            "mode": r.mode, "outcome": r.outcome, "waves": r.waves_completed,
        } for r in runs[-30:]],
        achievements=[Achievement(
            id=id_, name=name, description=desc, unlocked=value >= target,
            progress=min(value, target), target=target,
        ) for id_, name, desc, value, target in goals],
    )
