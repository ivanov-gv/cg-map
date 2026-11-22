"""OSM display extractor.

Every layer module owns one source GeoJSON file and the OSM handlers that fill
it. Shared state carries the country outline, coastlines and municipality areas
between those independent modules, along with counts one layer computes and
another needs in the same OSM pass.
"""

from dataclasses import dataclass, field


@dataclass
class ExtractionState:
    """Geometry one layer computes and another needs in the same OSM pass."""

    country_geometry: dict | None = None
    coastlines: list = field(default_factory=list)
    # Published building parts, keyed by identity and part, for joins after the pass.
    buildings: dict = field(default_factory=dict)
    # Normalised street name to published roads as (entity ID, first node, last node).
    road_names: dict = field(default_factory=dict)
    # Counts written beside the reviewed source provenance.
    building_counts: dict = field(default_factory=dict)
    municipality_areas: list = field(default_factory=list)
    municipality_sources: list = field(default_factory=list)
    municipality_features: list = field(default_factory=list)


class Layer:
    """Base for one group; subclasses declare a file and OSM handlers."""

    filename: str = ''

    def __init__(self):
        self.features = []

    def node(self, node, options, state):
        """Collect what this layer needs from an OSM node."""

    def way(self, way, options, state):
        """Collect what this layer needs from an OSM way."""

    def area(self, area, options, state):
        """Collect what this layer needs from an OSM area."""

    def finish(self, options, state):
        """Apply any whole-layer step and return this layer's features."""
        return self.features
