"""Summit clipping needs the GIS packages pinned in data/tools/requirements.txt."""
import os
import sys
import unittest
from pathlib import Path

from shapely.geometry import box, mapping

TOOLS_PATH = Path(os.environ.get(
    'RELIEF_TOOLS_PATH', Path(__file__).resolve().parents[1] / 'tools'
))
sys.path.insert(0, str(TOOLS_PATH))

from relief import derivations  # noqa: E402


class ConstantTerrainModel:
    """Return one elevation so height checks do not depend on a DEM."""

    def sample(self, longitude, latitude):
        return 120.0

    def surrounding_height(self, longitude, latitude):
        return 120.0


def summit(entity_id, coordinates, name):
    """Build the OSM-shaped summit record consumed by the relief builder."""
    return {
        'entityId': entity_id,
        'entityVersion': 1,
        'coordinates': coordinates,
        'kind': 'peak',
        'tags': {'ele': '120', 'name': name},
    }


class ReliefDerivationTests(unittest.TestCase):
    def test_summits_outside_synthetic_country_are_excluded(self):
        country = box(0, 0, 20, 10).difference(box(9.9999999, 1, 10.00000005, 9))
        land = {'features': [{
            'properties': {'kind': 'country', 'entityId': 'relation/53296'},
            'geometry': mapping(country),
        }]}
        osm = {'summits': [
            summit('node/1', [5.0, 5.0], 'Inside'),
            summit('node/2', [20.0, 5.0], 'Boundary'),
            summit('node/3', [30.0, 5.0], 'Outside'),
            summit('node/4', [20.0000001, 5.0], 'Rounds inside'),
            summit('node/5', [10.0000001, 5.0], 'Rounds outside'),
        ]}

        features, report = derivations.build_summits(
            ConstantTerrainModel(), osm, land, []
        )

        self.assertEqual(
            [feature['properties']['entityId'] for feature in features],
            ['node/1', 'node/2'],
        )
        self.assertEqual(report['features'], 2)
        self.assertEqual(report['summitsOutsideCountry'], 3)
        self.assertEqual(
            report['heightCheckCounts'], {'ok': 2, 'mismatch': 0, 'missing': 0}
        )
