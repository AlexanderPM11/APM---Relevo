"""FastAPI application entry point."""

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.api.routes import router as api_router
from app.core.config import get_settings
from app.core.security import hash_password
from app.core.seed import load_seed
from app.db.models import AdminUser
from app.db.session import SessionLocal, engine


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Initialize and release process-level resources."""
    async with SessionLocal() as session:
        if settings.admin_email and settings.admin_password:
            result = await session.execute(select(AdminUser).limit(1))
            if result.scalar_one_or_none() is None:
                session.add(
                    AdminUser(
                        email=str(settings.admin_email),
                        password_hash=hash_password(settings.admin_password.get_secret_value()),
                    )
                )
                await session.commit()
        await load_seed(session, settings)
    yield
    await engine.dispose()


settings = get_settings()
app = FastAPI(
    title="Relevo API",
    description="OpenAI-compatible API for routing requests across model providers.",
    version="0.1.0",
    docs_url="/docs" if settings.docs_enabled and settings.app_env != "production" else None,
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(api_router)


@app.middleware("http")
async def security_headers(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Attach conservative browser security headers to every response."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.get("/health", tags=["operations"])
async def health() -> dict[str, str]:
    """Report that the API process is alive."""
    return {"status": "ok"}


@app.get("/ready", tags=["operations"])
async def ready() -> dict[str, str]:
    """Verify database connectivity and at least one credentialed model."""
    from app.db.models import Model, Provider
    from app.router.service import provider_is_configured

    try:
        async with SessionLocal() as session:
            await session.execute(text("SELECT 1"))
            rows = await session.execute(
                select(Model, Provider)
                .join(Provider)
                .where(Model.is_enabled.is_(True), Provider.is_enabled.is_(True))
                .options(selectinload(Model.health))
            )
            now = datetime.now(UTC).replace(tzinfo=None)
            available = any(
                provider_is_configured(settings, provider)
                and (provider.adapter in {"openai", "google"})
                and (provider.slug != "ollama" or settings.router_enable_local_fallback)
                and (
                    model.health is None
                    or model.health.state != "open"
                    or model.health.cooldown_until is None
                    or model.health.cooldown_until <= now
                )
                for model, provider in rows.all()
            )
    except Exception as exc:
        raise HTTPException(503, "Service is not ready") from exc
    if not available:
        raise HTTPException(503, "No model is currently available")
    return {"status": "ok", "database": "ok", "models": "available"}
