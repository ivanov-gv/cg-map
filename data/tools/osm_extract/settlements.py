"""Montenegro settlement points extracted from OSM place nodes."""

from shapely.geometry import Point, shape

from . import Layer
from .identity import make_feature, osm_identity
from .tags import PLACE_RANKS, population_value, rank_for

SOURCE_FILE = 'settlements.geojson'
OSM_SOURCE = 'OpenStreetMap'
DETAIL_PLACES = {'suburb', 'quarter', 'neighbourhood'}


def optional_tag(tags, name):
    """Return a copied tag only when OSM supplies a non-empty value."""
    value = tags.get(name)
    return value if value else None


def numeric_tag(tags, name):
    """Return an integer tag value, or nothing for other values."""
    value = tags.get(name, '')
    return int(value) if value.isdigit() else None


def municipality_at(point, areas):
    """Find the ISO code of the municipality containing one settlement.

    A few OSM place nodes sit just outside their relation's boundary. They stay
    in the extract and use the nearest municipality rather than being dropped.
    """
    containing = [
        iso_code for iso_code, area in areas if area.covers(point)
    ]
    if containing:
        return min(containing)
    return min(
        (point.distance(area), iso_code) for iso_code, area in areas
    )[1]


class SettlementsLayer(Layer):
    """Write named settlements with rank, municipality and OSM identity."""

    filename = SOURCE_FILE

    def __init__(self):
        super().__init__()
        self.nodes = []

    def node(self, node, options, state):
        place = node.tags.get('place')
        if place not in PLACE_RANKS or not node.location.valid():
            return
        coordinate = (node.location.lon, node.location.lat)
        if place in DETAIL_PLACES and not options.contains(*coordinate):
            return
        if not node.tags.get('name'):
            return
        self.nodes.append((
            coordinate, dict(node.tags),
            osm_identity('node', node.id, node.version),
        ))

    def finish(self, options, state):
        if not state.municipality_sources:
            raise RuntimeError('Municipality areas missing from the OSM pass.')
        areas = sorted(
            (
                (
                    municipality_source['iso'],
                    shape(municipality_source['geometry']),
                )
                for municipality_source in state.municipality_sources
            ),
            key=lambda area: area[0]
        )
        for coordinate, tags, identity in self.nodes:
            try:
                municipality = municipality_at(Point(*coordinate), areas)
            except ValueError as error:
                raise ValueError(
                    f'{identity["entityId"]} {tags["name"]}: {error}'
                ) from error
            properties = {
                'kind': 'settlement',
                'name': tags['name'],
                'place': tags['place'],
                'rank': rank_for(tags),
                'municipality': municipality,
                'source': OSM_SOURCE,
            }
            english = optional_tag(tags, 'name:en')
            if english:
                properties['name:en'] = english
            population = population_value(tags)
            if population is not None:
                properties['population'] = population
            capital = optional_tag(tags, 'capital')
            if capital:
                properties['capital'] = capital
            admin_level = numeric_tag(tags, 'admin_level')
            if admin_level is not None:
                properties['admin_level'] = admin_level
            wikidata = optional_tag(tags, 'wikidata')
            if wikidata:
                properties['wikidata'] = wikidata
            self.features.append(make_feature(
                {
                    'type': 'Point',
                    'coordinates': list(coordinate),
                },
                properties, identity
            ))
        self.features.sort(key=lambda feature: (
            feature['properties']['municipality'],
            feature['properties']['name'],
            feature['properties']['entityId'],
        ))
        return self.features
