import math
from datetime import datetime, timedelta

from integration_tests.utils import populate_mock_db
from src.models.related_artist import RelatedArtist
from src.queries.get_related_artists import (
    _calculate_related_artists_scores,
    get_related_artists,
    update_related_artist_scores_if_needed,
)
from src.utils.db_session import get_db

entities = {
    "users": [{}] * 8,
    "follows": [
        # at least 200 followers for user_0
        {"follower_user_id": i, "followee_user_id": 0}
        for i in range(1, 201)
    ]
    # 50 mutual followers between user_1 & user_0 make up 100% of user_1 followers = score 50
    + [{"follower_user_id": i, "followee_user_id": 1} for i in range(151, 201)]
    # 50 mutual followers between user_2 & user_0 make up 50% of user_2 followers = score 25
    + [{"follower_user_id": i, "followee_user_id": 2} for i in range(151, 251)]
    # 20 mutual followers between user_3 & user_0 make up 50% of user_3 followers = score 10
    + [{"follower_user_id": i, "followee_user_id": 3} for i in range(181, 221)]
    # 4 mutual followers between user_4 & user_0 make up 80% of user_4 followers = score 3.2
    + [{"follower_user_id": i, "followee_user_id": 4} for i in range(197, 202)]
    # 50 mutual followers between user_5 & user_0 make up 10% of user_5 followers = score 5
    + [{"follower_user_id": i, "followee_user_id": 5} for i in range(151, 651)]
    # 60 mutual followers between user_5 & user_0 make up 30% of user_6 followers = score 18
    + [{"follower_user_id": i, "followee_user_id": 6} for i in range(141, 341)],
    # User ID 8 has no followers
    "tracks": [{"owner_id": i} for i in range(0, 8)],
}


def test_calculate_related_artists_scores(app):

    with app.app_context():
        db = get_db()

    populate_mock_db(db, entities)

    with db.scoped_session() as session:
        # Check sampled (with large enough sample to get all rows for deterministic result)
        rows = _calculate_related_artists_scores(
            session,
            0,
            sample_size=200 + 50 + 100 + 40 + 5 + 500 + 200,  # sum of all the follows
        )
        assert rows[0].related_artist_user_id == 1 and math.isclose(
            rows[0].score, 50, abs_tol=0.001
        )
        assert rows[1].related_artist_user_id == 2 and math.isclose(
            rows[1].score, 25, abs_tol=0.001
        )
        assert rows[2].related_artist_user_id == 6 and math.isclose(
            rows[2].score, 18, abs_tol=0.001
        )
        assert rows[3].related_artist_user_id == 3 and math.isclose(
            rows[3].score, 10, abs_tol=0.001
        )
        assert rows[4].related_artist_user_id == 5 and math.isclose(
            rows[4].score, 5, abs_tol=0.001
        )
        assert rows[5].related_artist_user_id == 4 and math.isclose(
            rows[5].score, 3.2, abs_tol=0.001
        )

        # Check unsampled
        rows = _calculate_related_artists_scores(session, 0)
        assert rows[0].related_artist_user_id == 1 and math.isclose(
            rows[0].score, 50, abs_tol=0.001
        )
        assert rows[1].related_artist_user_id == 2 and math.isclose(
            rows[1].score, 25, abs_tol=0.001
        )
        assert rows[2].related_artist_user_id == 6 and math.isclose(
            rows[2].score, 18, abs_tol=0.001
        )
        assert rows[3].related_artist_user_id == 3 and math.isclose(
            rows[3].score, 10, abs_tol=0.001
        )
        assert rows[4].related_artist_user_id == 5 and math.isclose(
            rows[4].score, 5, abs_tol=0.001
        )
        assert rows[5].related_artist_user_id == 4 and math.isclose(
            rows[5].score, 3.2, abs_tol=0.001
        )

        # Check edge case with 0 followers
        populate_mock_db(
            db, {"follows": [{"follower_user_id": 100, "followee_user_id": 7}]}
        )
        rows = _calculate_related_artists_scores(session, 0)
        # Same results as unsampled. Shouldn't throw DivideByZero exception
        assert rows[0].related_artist_user_id == 1 and math.isclose(
            rows[0].score, 50, abs_tol=0.001
        )
        assert rows[1].related_artist_user_id == 2 and math.isclose(
            rows[1].score, 25, abs_tol=0.001
        )
        assert rows[2].related_artist_user_id == 6 and math.isclose(
            rows[2].score, 18, abs_tol=0.001
        )
        assert rows[3].related_artist_user_id == 3 and math.isclose(
            rows[3].score, 10, abs_tol=0.001
        )
        assert rows[4].related_artist_user_id == 5 and math.isclose(
            rows[4].score, 5, abs_tol=0.001
        )
        assert rows[5].related_artist_user_id == 4 and math.isclose(
            rows[5].score, 3.2, abs_tol=0.001
        )


def test_update_related_artist_scores_if_needed(app):
    """Tests all cases of update_related_artist_scores_if_needed: not enough followers, existing fresh scores,
    and needing recalculation"""
    with app.app_context():
        db = get_db()

    with db.scoped_session() as session:
        result, _ = update_related_artist_scores_if_needed(session, 0)
        assert not result, "Don't calculate for low number of followers"
        populate_mock_db(db, entities)
        result, _ = update_related_artist_scores_if_needed(session, 0)
        assert result, "Calculate when followers >= MIN_FOLLOWER_REQUIREMENT (200)"
        result, _ = update_related_artist_scores_if_needed(session, 0)
        assert (
            not result
        ), "Don't calculate when scores are already calculated and fresh"
        session.query(RelatedArtist).update(
            {RelatedArtist.created_at: datetime.utcnow() - timedelta(weeks=5)}
        )
        session.commit()
        result, _ = update_related_artist_scores_if_needed(session, 0)
        assert result, "Calculate when the scores are stale"


def test_get_related_artists_too_few_followers(app):
    """Tests that artists with too few followers get an empty list"""
    with app.app_context():
        db = get_db()
        populate_mock_db(db, entities)
        artists = get_related_artists(1, None)
        assert len(artists) == 0
