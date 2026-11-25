"""Derive neighbour areas that meet Montenegro at its reviewed border."""

from collections import defaultdict

from shapely.geometry import LineString, box, shape
from shapely.ops import polygonize, unary_union, voronoi_diagram

from . import Layer
from .borders import EDGE_FILE, country_geometry
from .geometry import canonical_geometry, rounded_valid_geometry
from .identity import content_version, make_feature
from .shared_edges import OSM_ONLY_AUTHORITIES, SEA, slug
from .writing import read_collection

CONTEXT_FILE = 'context-countries.geojson'
NEIGHBOUR_SOURCE_FILE = 'context-countries-source.geojson'
LAND_FILE = 'land.geojson'
OCEAN_BOUNDS = (17.5, 41.0, 21.5, 44.2)
CONTEXT_KIND = 'context'
DERIVED_CONTEXT_PREFIX = 'derived:context-'
EDGE_TOUCH_TOLERANCE_DEGREES = 1e-9
# The real slivers between Natural Earth outlines and the reviewed border all
# sit this close to Montenegro. Further out, a Voronoi label is a guess from a
# border we have not checked, not a fact about the neighbouring country.
NEAR_BORDER_DISTANCE_DEGREES = 0.2


def outside_edges(border_edges, authority_names):
    """Index border lines by outside authority and collect the sea lines."""
    authorities = defaultdict(list)
    sea_lines = []
    for feature in border_edges:
        properties = feature['properties']
        line = LineString(feature['geometry']['coordinates'])
        for side in ('left', 'right'):
            label = properties[side]
            if label == SEA:
                sea_lines.append(line)
            elif label in authority_names:
                authorities[label].append(line)
    return authorities, sea_lines


def touching_authorities(gap, authorities):
    """Return authorities whose border lines run along this gap."""
    return sorted(
        label for label, lines in authorities.items()
        if any(
            gap.boundary.intersection(line).length
            > EDGE_TOUCH_TOLERANCE_DEGREES
            for line in lines
        )
    )


def touches_sea(gap, sea_lines):
    """Report whether one inland gap is connected to the Adriatic."""
    return any(
        gap.boundary.intersection(line).length > EDGE_TOUCH_TOLERANCE_DEGREES
        for line in sea_lines
    )


def voronoi_pieces(region, labels, lines_by_authority):
    """Divide one region between the authorities whose borders run beside it."""
    if not labels or region.is_empty or region.area <= 0:
        return {}
    if len(labels) == 1:
        return {labels[0]: region}
    cells = voronoi_diagram(
        unary_union([lines_by_authority[label] for label in labels]),
        envelope=region
    )
    pieces = defaultdict(list)
    for cell in cells.geoms:
        clipped = cell.intersection(region)
        if clipped.is_empty or clipped.area <= 0:
            continue
        label = min(
            labels,
            key=lambda name: (clipped.distance(lines_by_authority[name]), name)
        )
        pieces[label].append(clipped)
    return {
        label: unary_union(geometries)
        for label, geometries in pieces.items()
    }


def split_between_authorities(gap, labels, authorities):
    """Divide one gap by the Voronoi cells of the authorities beside it."""
    lines_by_authority = {
        label: unary_union(authorities[label]) for label in labels
    }
    return voronoi_pieces(gap, labels, lines_by_authority)


def reaches_far_field(piece, near_border_region):
    """Report whether a Voronoi piece extends beyond the near-border band."""
    return not piece.difference(near_border_region).is_empty


def assign_gap_pieces(split, near_border_region, preserved_names):
    """Keep near-border cells; give far-reaching cells to the unshaped neighbour.

    A cell that reaches into the far field is labelled by the near end of a
    border we have not reviewed. The whole cell goes to the authority without a
    Natural Earth outline; moving only its far part would draw a straight band
    cut through the hole instead of keeping the reviewed Voronoi boundary.
    """
    unshaped = [
        label for label in split if label not in preserved_names
    ]
    if len(unshaped) != 1:
        return split
    far_owner = unshaped[0]
    assigned = defaultdict(list)
    for label, piece in split.items():
        sends_far = (
            label in preserved_names
            and reaches_far_field(piece, near_border_region)
        )
        assigned[far_owner if sends_far else label].append(piece)
    return {
        label: unary_union(pieces) for label, pieces in assigned.items()
    }


def assign_gap(gap, split, near_border_region, preserved_names):
    """Apply the near-border rule to the pieces of one gap.

    When every piece goes to the unshaped neighbour, publish the original gap
    instead of the union of its cells. The union leaves seams at the old cell
    boundaries once the grid snapping runs, and those seams become gaps.
    """
    pieces = assign_gap_pieces(split, near_border_region, preserved_names)
    unshaped = [
        label for label in split if label not in preserved_names
    ]
    if len(unshaped) == 1 and set(pieces) == set(unshaped):
        return {unshaped[0]: gap}
    return pieces


def gap_areas(country, preserved, border_edges, ocean_bounds=OCEAN_BOUNDS):
    """Assign every inland gap to the outside authority that borders it."""
    preserved_names = {
        feature['properties']['name'] for feature in preserved
    }
    authority_names = preserved_names | OSM_ONLY_AUTHORITIES
    authorities, sea_lines = outside_edges(border_edges, authority_names)
    all_lines = [
        LineString(feature['geometry']['coordinates'])
        for feature in border_edges
    ]
    covered = unary_union([
        country, *[shape(feature['geometry']) for feature in preserved]
    ])
    uncovered = box(*ocean_bounds).difference(covered)
    # Border lines split the uncovered region at each neighbour, so a sea
    # connection cannot claim the land gap that sits on the other side of it.
    gaps = [
        polygon for polygon in polygonize(
            unary_union([uncovered.boundary, *all_lines])
        )
        if uncovered.covers(polygon.representative_point())
    ]
    near_border_region = country.buffer(NEAR_BORDER_DISTANCE_DEGREES)
    assigned = defaultdict(list)
    for gap in gaps:
        if touches_sea(gap, sea_lines):
            continue
        labels = touching_authorities(gap, authorities)
        if len(labels) > 1:
            split = split_between_authorities(gap, labels, authorities)
            pieces = assign_gap(
                gap, split, near_border_region, preserved_names
            )
        elif labels:
            pieces = {labels[0]: gap}
        else:
            # Coastline residue and slivers between mapped edges are not
            # neighbour land; a real inland gap runs beside an outside border.
            continue
        for label, geometry in pieces.items():
            assigned[label].append(geometry)
    return {
        label: unary_union(geometries)
        for label, geometries in assigned.items()
    }


def context_identity(feature, geometry_value):
    """Keep a preserved NE identity, or derive one for an OSM-only authority."""
    properties = feature['properties']
    identity = {'entityId': properties['entityId']}
    domain_properties = {
        name: value for name, value in properties.items()
        if name not in ('entityId', 'entityVersion', 'entityPart')
    }
    identity['entityVersion'] = content_version({
        'geometry': geometry_value, 'properties': domain_properties
    })
    return make_feature(geometry_value, domain_properties, identity)


def reviewed_border_edges(options, state):
    """Use this run's edges, or the reviewed ones when borders were not regenerated."""
    if state.border_edges:
        return state.border_edges
    return read_collection(options.sources_directory / EDGE_FILE)['features']


def derive_context_features(options, state, ocean_bounds=OCEAN_BOUNDS):
    """Return clipped NE neighbours plus derived areas for inland gaps."""
    # The pinned NE source never contains derived gaps, so repeated runs see
    # the same input even after context-countries.geojson is published.
    preserved = read_collection(
        options.sources_directory / NEIGHBOUR_SOURCE_FILE
    )['features']
    country = country_geometry(options, state)
    clipped = {
        feature['properties']['name']: shape(feature['geometry']).difference(
            country
        )
        for feature in preserved
    }
    edges = reviewed_border_edges(options, state)
    assigned = gap_areas(country, preserved, edges, ocean_bounds)
    preserved_names = set(clipped)
    for name, geometry in assigned.items():
        if name in clipped:
            clipped[name] = unary_union([clipped[name], geometry])
        else:
            clipped[name] = geometry

    features = []
    for feature in preserved:
        name = feature['properties']['name']
        geometry = canonical_geometry(rounded_valid_geometry(clipped[name]))
        derived = context_identity(feature, geometry)
        if 'id' in feature:
            derived['id'] = feature['id']
        features.append(derived)
    for name in sorted(set(assigned) - preserved_names):
        properties = {'kind': CONTEXT_KIND, 'name': name}
        geometry = canonical_geometry(rounded_valid_geometry(clipped[name]))
        identity = {
            'entityId': f'{DERIVED_CONTEXT_PREFIX}{slug(name)}',
            'entityVersion': content_version({
                'geometry': geometry, 'properties': properties
            }),
        }
        features.append(make_feature(geometry, properties, identity))
    return features


class NeighbourCountriesLayer(Layer):
    """Write the reviewed context source from the derived neighbour areas."""

    filename = CONTEXT_FILE

    def finish(self, options, state):
        state.context_features = derive_context_features(options, state)
        return state.context_features


class NeighbourLandLayer(Layer):
    """Publish neighbour areas alongside the country and green land cover."""

    filename = LAND_FILE

    def finish(self, options, state):
        if options.uses_fresh_country:
            return state.context_features
        reviewed = read_collection(options.sources_directory / LAND_FILE)[
            'features'
        ]
        return [
            feature for feature in reviewed
            if feature['properties'].get('kind') != CONTEXT_KIND
        ] + state.context_features
