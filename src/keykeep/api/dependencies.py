from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from keykeep.db.redis import SessionStore, get_redis
from keykeep.db.session import get_session

SessionDep = Annotated[AsyncSession, Depends(get_session)]
RedisDep = Annotated[SessionStore, Depends(get_redis)]
