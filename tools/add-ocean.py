from pathlib import Path
import json
from shapely.geometry import shape,mapping,box
from shapely.ops import unary_union
root=Path(__file__).resolve().parents[1]/'source-data'
land=json.loads((root/'land.geojson').read_text())
countries=[shape(f['geometry']) for f in land['features'] if f['properties'].get('kind') in ['country','context']]
ocean=box(17.5,41,21.5,44.2).difference(unary_union(countries))
water=json.loads((root/'water.geojson').read_text())
water['features']=[f for f in water['features'] if f['properties'].get('kind')!='ocean']
water['features'].insert(0,{'type':'Feature','properties':{'kind':'ocean'},'geometry':mapping(ocean)})
(root/'water.geojson').write_text(json.dumps(water,ensure_ascii=False,separators=(',',':')))
print('Added ocean polygon using existing country coastlines')
