from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from keykeep.models import Profile, Run, User
from keykeep.modules.leaderboard.schemas import LeaderboardEntry


async def get_leaderboard(
    db: AsyncSession, metric: str, period: str, mode: str, language: str, difficulty: str,
) -> list[LeaderboardEntry]:
    value = {"cpm": func.max(Run.cpm), "accuracy": func.max(Run.accuracy), "xp": func.sum(Run.xp)}[metric]
    stmt = (
        select(User.id, Profile.first_name, value.label("value"), func.count(Run.id).label("runs"))
        .join(Profile, Profile.user_id == User.id).join(Run, Run.user_id == User.id)
        .where(User.is_active.is_(True), User.is_guest.is_(False), Run.finished_at.is_not(None),
               Run.correct_chars >= 50, Run.elapsed_seconds >= 10,
               Run.mode == mode, Run.language == language, Run.difficulty == difficulty)
    )
    if period != "all":
        now = datetime.now(timezone.utc)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0) if period == "today" else now - timedelta(days=7)
        stmt = stmt.where(Run.finished_at >= start)
    rows = (await db.execute(
        stmt.group_by(User.id, Profile.first_name)
        .order_by(value.desc(), User.id).limit(50),
    )).all()
    return [LeaderboardEntry(rank=i + 1, user_id=r.id, name=r.first_name, value=round(r.value, 1), runs=r.runs) for i, r in enumerate(rows)]
