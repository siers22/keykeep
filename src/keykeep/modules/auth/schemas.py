from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from keykeep.modules.profiles.schemas import ProfileResponse


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(default="", max_length=100)

    @field_validator("first_name", "last_name", mode="before")
    @classmethod
    def strip_names(cls, value):
        return value.strip() if isinstance(value, str) else value


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    is_active: bool
    is_guest: bool
    created_at: datetime
    profile: ProfileResponse


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"


class AuthResponse(AccessTokenResponse):
    user: UserResponse


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
