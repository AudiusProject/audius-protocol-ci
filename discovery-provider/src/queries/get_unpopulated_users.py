import datetime
import json
from flask.json import dumps

from src.utils import redis_connection
from src.models import User
from src.utils import helpers

ttl_sec = 60


def get_user_id_cache_key(id):
    return "user:id:{}".format(id)


def get_cached_users(user_ids):
    redis_user_id_keys = map(get_user_id_cache_key, user_ids)
    redis = redis_connection.get_redis()
    cached_values = redis.mget(redis_user_id_keys)

    users = []
    for val in cached_values:
        if val is not None:
            user = json.loads(val)
            user["created_at"] = datetime.datetime.fromisoformat(user["created_at"])
            user["updated_at"] = datetime.datetime.fromisoformat(user["updated_at"])
            users.append(user)
        else:
            users.append(None)
    return users


def set_users_in_cache(users):
    redis = redis_connection.get_redis()
    for user in users:
        key = get_user_id_cache_key(user['user_id'])
        serialized = dumps(user, cls=helpers.DateTimeEncoder)
        redis.set(key, serialized, ttl_sec)


def get_unpopulated_users(session, user_ids):
    """
    Fetches users by checking the redis cache first then
    going to DB and writes to cache if not present

    Args:
        session: DB session
        user_ids: array A list of user ids

    Returns:
        Array of users
    """
    cached_users_results = get_cached_users(user_ids)
    has_all_users_cached = cached_users_results.count(None) == 0
    if has_all_users_cached:
        return cached_users_results

    cached_users = {}
    for cached_user in cached_users_results:
        if cached_user:
            cached_users[cached_user['user_id']] = cached_user

    user_ids_to_fetch = filter(
        lambda user_id: user_id not in cached_users, user_ids)

    users = (
        session
        .query(User)
        .filter(User.is_current == True, User.wallet != None, User.handle != None)
        .filter(User.user_id.in_(user_ids_to_fetch))
        .all()
    )
    users = helpers.query_result_to_list(users)
    queried_users = {user['user_id']: user for user in users}

    set_users_in_cache(users)

    users_response = []
    for user_id in user_ids:
        if user_id in cached_users:
            users_response.append(cached_users[user_id])
        elif user_id in queried_users:
            users_response.append(queried_users[user_id])

    return users_response
