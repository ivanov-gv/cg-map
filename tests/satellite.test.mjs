import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {mapStyle} from '../web/map-style.js';
import {installSatellite,setSatelliteVisible,satelliteBounds,satelliteLayerIds} from '../web/satellite.js';

test('satellite uses bounded local imagery below labels and toggles without replacing the map',()=>{
 globalThis.location={href:'https://ivanov-gv.github.io/cg-map/'};
 const style=mapStyle('https://ivanov-gv.github.io/cg-map/data/map.pmtiles');
 const map={addSource(id,source){style.sources[id]=source;},addLayer(layer,before){const i=style.layers.findIndex(l=>l.id===before);assert.ok(i>=0);style.layers.splice(i,0,layer);},setLayoutProperty(id,key,value){style.layers.find(l=>l.id===id).layout[key]=value;}};
 installSatellite(map,location.href);
 assert.deepEqual(validateStyleMin(style).map(e=>e.message),[]);
 assert.deepEqual(style.sources['satellite-tiles'].bounds,satelliteBounds);
 assert.ok(style.sources['satellite-tiles'].tiles[0].startsWith(location.href));
 assert.ok(style.sources['satellite-tiles'].tiles[0].includes('17/{x}/{y}.webp'));
 assert.equal(style.sources['satellite-tiles'].maxzoom,17);
 for(const id of satelliteLayerIds){assert.equal(style.layers.find(l=>l.id===id).layout.visibility,'none');assert.ok(style.layers.findIndex(l=>l.id===id)<style.layers.findIndex(l=>l.id==='road-labels'));}
 for(const visible of [true,false]){setSatelliteVisible(map,visible);for(const id of satelliteLayerIds)assert.equal(style.layers.find(l=>l.id===id).layout.visibility,visible?'visible':'none');}
});

test('all 16 satellite tiles match their source hashes and are available offline and in Pages',()=>{
 const sample=JSON.parse(fs.readFileSync('web/data/satellite/manifest.json'));
 const offline=JSON.parse(fs.readFileSync('web/data/manifest.json'));
 assert.equal(sample.tiles.length,16);
 for(const tile of sample.tiles){const rel='data/satellite/'+tile.path;const bytes=fs.readFileSync('web/'+rel);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),tile.sha256);assert.ok(offline.shell.includes(rel));assert.deepEqual(fs.readFileSync('docs/'+rel),bytes);}
 for(const rel of ['satellite.js','data/satellite/podgorica-center.webp']){assert.ok(offline.shell.includes(rel));assert.deepEqual(fs.readFileSync('docs/'+rel),fs.readFileSync('web/'+rel));}
});
