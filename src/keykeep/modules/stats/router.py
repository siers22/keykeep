from fastapi import APIRouter

from keykeep.api.dependencies import SessionDep
from keykeep.modules.auth.dependencies import CurrentUserDep
from keykeep.modules.stats.schemas import StatsResponse
from keykeep.modules.stats.service import get_stats

router = APIRouter(prefix="/stats", tags=["Statistics"])


@router.get("/me", response_model=StatsResponse)
async def get_stats_endpoint(current_user: CurrentUserDep, db: SessionDep) -> StatsResponse:
    return await get_stats(db, current_user.id)
