from fastapi import APIRouter

from keykeep.api.dependencies import SessionDep
from keykeep.modules.auth.dependencies import CurrentUserDep
from keykeep.modules.profiles.schemas import ProfileResponse, ProfileUpdate
from keykeep.modules.profiles.service import update_profile

router = APIRouter(prefix="/profile", tags=["Profiles"])


@router.patch("/me", response_model=ProfileResponse)
async def update_profile_endpoint(
    payload: ProfileUpdate, current_user: CurrentUserDep, db: SessionDep,
) -> ProfileResponse:
    return ProfileResponse.model_validate(await update_profile(db, current_user, payload))
