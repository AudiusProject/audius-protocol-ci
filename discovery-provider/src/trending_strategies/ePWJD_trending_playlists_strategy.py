from src.trending_strategies.base_trending_strategy import BaseTrendingStrategy
from src.trending_strategies.ePWJD_trending_tracks_strategy import z
from src.trending_strategies.trending_type_and_version import TrendingType, TrendingVersion

class TrendingPlaylistsStrategyePWJD(BaseTrendingStrategy):
    def __init__(self):
        super().__init__(TrendingType.PLAYLISTS, TrendingVersion.ePWJD)

    def get_track_score(self, time, track):
        return z(time, track)

    def get_score_params(self):
        return {'zq': 1000, 'xf': True, 'pt': 0}
