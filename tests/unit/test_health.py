"""Basic process health endpoint checks."""

from fastapi.testclient import TestClient

from app.main import app


def test_health_reports_process_liveness() -> None:
    """The liveness endpoint must respond without database dependencies."""
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
