import logging
from typing import List

from integration_tests.utils import populate_mock_db
from sqlalchemy import asc
from src.models.notifications.notification import Notification
from src.utils.db_session import get_db

logger = logging.getLogger(__name__)


# ========================================== Start Tests ==========================================
def test_repost_notification(app):
    """Tests that a repost notification is created on repost  correctly"""
    with app.app_context():
        db = get_db()

    # Insert a follow and check that a notificaiton is created for the followee
    entities = {
        "users": [{"user_id": i + 1} for i in range(5)],
        "follows": [
            {"follower_user_id": i + 2, "followee_user_id": i + 1} for i in range(4)
        ],
    }
    populate_mock_db(db, entities)

    with db.scoped_session() as session:

        notifications: List[Notification] = (
            session.query(Notification).order_by(asc(Notification.blocknumber)).all()
        )
        assert len(notifications) == 4
        assert notifications[0].specifier == "follow:1"
        assert notifications[1].specifier == "follow:2"
        assert notifications[2].specifier == "follow:3"
        assert notifications[3].specifier == "follow:4"
        assert notifications[0].notification_group_id == None
        assert notifications[0].type == "follow"
        assert notifications[0].slot == None
        assert notifications[0].blocknumber == 0
        assert notifications[0].data == {"followee_user_id": 1, "follower_user_id": 2}
        assert notifications[0].user_ids == [1]
