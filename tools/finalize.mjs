import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const web=path.resolve('web');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
let archive=path.join(web,'data/montenegro.pmtiles');
if(!fs.existsSync(archive)){archive=fs.readdirSync(path.join(web,'data')).filter(p=>/^montenegro-[a-f0-9]+\.pmtiles$/.test(p)).map(p=>path.join(web,'data',p))[0];}
const data=fs.readFileSync(archive),hash=sha(data),archiveName='data/montenegro-'+hash.slice(0,16)+'.pmtiles';
if(path.resolve(archive)!==path.join(web,archiveName))fs.renameSync(archive,path.join(web,archiveName));
for(const name of fs.readdirSync(path.join(web,'data')))if(name.endsWith('.pmtiles')&&'data/'+name!==archiveName)fs.unlinkSync(path.join(web,'data',name));
const shell=['index.html','app.js','core.js','offline.js','map-style.js','satellite.js','style.css','icon.svg','icon-192.png','icon-512.png','manifest.webmanifest','vendor/maplibre-gl.js','vendor/maplibre-gl.css','vendor/pmtiles.js','data/places.geojson'];
for(const stack of fs.readdirSync(path.join(web,'fonts'))){const p=path.join(web,'fonts',stack);if(fs.statSync(p).isDirectory())for(const f of fs.readdirSync(p))if(f.endsWith('.pbf'))shell.push('fonts/'+stack+'/'+f);}
// Satellite is deliberately small: include every sample asset in offline releases.
function collectSatellite(dir) {
 for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
  const p=path.join(dir,item.name);
  if(item.isDirectory())collectSatellite(p);
  else if(/\.(webp|png|json)$/.test(item.name))shell.push(path.relative(web,p).split(path.sep).join('/'));
 }
}
collectSatellite(path.join(web,'data/satellite'));
const shellHash=sha(Buffer.concat([...shell,'sw.js'].map(f=>fs.readFileSync(path.join(web,f))))).slice(0,16);
const manifest={version:'0.1.0',sourceTimestamp:'2026-10-17T20:20:51Z',coverage:'Detailed central Podgorica; Montenegro major roads and attractions.',archive:{path:archiveName,sha256:hash,bytes:data.length},shellCache:'kompas-shell-'+shellHash+'-'+hash.slice(0,8),shell:[...shell,'data/manifest.json'],totalBytes:data.length+shell.reduce((n,f)=>n+fs.statSync(path.join(web,f)).size,0)};
fs.writeFileSync(path.join(web,'data/manifest.json'),JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(web,'offline-manifest.js'),'self.KOMPAS_OFFLINE='+JSON.stringify({shellCache:manifest.shellCache,shell:manifest.shell})+';\n');
console.log('Archive:',archiveName,'bytes:',data.length,'total offline bytes:',manifest.totalBytes,'shell assets:',manifest.shell.length);
