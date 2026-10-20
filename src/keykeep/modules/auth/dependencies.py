from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import InvalidTokenError
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from structlog.contextvars import bind_contextvars

from keykeep.api.dependencies import SessionDep
from keykeep.models.user import User
from keykeep.modules.auth.security import decode_access_token

bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials,
        Depends(bearer_scheme),
    ],
    db: SessionDep,
) -> User:

    try:
        user_id = decode_access_token(
            credentials.credentials,
        )
    except InvalidTokenError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from error

    user = await db.scalar(
        select(User).options(selectinload(User.profile)).where(User.id == user_id)
    )

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )
    bind_contextvars(
        user_id=str(user.id),
    )

    return user


CurrentUserDep = Annotated[
    User,
    Depends(get_current_user),
]
