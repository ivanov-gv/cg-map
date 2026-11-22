"""Point directory: local POIs, attractions and standalone points."""

from shapely.geometry import shape
from shapely.strtree import STRtree

from . import Layer
from .geometry import (
    area_source, rounded_geometry, usable_area_geometry, way_coordinates
)
from .identity import make_feature, osm_identity

SOURCE_FILE = 'places.geojson'
OSM_SOURCE = 'OpenStreetMap'

# Existing categories mapped from OSM tags.
FOOD_AMENITIES = {
    'restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'ice_cream'
}
STAY_TOURISM = {
    'hotel', 'hostel', 'guest_house', 'motel', 'camp_site'
}
ESSENTIAL_AMENITIES = {
    'pharmacy', 'hospital', 'clinic', 'bank', 'atm', 'fuel', 'post_office'
}

# Standalone points, grouped by the OSM key they come from. Only named objects
# are collected, so unnamed boards and maps do not become places.
STANDALONE_HISTORIC = {
    'monument', 'memorial', 'ruins', 'castle', 'fort',
    'city_gate', 'archaeological_site', 'wayside_cross', 'wayside_shrine',
}
STANDALONE_TOURISM = {
    'viewpoint', 'artwork', 'attraction', 'museum', 'gallery',
}
# amenity=* values that are standalone points and map to 'sights'.
STANDALONE_AMENITY_SIGHTS = {'fountain'}
# These need categories the contract does not have (culture, worship,
# public), so they stay out of the extract unless sight tags promote them.
STANDALONE_AMENITY_NO_CATEGORY = {
    'place_of_worship', 'townhall', 'theatre',
    'cinema', 'library', 'arts_centre', 'community_centre',
}
STANDALONE_AMENITY = STANDALONE_AMENITY_SIGHTS | STANDALONE_AMENITY_NO_CATEGORY
# Named towers and lighthouses are sights. man_made=bridge stays excluded:
# a bridge is a linear feature, not a standalone place point. barrier=gate
# also stays excluded until the contract has a public category. See ADR 0026.
STANDALONE_MAN_MADE_SIGHTS = {'tower', 'lighthouse'}
STANDALONE_KEYS = {
    'historic': STANDALONE_HISTORIC,
    'tourism': STANDALONE_TOURISM,
    'amenity': STANDALONE_AMENITY,
    'man_made': STANDALONE_MAN_MADE_SIGHTS,
}

# Tags that promote certain amenity kinds to 'sights' even when their
# default category is not yet defined. Only tourism=attraction counts as
# a sight tag, not tourism=hotel or tourism=music_school.
SIGHT_PROMOTION_TAGS = {'heritage', 'historic'}
SIGHT_PROMOTION_TOURISM = {'attraction'}


def has_sight_promotion(tags):
    """Check if a place has a tag that promotes it to 'sights'.

    Only tourism=attraction (not any tourism value), heritage=*, or
    historic=* promote a place to the sights category.
    """
    for key in SIGHT_PROMOTION_TAGS:
        if tags.get(key):
            return True
    tourism = tags.get('tourism', '')
    if tourism in SIGHT_PROMOTION_TOURISM:
        return True
    return False


# Facts copied from OSM tags. contact:* keys normalise onto the plain key
# only when the plain key is absent (e.g. contact:phone -> phone).
FACT_TAGS = (
    'name:en', 'name:sr-Latn', 'website', 'opening_hours', 'phone',
    'addr:street', 'addr:housenumber', 'wheelchair', 'level',
    'cuisine', 'wikidata', 'wikipedia', 'email',
)
CONTACT_NORMALISATION = {
    'contact:phone': 'phone',
    'contact:website': 'website',
    'contact:email': 'email',
}


def category_for(tags):
    """Return the display category an OSM feature supports, or a blank.

    Only the five contract categories are used. Named towers and lighthouses
    are sights. Public and cultural amenity kinds would need new categories,
    so they drop out unless a sight tag (tourism=attraction, heritage=*,
    historic=*) promotes them to sights.
    """
    amenity = tags.get('amenity', '')
    tourism = tags.get('tourism', '')
    historic = tags.get('historic', '')
    man_made = tags.get('man_made', '')

    is_standalone_sight = (
        historic in STANDALONE_HISTORIC or tourism in STANDALONE_TOURISM
        or man_made in STANDALONE_MAN_MADE_SIGHTS
        or amenity in STANDALONE_AMENITY_SIGHTS
    )
    if amenity in FOOD_AMENITIES:
        return 'food'
    if is_standalone_sight:
        return 'sights'
    if tags.get('shop'):
        return 'shops'
    if tourism in STAY_TOURISM:
        return 'stay'
    if amenity in ESSENTIAL_AMENITIES:
        return 'essentials'
    if amenity in STANDALONE_AMENITY_NO_CATEGORY and has_sight_promotion(tags):
        return 'sights'
    return ''


def is_standalone_kind(tags):
    """Report whether the tags describe one of the standalone point kinds."""
    return any(
        tags.get(key) in values for key, values in STANDALONE_KEYS.items()
    )


def get_kind(tags):
    """Return the OSM kind value for a place, checking all relevant keys."""
    return (
        tags.get('amenity')
        or tags.get('tourism')
        or tags.get('shop')
        or tags.get('historic')
        or tags.get('man_made')
    )


def collect_facts(tags):
    """Copy OSM fact tags, normalising contact:* onto plain keys."""
    facts = {}
    for tag in FACT_TAGS:
        value = tags.get(tag)
        if value:
            facts[tag] = value
    for contact_key, plain_key in CONTACT_NORMALISATION.items():
        if plain_key not in facts and tags.get(contact_key):
            facts[plain_key] = tags[contact_key]
    return facts


def containing_building(geometry, records, tree):
    """Return the smallest footprint containing a point, or None."""
    # The predicate is point.within(footprint), not the reverse: a point on a
    # wall is outside, matching the footprint joins used for entrances.
    candidates = tree.query(shape(geometry), predicate='within')
    if len(candidates) == 0:
        return None
    containing = [records[int(index)] for index in candidates]
    return min(
        containing,
        key=lambda record: (record['shape'].area, record['entityId'])
    )


class PlacesLayer(Layer):
    """Write directory points with OSM identity and the public place ID."""

    filename = SOURCE_FILE

    def __init__(self):
        super().__init__()
        # OSM tags are invalidated after the pass; keep copied values until
        # building containment is resolved at finish.
        self._pending_places = []

    def node(self, node, options, state):
        if not node.location.valid():
            return
        coordinate = [node.location.lon, node.location.lat]
        self._collect_place(
            node.tags, {'type': 'Point', 'coordinates': coordinate},
            osm_identity('node', node.id, node.version), options
        )

    def way(self, way, options, state):
        if not way.is_closed():
            return
        coordinates = way_coordinates(way)
        if len(coordinates) < 4:
            return
        polygon = {'type': 'Polygon', 'coordinates': [coordinates]}
        anchor = shape(polygon).representative_point()
        geometry = {'type': 'Point', 'coordinates': [anchor.x, anchor.y]}
        identity = osm_identity('way', way.id, way.version)
        self._collect_place(way.tags, geometry, identity, options)

    def area(self, area, options, state):
        if area.from_way():
            return
        geometry = usable_area_geometry(area)
        if geometry is None:
            return
        anchor = shape(geometry).representative_point()
        point = {'type': 'Point', 'coordinates': [anchor.x, anchor.y]}
        kind, osm_id = area_source(area)
        identity = osm_identity(kind, osm_id, area.version)
        self._collect_place(area.tags, point, identity, options)

    def _collect_place(self, tags, geometry, identity, options):
        """Gather a candidate place; containment is added in finish()."""
        name = tags.get('name')
        category = category_for(tags)
        kind = get_kind(tags)
        if not name or not category:
            return
        if (
            category != 'sights' and not options.all_places
            and not options.contains(*geometry['coordinates'])
        ):
            return
        self._pending_places.append({
            'tags': dict(tags),
            'geometry': geometry,
            'identity': identity,
            'name': name,
            'category': category,
            'kind': kind,
        })

    def finish(self, options, state):
        """Publish places with one join setting both location fields."""
        records = list(state.buildings.values())
        tree = (
            STRtree([record['shape'] for record in records])
            if records else None
        )
        inside = 0
        for entry in self._pending_places:
            properties = {
                'id': entry['identity']['entityId'],
                'name': entry['name'],
                'category': entry['category'],
                'kind': entry['kind'],
                'source': OSM_SOURCE,
            }
            properties.update(collect_facts(entry['tags']))
            building = (
                containing_building(entry['geometry'], records, tree)
                if tree is not None else None
            )
            if building is not None:
                properties['buildingEntityId'] = building['entityId']
                inside += 1
            elif is_standalone_kind(entry['tags']):
                properties['standalone'] = True
            self.features.append(make_feature(
                rounded_geometry(entry['geometry']),
                properties,
                entry['identity']
            ))
        state.building_counts.update({
            'placesInsideBuildings': inside,
            'placesOutsideBuildings': len(self.features) - inside,
        })
        return self.features
