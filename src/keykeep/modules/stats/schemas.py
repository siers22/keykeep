from pydantic import BaseModel


class Achievement(BaseModel):
    id: str
    name: str
    description: str
    unlocked: bool
    progress: int
    target: int


class StatsResponse(BaseModel):
    runs: int
    victories: int
    total_seconds: float
    total_chars: int
    total_xp: int
    level: int
    level_progress: int
    level_target: int
    best_cpm: float
    accuracy: float
    best_combo: int
    best_wave: int
    character_errors: dict[str, int]
    history: list[dict]
    achievements: list[Achievement]
