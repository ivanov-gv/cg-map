import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {PMTiles,TileType} from 'pmtiles';import {VectorTile} from '@mapbox/vector-tile';import Pbf from 'pbf';import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';import {mapStyle} from '../../apps/web/src/map-style.js';
const web=path.resolve('dist/web'),manifest=JSON.parse(fs.readFileSync(path.join(web,'data/manifest.json'))),bytes=fs.readFileSync(path.join(web,manifest.archive.path));
const source={getKey:()=>manifest.archive.path,getBytes:async(offset,length)=>({data:bytes.buffer.slice(bytes.byteOffset+offset,bytes.byteOffset+Math.min(offset+length,bytes.length))})};
const archive=new PMTiles(source);const xy=(lon,lat,z)=>[Math.floor((lon+180)/360*2**z),Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z)];
test('published archive is a valid vector archive with a verified content hash',async()=>{const h=await archive.getHeader();assert.equal(h.tileType,TileType.Mvt);assert.equal(h.minZoom,0);assert.equal(h.maxZoom,16);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),manifest.archive.sha256);assert.equal(bytes.length,manifest.archive.bytes);assert.ok(h.numAddressedTiles>100000);});
test('dense Podgorica tile decodes real roads and buildings at native zoom',async()=>{const [x,y]=xy(19.26,42.437,16);const tile=await archive.getZxy(16,x,y);assert.ok(tile);const decoded=new VectorTile(new Pbf(tile.data));for(const name of ['land','roads','buildings']){assert.ok(decoded.layers[name]?.length>0,name);assert.equal(decoded.layers[name].extent,8192);}const building=decoded.layers.buildings.feature(0);assert.equal(building.type,3);assert.ok(building.loadGeometry()[0].length>=4);});
test('country overview and coast remain decodable across representative zooms',async()=>{for(const [lon,lat,z] of [[19.26,42.437,7],[18.77,42.424,14],[19.12,43.15,16],[19.26,42.437,18]]){const [x,y]=xy(lon,lat,z),tile=await archive.getZxy(z,x,y);if(z>16){assert.equal(tile,undefined);continue;}assert.ok(tile,`${z}/${x}/${y}`);const decoded=new VectorTile(new Pbf(tile.data));assert.ok(Object.keys(decoded.layers).length);}});
test('style is valid and uses vector sources, including unescaped glyph tokens',()=>{globalThis.location={href:'http://localhost:8080/'};const style=mapStyle('http://localhost:8080/'+manifest.archive.path);assert.deepEqual(validateStyleMin(style).map(e=>e.message),[]);assert.ok(style.glyphs.includes('{fontstack}/{range}'));assert.ok(Object.values(style.sources).every(s=>s.type!=='raster'));});
test('every required offline asset exists and the glyph ranges cover names',()=>{for(const f of manifest.shell)assert.ok(fs.statSync(path.join(web,f)).size>0,f);const places=JSON.parse(fs.readFileSync(path.join(web,'data/places.geojson')));assert.equal(places.features.length,1811);const ranges=new Set([0]);for(const file of ['dist/web/data/places.geojson','data/sources/roads.geojson'])for(const f of JSON.parse(fs.readFileSync(file)).features)for(const [key,value] of Object.entries(f.properties))if(['name','name:en'].includes(key))for(const c of String(value)){if(c.codePointAt(0)>31)ranges.add(Math.floor(c.codePointAt(0)/256)*256);}for(const start of ranges)assert.ok(fs.existsSync(path.join(web,'fonts/Open Sans Semibold',`${start}-${start+255}.pbf`)),String(start));});

test('address footprint indices match polygon IDs and locations in the published archive',async()=>{
 const labels=JSON.parse(fs.readFileSync(path.join(web,'data/building-labels.geojson')));
 const tiles=new Map();
 const inside=(p,ring)=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;
 }return hit;};
 for(const label of labels.features){
  const [lon,lat]=label.geometry.coordinates,[x,y]=xy(lon,lat,16),key=`${x}/${y}`;
  if(!tiles.has(key)){
   const tile=await archive.getZxy(16,x,y);assert.ok(tile,key);
   const layer=new VectorTile(new Pbf(tile.data)).layers.buildings;
   tiles.set(key,Array.from({length:layer.length},(_,i)=>layer.feature(i)));
  }
  const matches=tiles.get(key).filter(f=>f.id===label.properties.footprintIndex);
  assert.ok(matches.some(f=>{
   const g=f.toGeoJSON(x,y,16).geometry;
   const polygons=g.type==='Polygon'?[g.coordinates]:g.coordinates;
   return polygons.some(rings=>inside([lon,lat],rings[0])&&!rings.slice(1).some(r=>inside([lon,lat],r)));
  }),`${label.id}: address must join its actual footprint, not another polygon`);
 }
});
