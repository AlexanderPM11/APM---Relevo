"""Password, token and API-key cryptographic helpers."""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher

_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    """Hash an administrator password using Argon2id."""
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password without exposing invalid-hash errors."""
    try:
        return _password_hasher.verify(password_hash, password)
    except Exception:
        return False


def generate_api_key() -> tuple[str, str]:
    """Return a display-once API key and its public prefix."""
    prefix = secrets.token_hex(4)
    return f"rlv_{prefix}_{secrets.token_urlsafe(32)}", prefix


def hash_api_key(key: str, pepper: str) -> str:
    """Hash an API key with an application pepper."""
    return hmac.new(pepper.encode(), key.encode(), hashlib.sha256).hexdigest()


def verify_api_key(key: str, expected_hash: str, pepper: str) -> bool:
    """Compare an API-key digest in constant time."""
    return hmac.compare_digest(hash_api_key(key, pepper), expected_hash)


def create_access_token(subject: str, secret: str, algorithm: str, expires_minutes: int) -> str:
    """Create a signed administrator access token."""
    now = datetime.now(UTC)
    return jwt.encode(
        {"sub": subject, "iat": now, "exp": now + timedelta(minutes=expires_minutes)},
        secret,
        algorithm=algorithm,
    )
