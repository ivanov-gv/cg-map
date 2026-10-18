from pathlib import Path
import json,gzip
from pmtiles.writer import write
from pmtiles.tile import zxy_to_tileid,Compression,TileType
root=Path(__file__).resolve().parents[2]
tiles=json.loads((root/'.build/tiles/tiles.json').read_text())
with write(str(root/'data/artifacts/montenegro.pmtiles')) as writer:
    for t in sorted(tiles,key=lambda t:zxy_to_tileid(t['z'],t['x'],t['y'])):
        writer.write_tile(zxy_to_tileid(t['z'],t['x'],t['y']),gzip.compress((root/'.build/tiles'/t['file']).read_bytes(),mtime=0))
    writer.finalize({'tile_compression':Compression.GZIP,'tile_type':TileType.MVT,'min_zoom':0,'max_zoom':17,'min_lon_e7':183500000,'min_lat_e7':417500000,'max_lon_e7':204000000,'max_lat_e7':436000000,'center_zoom':14,'center_lon_e7':192600000,'center_lat_e7':424370000},{'name':'Kompas Montenegro vector PoC','description':'National overview; detailed central Podgorica. OSM 2026-10-17.','attribution':'© OpenStreetMap contributors · ODbL; Natural Earth public domain','vector_layers':[{'id':n,'fields':{},'minzoom':13 if n=='buildings' else 0,'maxzoom':17} for n in ['land','water','roads','buildings']]})
print('PMTiles bytes', (root/'data/artifacts/montenegro.pmtiles').stat().st_size)
