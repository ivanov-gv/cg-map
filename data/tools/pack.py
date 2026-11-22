"""Package the reviewed tiles as the current PMTiles archive."""

import gzip
import json
from pathlib import Path

from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import write

ROOT = Path(__file__).resolve().parents[2]
MIN_ZOOM = 0
MAX_ZOOM = 17
MIN_LONGITUDE_E7 = 183500000
MIN_LATITUDE_E7 = 417500000
MAX_LONGITUDE_E7 = 204000000
MAX_LATITUDE_E7 = 436000000
CENTER_ZOOM = 14
CENTER_LONGITUDE_E7 = 192600000
CENTER_LATITUDE_E7 = 424370000


def read_provenance():
    """Read the reviewed snapshot date, coverage and relief licence for the archive header."""
    path = ROOT / 'data/sources/provenance.json'
    return json.loads(path.read_text(encoding='utf-8'))


def read_layer_metadata():
    """Read the layer table emitted by build-tiles from its single shared definition."""
    path = ROOT / '.build/tiles/layer-metadata.json'
    return json.loads(path.read_text(encoding='utf-8'))


def archive_description(provenance):
    """Describe the source snapshot and the DEM behind the relief layers."""
    snapshot_day = provenance['upstream_snapshot'][:10]
    relief_source = provenance['relief']['sources']['contour']
    return f"{provenance['coverage']} OSM {snapshot_day}. Relief: {relief_source}."


def archive_attribution(provenance):
    """Keep the adapted-product notice required for vectors derived from Copernicus DEM."""
    relief_notice = provenance['relief']['license']['adaptedProductNotice']
    return '© OpenStreetMap contributors · ODbL; Natural Earth public domain; ' + relief_notice


def main():
    """Write and finalize the temporary archive for the release step."""
    tiles = json.loads((ROOT / '.build/tiles/tiles.json').read_text(encoding='utf-8'))
    metadata = read_layer_metadata()
    provenance = read_provenance()
    metadata['description'] = archive_description(provenance)
    metadata['attribution'] = archive_attribution(provenance)
    archive_path = ROOT / 'data/artifacts/montenegro.pmtiles'
    with write(str(archive_path)) as writer:
        for tile in sorted(
            tiles, key=lambda value: zxy_to_tileid(value['z'], value['x'], value['y'])
        ):
            tile_id = zxy_to_tileid(tile['z'], tile['x'], tile['y'])
            tile_bytes = (ROOT / '.build/tiles' / tile['file']).read_bytes()
            writer.write_tile(tile_id, gzip.compress(tile_bytes, mtime=0))
        writer.finalize(
            {
                'tile_compression': Compression.GZIP,
                'tile_type': TileType.MVT,
                'min_zoom': MIN_ZOOM,
                'max_zoom': MAX_ZOOM,
                'min_lon_e7': MIN_LONGITUDE_E7,
                'min_lat_e7': MIN_LATITUDE_E7,
                'max_lon_e7': MAX_LONGITUDE_E7,
                'max_lat_e7': MAX_LATITUDE_E7,
                'center_zoom': CENTER_ZOOM,
                'center_lon_e7': CENTER_LONGITUDE_E7,
                'center_lat_e7': CENTER_LATITUDE_E7,
            },
            metadata,
        )
    print('PMTiles bytes', archive_path.stat().st_size)


if __name__ == '__main__':
    main()
