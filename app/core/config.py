"""Environment-backed application settings."""

from functools import lru_cache
from typing import Literal

from pydantic import EmailStr, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Validated runtime settings. Provider credentials stay outside the database."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["development", "production"] = "development"
    app_port: int = Field(default=8000, ge=1, le=65535)
    log_level: str = "INFO"
    cors_origins: str = ""
    tz: str = "UTC"
    database_url: str | None = None
    mysql_host: str = "mysql"
    mysql_port: int = 3306
    mysql_database: str = "relevo"
    mysql_user: str = "relevo"
    mysql_password: SecretStr = SecretStr("relevo-local-only")
    mysql_root_password: SecretStr = SecretStr("mysql-local-only")
    jwt_secret: SecretStr = SecretStr("development-only-change-me-before-deploying")
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60
    api_key_pepper: SecretStr = SecretStr("development-only-change-me")
    admin_email: EmailStr | None = None
    admin_password: SecretStr | None = None
    router_max_attempts: int = 3
    router_request_timeout_seconds: float = 60.0
    router_cooldown_default_seconds: int = 60
    router_circuit_failure_threshold: int = 3
    router_strategy: Literal["priority", "weighted_round_robin"] = "priority"
    router_enable_local_fallback: bool = False
    docs_enabled: bool = True
    log_prompts: bool = False
    prometheus_enabled: bool = False
    google_ai_studio_api_key: SecretStr | None = None
    groq_api_key: SecretStr | None = None
    cerebras_api_key: SecretStr | None = None
    openrouter_api_key: SecretStr | None = None
    cloudflare_account_id: str | None = None
    cloudflare_api_token: SecretStr | None = None
    cohere_api_key: SecretStr | None = None
    mistral_api_key: SecretStr | None = None
    nvidia_api_key: SecretStr | None = None
    kilo_api_key: SecretStr | None = None
    ollama_base_url: str | None = None

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        """Reject known development credentials in production."""
        if self.app_env == "production":
            required = ("mysql_password", "mysql_root_password", "jwt_secret", "api_key_pepper",
                        "admin_email", "admin_password")
            for field in required:
                if field not in self.model_fields_set:
                    raise ValueError(f"{field.upper()} must be explicitly configured in production")
            for field in ("jwt_secret", "api_key_pepper"):
                secret = getattr(self, field).get_secret_value()
                if secret.startswith("development-only") or len(secret) < 32:
                    raise ValueError(f"{field.upper()} must be a unique secret of at least 32 characters")
            if self.admin_password is None or len(self.admin_password.get_secret_value()) < 12:
                raise ValueError("ADMIN_PASSWORD must contain at least 12 characters")
        return self

    @property
    def async_database_url(self) -> str:
        """Return explicit URL or construct the async MySQL URL."""
        if self.database_url:
            return self.database_url
        password = self.mysql_password.get_secret_value()
        return (
            f"mysql+asyncmy://{self.mysql_user}:{password}@{self.mysql_host}:"
            f"{self.mysql_port}/{self.mysql_database}?charset=utf8mb4"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        """Parse comma-separated CORS origins."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Load settings once per process."""
    return Settings()
