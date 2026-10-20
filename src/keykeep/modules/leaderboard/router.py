from typing import Literal

from fastapi import APIRouter

from keykeep.api.dependencies import SessionDep
from keykeep.modules.leaderboard.schemas import LeaderboardEntry
from keykeep.modules.leaderboard.service import get_leaderboard
from keykeep.modules.runs.schemas import Language, Mode

router = APIRouter(prefix="/leaderboard", tags=["Leaderboard"])


@router.get("", response_model=list[LeaderboardEntry])
async def get_leaderboard_endpoint(
    db: SessionDep,
    metric: Literal["cpm", "accuracy", "xp"] = "cpm",
    period: Literal["today", "week", "all"] = "all",
    mode: Mode = "words",
    language: Language = "ru",
    difficulty: Literal["calm", "normal", "hard"] = "normal",
) -> list[LeaderboardEntry]:
    return await get_leaderboard(db, metric, period, mode, language, difficulty)
