import fs from 'node:fs';
import path from 'node:path';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.join(root,'.build/tiles');fs.mkdirSync(out,{recursive:true});
const indexes={};
for(const name of ['land','water','roads','buildings']){
 const data=JSON.parse(fs.readFileSync(path.join(root,'data/sources',name+'.geojson')));
 indexes[name]=geojsonvt(data,{maxZoom:17,indexMaxZoom:5,indexMaxPoints:50000,tolerance:2,extent:8192,buffer:128,generateId:true});
 console.log(name,data.features.length);
}
const x=(lon,z)=>Math.floor((lon+180)/360*2**z);
const y=(lat,z)=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z);
const manifest=[];
for(let z=0;z<=16;z++){
 const b=[18.35,41.75,20.4,43.6];
 for(let tx=x(b[0],z);tx<=x(b[2],z);tx++)for(let ty=y(b[3],z);ty<=y(b[1],z);ty++){
  const layers={};
  for(const [name,idx] of Object.entries(indexes)){
   if(name==='buildings'&&z<13)continue;
   const tile=idx.getTile(z,tx,ty);
   if(!tile?.features.length)continue;
   if(name==='roads'&&z<11)tile.features=tile.features.filter(f=>z>=9?!['residential','service','footway','path','steps','track','pedestrian','living_street'].includes(f.tags.kind):['motorway','trunk','primary','secondary','motorway_link','trunk_link','primary_link'].includes(f.tags.kind));
   if(tile.features.length)layers[name]=tile;
  }
  if(!Object.keys(layers).length)continue;
  const name=`${z}-${tx}-${ty}.pbf`;fs.writeFileSync(path.join(out,name),vtpbf.fromGeojsonVt(layers,{extent:8192}));
  manifest.push({z,x:tx,y:ty,file:name});
 }
 console.log('zoom',z,'total tiles',manifest.length);
}
fs.writeFileSync(path.join(out,'tiles.json'),JSON.stringify(manifest));
