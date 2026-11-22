"""Municipality areas built from OSM boundaries as shared edges."""

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from geo_area import SQUARE_DEGREES_TO_SQUARE_METRES

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
LAND_FILE = 'land.geojson'
MUNICIPALITY_ISO_PREFIX = 'ME-'
BOUNDARY_LEVELS = {'2', '6'}
MIN_ASSIGNED_GAP_SQM = 100


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


def reviewed_country_geometry(options):
    """Read the published coastline-cut outline for a borders-only run."""
    land = read_collection(options.sources_directory / LAND_FILE)
    for feature in land['features']:
        if feature['properties'].get('kind') == 'country':
            return shape(feature['geometry'])
    raise RuntimeError('land.geojson has no country feature')


def country_geometry(options, state):
    """Use this run's finished outline, or the reviewed one for a partial run."""
    if not options.uses_fresh_country:
        return reviewed_country_geometry(options)
    if state.country_geometry is None:
        raise RuntimeError('Country outline missing from the OSM pass.')
    return shape(state.country_geometry)


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


def polygon_parts(geometry):
    """Return the polygon pieces of a shapely difference, if any."""
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'Polygon':
        return [geometry]
    if hasattr(geometry, 'geoms'):
        return [
            part for child in geometry.geoms for part in polygon_parts(child)
        ]
    return []


def adjacent_municipality(gap, areas):
    """Pick the neighbour sharing the longest boundary with one country gap."""
    candidates = [
        (
            -gap.boundary.intersection(area.boundary).length,
            gap.distance(area),
            iso_code,
        )
        for iso_code, area in areas
    ]
    return min(candidates)[2]


def fill_country_gaps(areas, land):
    """Give each material internal country gap to one adjacent municipality."""
    covered = unary_union([area for _, area in areas])
    gaps = polygon_parts(land.difference(covered))
    additions = {}
    for gap in sorted(gaps, key=lambda part: (-part.area, part.bounds)):
        if (
            gap.area * SQUARE_DEGREES_TO_SQUARE_METRES
            <= MIN_ASSIGNED_GAP_SQM
        ):
            continue
        iso_code = adjacent_municipality(gap, areas)
        additions[iso_code] = (
            gap if iso_code not in additions
            else unary_union([additions[iso_code], gap])
        )
    return [
        (
            iso_code,
            unary_union([area, additions[iso_code]])
            if iso_code in additions else area,
        )
        for iso_code, area in areas
    ]


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
            'version': way.version,
            'coordinates': coordinates,
            'tags': dict(way.tags),
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
        land = country_geometry(options, state)
        areas = fill_country_gaps(clipped_areas(self.collected_areas, land), land)
        codes = [code for code, _ in areas]
        if len(codes) != len(set(codes)):
            raise RuntimeError('Duplicate municipality ISO3166-2 codes.')
        state.municipality_areas = areas
        state.municipality_sources = [
            {**source, 'geometry': mapping(area)}
            for source, (_, area) in zip(self.collected_areas, areas)
        ]
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
        try:
            geometry = rebuild_municipality(placeholder, lines)
        except ValueError as error:
            raise ValueError(f'{iso_code}: {error}') from error
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
