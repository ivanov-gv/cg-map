"""One-time tracing of bridge roads that OSM areas do not cover."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / 'data/tools'
sys.path.insert(0, str(TOOLS))

from osm_extract.writing import write_collection  # noqa: E402
from seed_bridge_outlines import (  # noqa: E402
    ABSENT_BRIDGE_VALUES, JOIN_DISTANCE_METRES, OSM_OUTLINE_TOLERANCE_METRES,
    OUTLINE_HALF_WIDTH_METRES, SIMPLIFICATION_METRES, bridge_roads,
    connected_groups, covered_road_indexes, detail_midpoint, local_scales,
    seed, to_local,
)

DETAIL_BBOX = (19.0, 42.0, 19.3, 42.6)
REFERENCE_LATITUDE = detail_midpoint(DETAIL_BBOX)


def road(entity_id, coordinates, **properties):
    """Build one published bridge road with a stable source identity."""
    return {
        'type': 'Feature',
        'properties': {
            'entityId': entity_id,
            'entityVersion': 1,
            'entityPart': 0,
            'kind': 'primary',
            'bridge': 'yes',
            **properties,
        },
        'geometry': {
            'type': 'LineString',
            'coordinates': coordinates,
        },
    }


def osm_area():
    """Build one OSM bridge polygon that covers only the first road."""
    return {
        'type': 'Feature',
        'properties': {
            'entityId': 'way/100',
            'entityVersion': 2,
            'entityPart': 0,
            'kind': 'bridge',
            'osmTag': 'man_made=bridge',
            'method': 'osm',
            'name': 'Mapped Bridge',
        },
        'geometry': {
            'type': 'Polygon',
            'coordinates': [[
                [19.099, 42.3999], [19.111, 42.3999],
                [19.111, 42.39997], [19.099, 42.39997],
                [19.099, 42.3999],
            ]],
        },
    }


def prepared_roads():
    """Return roads with one OSM-covered pair, one nearby pair and two singles."""
    return [
        road('way/1', [[19.10, 42.39995], [19.11, 42.39995]]),
        road(
            'way/2', [[19.10, 42.40], [19.11, 42.40]],
            name='Main', startNode='node/1', endNode='node/2'
        ),
        road(
            'way/6', [[19.10, 42.40005], [19.11, 42.40005]],
            name='Main', startNode='node/3', endNode='node/4'
        ),
        road(
            'way/3', [[19.20, 42.40], [19.21, 42.40]],
            kind='footway', bridge='viaduct'
        ),
        road('way/5', [[19.25, 42.40], [19.26, 42.40]], name='Main'),
        road('way/4', [[19.28, 42.40], [19.29, 42.40]], bridge='no'),
    ]


def prepared_root(directory):
    """Build a disposable reviewed source tree for the seed step."""
    sources = Path(directory) / 'data/sources'
    sources.mkdir(parents=True)
    write_collection(
        sources / 'roads.geojson',
        [feature for feature in prepared_roads()
         if feature['properties']['bridge'] not in ABSENT_BRIDGE_VALUES]
    )
    area = osm_area()
    write_collection(sources / 'bridges.geojson', [area])
    (sources / 'provenance.json').write_text(
        json.dumps({
            'detail_bbox': list(DETAIL_BBOX),
            'layers': {'bridges.geojson': {'features': 1}},
        }) + '\n',
        encoding='utf-8'
    )
    return sources


class BridgeSeedTest(unittest.TestCase):
    """Traced outlines are grouped once and keep the roads they came from."""

    def test_bridge_road_selection_excludes_absent_bridges(self):
        roads = {'features': prepared_roads()}
        selected = bridge_roads(roads)
        self.assertEqual(
            [feature['properties']['entityId'] for feature in selected],
            ['way/1', 'way/2', 'way/6', 'way/3', 'way/5']
        )
        self.assertIn('viaduct', {
            feature['properties']['bridge'] for feature in selected
        })

    def test_grouping_uses_nearby_names_endpoints_and_walking_kinds(self):
        roads = bridge_roads({'features': prepared_roads()})
        scales = local_scales(REFERENCE_LATITUDE)
        lines = [
            to_local(shape(feature['geometry']), scales) for feature in roads
        ]
        groups = connected_groups(roads, lines, covered={0})
        self.assertEqual(groups, [[1, 2], [3], [4]])

    def test_road_just_outside_simplified_osm_ring_is_covered(self):
        scales = local_scales(REFERENCE_LATITUDE)
        area = to_local(shape(osm_area()['geometry']), scales)
        near = to_local(shape(road(
            'way/7', [[19.10, 42.399974], [19.11, 42.399974]]
        )['geometry']), scales)
        far = to_local(shape(road(
            'way/8', [[19.10, 42.401], [19.11, 42.401]]
        )['geometry']), scales)
        self.assertGreater(area.distance(near), 0)
        self.assertLessEqual(area.distance(near), OSM_OUTLINE_TOLERANCE_METRES)
        self.assertEqual(covered_road_indexes([near, far], [area]), {0})

    def test_seed_writes_one_outline_per_crossing_and_repeatable_counts(self):
        temporary = tempfile.TemporaryDirectory(prefix='cg-map-bridge-seed-')
        self.addCleanup(temporary.cleanup)
        sources = prepared_root(temporary.name)
        root = Path(temporary.name)
        area_before = next(
            feature for feature in json.loads(
                (sources / 'bridges.geojson').read_text(encoding='utf-8')
            )['features']
            if feature['properties']['entityId'] == 'way/100'
        )
        seed(root)
        first_bytes = (sources / 'bridges.geojson').read_bytes()
        bridges = json.loads(first_bytes)
        provenance = json.loads(
            (sources / 'provenance.json').read_text(encoding='utf-8')
        )
        mapped = next(
            feature for feature in bridges['features']
            if feature['properties']['entityId'] == 'way/100'
        )
        self.assertEqual(mapped, area_before)
        traced = [
            feature for feature in bridges['features']
            if feature['properties']['method'] == 'traced'
        ]
        self.assertEqual(len(traced), 3)
        self.assertEqual(
            [feature['properties']['sourceRoadIds'] for feature in traced],
            [['way/2', 'way/6'], ['way/3'], ['way/5']]
        )
        self.assertEqual(
            traced[0]['properties']['entityId'], 'derived:bridge-way-2'
        )
        self.assertEqual(traced[0]['properties']['name'], 'Main')
        self.assertNotIn('osmTag', traced[0]['properties'])
        osm_shape = shape(area_before['geometry'])
        for feature in traced:
            self.assertEqual(feature['geometry']['type'], 'Polygon')
            self.assertEqual(feature['properties']['kind'], 'bridge')
            self.assertEqual(feature['properties']['method'], 'traced')
            self.assertFalse(shape(feature['geometry']).intersects(osm_shape))
            self.assertRegex(
                feature['properties']['entityVersion'],
                r'^sha256:[a-f0-9]{64}$'
            )
        self.assertEqual(provenance['bridge_counts'], {
            'osmAreas': 1,
            'tracedOutlines': 3,
            'bridgeRoadFeatures': 5,
            'coveredByOsm': 1,
            'tracedRoadFeatures': 4,
        })
        self.assertEqual(provenance['bridge_seed'], {
            'sourceFile': 'roads.geojson',
            'joinDistanceMetres': JOIN_DISTANCE_METRES,
            'outlineHalfWidthMetres': OUTLINE_HALF_WIDTH_METRES,
            'simplificationMetres': SIMPLIFICATION_METRES,
            'osmOutlineToleranceMetres': OSM_OUTLINE_TOLERANCE_METRES,
            'walkingKinds': [
                'bridleway', 'cycleway', 'footway', 'path', 'pedestrian',
                'track'
            ],
            'referenceLatitude': 42.3,
        })
        self.assertEqual(
            provenance['layers']['bridges.geojson']['features'], 4
        )
        seed(root)
        self.assertEqual(
            (sources / 'bridges.geojson').read_bytes(), first_bytes
        )


if __name__ == '__main__':
    unittest.main()
