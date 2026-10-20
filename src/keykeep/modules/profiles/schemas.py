from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    first_name: str
    last_name: str
    created_at: datetime


class ProfileUpdate(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
