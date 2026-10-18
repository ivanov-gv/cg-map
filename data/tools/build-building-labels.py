"""Recover OSM address labels for unchanged reviewed footprints.

Run with data/tools/requirements.txt installed. Exact rounded geometry matches
recover real way IDs; address nodes are used only when associated unambiguously.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path

import osmium
from shapely.geometry import Point, shape
from shapely.ops import polylabel
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[2]


def house_number(raw):
    value = raw.strip()
    normalized = ''.join(c for c in value.casefold() if c not in ' ./-_')
    # Local 'bb' means 'bez broja' (no number); do not display it as a house number.
    return '' if normalized in ['', 'bb', 'бб', 'bezbroja', 'безброја', 'na', '?'] else value


def ring_key(ring):
    points = [(round(p[0], 6), round(p[1], 6)) for p in ring]
    if points and points[0] == points[-1]:
        points.pop()
    if not points:
        return ()
    minimum = min(points)
    rotations = []
    for order in [points, list(reversed(points))]:
        for i, point in enumerate(order):
            if point == minimum:
                rotations.append(tuple(order[i:] + order[:i]))
    return min(rotations)


def footprint_key(coordinates):
    return (ring_key(coordinates[0]), tuple(sorted(ring_key(r) for r in coordinates[1:])))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_pbf')
    args = parser.parse_args()
    pbf = Path(args.input_pbf)
    expected_hash = '574423f1685e7b0a82a14166ba492376fc824294680ea0c576426ff408230397'
    actual_hash = hashlib.sha256(pbf.read_bytes()).hexdigest()
    if actual_hash != expected_hash:
        raise ValueError('Use the reviewed OSM snapshot; review provenance before changing the input.')
    source = ROOT / 'data/sources/buildings.geojson'
    source_bytes = source.read_bytes()
    features = json.loads(source_bytes)['features']
    indexes = {}
    polygons = [shape(f['geometry']) for f in features]
    for i, feature in enumerate(features):
        indexes.setdefault(footprint_key(feature['geometry']['coordinates']), []).append(i)

    class Addresses(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.nodes = []
            self.matches = {}
            self.members = {}

        def node(self, n):
            number = house_number(n.tags.get('addr:housenumber', ''))
            if number and n.location.valid():
                self.nodes.append((n.id, Point(n.location.lon, n.location.lat), number, n.tags.get('addr:street', '')))

        def way(self, w):
            if not w.tags.get('building') or not w.is_closed():
                return
            try:
                coordinates = [(n.lon, n.lat) for n in w.nodes]
            except osmium.InvalidLocationError:
                return
            candidates = indexes.get(footprint_key([coordinates]), [])
            if len(candidates) != 1:
                return
            i = candidates[0]
            self.matches.setdefault(i, []).append({'osm_id': 'way/' + str(w.id), 'number': house_number(w.tags.get('addr:housenumber', '')), 'street': w.tags.get('addr:street', '')})
            for n in w.nodes:
                self.members.setdefault(n.ref, set()).add(i)

    addresses = Addresses()
    addresses.apply_file(str(pbf), locations=True, idx='flex_mem')
    matched = {i: rows[0] for i, rows in addresses.matches.items() if len(rows) == 1}
    tree = STRtree(polygons)
    node_addresses = {}
    ambiguous = 0
    for nid, point, number, street in addresses.nodes:
        members = addresses.members.get(nid, set())
        candidates = list(members) if members else [int(i) for i in tree.query(point, predicate='intersects')]
        if len(candidates) != 1:
            ambiguous += len(candidates) > 1
            continue
        i = candidates[0]
        if i not in matched:
            continue
        node_addresses.setdefault(i, []).append({'osm_id': 'node/' + str(nid), 'number': number, 'street': street})

    labels = []
    direct = 0
    from_nodes = 0
    for i, way in sorted(matched.items()):
        rows = [way] if way['number'] else node_addresses.get(i, [])
        if not rows or not polygons[i].is_valid:
            continue
        numbers = sorted({row['number'] for row in rows})
        text = '; '.join(numbers)
        if len(text) > 128:
            continue
        anchor = polylabel(polygons[i], tolerance=0.000001)
        if not polygons[i].covers(anchor):
            raise ValueError('Label anchor outside its footprint')
        # Retain sub-metre anchor precision so tiny footprints stay valid.
        point = [anchor.x, anchor.y]
        properties = {'kind': 'building', 'addr:housenumber': text, 'osm_id': way['osm_id'], 'footprintIndex': i,
                      'address_sources': sorted({row['osm_id'] for row in rows})}
        streets = sorted({row['street'] for row in rows if row['street']})
        if len(streets) == 1:
            properties['addr:street'] = streets[0]
        labels.append({'type': 'Feature', 'id': way['osm_id'], 'geometry': {'type': 'Point', 'coordinates': point}, 'properties': properties})
        direct += bool(way['number'])
        from_nodes += not bool(way['number'])
    data = (json.dumps({'type': 'FeatureCollection', 'features': labels}, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    (ROOT / 'data/sources/building-labels.geojson').write_bytes(data)
    metadata = {'source': 'OpenStreetMap / Geofabrik Montenegro', 'upstream_snapshot': '2026-10-17T20:20:51Z', 'input_pbf_sha256': actual_hash,
                'buildings_sha256': hashlib.sha256(source_bytes).hexdigest(), 'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'features': len(labels), 'direct_building_addresses': direct, 'node_derived_addresses': from_nodes, 'ambiguous_address_nodes_skipped': ambiguous,
                'matched_footprints': len(matched), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'license': 'ODbL 1.0',
                'method': 'Exact footprint match at existing six-decimal precision. Direct building number preferred; otherwise unique address-node membership/containment. Anchor is inside the polygon. No inferred numbering or nearest-building assignment; no-number placeholders (bb/bez broja) are excluded.'}
    (ROOT / 'data/sources/building-labels.provenance.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata), flush=True)


if __name__ == '__main__':
    main()
