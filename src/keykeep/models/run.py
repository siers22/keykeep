from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from keykeep.db.base import Base


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    seed: Mapped[int] = mapped_column(Integer)
    mode: Mapped[str] = mapped_column(String(20))
    language: Mapped[str] = mapped_column(String(2))
    difficulty: Mapped[str] = mapped_column(String(20))
    outcome: Mapped[str] = mapped_column(String(20), default="active")
    waves_completed: Mapped[int] = mapped_column(Integer, default=0)
    kills: Mapped[int] = mapped_column(Integer, default=0)
    correct_chars: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[int] = mapped_column(Integer, default=0)
    max_combo: Mapped[int] = mapped_column(Integer, default=0)
    combo_counts: Mapped[dict] = mapped_column(JSON, default=dict)
    elapsed_seconds: Mapped[float] = mapped_column(Float, default=0)
    cpm: Mapped[float] = mapped_column(Float, default=0)
    accuracy: Mapped[float] = mapped_column(Float, default=0)
    xp: Mapped[int] = mapped_column(Integer, default=0)
    score: Mapped[int] = mapped_column(Integer, default=0)
    character_errors: Mapped[dict] = mapped_column(JSON, default=dict)
    relics: Mapped[list] = mapped_column(JSON, default=list)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
