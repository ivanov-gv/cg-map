"""Municipality areas built from OSM boundaries as shared edges."""

from shapely import set_precision, snap
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
from .identity import content_version, make_feature, osm_identity
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
MIN_UNASSIGNED_AREA_SQM = 100
# A cross-border lake is orders of magnitude larger than coastline residue;
# this separates Lake Skadar from slivers that collapse when edges are rounded.
EXTERIOR_WATER_MIN_AREA_SQM = 1_000_000
BOUNDARY_TOUCH_TOLERANCE_DEGREES = 1e-9
COORDINATE_PRECISION_DEGREES = 1e-6
WATER_ID_PREFIX = 'derived:unassigned-water-'
# Lake Skadar is the largest derived gap. Its reviewed outline and clipped
# municipality shoreline cross twice in a narrow strip on the Albanian border.
LAKE_SKADAR_ID = f'{WATER_ID_PREFIX}1'


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


def neighbouring_municipalities(gap, areas):
    """Return codes of municipalities sharing a boundary with one gap."""
    return sorted(
        iso_code
        for iso_code, area in areas
        if gap.boundary.intersection(area.boundary).length > 0
    )


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


def material_country_gaps(areas, land):
    """Return material gaps in one area set, largest first."""
    covered = unary_union([area for _, area in areas])
    gaps = polygon_parts(land.difference(covered))
    return sorted(
        (
            gap for gap in gaps
            if (
                gap.area * SQUARE_DEGREES_TO_SQUARE_METRES
                > MIN_UNASSIGNED_AREA_SQM
            )
        ),
        key=lambda gap: (-gap.area, gap.bounds),
    )


def exterior_residue_additions(gaps, areas, land):
    """Collect small boundary-touching gaps by receiving municipality."""
    additions = {}
    for gap in gaps:
        touches_boundary = (
            gap.distance(land.boundary)
            <= BOUNDARY_TOUCH_TOLERANCE_DEGREES
        )
        is_residue = (
            gap.area * SQUARE_DEGREES_TO_SQUARE_METRES
            <= EXTERIOR_WATER_MIN_AREA_SQM
        )
        if not touches_boundary or not is_residue:
            continue
        iso_code = adjacent_municipality(gap, areas)
        additions[iso_code] = (
            gap if iso_code not in additions
            else unary_union([additions[iso_code], gap])
        )
    return additions


def fill_municipalities(areas, additions):
    """Return municipality areas after absorbing exterior residue."""
    return [
        (
            iso_code,
            unary_union([area, additions[iso_code]])
            if iso_code in additions else area,
        )
        for iso_code, area in areas
    ]


def identified_water_areas(areas, land):
    """Number the final material gaps by area and bounds."""
    return [
        (
            f'{WATER_ID_PREFIX}{index}', gap,
            neighbouring_municipalities(gap, areas),
        )
        for index, gap in enumerate(
            material_country_gaps(areas, land), start=1
        )
    ]


def partition_country_gaps(areas, land):
    """Split material country gaps into derived water and municipality fill.

    Internal gaps and large cross-border lakes stay outside the municipalities.
    Small exterior gaps are coastline residue: joining the nearest municipality
    keeps the reviewed outline covered without degenerate derived edges. The
    remaining gaps are numbered only after that fill, so every identity has one
    authoritative geometry.
    """
    additions = exterior_residue_additions(
        material_country_gaps(areas, land), areas, land
    )
    filled = fill_municipalities(areas, additions)
    return identified_water_areas(filled, land), filled


def unassigned_water_areas(areas, land):
    """Return derived areas for the gaps that stay outside municipalities."""
    return partition_country_gaps(areas, land)[0]


def aligned_lake_areas(areas, water_areas):
    """Give Lake Skadar and its neighbours one shared shoreline.

    The reviewed country outline and the clipped municipality shoreline cross
    twice in a narrow strip, leaving a sliver in the raw gap. Snapping only the
    lake to reviewed precision would then leave its neighbours on the old
    shoreline, so they are drawn onto the cleaned boundary as well.
    """
    lake_neighbours = next(
        (
            neighbours for identifier, _, neighbours in water_areas
            if identifier == LAKE_SKADAR_ID
        ),
        None,
    )
    if lake_neighbours is None:
        return areas
    lake = set_precision(
        dict(areas)[LAKE_SKADAR_ID], COORDINATE_PRECISION_DEGREES,
        mode='valid_output'
    )
    aligned = []
    for identifier, geometry in areas:
        if identifier == LAKE_SKADAR_ID:
            aligned.append((identifier, lake))
        elif identifier in lake_neighbours:
            aligned.append((
                identifier,
                snap(geometry, lake.boundary, COORDINATE_PRECISION_DEGREES),
            ))
        else:
            aligned.append((identifier, geometry))
    return aligned


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
            'name': tags.get('name'),
            'name:en': tags.get('name:en'),
            'population': population_value(tags),
            'identity': osm_identity(kind, osm_id, area.version),
        })

    def finish(self, options, state):
        if not self.collected_areas:
            raise RuntimeError('No Montenegrin municipality relations found.')
        land = country_geometry(options, state)
        municipality_areas = clipped_areas(self.collected_areas, land)
        water_areas, municipality_areas = partition_country_gaps(
            municipality_areas, land
        )
        areas = municipality_areas + [
            (identifier, geometry) for identifier, geometry, _ in water_areas
        ]
        areas = aligned_lake_areas(areas, water_areas)
        codes = [code for code, _ in municipality_areas]
        if len(codes) != len(set(codes)):
            raise RuntimeError('Duplicate municipality ISO3166-2 codes.')
        state.municipality_areas = areas
        state.municipality_sources = [
            {**source, 'geometry': mapping(area)}
            for source, (_, area) in zip(
                self.collected_areas, municipality_areas
            )
        ]
        edges = build_edges(
            areas, land, context_areas(options), self.boundary_ways
        )
        water_neighbours = {
            identifier: neighbours
            for identifier, _, neighbours in water_areas
        }
        state.municipality_features = municipality_features(
            areas, edges, self.collected_areas, water_neighbours
        )
        self.features = edges
        return self.features


class MunicipalitiesLayer(Layer):
    """Publish municipality polygons rebuilt from the shared edges."""

    filename = MUNICIPALITY_FILE

    def finish(self, options, state):
        return state.municipality_features


def municipality_features(areas, edges, collected, water_neighbours):
    """Rebuild municipality and derived water polygons from their edges."""
    lines = edge_lines(edges)
    features = []
    by_code = {
        municipality_source['iso']: municipality_source
        for municipality_source in collected
    }
    for area_id, _ in sorted(areas, key=lambda area: area[0]):
        try:
            edge_references = directed_references(area_id, edges)
            placeholder = {'properties': {'edges': edge_references}}
            geometry = rebuild_municipality(placeholder, lines)
        except ValueError as error:
            raise ValueError(f'{area_id}: {error}') from error
        geometry_value = rounded_geometry(mapping(geometry))
        label_point = geometry.representative_point()
        properties = {
            'labelPoint': [
                round(label_point.x, 6), round(label_point.y, 6),
            ],
            'edges': edge_references,
        }
        if area_id in water_neighbours:
            properties.update({
                'kind': 'unassigned-water',
                'neighbouringMunicipalities': water_neighbours[area_id],
            })
            identity = {
                'entityId': area_id,
                'entityVersion': content_version({
                    'geometry': geometry_value, 'properties': properties,
                }),
            }
        else:
            source = by_code[area_id]
            properties.update({
                'kind': 'municipality', 'ISO3166-2': area_id,
            })
            if source['name']:
                properties['name'] = source['name']
            if source['name:en']:
                properties['name:en'] = source['name:en']
            if source['population'] is not None:
                properties['population'] = source['population']
            identity = source['identity']
        features.append(make_feature(geometry_value, properties, identity))
    return features
