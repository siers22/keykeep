from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from keykeep.api.dependencies import SessionDep
from keykeep.modules.auth.dependencies import CurrentUserDep
from keykeep.modules.runs.exceptions import InvalidRunResultError, RunNotFoundError
from keykeep.modules.runs.schemas import RunCreate, RunFinish, RunResponse
from keykeep.modules.runs.service import create_run, finish_run, get_run, list_runs

router = APIRouter(prefix="/runs", tags=["Runs"])


@router.post("", response_model=RunResponse, status_code=201)
async def create_run_endpoint(payload: RunCreate, current_user: CurrentUserDep, db: SessionDep) -> RunResponse:
    return RunResponse.model_validate(await create_run(db, current_user.id, payload))


@router.get("", response_model=list[RunResponse])
async def list_runs_endpoint(
    current_user: CurrentUserDep, db: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[RunResponse]:
    return [RunResponse.model_validate(r) for r in await list_runs(db, current_user.id, limit, offset)]


@router.get("/{run_id}", response_model=RunResponse)
async def get_run_endpoint(run_id: UUID, current_user: CurrentUserDep, db: SessionDep) -> RunResponse:
    try:
        return RunResponse.model_validate(await get_run(db, run_id, current_user.id))
    except RunNotFoundError as error:
        raise HTTPException(404, "Run not found") from error


@router.post("/{run_id}/finish", response_model=RunResponse)
async def finish_run_endpoint(
    run_id: UUID, payload: RunFinish, current_user: CurrentUserDep, db: SessionDep,
) -> RunResponse:
    try:
        return RunResponse.model_validate(await finish_run(db, run_id, current_user.id, payload))
    except RunNotFoundError as error:
        raise HTTPException(404, "Run not found") from error
    except InvalidRunResultError as error:
        raise HTTPException(422, "Run result is inconsistent with its duration or game rules") from error
