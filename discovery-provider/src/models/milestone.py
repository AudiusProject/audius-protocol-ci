import enum

from sqlalchemy import Column, DateTime, Integer, PrimaryKeyConstraint, String

from .models import Base


class MilestoneName(str, enum.Enum):
    LISTEN_COUNT = "LISTEN_COUNT"


class Milestone(Base):
    __tablename__ = "milestones"

    id = Column(Integer, nullable=False)
    name = Column(String, nullable=False)
    threshold = Column(Integer, nullable=False)
    blocknumber = Column(Integer, nullable=True)
    slot = Column(Integer, nullable=True)
    timestamp = Column(DateTime, nullable=False)
    PrimaryKeyConstraint(id, name, threshold)

    def __repr__(self):
        return f"<Milestone(\
id={self.id},\
name={self.name},\
threshold={self.threshold},\
blocknumber={self.blocknumber},\
slot={self.slot},\
timestamp={self.timestamp},\
)>"
