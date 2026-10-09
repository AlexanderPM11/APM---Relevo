"""SQLAlchemy schema for authentication, routing, quotas, and request history."""

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class AdminUser(TimestampMixin, Base):
    """Administrator login record."""

    __tablename__ = "admin_users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class ApiKey(TimestampMixin, Base):
    """Consumer API key; only its digest is stored."""

    __tablename__ = "api_keys"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    prefix: Mapped[str] = mapped_column(String(16), index=True)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    owner: Mapped[str | None] = mapped_column(String(320), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    requests_per_minute: Mapped[int] = mapped_column(Integer, default=60)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Provider(TimestampMixin, Base):
    """Configurable model provider metadata."""

    __tablename__ = "providers"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    base_url: Mapped[str] = mapped_column(String(500))
    env_key_name: Mapped[str] = mapped_column(String(120))
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    requires_card: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    requires_phone: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    uses_data_for_training: Mapped[str | None] = mapped_column(String(32), nullable=True)
    adapter: Mapped[str] = mapped_column(String(40), default="openai")
    models: Mapped[list["Model"]] = relationship(back_populates="provider")


class Model(TimestampMixin, Base):
    """Routable model and feature metadata."""

    __tablename__ = "models"
    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200))
    alias: Mapped[str | None] = mapped_column(String(100), index=True, nullable=True)
    priority: Mapped[int] = mapped_column(Integer, default=100)
    weight: Mapped[int] = mapped_column(Integer, default=1)
    context_max: Mapped[int] = mapped_column(Integer, default=8192)
    capabilities: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    tier: Mapped[int] = mapped_column(Integer, default=3)
    provider: Mapped[Provider] = relationship(back_populates="models")
    limits: Mapped[list["ModelLimit"]] = relationship(cascade="all, delete-orphan")
    health: Mapped["ModelHealth | None"] = relationship(
        back_populates="model", cascade="all, delete-orphan", uselist=False
    )


class ModelLimit(TimestampMixin, Base):
    """Provider quota for a model and metric window."""

    __tablename__ = "model_limits"
    __table_args__ = (UniqueConstraint("model_id", "window", "metric"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("models.id", ondelete="CASCADE"), index=True)
    window: Mapped[str] = mapped_column(String(16))
    metric: Mapped[str] = mapped_column(String(16))
    max_value: Mapped[int] = mapped_column(Integer)


class ModelUsage(TimestampMixin, Base):
    """Persisted usage counter for a quota window."""

    __tablename__ = "model_usage"
    __table_args__ = (UniqueConstraint("model_id", "window", "window_start", "metric"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("models.id", ondelete="CASCADE"))
    window: Mapped[str] = mapped_column(String(16))
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    metric: Mapped[str] = mapped_column(String(16))
    consumed: Mapped[int] = mapped_column(Integer, default=0)


class ModelHealth(TimestampMixin, Base):
    """Persisted circuit-breaker and cooldown state."""

    __tablename__ = "model_health"
    id: Mapped[int] = mapped_column(primary_key=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("models.id", ondelete="CASCADE"), unique=True)
    state: Mapped[str] = mapped_column(String(16), default="closed")
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)
    cooldown_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    model: Mapped[Model] = relationship(back_populates="health")


class RequestLog(TimestampMixin, Base):
    """Request metadata without prompt content by default."""

    __tablename__ = "request_logs"
    __table_args__ = (Index("ix_request_logs_created_at", "created_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    api_key_id: Mapped[int | None] = mapped_column(ForeignKey("api_keys.id"), nullable=True)
    requested_model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    final_model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32))
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
