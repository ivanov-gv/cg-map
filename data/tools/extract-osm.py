"""Reproducible OSM -> lightweight demonstration layers. pip install osmium shapely"""
import osmium, json, sys, pathlib, datetime, argparse
from shapely.geometry import shape, mapping, LineString, Point
from shapely.ops import unary_union, polygonize
BASE=pathlib.Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description='Small OSM display extractor; not a full cartographic pipeline.')
parser.add_argument('input_pbf')
parser.add_argument('--all-details',action='store_true',help='Include roads/buildings beyond the local detail box; increases build cost.')
parser.add_argument('--all-places',action='store_true',help='Include supported named place categories throughout the extract.')
parser.add_argument('--detail-bbox',nargs=4,type=float,default=[19.20,42.405,19.295,42.465],metavar=('WEST','SOUTH','EAST','NORTH'))
args=parser.parse_args()
OUT=BASE/'data/sources';OUT.mkdir(exist_ok=True)
LOCAL=tuple(args.detail_bbox)
def inside(x,y):return LOCAL[0]<=x<=LOCAL[2] and LOCAL[1]<=y<=LOCAL[3]
def feature(g,p):return {'type':'Feature','geometry':g,'properties':p}
def rounded(g):
 if isinstance(g,(list,tuple)):return [rounded(x) for x in g]
 if isinstance(g,float):return round(g,6)
 return g
class Extract(osmium.SimpleHandler):
 def __init__(self):
  super().__init__();self.factory=osmium.geom.GeoJSONFactory();self.layers={x:[] for x in ['roads','buildings','land','water','places']};self.ids=set();self.coast=[]
 def poi(self,t,g,oid):
  if not t.get('name'):return
  a=t.get('amenity','');tour=t.get('tourism','');shop=t.get('shop','')
  cat=''
  if a in ['restaurant','cafe','bar','pub','fast_food','ice_cream']:cat='food'
  elif tour in ['attraction','museum','viewpoint','artwork','gallery'] or t.get('historic') in ['castle','monument','ruins','memorial']:cat='sights'
  elif shop:cat='shops'
  elif tour in ['hotel','hostel','guest_house','motel','camp_site']:cat='stay'
  elif a in ['pharmacy','hospital','clinic','bank','atm','fuel','post_office']:cat='essentials'
  if not cat:return
  # Countrywide attractions, local directory for everything else.
  if cat!='sights' and not args.all_places and not inside(*g['coordinates']):return
  p={'id':oid,'name':t['name'],'category':cat,'kind':a or tour or shop or t.get('historic'),'source':'OpenStreetMap'}
  for k in ['name:en','website','opening_hours','phone','addr:street','addr:housenumber']:
   if t.get(k):p[k]=t[k]
  self.layers['places'].append(feature(g,p));self.ids.add(oid)
 def node(self,n):
  if n.location.valid():self.poi(n.tags,{'type':'Point','coordinates':[n.location.lon,n.location.lat]},'node/'+str(n.id))
 def way(self,w):
  t=w.tags
  try: coords=[(n.lon,n.lat) for n in w.nodes if n.location.valid()]
  except:return
  if len(coords)<2:return
  if t.get('natural')=='coastline':self.coast.append(LineString(coords))
  local=args.all_details or any(inside(x,y) for x,y in coords)
  h=t.get('highway','')
  major=h in ['motorway','trunk','primary','secondary','tertiary','motorway_link','trunk_link','primary_link','secondary_link']
  if h and (major or local) and h not in ['proposed','construction','platform']:
   g=shape({'type':'LineString','coordinates':coords}).simplify(.000015 if local else .0001)
   self.layers['roads'].append(feature(mapping(g),{'kind':h,'name':t.get('name','')}))
  if t.get('waterway') in ['river','canal']:
   self.layers['water'].append(feature({'type':'LineString','coordinates':coords},{'kind':'river','name':t.get('name','')}))
  if w.is_closed() and len(coords)>3:
   poly={'type':'Polygon','coordinates':[coords]}
   if t.get('building') and local:self.layers['buildings'].append(feature(poly,{'kind':'building'}))
   if (t.get('landuse') in ['forest','grass','meadow','recreation_ground'] or t.get('leisure') in ['park','garden']) and local:
    self.layers['land'].append(feature(poly,{'kind':'park','name':t.get('name','')}))
   if t.get('natural')=='water':self.layers['water'].append(feature(mapping(shape(poly).simplify(.0001)),{'kind':'water'}))
   c=shape(poly).representative_point();self.poi(t,{'type':'Point','coordinates':[c.x,c.y]},'way/'+str(w.id))
 def area(self,a):
  t=a.tags
  if (t.get('admin_level')=='2' and t.get('boundary')=='administrative' and t.get('ISO3166-1')=='ME') or (t.get('natural')=='water' and a.from_way()==False):
   try:
    g=shape(json.loads(self.factory.create_multipolygon(a))).simplify(.0001,preserve_topology=True)
    key='land' if t.get('admin_level')=='2' else 'water'
    self.layers[key].insert(0,feature(mapping(g),{'kind':'country' if key=='land' else 'water','name':t.get('name','')}))
   except Exception as e:print('Area skipped',a.id,str(e))
e=Extract();e.apply_file(args.input_pbf,locations=True,idx='flex_mem')
# Fail explicitly if OSM country geometry is unavailable; do not silently change sources.
fallback=not any(f['properties']['kind']=='country' for f in e.layers['land'])
if fallback:raise RuntimeError('Montenegro boundary missing; inspect the input and extractor before publishing.')
# Administrative boundaries include territorial sea; split along OSM coastline for land fill.
if e.coast:
 for f in e.layers['land']:
  if f['properties']['kind']!='country':continue
  country=shape(f['geometry']);polys=list(polygonize(unary_union([country.boundary,unary_union(e.coast)])))
  if polys:
   mainland=max(polys,key=lambda x:x.area)
   if mainland.contains(Point(19.258,42.438)):
    islands=[x for x in polys if x is not mainland and x.area<.001 and country.covers(x.representative_point())]
    f['geometry']=mapping(unary_union([mainland,*islands]).simplify(.00003,preserve_topology=True))
# Reuse the supplied public-domain context; refresh it independently when appropriate.
context=json.loads((OUT/'context-countries.geojson').read_text())
e.layers['land'][:0]=context['features']
for name,features in e.layers.items():
 for f in features:f['geometry']['coordinates']=rounded(f['geometry']['coordinates'])
 p=(OUT/'places.geojson') if name=='places' else OUT/(name+'.geojson');p.write_text(json.dumps({'type':'FeatureCollection','features':features},ensure_ascii=False,separators=(',',':')));print(name,len(features),p.stat().st_size)
meta={'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'Geofabrik / OpenStreetMap','license':'ODbL 1.0','detail_bbox':LOCAL,'counts':{k:len(v) for k,v in e.layers.items()},'country_outline_fallback':fallback,'source_timestamp':osmium.io.Reader(args.input_pbf).header().get('osmosis_replication_timestamp'),'coverage':'Montenegro major roads and attractions; detailed buildings and directory in central Podgorica only.'}
meta['extract_flags']={'all_details':args.all_details,'all_places':args.all_places}
(OUT/'extract-metadata.json').write_text(json.dumps(meta,indent=2))
