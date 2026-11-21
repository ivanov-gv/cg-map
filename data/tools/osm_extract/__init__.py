"""OSM display extractor.

Every layer module owns one source GeoJSON file and the OSM handlers that fill
it. Shared state carries only the country outline and coastlines between those
independent modules.
"""

from dataclasses import dataclass, field


@dataclass
class ExtractionState:
    """Geometry one layer computes and another needs in the same OSM pass."""

    country_geometry: dict | None = None
    coastlines: list = field(default_factory=list)


class Layer:
    """Base for one group; subclasses declare a file and OSM handlers."""

    filename: str = ''

    def __init__(self, options):
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
