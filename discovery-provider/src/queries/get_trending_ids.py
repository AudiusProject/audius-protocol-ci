import logging
from src.utils.redis_cache import extract_key, use_redis_cache
from src.queries.get_trending import TRENDING_TTL_SEC, get_trending

logger = logging.getLogger(__name__)

request_cache_path = '/v1/full/tracks/trending'

def get_time_trending(cache_args, time, limit):
    time_params = {**cache_args, 'time':time}
    time_cache_key = extract_key(request_cache_path, time_params.items())
    time_trending = use_redis_cache(time_cache_key, TRENDING_TTL_SEC, lambda: get_trending(time_params))
    time_trending_track_ids = [{"track_id": track['track_id']} for track in time_trending]
    time_trending_track_ids = time_trending_track_ids[:limit]
    return time_trending_track_ids

def get_trending_ids(args):
    """
    Fetches the ids of the trending tracks using the route's cache

    Args:
        args: (dict) The args of the request
        args.limit: (number) The number of track ids to return
        args.genre: (string?) The genre to fetch the trending tracks for

    Returns:
        trending_times_id: (dict) Dictionary containing the week/month/year trending track ids
    """

    cache_args = {}
    limit = args['limit']
    if "genre" in args:
        cache_args['genre'] = args["genre"]

    week_trending_track_ids = get_time_trending(cache_args, 'week', limit)
    month_trending_track_ids = get_time_trending(cache_args, 'month', limit)
    year_trending_track_ids = get_time_trending(cache_args, 'year', limit)

    return {
        "week": week_trending_track_ids,
        "month": month_trending_track_ids,
        "year": year_trending_track_ids
    }
