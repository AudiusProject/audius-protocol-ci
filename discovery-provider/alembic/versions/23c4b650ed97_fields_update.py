"""Fields update

Revision ID: 23c4b650ed97
Revises: 45e5117f4419
Create Date: 2019-03-28 16:55:10.253742

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "23c4b650ed97"
down_revision = "45e5117f4419"
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column("follows", sa.Column("created_at", sa.DateTime(), nullable=False))
    op.drop_column("follows", "timestamp")
    op.add_column("playlists", sa.Column("created_at", sa.DateTime(), nullable=False))
    op.add_column("playlists", sa.Column("upc", sa.String(), nullable=True))
    op.add_column("playlists", sa.Column("updated_at", sa.DateTime(), nullable=False))
    op.drop_column("playlists", "timestamp")
    op.add_column("reposts", sa.Column("created_at", sa.DateTime(), nullable=False))
    op.drop_column("reposts", "timestamp")
    op.add_column("saves", sa.Column("created_at", sa.DateTime(), nullable=False))
    op.drop_column("saves", "timestamp")
    op.add_column("tracks", sa.Column("created_at", sa.DateTime(), nullable=False))
    op.add_column("tracks", sa.Column("description", sa.String(), nullable=True))
    op.add_column("tracks", sa.Column("isrc", sa.String(), nullable=True))
    op.add_column("tracks", sa.Column("iswc", sa.String(), nullable=True))
    op.add_column("tracks", sa.Column("license", sa.String(), nullable=True))
    op.add_column("tracks", sa.Column("updated_at", sa.DateTime(), nullable=False))
    op.drop_column("tracks", "timestamp")
    op.add_column("users", sa.Column("created_at", sa.DateTime(), nullable=False))
    op.add_column("users", sa.Column("updated_at", sa.DateTime(), nullable=False))
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_column("users", "updated_at")
    op.drop_column("users", "created_at")
    op.add_column(
        "tracks",
        sa.Column(
            "timestamp", postgresql.TIMESTAMP(), autoincrement=False, nullable=False
        ),
    )
    op.drop_column("tracks", "updated_at")
    op.drop_column("tracks", "license")
    op.drop_column("tracks", "iswc")
    op.drop_column("tracks", "isrc")
    op.drop_column("tracks", "description")
    op.drop_column("tracks", "created_at")
    op.add_column(
        "saves",
        sa.Column(
            "timestamp", postgresql.TIMESTAMP(), autoincrement=False, nullable=False
        ),
    )
    op.drop_column("saves", "created_at")
    op.add_column(
        "reposts",
        sa.Column(
            "timestamp", postgresql.TIMESTAMP(), autoincrement=False, nullable=False
        ),
    )
    op.drop_column("reposts", "created_at")
    op.add_column(
        "playlists",
        sa.Column(
            "timestamp", postgresql.TIMESTAMP(), autoincrement=False, nullable=False
        ),
    )
    op.drop_column("playlists", "updated_at")
    op.drop_column("playlists", "upc")
    op.drop_column("playlists", "created_at")
    op.add_column(
        "follows",
        sa.Column(
            "timestamp", postgresql.TIMESTAMP(), autoincrement=False, nullable=False
        ),
    )
    op.drop_column("follows", "created_at")
    # ### end Alembic commands ###
