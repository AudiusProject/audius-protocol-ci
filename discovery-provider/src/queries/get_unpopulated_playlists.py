import datetime
import json
from flask.json import dumps

from src.utils import redis_connection
from src.models import Playlist
from src.utils import helpers

ttl_sec = 60


def get_playlist_id_cache_key(id):
    return "playlist:id:{}".format(id)


def get_cached_playlists(playlist_ids):
    redis_playlist_id_keys = map(get_playlist_id_cache_key, playlist_ids)
    redis = redis_connection.get_redis()
    cached_values = redis.mget(redis_playlist_id_keys)

    playlists = []
    for val in cached_values:
        if val is not None:
            playlist = json.loads(val)
            playlist["created_at"] = datetime.datetime.fromisoformat(playlist["created_at"])
            playlist["updated_at"] = datetime.datetime.fromisoformat(playlist["updated_at"])
            playlists.append(playlist)
        else:
            playlists.append(None)
    return playlists


def set_playlists_in_cache(playlists):
    redis = redis_connection.get_redis()
    for playlist in playlists:
        key = get_playlist_id_cache_key(playlist['playlist_id'])
        serialized = dumps(playlist, cls=helpers.DateTimeEncoder)
        redis.set(key, serialized, ttl_sec)


def get_unpopulated_playlists(session, playlist_ids, filter_deleted=False):
    """
    Fetches playlists by checking the redis cache first then
    going to DB and writes to cache if not present

    Args:
        session: DB session
        playlist_ids: array A list of playlist ids

    Returns:
        Array of playlists
    """
    # Check the cached playlists
    cached_playlists_results = get_cached_playlists(playlist_ids)
    has_all_playlists_cached = cached_playlists_results.count(None) == 0
    if has_all_playlists_cached:
        if filter_deleted:
            return list(filter(lambda playlist: not playlist['is_delete'], cached_playlists_results))
        return cached_playlists_results

    # Create a dict of cached playlists
    cached_playlists = {}
    for cached_playlist in cached_playlists_results:
        if cached_playlist:
            cached_playlists[cached_playlist['playlist_id']] = cached_playlist

    playlist_ids_to_fetch = filter(
        lambda playlist_id: playlist_id not in cached_playlists, playlist_ids)

    playlists_query = (
        session
        .query(Playlist)
        .filter(Playlist.is_current == True)
        .filter(Playlist.playlist_id.in_(playlist_ids_to_fetch))
    )
    if filter_deleted:
        playlists_query = playlists_query.filter(Playlist.is_delete == False)

    playlists = playlists_query.all()
    playlists = helpers.query_result_to_list(playlists)
    queried_playlists = {playlist['playlist_id']: playlist for playlist in playlists}

    # cache playlists for future use
    set_playlists_in_cache(playlists)

    playlists_response = []
    for playlist_id in playlist_ids:
        if playlist_id in cached_playlists:
            if not filter_deleted or not cached_playlists[playlist_id]['is_delete']:
                playlists_response.append(cached_playlists[playlist_id])
        elif playlist_id in queried_playlists:
            playlists_response.append(queried_playlists[playlist_id])

    return playlists_response
