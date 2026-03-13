"""Geographic data types for the AI Historian pipeline.

Defines Pydantic v2 models for geographic locations, routes, and per-segment
geographic metadata extracted during Phase 3.8 (Geographic Mapping).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class GeoEvent(BaseModel):
    """A geographic location or event mentioned in a documentary segment."""

    name: str = Field(..., description="Place name as referenced in the narration")
    lat: float = Field(..., description="Latitude (-90 to 90)")
    lng: float = Field(..., description="Longitude (-180 to 180)")
    type: Literal["city", "battle", "route", "region"] = Field(
        default="city", description="Location classification"
    )
    era: str | None = Field(default=None, description="Historical period, e.g. '1453 AD'")
    description: str | None = Field(default=None, description="One-sentence context")


class GeoRoute(BaseModel):
    """A historical route or journey path between locations."""

    name: str = Field(..., description="Route name, e.g. 'Via Egnatia'")
    points: list[tuple[float, float]] = Field(
        ..., description="Ordered [lat, lng] waypoints"
    )
    style: Literal["trade", "military", "migration"] = Field(
        default="trade", description="Route classification for visual styling"
    )


class SegmentGeo(BaseModel):
    """Complete geographic metadata for one documentary segment.

    Mirrors the frontend SegmentGeo TypeScript interface exactly.
    """

    segment_id: str = Field(..., alias="segmentId")
    center: tuple[float, float] = Field(..., description="[lat, lng] map center")
    zoom: int = Field(default=4, ge=2, le=8, description="Map zoom level 2-8")
    events: list[GeoEvent] = Field(default_factory=list)
    routes: list[GeoRoute] = Field(default_factory=list)

    model_config = {"populate_by_name": True}

    def to_frontend_dict(self) -> dict:
        """Serialize using camelCase keys matching the frontend TypeScript interface."""
        return {
            "segmentId": self.segment_id,
            "center": list(self.center),
            "zoom": self.zoom,
            "events": [e.model_dump() for e in self.events],
            "routes": [
                {"name": r.name, "points": [list(p) for p in r.points], "style": r.style}
                for r in self.routes
            ],
        }
