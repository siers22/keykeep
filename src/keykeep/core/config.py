from functools import cache
from secrets import token_urlsafe
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Keykeep"
    app_mode: Literal["local", "production"] = "local"
    debug: bool = False
    database_url: str = "sqlite+aiosqlite:///./keykeep.db"
    redis_url: str = "memory://"
    sql_echo: bool = False
    jwt_secret: str = Field(default_factory=lambda: token_urlsafe(48))
    jwt_algorithm: Literal["HS256"] = "HS256"
    access_token_expire_minutes: int = Field(default=30, ge=1)
    refresh_token_expire_days: int = Field(default=30, ge=1)
    refresh_cookie_secure: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @model_validator(mode="after")
    def validate_runtime(self) -> "Settings":
        if self.app_mode == "production":
            if "jwt_secret" not in self.model_fields_set or len(self.jwt_secret) < 32:
                raise ValueError("Production requires an explicit JWT_SECRET of at least 32 characters")
            if self.redis_url == "memory://":
                raise ValueError("Production requires Redis")
            if not self.database_url.startswith("postgresql+"):
                raise ValueError("Production requires PostgreSQL")
        return self


@cache
def get_settings() -> Settings:
    return Settings()
