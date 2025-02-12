"""Enable update with users rename

Revision ID: 2571ec7593c7
Revises: 
Create Date: 2018-11-27 17:24:52.534597

"""
import sqlalchemy as sa
from alembic import context, op

# revision identifiers, used by Alembic.
revision = "2571ec7593c7"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "blocks",
        sa.Column("blockhash", sa.String(), nullable=False),
        sa.Column("parenthash", sa.String(), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=True),
        sa.PrimaryKeyConstraint("blockhash"),
    )
    # Initialize the blocks table to contain one current row,
    # after which, indexing will begin to add more rows.
    # When running in test config, do not initialize the table
    # as many tests depend on clear database state.
    mode = context.config.get_main_option("mode")
    if mode != "test":
        op.execute("""
            INSERT INTO "blocks"
            ("blockhash", "parenthash", "is_current")
            VALUES
            (
                '0x0',
                NULL,
                TRUE
            )
        """)

    op.create_table(
        "tracks",
        sa.Column("blockhash", sa.String(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("is_delete", sa.Boolean(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("length", sa.Integer(), nullable=True),
        sa.Column("cover_art", sa.String(), nullable=True),
        sa.Column("tags", sa.String(), nullable=True),
        sa.Column("genre", sa.String(), nullable=True),
        sa.Column("mood", sa.String(), nullable=True),
        sa.Column("credits_splits", sa.String(), nullable=True),
        sa.Column("create_date", sa.String(), nullable=True),
        sa.Column("release_date", sa.String(), nullable=True),
        sa.Column("file_type", sa.String(), nullable=True),
        sa.Column("file_multihash", sa.String(), nullable=False),
        sa.Column("metadata_multihash", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("is_current", "track_id", "blockhash"),
    )
    op.create_table(
        "users",
        sa.Column("blockhash", sa.String(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("handle", sa.String(), nullable=True),
        sa.Column("wallet", sa.String(), nullable=True),
        sa.Column("is_creator", sa.Boolean(), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("profile_picture", sa.String(), nullable=True),
        sa.Column("cover_photo", sa.String(), nullable=True),
        sa.Column("bio", sa.String(), nullable=True),
        sa.Column("location", sa.String(), nullable=True),
        sa.Column("metadata_multihash", sa.String(), nullable=True),
        sa.Column("creator_node_endpoint", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(
            ["blockhash"],
            ["blocks.blockhash"],
        ),
        sa.PrimaryKeyConstraint("is_current", "user_id", "blockhash"),
    )


def downgrade():
    op.drop_table("users")
    op.drop_table("tracks")
    op.drop_table("blocks")
