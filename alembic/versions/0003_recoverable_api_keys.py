"""Store API key secrets encrypted so administrators can retrieve them."""

import sqlalchemy as sa

from alembic import op

revision = "0003_recoverable_api_keys"
down_revision = "0002_laya_routing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("api_keys")}
    if "encrypted_secret" not in existing:
        op.add_column("api_keys", sa.Column("encrypted_secret", sa.Text(), nullable=True))


def downgrade() -> None:
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("api_keys")}
    if "encrypted_secret" in existing:
        op.drop_column("api_keys", "encrypted_secret")
