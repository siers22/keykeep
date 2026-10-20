from uuid import UUID

from pydantic import BaseModel


class LeaderboardEntry(BaseModel):
    rank: int
    user_id: UUID
    name: str
    value: float
    runs: int
