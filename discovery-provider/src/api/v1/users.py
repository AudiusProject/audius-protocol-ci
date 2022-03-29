import logging

from flask_restx import Namespace, Resource, fields, reqparse
from src.api.v1.helpers import (
    abort_bad_request_param,
    abort_not_found,
    current_user_parser,
    decode_with_abort,
    extend_activity,
    extend_challenge_response,
    extend_favorite,
    extend_track,
    extend_user,
    format_limit,
    format_offset,
    get_current_user_id,
    get_default_max,
    make_full_response,
    make_response,
    pagination_parser,
    pagination_with_current_user_parser,
    search_parser,
    success_response,
)
from src.api.v1.models.common import favorite
from src.api.v1.models.users import (
    associated_wallets,
    challenge_response,
    connected_wallets,
    encoded_user_id,
    user_model,
    user_model_full,
    user_replica_set,
)
from src.api.v1.playlists import get_tracks_for_playlist
from src.challenges.challenge_event_bus import setup_challenge_bus
from src.queries.get_associated_user_id import get_associated_user_id
from src.queries.get_associated_user_wallet import get_associated_user_wallet
from src.queries.get_challenges import get_challenges
from src.queries.get_followees_for_user import get_followees_for_user
from src.queries.get_followers_for_user import get_followers_for_user
from src.queries.get_related_artists import get_related_artists
from src.queries.get_repost_feed_for_user import get_repost_feed_for_user
from src.queries.get_save_tracks import get_save_tracks
from src.queries.get_saves import get_saves
from src.queries.get_top_genre_users import get_top_genre_users
from src.queries.get_top_user_track_tags import get_top_user_track_tags
from src.queries.get_top_users import get_top_users
from src.queries.get_tracks import get_tracks
from src.queries.get_user_listening_history import (
    GetUserListeningHistoryArgs,
    get_user_listening_history,
)
from src.queries.get_users import get_users
from src.queries.get_users_cnode import ReplicaType, get_users_cnode
from src.queries.search_queries import SearchKind, search
from src.utils.auth_middleware import auth_middleware
from src.utils.db_session import get_db_read_replica
from src.utils.helpers import encode_int_id
from src.utils.redis_cache import cache
from src.utils.redis_metrics import record_metrics

from .models.activities import activity_model, activity_model_full
from .models.tracks import track, track_full

logger = logging.getLogger(__name__)

ns = Namespace("users", description="User related operations")
full_ns = Namespace("users", description="Full user operations")

user_response = make_response("user_response", ns, fields.Nested(user_model))
full_user_response = make_full_response(
    "full_user_response", full_ns, fields.List(fields.Nested(user_model_full))
)


def get_single_user(user_id, current_user_id):
    args = {"id": [user_id], "current_user_id": current_user_id}
    users = get_users(args)
    if not users:
        abort_not_found(user_id, ns)
    user = extend_user(users[0], current_user_id)
    return success_response(user)


USER_ROUTE = "/<string:id>"


@ns.route(USER_ROUTE)
class User(Resource):
    @record_metrics
    @ns.doc(
        id="""Get User""",
        description="Gets a single user by their encoded user ID",
        params={"id": "The user's id"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @ns.marshal_with(user_response)
    @cache(ttl_sec=5)
    def get(self, user_id):
        user_id = decode_with_abort(user_id, ns)
        return get_single_user(user_id, None)


@full_ns.route(USER_ROUTE)
class FullUser(Resource):
    @record_metrics
    @ns.doc(
        id="""Get User""",
        description="Gets a single user by their encoded user ID",
        params={"id": "A user ID"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @full_ns.expect(current_user_parser)
    @full_ns.marshal_with(full_user_response)
    @cache(ttl_sec=5)
    def get(self, user_id):
        user_id = decode_with_abort(user_id, ns)
        args = current_user_parser.parse_args()
        current_user_id = get_current_user_id(args)

        return get_single_user(user_id, current_user_id)


@full_ns.route("/handle/<string:handle>")
class FullUserHandle(Resource):
    @record_metrics
    @ns.doc(
        id="""Get User by Handle""",
        description="Gets a single user by their handle",
        params={"handle": "A user handle"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @full_ns.expect(current_user_parser)
    @full_ns.marshal_with(full_user_response)
    @cache(ttl_sec=5)
    def get(self, handle):
        args = current_user_parser.parse_args()
        current_user_id = get_current_user_id(args)

        args = {"handle": handle, "current_user_id": current_user_id}
        users = get_users(args)
        if not users:
            abort_not_found(handle, ns)
        user = extend_user(users[0])
        return success_response(user)


USER_TRACKS_ROUTE = "/<string:id>/tracks"
user_tracks_route_parser = pagination_with_current_user_parser.copy()
user_tracks_route_parser.add_argument(
    "sort",
    required=False,
    type=str,
    default="date",
    choices=("date", "plays"),
    help="Field to sort by",
)

tracks_response = make_response(
    "tracks_response", ns, fields.List(fields.Nested(track))
)


@ns.route(USER_TRACKS_ROUTE)
class TrackList(Resource):
    @record_metrics
    @ns.doc(
        id="""Get Tracks""",
        description="""Gets the tracks created by a user using the encoded user ID""",
        params={
            "id": "A User ID",
        },
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @ns.expect(user_tracks_route_parser)
    @ns.marshal_with(tracks_response)
    @auth_middleware()
    @cache(ttl_sec=5)
    def get(self, user_id, authed_user_id=None):
        decoded_id = decode_with_abort(user_id, ns)
        args = user_tracks_route_parser.parse_args()

        current_user_id = get_current_user_id(args)

        sort = args.get("sort", None)
        offset = format_offset(args)
        limit = format_limit(args)

        args = {
            "user_id": decoded_id,
            "authed_user_id": authed_user_id,
            "current_user_id": current_user_id,
            "with_users": True,
            "filter_deleted": True,
            "sort": sort,
            "limit": limit,
            "offset": offset,
        }
        tracks = get_tracks(args)
        tracks = list(map(extend_track, tracks))
        return success_response(tracks)


full_tracks_response = make_full_response(
    "full_tracks", full_ns, fields.List(fields.Nested(track_full))
)


@full_ns.route(USER_TRACKS_ROUTE)
class FullTrackList(Resource):
    @record_metrics
    @full_ns.doc(
        id="""Get Tracks""",
        description="""Gets the tracks created by a user using the encoded user ID""",
        params={
            "id": "A User ID",
        },
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @full_ns.expect(user_tracks_route_parser)
    @full_ns.marshal_with(full_tracks_response)
    @auth_middleware()
    @cache(ttl_sec=5)
    def get(self, user_id, authed_user_id=None):
        decoded_id = decode_with_abort(user_id, ns)
        args = user_tracks_route_parser.parse_args()

        current_user_id = get_current_user_id(args)

        sort = args.get("sort", None)
        offset = format_offset(args)
        limit = format_limit(args)

        args = {
            "user_id": decoded_id,
            "current_user_id": current_user_id,
            "authed_user_id": authed_user_id,
            "with_users": True,
            "filter_deleted": True,
            "sort": sort,
            "limit": limit,
            "offset": offset,
        }
        tracks = get_tracks(args)
        tracks = list(map(extend_track, tracks))
        return success_response(tracks)


@full_ns.route("/handle/<string:handle>/tracks")
class HandleFullTrackList(Resource):
    @record_metrics
    @full_ns.doc(
        id="""Get Tracks by Handle""",
        description="""Gets the tracks created by a user using the user's handle""",
        params={
            "handle": "A User handle",
        },
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @full_ns.expect(user_tracks_route_parser)
    @full_ns.marshal_with(full_tracks_response)
    @auth_middleware()
    @cache(ttl_sec=5)
    def get(self, handle, authed_user_id=None):
        """Fetch a list of tracks for a user."""
        args = user_tracks_route_parser.parse_args()

        current_user_id = get_current_user_id(args)

        sort = args.get("sort", None)
        offset = format_offset(args)
        limit = format_limit(args)

        args = {
            "handle": handle,
            "current_user_id": current_user_id,
            "authed_user_id": authed_user_id,
            "with_users": True,
            "filter_deleted": True,
            "sort": sort,
            "limit": limit,
            "offset": offset,
        }
        tracks = get_tracks(args)
        tracks = list(map(extend_track, tracks))
        return success_response(tracks)


USER_REPOSTS_ROUTE = "/<string:id>/reposts"

reposts_response = make_response(
    "reposts", ns, fields.List(fields.Nested(activity_model))
)


@ns.route(USER_REPOSTS_ROUTE)
class RepostList(Resource):
    @record_metrics
    @ns.doc(
        id="""Get Reposts""",
        description="""Gets the given user's reposts""",
        params={
            "id": "A User ID",
        },
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @ns.expect(pagination_with_current_user_parser)
    @ns.marshal_with(reposts_response)
    @cache(ttl_sec=5)
    def get(self, user_id):
        decoded_id = decode_with_abort(user_id, ns)
        args = pagination_with_current_user_parser.parse_args()

        current_user_id = get_current_user_id(args)

        offset = format_offset(args)
        limit = format_limit(args)

        args = {
            "user_id": decoded_id,
            "current_user_id": current_user_id,
            "with_users": True,
            "filter_deleted": True,
            "limit": limit,
            "offset": offset,
        }
        reposts = get_repost_feed_for_user(decoded_id, args)
        activities = list(map(extend_activity, reposts))

        return success_response(activities)


full_reposts_response = make_full_response(
    "full_reposts", full_ns, fields.List(fields.Nested(activity_model_full))
)


@full_ns.route(USER_REPOSTS_ROUTE)
class FullRepostList(Resource):
    @record_metrics
    @full_ns.doc(
        id="""Get Reposts""",
        description="""Gets the given user's reposts""",
        params={
            "id": "A User ID",
        },
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @full_ns.expect(pagination_with_current_user_parser)
    @full_ns.marshal_with(full_reposts_response)
    @cache(ttl_sec=5)
    def get(self, user_id):
        decoded_id = decode_with_abort(user_id, ns)
        args = pagination_with_current_user_parser.parse_args()

        current_user_id = get_current_user_id(args)

        offset = format_offset(args)
        limit = format_limit(args)

        args = {
            "current_user_id": current_user_id,
            "with_users": True,
            "filter_deleted": True,
            "limit": limit,
            "offset": offset,
        }
        reposts = get_repost_feed_for_user(decoded_id, args)
        for repost in reposts:
            if "playlist_id" in repost:
                repost["tracks"] = get_tracks_for_playlist(
                    repost["playlist_id"], current_user_id
                )
        activities = list(map(extend_activity, reposts))

        return success_response(activities)


@full_ns.route("/handle/<string:handle>/reposts")
class HandleFullRepostList(Resource):
    @record_metrics
    @full_ns.doc(
        id="""Get Reposts by Handle""",
        description="""Gets the user's reposts by the user handle""",
        params={
            "handle": "A User handle",
        },
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @full_ns.expect(pagination_with_current_user_parser)
    @full_ns.marshal_with(full_reposts_response)
    @cache(ttl_sec=5)
    def get(self, handle):
        args = pagination_with_current_user_parser.parse_args()

        current_user_id = get_current_user_id(args)
        offset = format_offset(args)
        limit = format_limit(args)

        args = {
            "handle": handle,
            "current_user_id": current_user_id,
            "with_users": True,
            "filter_deleted": True,
            "limit": limit,
            "offset": offset,
        }
        reposts = get_repost_feed_for_user(None, args)
        for repost in reposts:
            if "playlist_id" in repost:
                repost["tracks"] = get_tracks_for_playlist(
                    repost["playlist_id"], current_user_id
                )
        activities = list(map(extend_activity, reposts))

        return success_response(activities)


favorites_response = make_response(
    "favorites_response", ns, fields.List(fields.Nested(favorite))
)


@ns.route("/<string:id>/favorites")
class FavoritedTracks(Resource):
    @record_metrics
    @ns.doc(
        id="""Get Favorites""",
        description="""Gets a user's favorite tracks""",
        params={"id": "A User ID"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @ns.marshal_with(favorites_response)
    @cache(ttl_sec=5)
    def get(self, user_id):
        decoded_id = decode_with_abort(user_id, ns)
        favorites = get_saves("tracks", decoded_id)
        favorites = list(map(extend_favorite, favorites))
        return success_response(favorites)


tags_route_parser = pagination_with_current_user_parser.copy()
tags_route_parser.remove_argument("offset")
tags_response = make_response("tags_response", ns, fields.List(fields.String))


@ns.route("/<string:id>/tags")
class MostUsedTags(Resource):
    @record_metrics
    @ns.doc(
        id="""Get Top Track Tags""",
        description="""Gets the most used track tags by a user.""",
        params={"id": "A User ID"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @full_ns.expect(tags_route_parser)
    @ns.marshal_with(tags_response)
    @cache(ttl_sec=60 * 5)
    def get(self, user_id):
        """Fetch most used tags in a user's tracks."""
        decoded_id = decode_with_abort(user_id, ns)
        args = tags_route_parser.parse_args()
        limit = format_limit(args)
        tags = get_top_user_track_tags({"user_id": decoded_id, "limit": limit})
        return success_response(tags)


favorites_response = make_full_response(
    "favorites_response_full", full_ns, fields.List(fields.Nested(activity_model_full))
)


@full_ns.route("/<string:id>/favorites/tracks")
class FavoritedTracksFull(Resource):
    @record_metrics
    @full_ns.doc(
        id="""Get Favorites""",
        description="""Gets a user's favorite tracks""",
        params={"user_id": "A User ID"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @full_ns.expect(pagination_with_current_user_parser)
    @full_ns.marshal_with(favorites_response)
    @cache(ttl_sec=5)
    def get(self, user_id):
        """Fetch favorited tracks for a user."""
        args = pagination_with_current_user_parser.parse_args()
        decoded_id = decode_with_abort(user_id, ns)
        current_user_id = get_current_user_id(args)

        offset = format_offset(args)
        limit = format_limit(args)
        get_tracks_args = {
            "filter_deleted": False,
            "user_id": decoded_id,
            "current_user_id": current_user_id,
            "limit": limit,
            "offset": offset,
            "with_users": True,
        }
        track_saves = get_save_tracks(get_tracks_args)
        tracks = list(map(extend_activity, track_saves))
        return success_response(tracks)


history_response = make_full_response(
    "history_response_full", full_ns, fields.List(fields.Nested(activity_model_full))
)


@full_ns.route("/<string:id>/history/tracks")
class TrackHistoryFull(Resource):
    @record_metrics
    @full_ns.doc(
        id="""Get User's Track History""",
        params={"user_id": "A User ID"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @full_ns.expect(pagination_with_current_user_parser)
    @full_ns.marshal_with(history_response)
    @cache(ttl_sec=5)
    def get(self, user_id):
        args = pagination_with_current_user_parser.parse_args()
        decoded_id = decode_with_abort(user_id, ns)
        current_user_id = get_current_user_id(args)
        offset = format_offset(args)
        limit = format_limit(args)
        get_tracks_args = GetUserListeningHistoryArgs(
            user_id=decoded_id,
            current_user_id=current_user_id,
            limit=limit,
            offset=offset,
        )
        track_history = get_user_listening_history(get_tracks_args)
        tracks = list(map(extend_activity, track_history))
        return success_response(tracks)


user_search_result = make_response(
    "user_search", ns, fields.List(fields.Nested(user_model))
)


@ns.route("/search")
class UserSearchResult(Resource):
    @record_metrics
    @ns.doc(
        id="""Search Users""",
        params={"query": "Search query"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @ns.expect(search_parser)
    @ns.marshal_with(user_search_result)
    @cache(ttl_sec=600)
    def get(self):
        args = search_parser.parse_args()
        query = args["query"]
        if not query:
            abort_bad_request_param("query", ns)
        search_args = {
            "query": query,
            "kind": SearchKind.users.name,
            "is_auto_complete": False,
            "current_user_id": None,
            "with_users": True,
            "limit": 10,
            "offset": 0,
        }
        response = search(search_args)
        users = response["users"]
        users = list(map(extend_user, users))
        return success_response(users)


followers_response = make_full_response(
    "followers_response", full_ns, fields.List(fields.Nested(user_model_full))
)


@full_ns.route("/<string:id>/followers")
class FollowerUsers(Resource):
    @record_metrics
    @ns.doc(
        id="""Get Followers""",
        description="""All users that follow the provided user""",
        params={"id": "A User ID"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @ns.expect(pagination_with_current_user_parser)
    @full_ns.marshal_with(followers_response)
    @cache(ttl_sec=5)
    def get(self, user_id):
        decoded_id = decode_with_abort(user_id, full_ns)
        args = pagination_with_current_user_parser.parse_args()
        limit = get_default_max(args.get("limit"), 10, 100)
        offset = get_default_max(args.get("offset"), 0)
        current_user_id = get_current_user_id(args)
        args = {
            "followee_user_id": decoded_id,
            "current_user_id": current_user_id,
            "limit": limit,
            "offset": offset,
        }
        users = get_followers_for_user(args)
        users = list(map(extend_user, users))
        return success_response(users)


following_response = make_full_response(
    "following_response", full_ns, fields.List(fields.Nested(user_model_full))
)


@full_ns.route("/<string:id>/following")
class FollowingUsers(Resource):
    @record_metrics
    @full_ns.doc(
        id="""Get Followings""",
        description="""All users that the provided user follows""",
        params={"id": "A User ID"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @full_ns.expect(pagination_with_current_user_parser)
    @full_ns.marshal_with(following_response)
    @cache(ttl_sec=5)
    def get(self, user_id):
        decoded_id = decode_with_abort(user_id, full_ns)
        args = pagination_with_current_user_parser.parse_args()
        limit = get_default_max(args.get("limit"), 10, 100)
        offset = get_default_max(args.get("offset"), 0)
        current_user_id = get_current_user_id(args)
        args = {
            "follower_user_id": decoded_id,
            "current_user_id": current_user_id,
            "limit": limit,
            "offset": offset,
        }
        users = get_followees_for_user(args)
        users = list(map(extend_user, users))
        return success_response(users)


related_artist_route_parser = pagination_with_current_user_parser.copy()
related_artist_route_parser.remove_argument("offset")
related_artist_response = make_full_response(
    "related_artist_response", full_ns, fields.List(fields.Nested(user_model_full))
)


@full_ns.route("/<string:id>/related")
class RelatedUsers(Resource):
    @record_metrics
    @full_ns.doc(
        id="""Get Related Users""",
        description="""Gets a list of users that might be of interest to followers of this user.""",
        params={"user_id": "A User ID"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @full_ns.expect(related_artist_route_parser)
    @full_ns.marshal_with(related_artist_response)
    @cache(ttl_sec=5)
    def get(self, user_id):
        args = related_artist_route_parser.parse_args()
        limit = get_default_max(args.get("limit"), 10, 100)
        current_user_id = get_current_user_id(args)
        decoded_id = decode_with_abort(user_id, full_ns)
        users = get_related_artists(decoded_id, current_user_id, limit)
        users = list(map(extend_user, users))
        return success_response(users)


top_genre_users_route_parser = pagination_parser.copy()
top_genre_users_route_parser.add_argument("genre", required=False, action="append")
top_genre_users_response = make_full_response(
    "top_genre_users_response", full_ns, fields.List(fields.Nested(user_model_full))
)


@full_ns.route("/genre/top")
class FullTopGenreUsers(Resource):
    @full_ns.expect(top_genre_users_route_parser)
    @full_ns.doc(
        id="""Get Top Users In Genre""",
        description="""Get the Top Users for a Given Genre""",
        params={"genre": "List of Genres"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @full_ns.marshal_with(top_genre_users_response)
    @cache(ttl_sec=60 * 60 * 24)
    def get(self):
        args = top_genre_users_route_parser.parse_args()
        limit = get_default_max(args.get("limit"), 10, 100)
        offset = get_default_max(args.get("offset"), 0)

        get_top_genre_users_args = {
            "limit": limit,
            "offset": offset,
            "with_users": True,
        }
        if args["genre"] is not None:
            get_top_genre_users_args["genre"] = args["genre"]
        top_users = get_top_genre_users(get_top_genre_users_args)
        users = list(map(extend_user, top_users["users"]))
        return success_response(users)


top_users_response = make_full_response(
    "top_users_response", full_ns, fields.List(fields.Nested(user_model_full))
)


@full_ns.route("/top")
class FullTopUsers(Resource):
    @full_ns.doc(
        id="""Get Top Users""",
        description="""Get the Top Users having at least one track by follower count""",
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @full_ns.expect(pagination_with_current_user_parser)
    @full_ns.marshal_with(top_users_response)
    @cache(ttl_sec=60 * 60 * 24)
    def get(self):
        args = pagination_with_current_user_parser.parse_args()
        current_user_id = get_current_user_id(args)

        top_users = get_top_users(current_user_id)
        users = list(map(extend_user, top_users))
        return success_response(users)


associated_wallet_route_parser = reqparse.RequestParser()
associated_wallet_route_parser.add_argument("id", required=True)
associated_wallet_response = make_response(
    "associated_wallets_response", ns, fields.Nested(associated_wallets)
)


@ns.deprecated
@ns.route(
    "/associated_wallets",
    doc={"description": "(Deprecated in favor of `/<user_id>/connected_wallets`)"},
)
class AssociatedWalletByUserId(Resource):
    @ns.doc(
        id="""Get Associated Wallets""",
        description="""Get the User's associated wallets""",
        params={"id": "A User ID"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @ns.expect(associated_wallet_route_parser)
    @ns.marshal_with(associated_wallet_response)
    @cache(ttl_sec=10)
    def get(self):
        args = associated_wallet_route_parser.parse_args()
        user_id = decode_with_abort(args.get("id"), ns)
        wallets = get_associated_user_wallet({"user_id": user_id})
        return success_response(
            {"wallets": wallets["eth"], "sol_wallets": wallets["sol"]}
        )


user_associated_wallet_route_parser = reqparse.RequestParser()
user_associated_wallet_route_parser.add_argument("associated_wallet", required=True)
user_associated_wallet_response = make_response(
    "user_associated_wallet_response", ns, fields.Nested(encoded_user_id)
)


@ns.route("/id")
class UserIdByAssociatedWallet(Resource):
    @ns.doc(
        id="""Get User ID from Wallet""",
        description="""Gets a User ID from an associated wallet address""",
        params={"associated_wallet": "Wallet address"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @ns.expect(user_associated_wallet_route_parser)
    @ns.marshal_with(user_associated_wallet_response)
    @cache(ttl_sec=10)
    def get(self):
        args = user_associated_wallet_route_parser.parse_args()
        user_id = get_associated_user_id({"wallet": args.get("associated_wallet")})
        return success_response(
            {"user_id": encode_int_id(user_id) if user_id else None}
        )


connected_wallets_response = make_response(
    "connected_wallets_response", ns, fields.Nested(connected_wallets)
)


@ns.route("/<string:id>/connected_wallets")
class ConnectedWallets(Resource):
    @ns.doc(
        id="""Get connected wallets""",
        description="""Get the User's ERC and SPL connected wallets""",
        params={"id": "A User ID"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @ns.marshal_with(connected_wallets_response)
    @cache(ttl_sec=10)
    def get(self, user_id):
        decoded_id = decode_with_abort(user_id, full_ns)
        wallets = get_associated_user_wallet({"user_id": decoded_id})
        return success_response(
            {"erc_wallets": wallets["eth"], "spl_wallets": wallets["sol"]}
        )


users_by_content_node_route_parser = reqparse.RequestParser()
users_by_content_node_route_parser.add_argument(
    "creator_node_endpoint", required=True, type=str
)
users_by_content_node_response = make_full_response(
    "users_by_content_node", full_ns, fields.List(fields.Nested(user_replica_set))
)


@full_ns.route("/content_node/<string:replica_type>", doc=False)
class UsersByContentNode(Resource):
    @full_ns.marshal_with(users_by_content_node_response)
    # @cache(ttl_sec=30)
    def get(self, replica_type):
        """New route to call get_users_cnode with replica_type param (only consumed by content node)
        - Leaving `/users/creator_node` above untouched for backwards-compatibility

        Response = array of objects of schema {
            user_id, wallet, primary, secondary1, secondary2, primarySpId, secondary1SpID, secondary2SpID
        }
        """
        args = users_by_content_node_route_parser.parse_args()

        cnode_url = args.get("creator_node_endpoint")

        if replica_type == "primary":
            users = get_users_cnode(cnode_url, ReplicaType.PRIMARY)
        elif replica_type == "secondary":
            users = get_users_cnode(cnode_url, ReplicaType.SECONDARY)
        else:
            users = get_users_cnode(cnode_url, ReplicaType.ALL)

        return success_response(users)


get_challenges_route_parser = reqparse.RequestParser()
get_challenges_route_parser.add_argument(
    "show_historical",
    required=False,
    type=bool,
    default=False,
    help="Whether to show challenges that are inactive but completed",
)
get_challenges_response = make_response(
    "get_challenges", ns, fields.List(fields.Nested(challenge_response))
)


@ns.route("/<string:id>/challenges")
class GetChallenges(Resource):
    @ns.doc(
        id="""Get User Challenges""",
        description="""Gets all challenges for the given user""",
        params={"id": "A User ID"},
        responses={200: "Success", 400: "Bad request", 500: "Server error"},
    )
    @ns.expect(get_challenges_route_parser)
    @ns.marshal_with(get_challenges_response)
    @cache(ttl_sec=5)
    def get(self, user_id: str):
        args = get_challenges_route_parser.parse_args()
        show_historical = args.get("show_historical")
        decoded_id = decode_with_abort(user_id, ns)
        db = get_db_read_replica()

        with db.scoped_session() as session:
            bus = setup_challenge_bus()
            challenges = get_challenges(decoded_id, show_historical, session, bus)
            challenges = list(map(extend_challenge_response, challenges))

            return success_response(challenges)
