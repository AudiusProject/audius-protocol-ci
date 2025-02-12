"""Add IP to route metrics

Revision ID: 4c3784d41d41
Revises: 277bad300c09
Create Date: 2020-08-28 17:21:43.308374

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "4c3784d41d41"
down_revision = "277bad300c09"
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###

    # Route metrics
    op.drop_constraint("route_metrics_pkey", "route_metrics")
    op.execute(
        "ALTER TABLE route_metrics ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY"
    )
    op.add_column("route_metrics", sa.Column("ip", sa.String(), nullable=True))

    # App name metrics
    op.drop_constraint("app_name_metrics_pkey", "app_name_metrics")
    op.execute(
        "ALTER TABLE app_name_metrics ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY"
    )
    op.add_column("app_name_metrics", sa.Column("ip", sa.String(), nullable=True))

    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###

    # Route metrics
    op.drop_column("route_metrics", "ip")
    op.drop_column("route_metrics", "id")
    op.create_primary_key(
        "route_metrics_pkey",
        "route_metrics",
        ["route_path", "query_string", "timestamp"],
    )

    op.drop_column("app_name_metrics", "ip")
    op.drop_column("app_name_metrics", "id")
    op.create_primary_key(
        "app_name_metrics_pkey", "app_name_metrics", ["application_name", "timestamp"]
    )
    # ### end Alembic commands ###
