"""Add Laya routing metadata and verified model pricing."""

import sqlalchemy as sa

from alembic import op

revision = "0002_laya_routing"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {
        "models": {
            "is_free": sa.Column("is_free", sa.Boolean(), nullable=True),
            "free_verified_at": sa.Column(
                "free_verified_at", sa.DateTime(timezone=True), nullable=True
            ),
            "routing_profile": sa.Column("routing_profile", sa.String(length=24), nullable=True),
            "routing_tasks": sa.Column("routing_tasks", sa.JSON(), nullable=True),
        },
        "request_logs": {
            "routing_task": sa.Column("routing_task", sa.String(length=40), nullable=True),
            "routing_complexity": sa.Column(
                "routing_complexity", sa.String(length=24), nullable=True
            ),
            "routing_confidence": sa.Column("routing_confidence", sa.Float(), nullable=True),
            "routing_mode": sa.Column("routing_mode", sa.String(length=16), nullable=True),
            "routing_classifier_ms": sa.Column(
                "routing_classifier_ms", sa.Integer(), nullable=True
            ),
        },
    }
    inspector = sa.inspect(bind)
    for table, additions in columns.items():
        existing = {column["name"] for column in inspector.get_columns(table)}
        for name, column in additions.items():
            if name not in existing:
                op.add_column(table, column)


def downgrade() -> None:
    bind = op.get_bind()
    tables = (
        (
            "request_logs",
            (
                "routing_classifier_ms",
                "routing_mode",
                "routing_confidence",
                "routing_complexity",
                "routing_task",
            ),
        ),
        ("models", ("routing_tasks", "routing_profile", "free_verified_at", "is_free")),
    )
    for table, names in tables:
        existing = {column["name"] for column in sa.inspect(bind).get_columns(table)}
        for name in names:
            if name in existing:
                op.drop_column(table, name)
