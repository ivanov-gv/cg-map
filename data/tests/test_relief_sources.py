"""Relief source files keep the extractor's one-feature-per-line format."""
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
RELIEF_FILES = (
    'data/sources/contours.geojson',
    'data/sources/summits.geojson',
    'data/sources/slopes.geojson',
    'data/sources/ridges.geojson',
    'data/sources/canyon-rims.geojson',
)


class ReliefSourceFormatTests(unittest.TestCase):
    def test_each_relief_file_has_one_feature_per_line(self):
        for relative_path in RELIEF_FILES:
            path = ROOT / relative_path
            lines = path.read_text(encoding='utf8').splitlines()
            self.assertGreaterEqual(len(lines), 3, relative_path)
            self.assertEqual(lines[0], '{"entitySchemaVersion":1,"features":[', relative_path)
            self.assertEqual(lines[-1], '],"type":"FeatureCollection"}', relative_path)
            feature_lines = lines[1:-1]
            collection = json.loads(path.read_text(encoding='utf8'))
            self.assertEqual(len(feature_lines), len(collection['features']), relative_path)
            for index, line in enumerate(feature_lines):
                expected_end = ',' if index < len(feature_lines) - 1 else ''
                self.assertTrue(line.endswith(expected_end), relative_path)
                payload = line[:-1] if expected_end else line
                feature = json.loads(payload)
                self.assertEqual(feature['type'], 'Feature', relative_path)
