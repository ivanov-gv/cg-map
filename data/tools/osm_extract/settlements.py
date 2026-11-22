"""Montenegro settlement points extracted from OSM place nodes."""

from shapely.geometry import Point, shape

from . import Layer
from .identity import make_feature, osm_identity
from .tags import PLACE_RANKS, population_value, rank_for
from .writing import read_collection

SOURCE_FILE = 'settlements.geojson'
MUNICIPALITY_FILE = 'municipalities.geojson'
OSM_SOURCE = 'OpenStreetMap'
DETAIL_PLACES = {'suburb', 'quarter', 'neighbourhood'}
NEAREST_MUNICIPALITY_LIMIT_DEGREES = 0.025


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
    in the extract, but only a near miss can use the nearest municipality; a
    distant point would hide a broken boundary or a node outside the country.
    """
    containing = [
        iso_code for iso_code, area in areas if area.covers(point)
    ]
    if containing:
        return min(containing)
    distance, iso_code = min(
        (point.distance(area), iso_code) for iso_code, area in areas
    )
    if distance > NEAREST_MUNICIPALITY_LIMIT_DEGREES:
        raise ValueError(
            f'settlement is {distance:.6f} degrees from every municipality'
        )
    return iso_code


def reviewed_municipality_areas(options):
    """Read published areas when a settlement-only run has no OSM relations."""
    collection = read_collection(options.sources_directory / MUNICIPALITY_FILE)
    return [
        (feature['properties']['ISO3166-2'], shape(feature['geometry']))
        for feature in collection['features']
        if feature['properties'].get('kind') == 'municipality'
    ]


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
        if state.municipality_sources:
            areas = [
                (
                    municipality_source['iso'],
                    shape(municipality_source['geometry']),
                )
                for municipality_source in state.municipality_sources
            ]
        else:
            areas = reviewed_municipality_areas(options)
        areas.sort(key=lambda area: area[0])
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
            feature['properties']['entityId'],
            feature['properties'].get('entityPart', -1),
        ))
        return self.features
