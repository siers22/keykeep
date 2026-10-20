from fastapi import APIRouter

from keykeep.modules.auth.router import router as auth_router
from keykeep.modules.game.router import router as game_router
from keykeep.modules.leaderboard.router import router as leaderboard_router
from keykeep.modules.profiles.router import router as profiles_router
from keykeep.modules.runs.router import router as runs_router
from keykeep.modules.stats.router import router as stats_router

api_router = APIRouter(prefix="/api/v1")
for router in (auth_router, game_router, profiles_router, runs_router, stats_router, leaderboard_router):
    api_router.include_router(router)
