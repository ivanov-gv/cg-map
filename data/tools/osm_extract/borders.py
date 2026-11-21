"""Municipality areas built from OSM boundaries as shared edges."""

from shapely.geometry import mapping, shape

from . import Layer
from .geometry import (
    rounded_geometry,
    usable_area_geometry,
    area_source,
    way_coordinates,
)
from .identity import make_feature, osm_identity
from .shared_edges import (
    build_edges,
    directed_references,
    edge_lines,
    rebuild_municipality,
)
from .tags import population_value
from .writing import read_collection

EDGE_FILE = 'border-edges.geojson'
MUNICIPALITY_FILE = 'municipalities.geojson'
CONTEXT_FILE = 'context-countries.geojson'
MUNICIPALITY_ISO_PREFIX = 'ME-'
BOUNDARY_LEVELS = {'2', '6'}


def rounded_coordinates(way):
    """Return a way's node locations at the reviewed coordinate precision."""
    return [
        (round(longitude, 6), round(latitude, 6))
        for longitude, latitude in way_coordinates(way)
    ]


def boundary_tags(tags):
    """Report whether a way draws a country, municipality or coastline edge."""
    is_admin = (
        tags.get('boundary') == 'administrative'
        and tags.get('admin_level') in BOUNDARY_LEVELS
    )
    return is_admin or tags.get('natural') == 'coastline'


def municipality_tags(tags):
    """Report whether an OSM area is one of Montenegro's municipalities."""
    return (
        tags.get('boundary') == 'administrative'
        and tags.get('admin_level') == '6'
        and (tags.get('ISO3166-2') or '').startswith(MUNICIPALITY_ISO_PREFIX)
    )


def context_areas(options):
    """Return neighbouring country names and polygons for outside edge labels."""
    context = read_collection(options.sources_directory / CONTEXT_FILE)
    return [
        (feature['properties']['name'], shape(feature['geometry']))
        for feature in context['features']
    ]


def clipped_areas(collected, land):
    """Remove territorial water and keep every municipality part on land."""
    areas = []
    for municipality_source in collected:
        geometry = shape(
            municipality_source['geometry']
        ).intersection(land)
        if geometry.is_empty or geometry.area <= 0:
            raise ValueError(
                f'{municipality_source["iso"]}: municipality has no land area'
            )
        areas.append((municipality_source['iso'], geometry))
    return areas


class BorderEdgesLayer(Layer):
    """Collect municipality relations and write each boundary side once."""

    filename = EDGE_FILE

    def __init__(self):
        super().__init__()
        self.boundary_ways = {}
        self.collected_areas = []

    def way(self, way, options, state):
        if not boundary_tags(way.tags):
            return
        coordinates = rounded_coordinates(way)
        if len(coordinates) < 2:
            return
        self.boundary_ways[way.id] = {
            'version': way.version, 'coordinates': coordinates
        }

    def area(self, area, options, state):
        if not municipality_tags(area.tags):
            return
        geometry = usable_area_geometry(area)
        if geometry is None:
            return
        kind, osm_id = area_source(area)
        tags = area.tags
        self.collected_areas.append({
            'iso': tags['ISO3166-2'],
            'geometry': geometry,
            'name': tags.get('name', ''),
            'name:en': tags.get('name:en'),
            'population': population_value(tags),
            'identity': osm_identity(kind, osm_id, area.version),
        })

    def finish(self, options, state):
        if not self.collected_areas:
            raise RuntimeError('No Montenegrin municipality relations found.')
        if state.country_geometry is None:
            raise RuntimeError('Country outline missing from the OSM pass.')
        land = shape(state.country_geometry)
        areas = clipped_areas(self.collected_areas, land)
        codes = [code for code, _ in areas]
        if len(codes) != len(set(codes)):
            raise RuntimeError('Duplicate municipality ISO3166-2 codes.')
        state.municipality_areas = areas
        state.municipality_sources = self.collected_areas
        edges = build_edges(
            areas, land, context_areas(options), self.boundary_ways
        )
        state.municipality_features = municipality_features(
            areas, edges, self.collected_areas
        )
        self.features = edges
        return self.features


class MunicipalitiesLayer(Layer):
    """Publish municipality polygons rebuilt from the shared edges."""

    filename = MUNICIPALITY_FILE

    def finish(self, options, state):
        return state.municipality_features


def municipality_features(areas, edges, collected):
    """Rebuild each polygon from its edges and add a label point."""
    lines = edge_lines(edges)
    features = []
    by_code = {
        municipality_source['iso']: municipality_source
        for municipality_source in collected
    }
    for iso_code, _ in sorted(areas, key=lambda area: area[0]):
        references = directed_references(iso_code, edges)
        placeholder = {'properties': {'edges': references}}
        geometry = rebuild_municipality(placeholder, lines)
        properties = {
            'kind': 'municipality',
            'name': by_code[iso_code]['name'],
            'ISO3166-2': iso_code,
            'labelPoint': [
                round(geometry.representative_point().x, 6),
                round(geometry.representative_point().y, 6),
            ],
            'edges': references,
        }
        english = by_code[iso_code]['name:en']
        if english:
            properties['name:en'] = english
        population = by_code[iso_code]['population']
        if population is not None:
            properties['population'] = population
        features.append(make_feature(
            rounded_geometry(mapping(geometry)),
            properties, by_code[iso_code]['identity']
        ))
    return features
