"""FastAPI dependencies for consumer keys and administrator JWTs."""

from datetime import UTC, datetime
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import verify_api_key
from app.auth.rate_limit import allow_request
from app.db.models import AdminUser, ApiKey
from app.db.session import get_session

bearer = HTTPBearer(auto_error=False)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
BearerDep = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]


async def require_api_key(session: SessionDep, credentials: BearerDep) -> ApiKey:
    """Authenticate an active, non-expired consumer API key."""
    if credentials is None:
        raise HTTPException(401, "Valid API key required", headers={"WWW-Authenticate": "Bearer"})
    settings = get_settings()
    prefix = credentials.credentials.split("_", maxsplit=2)[1] if credentials.credentials.count("_") >= 2 else ""
    result = await session.execute(select(ApiKey).where(ApiKey.prefix == prefix, ApiKey.is_active.is_(True)))
    now = datetime.now(UTC)
    for api_key in result.scalars():
        if api_key.expires_at and api_key.expires_at <= now:
            continue
        if verify_api_key(credentials.credentials, api_key.key_hash, settings.api_key_pepper.get_secret_value()):
            if not await allow_request(f"api-key:{api_key.id}", api_key.requests_per_minute, 60):
                raise HTTPException(429, "API key rate limit exceeded", headers={"Retry-After": "60"})
            api_key.last_used_at = now
            return api_key
    raise HTTPException(401, "Invalid or expired API key", headers={"WWW-Authenticate": "Bearer"})


async def require_admin(session: SessionDep, credentials: BearerDep) -> AdminUser:
    """Validate an administrator JWT and load its active subject."""
    if credentials is None:
        raise HTTPException(401, "Administrator token required")
    settings = get_settings()
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
        )
        email = payload.get("sub")
    except jwt.PyJWTError as exc:
        raise HTTPException(401, "Invalid or expired administrator token") from exc
    result = await session.execute(select(AdminUser).where(AdminUser.email == email, AdminUser.is_active.is_(True)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(401, "Invalid or expired administrator token")
    return user
