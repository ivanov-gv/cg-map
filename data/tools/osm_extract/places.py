"""Point directory: local POIs plus countrywide attractions."""

from shapely.geometry import shape

from . import Layer
from .geometry import (
    area_source, rounded_geometry, usable_area_geometry, way_coordinates
)
from .identity import make_feature, osm_identity

SOURCE_FILE = 'places.geojson'
FOOD_AMENITIES = {
    'restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'ice_cream'
}
SIGHT_TOURISM = {
    'attraction', 'museum', 'viewpoint', 'artwork', 'gallery'
}
SIGHT_HISTORIC = {'castle', 'monument', 'ruins', 'memorial'}
STAY_TOURISM = {
    'hotel', 'hostel', 'guest_house', 'motel', 'camp_site'
}
ESSENTIAL_AMENITIES = {
    'pharmacy', 'hospital', 'clinic', 'bank', 'atm', 'fuel', 'post_office'
}
EXTRA_TAGS = (
    'name:en', 'website', 'opening_hours', 'phone', 'addr:street',
    'addr:housenumber'
)
OSM_SOURCE = 'OpenStreetMap'


def category_for(tags):
    """Return the display category an OSM feature supports, or a blank."""
    amenity = tags.get('amenity', '')
    tourism = tags.get('tourism', '')
    if amenity in FOOD_AMENITIES:
        return 'food'
    if tourism in SIGHT_TOURISM or tags.get('historic') in SIGHT_HISTORIC:
        return 'sights'
    if tags.get('shop'):
        return 'shops'
    if tourism in STAY_TOURISM:
        return 'stay'
    if amenity in ESSENTIAL_AMENITIES:
        return 'essentials'
    return ''


class PlacesLayer(Layer):
    """Write directory points with OSM identity and the public place ID."""

    filename = SOURCE_FILE

    def node(self, node, options, state):
        if not node.location.valid():
            return
        coordinate = [node.location.lon, node.location.lat]
        self.add_place(
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
        self.add_place(way.tags, geometry, identity, options)

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
        self.add_place(area.tags, point, identity, options)

    def add_place(self, tags, geometry, identity, options):
        name = tags.get('name')
        category = category_for(tags)
        if not name or not category:
            return
        if (
            category != 'sights' and not options.all_places
            and not options.contains(*geometry['coordinates'])
        ):
            return
        properties = {
            'id': identity['entityId'],
            'name': name,
            'category': category,
            'kind': (
                tags.get('amenity') or tags.get('tourism')
                or tags.get('shop') or tags.get('historic')
            ),
            'source': OSM_SOURCE,
        }
        for tag in EXTRA_TAGS:
            if tags.get(tag):
                properties[tag] = tags[tag]
        feature = make_feature(
            rounded_geometry(geometry), properties, identity
        )
        self.features.append(feature)
