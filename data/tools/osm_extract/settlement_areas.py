"""Settlement areas extracted from OSM place and administrative areas."""

from collections import defaultdict

from shapely.geometry import Point, mapping, shape

from . import Layer
from .geometry import area_source, rounded_geometry, usable_area_geometry
from .identity import make_feature, osm_identity
from .rings import rfc7946_geometry
from .settlements import reviewed_municipality_areas
from .tags import PLACE_RANKS
from .writing import read_collection

SOURCE_FILE = 'settlement-areas.geojson'
SETTLEMENT_FILE = 'settlements.geojson'
# Below a municipality, OSM Montenegro maps settlements on these levels.
SETTLEMENT_ADMIN_LEVELS = {'8', '9', '10'}
SIMPLIFY_DEGREES = 0.00002
# A relation names the node that stands for it in one of these roles.
CENTRE_ROLES = ('label', 'admin_centre')


def comparable_names(tags):
    """Return the names an area may share with the point that stands for it."""
    names = {tags.get('name', ''), tags.get('name:sr-Latn', '')}
    names |= {
        part for name in names for part in name.split(' - ')
    }
    return {name.strip().casefold() for name in names if name.strip()}


class SettlementAreasLayer(Layer):
    """Write the area of a settlement where OSM maps one."""

    filename = SOURCE_FILE

    def __init__(self):
        super().__init__()
        self._areas = []
        self._centre_nodes = {}

    def relation(self, relation, options, state):
        """Remember the node a boundary names as its centre."""
        nodes = {
            member.role: member.ref for member in relation.members
            if member.type == 'n' and member.role in CENTRE_ROLES
        }
        for role in CENTRE_ROLES:
            if role in nodes:
                self._centre_nodes[relation.id] = nodes[role]
                return

    def area(self, area, options, state):
        tags = area.tags
        is_place = tags.get('place') in PLACE_RANKS
        is_boundary = (
            tags.get('boundary') == 'administrative'
            and tags.get('admin_level') in SETTLEMENT_ADMIN_LEVELS
        )
        if not (is_place or is_boundary) or not tags.get('name'):
            return
        geometry = usable_area_geometry(area)
        if geometry is None:
            return
        kind, osm_id = area_source(area)
        self._areas.append({
            'tags': dict(tags),
            'is_place': is_place,
            'shape': shape(geometry),
            'identity': osm_identity(kind, osm_id, area.version),
            'centre': (
                self._centre_nodes.get(osm_id) if kind == 'relation' else None
            ),
        })

    def finish(self, options, state):
        """Join every area to its settlement and keep one area for each."""
        settlements = read_settlements(options, state)
        municipalities = municipality_areas(options, state)
        unnamed_count = 0
        area_by_owner = {}
        for area in self._areas:
            if not is_inside(area['shape'], municipalities):
                continue
            owner = settlement_of(area, settlements)
            if owner is None and not area['is_place']:
                unnamed_count += 1
                continue
            key = owner or area['identity']['entityId']
            known = area_by_owner.get(key)
            if known is None or preference(area) < preference(known):
                area_by_owner[key] = {**area, 'owner': owner}
        if unnamed_count:
            print(
                f'settlement-areas: left out {unnamed_count} administrative '
                'areas without a settlement'
            )
        self.features = sorted(
            map(area_feature, area_by_owner.values()),
            key=lambda feature: feature['properties']['entityId']
        )
        return self.features


def preference(area):
    """Order areas of one settlement: the place itself, then the smaller."""
    return (not area['is_place'], area['shape'].area)


def read_settlements(options, state):
    """Return the settlements of this run, or the reviewed ones."""
    features = state.settlement_features or read_collection(
        options.sources_directory / SETTLEMENT_FILE
    )['features']
    by_name = defaultdict(list)
    for feature in features:
        for name in comparable_names(feature['properties']):
            by_name[name].append(feature)
    ids = {feature['properties']['entityId'] for feature in features}
    return {'by_name': by_name, 'ids': ids}


def municipality_areas(options, state):
    if state.municipality_sources:
        return [
            shape(source['geometry']) for source in state.municipality_sources
        ]
    return [area for _, area in reviewed_municipality_areas(options)]


def is_inside(geometry, municipalities):
    point = geometry.representative_point()
    return any(area.covers(point) for area in municipalities)


def settlement_of(area, settlements):
    """Return the entity ID of the settlement an area belongs to, or None."""
    centre_id = f'node/{area["centre"]}'
    if centre_id in settlements['ids']:
        return centre_id
    inside = {
        feature['properties']['entityId']
        for name in comparable_names(area['tags'])
        for feature in settlements['by_name'].get(name, ())
        if area['shape'].covers(Point(feature['geometry']['coordinates']))
    }
    return min(inside) if inside else None


def area_feature(area):
    tags = area['tags']
    properties = {'kind': 'settlement-area', 'name': tags['name']}
    if tags.get('name:en'):
        properties['name:en'] = tags['name:en']
    if area['owner']:
        properties['settlementEntityId'] = area['owner']
    geometry = area['shape'].simplify(SIMPLIFY_DEGREES, preserve_topology=True)
    return make_feature(
        rfc7946_geometry(rounded_geometry(mapping(geometry))), properties,
        area['identity']
    )
