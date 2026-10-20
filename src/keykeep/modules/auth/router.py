from typing import Annotated

from fastapi import APIRouter, Cookie, HTTPException, Response, status

from keykeep.api.dependencies import RedisDep, SessionDep
from keykeep.core.config import get_settings
from keykeep.modules.auth.dependencies import CurrentUserDep
from keykeep.modules.auth.exceptions import (
    EmailAlreadyRegisteredError,
    InvalidCredentialsError,
    InvalidRefreshTokenError,
)
from keykeep.modules.auth.schemas import (
    AccessTokenResponse,
    AuthResponse,
    LoginRequest,
    RegisterRequest,
    UserResponse,
)
from keykeep.modules.auth.service import (
    claim_guest, create_guest, login, logout, refresh_tokens, register,
)

router = APIRouter(
    prefix="/auth",
    tags=["Users"],
)

settings = get_settings()


@router.post("/guest", response_model=AuthResponse, status_code=201)
async def create_guest_endpoint(db: SessionDep, redis: RedisDep, response: Response) -> AuthResponse:
    result = await create_guest(db, redis)
    _set_refresh_cookie(response, result.refresh_token)
    return AuthResponse(access_token=result.access_token, user=UserResponse.model_validate(result.user))


@router.post("/claim", response_model=UserResponse)
async def claim_guest_endpoint(
    payload: RegisterRequest, current_user: CurrentUserDep, db: SessionDep,
) -> UserResponse:
    try:
        user = await claim_guest(db, current_user, payload)
    except EmailAlreadyRegisteredError as error:
        raise HTTPException(409, "Email already registered") from error
    except InvalidCredentialsError as error:
        raise HTTPException(409, "Only a guest account can be claimed") from error
    return UserResponse.model_validate(user)


def _set_refresh_cookie(
    response: Response,
    refresh_token: str,
) -> None:
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        samesite="lax",
        secure=settings.refresh_cookie_secure,
        path="/api/v1/auth",
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
    )


def _delete_refresh_cookie(
    response: Response,
) -> None:
    response.delete_cookie(
        key="refresh_token",
        path="/api/v1/auth",
    )


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_user(
    payload: RegisterRequest,
    db: SessionDep,
    redis: RedisDep,
    response: Response,
) -> AuthResponse:
    try:
        result = await register(db, payload, redis)
    except EmailAlreadyRegisteredError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        ) from error

    _set_refresh_cookie(response, result.refresh_token)
    return AuthResponse.model_validate(
        {
            "access_token": result.access_token,
            "user": result.user,
        },
    )


@router.post(
    "/login",
    response_model=AuthResponse,
)
async def login_user(
    payload: LoginRequest,
    db: SessionDep,
    redis: RedisDep,
    response: Response,
) -> AuthResponse:
    try:
        result = await login(db, payload, redis)
    except InvalidCredentialsError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid credentials",
        ) from error

    _set_refresh_cookie(response, result.refresh_token)
    return AuthResponse.model_validate(
        {
            "access_token": result.access_token,
            "user": result.user,
        },
    )


@router.post(
    "/refresh",
    response_model=AccessTokenResponse,
)
async def refresh_access_token(
    response: Response,
    db: SessionDep,
    redis: RedisDep,
    refresh_token: Annotated[
        str | None,
        Cookie(alias="refresh_token"),
    ] = None,
) -> AccessTokenResponse:
    try:
        if refresh_token is None:
            raise InvalidRefreshTokenError
        result = await refresh_tokens(
            db,
            redis,
            refresh_token,
        )
    except InvalidRefreshTokenError as error:
        _delete_refresh_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        ) from error

    _set_refresh_cookie(
        response,
        result.refresh_token,
    )

    return AccessTokenResponse(
        access_token=result.access_token,
    )


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def logout_user(
    response: Response,
    redis: RedisDep,
    refresh_token: Annotated[
        str | None,
        Cookie(alias="refresh_token"),
    ] = None,
) -> None:
    await logout(
        redis,
        refresh_token,
    )

    _delete_refresh_cookie(response)


@router.get(
    "/me",
    response_model=UserResponse,
)
async def get_me(
    current_user: CurrentUserDep,
) -> UserResponse:
    return UserResponse.model_validate(
        current_user,
    )
