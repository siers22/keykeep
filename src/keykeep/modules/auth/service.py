from dataclasses import dataclass
from secrets import token_urlsafe
from uuid import uuid4

import structlog
from keykeep.db.redis import SessionStore
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from keykeep.models import Profile, User
from keykeep.modules.auth.exceptions import (
    EmailAlreadyRegisteredError,
    InvalidCredentialsError,
    InvalidRefreshTokenError,
)
from keykeep.modules.auth.refresh_session import (
    consume_refresh_session,
    create_refresh_session,
    revoke_refresh_session,
)
from keykeep.modules.auth.schemas import LoginRequest, RegisterRequest
from keykeep.modules.auth.security import (
    create_access_token,
    hash_password,
    verify_password,
)

log = structlog.get_logger(
    component="auth.service",
)


@dataclass(slots=True)
class AuthResult:
    user: User
    access_token: str
    refresh_token: str


@dataclass(slots=True)
class RefreshResult:
    access_token: str
    refresh_token: str


async def register(
    db: AsyncSession,
    data: RegisterRequest,
    redis: SessionStore,
) -> AuthResult:
    email = str(data.email).lower()
    stmt = select(User).where(User.email == email)
    existing_user = await db.scalar(stmt)

    if existing_user is not None:
        raise EmailAlreadyRegisteredError

    user = User(
        email=email,
        password_hash=await hash_password(data.password),
        profile=Profile(
            first_name=data.first_name,
            last_name=data.last_name,
        ),
    )

    db.add(user)
    try:
        await db.flush()
    except IntegrityError as error:
        await db.rollback()
        raise EmailAlreadyRegisteredError from error

    access_token = create_access_token(user.id)
    refresh_token = await create_refresh_session(
        redis,
        user.id,
    )

    await db.commit()

    log.info(
        "user_registered",
        user_id=str(user.id),
    )
    return AuthResult(
        user=user,
        access_token=access_token,
        refresh_token=refresh_token,
    )


async def login(
    db: AsyncSession,
    data: LoginRequest,
    redis: SessionStore,
) -> AuthResult:
    email = str(data.email).lower()

    user = await db.scalar(
        select(User).options(selectinload(User.profile)).where(User.email == email)
    )
    if user is None or not user.is_active:
        log.warning(
            "login_failed",
            email=email,
        )
        raise InvalidCredentialsError
    password_is_valid = await verify_password(
        data.password,
        user.password_hash,
    )
    if not password_is_valid:
        log.warning(
            "login_failed",
            email=email,
        )
        raise InvalidCredentialsError
    access_token = create_access_token(user.id)
    refresh_token = await create_refresh_session(
        redis,
        user.id,
    )

    log.info(
        "user_logged_in",
        user_id=str(user.id),
    )
    return AuthResult(
        user=user,
        access_token=access_token,
        refresh_token=refresh_token,
    )


async def refresh_tokens(
    db: AsyncSession,
    redis: SessionStore,
    refresh_token: str,
) -> RefreshResult:
    user_id = await consume_refresh_session(
        redis,
        refresh_token,
    )

    user = await db.get(User, user_id)

    if user is None or not user.is_active:
        raise InvalidRefreshTokenError

    access_token = create_access_token(user.id)
    new_refresh_token = await create_refresh_session(
        redis,
        user.id,
    )

    log.info("refresh_token_rotated", user_id=str(user.id))

    return RefreshResult(
        access_token=access_token,
        refresh_token=new_refresh_token,
    )


async def logout(
    redis: SessionStore,
    refresh_token: str | None,
) -> None:
    if refresh_token is not None:
        await revoke_refresh_session(
            redis,
            refresh_token,
        )

    log.info(
        "user_logged_out",
        had_refresh_token=refresh_token is not None,
    )


async def create_guest(db: AsyncSession, redis: SessionStore) -> AuthResult:
    user = User(
        email=f"{uuid4().hex}@guest.keykeep.dev",
        password_hash=await hash_password(token_urlsafe(48)),
        is_guest=True,
        profile=Profile(first_name="Странник", last_name=""),
    )
    db.add(user)
    await db.flush()
    refresh_token = await create_refresh_session(redis, user.id)
    await db.commit()
    log.info("guest_created", user_id=str(user.id))
    return AuthResult(user, create_access_token(user.id), refresh_token)


async def claim_guest(db: AsyncSession, user: User, data: RegisterRequest) -> User:
    if not user.is_guest:
        raise InvalidCredentialsError
    email = str(data.email).lower()
    if await db.scalar(select(User.id).where(User.email == email)) is not None:
        raise EmailAlreadyRegisteredError
    user.email = email
    user.password_hash = await hash_password(data.password)
    user.is_guest = False
    user.profile.first_name = data.first_name
    user.profile.last_name = data.last_name
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        raise EmailAlreadyRegisteredError from error
    log.info("guest_claimed", user_id=str(user.id))
    return user
