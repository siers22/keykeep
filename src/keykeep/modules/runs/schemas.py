from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

Mode = Literal["words", "sentences", "code", "symbols"]
Language = Literal["ru", "en"]


class RunCreate(BaseModel):
    mode: Mode = "words"
    language: Language = "ru"
    difficulty: Literal["calm", "normal", "hard"] = "normal"

    @model_validator(mode="after")
    def code_language(self) -> "RunCreate":
        if self.mode in {"code", "symbols"}:
            self.language = "en"
        return self


class RunFinish(BaseModel):
    outcome: Literal["victory", "defeat", "abandoned"]
    waves_completed: int = Field(ge=0, le=8)
    kills: int = Field(ge=0, le=200)
    correct_chars: int = Field(ge=0, le=100_000)
    errors: int = Field(ge=0, le=100_000)
    max_combo: int = Field(ge=0, le=100_000)
    combo_counts: dict[Literal["1", "2", "3", "5"], int] = Field(default_factory=dict)
    elapsed_seconds: float = Field(ge=0.01, le=86_400, allow_inf_nan=False)
    character_errors: dict[str, int] = Field(default_factory=dict, max_length=200)
    relics: list[str] = Field(default_factory=list, max_length=7)

    @model_validator(mode="after")
    def consistent_counters(self) -> "RunFinish":
        if self.max_combo > self.correct_chars:
            raise ValueError("Combo cannot exceed correct characters")
        if any(v < 0 for v in self.combo_counts.values()) or sum(self.combo_counts.values()) != self.correct_chars:
            raise ValueError("Combo counts must match correct characters")
        if any(len(k) != 1 or v < 0 for k, v in self.character_errors.items()):
            raise ValueError("Character errors must be non-negative single-character counts")
        if sum(self.character_errors.values()) != self.errors:
            raise ValueError("Character error counts must match total errors")
        if self.outcome == "victory" and self.waves_completed != 8:
            raise ValueError("Victory requires eight completed waves")
        if self.outcome == "defeat" and self.waves_completed == 8:
            raise ValueError("A defeated run cannot have completed all waves")
        if len(set(self.relics)) != len(self.relics) or len(self.relics) > self.waves_completed:
            raise ValueError("Relic count must match completed waves")
        return self


class RunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    seed: int
    mode: str
    language: str
    difficulty: str
    outcome: str
    waves_completed: int
    kills: int
    correct_chars: int
    errors: int
    max_combo: int
    combo_counts: dict[str, int]
    elapsed_seconds: float
    cpm: float
    accuracy: float
    xp: int
    score: int
    character_errors: dict[str, int]
    relics: list[str]
    started_at: datetime
    finished_at: datetime | None

    @computed_field
    @property
    def wpm(self) -> float:
        return round(self.cpm / 5, 1)
