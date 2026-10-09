"""Async SQLAlchemy engine and request-scoped sessions."""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()
engine = create_async_engine(settings.async_database_url, pool_pre_ping=True, pool_recycle=1800)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """Yield a request-scoped database session."""
    async with SessionLocal() as session:
        yield session
