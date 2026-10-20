from fastapi import APIRouter

from keykeep.modules.game.catalog import CATALOG

router = APIRouter(prefix="/game", tags=["Game"])


@router.get("/catalog")
async def get_catalog() -> dict:
    return CATALOG
