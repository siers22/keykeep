from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash
from starlette.concurrency import run_in_threadpool

from keykeep.core.config import get_settings

settings = get_settings()

password_hash = PasswordHash.recommended()


async def hash_password(password: str) -> str:
    return await run_in_threadpool(
        password_hash.hash,
        password,
    )


async def verify_password(
    plain_password: str,
    hashed_password: str,
) -> bool:
    return await run_in_threadpool(
        password_hash.verify,
        plain_password,
        hashed_password,
    )


def create_access_token(user_id: UUID) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes,
    )

    payload = {
        "sub": str(user_id),
        "exp": expires_at,
    }
    return jwt.encode(
        payload,
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def decode_access_token(token: str) -> UUID:
    payload = jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
    )
    sub = payload.get("sub")
    if not isinstance(sub, str):
        raise InvalidTokenError("Token subject is missing")

    try:
        return UUID(sub)
    except ValueError as error:
        raise InvalidTokenError(
            "Token subject is not a valid UUID",
        ) from error
