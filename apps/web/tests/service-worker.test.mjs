import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const manifest=JSON.parse(fs.readFileSync('dist/web/data/manifest.json')),script=fs.readFileSync('dist/web/sw.js','utf8');
function setup(cached={marker:'cached shell'}){const events={},saved=[];let network=0;const cache={addAll:async urls=>saved.push(...urls),match:async()=>cached};const self={KOMPAS_OFFLINE:manifest,registration:{scope:'https://map.test/'},location:{origin:'https://map.test'},skipWaiting:async()=>{},clients:{claim:async()=>{},matchAll:async()=>[]},addEventListener:(name,handler)=>events[name]=handler};vm.runInNewContext(script,{self,importScripts:()=>{},caches:{open:async()=>cache,keys:async()=>[],delete:async()=>{}},URL,Request,Response,Headers,fetch:async()=>{network++;throw new Error('Network unavailable');}});return {events,saved,cached,get network(){return network;}};}
test('shell installation excludes the archive and partial tile requests',async()=>{const env=setup();await new Promise((resolve,reject)=>env.events.install({waitUntil:p=>p.then(resolve,reject)}));assert.ok(env.saved.some(u=>u.url.endsWith('/index.html')));assert.ok(env.saved.some(u=>u.url.includes('/fonts/')));assert.ok(env.saved.every(u=>!u.url.endsWith('.pmtiles')&&u.cache==='reload'));});
test('range responses never enter shell-cache interception',()=>{const env=setup();let intercepted=false;env.events.fetch({request:new Request('https://map.test/'+manifest.archive.path,{headers:{Range:'bytes=0-126'}}),respondWith:()=>intercepted=true});assert.equal(intercepted,false);});
test('cached shell serves without network access',async()=>{const env=setup();let promise;env.events.fetch({request:new Request('https://map.test/app.js'),respondWith:p=>promise=p});assert.equal(await promise,env.cached);assert.equal(env.network,0);});
test('a complete update activates and starts scoped navigation without waiting for it',async()=>{
 let skipped=0,claimed=0,navigated=0;const events={},deleted=[];
 const self={KOMPAS_OFFLINE:manifest,registration:{scope:'https://map.test/cg-map/'},location:{origin:'https://map.test'},skipWaiting:async()=>skipped++,clients:{claim:async()=>claimed++,matchAll:async()=>[
  {url:'https://map.test/cg-map/?lang=sr#point',navigate:()=>{navigated++;return new Promise(()=>{});}},
  {url:'https://map.test/other/',navigate:()=>{throw new Error('Out-of-scope tab');}}
 ]},addEventListener:(n,h)=>events[n]=h};
 vm.runInNewContext(script,{self,importScripts:()=>{},caches:{open:async()=>({addAll:async()=>{}}),keys:async()=>['kompas-shell-old',manifest.shellCache,'unrelated-cache'],delete:async key=>deleted.push(key)},URL,Request});
 for(const name of ['install','activate'])await new Promise((resolve,reject)=>events[name]({waitUntil:p=>p.then(resolve,reject)}));
 assert.equal(skipped,1);assert.equal(claimed,1);assert.equal(navigated,1);assert.deepEqual(deleted,['kompas-shell-old']);
});
test('failed shell replacement never activates or removes the working cache',async()=>{
 const events={};let skipped=false;
 const self={KOMPAS_OFFLINE:manifest,registration:{scope:'https://map.test/'},skipWaiting:async()=>{skipped=true;},addEventListener:(n,h)=>events[n]=h};
 vm.runInNewContext(script,{self,importScripts:()=>{},caches:{open:async()=>({addAll:async()=>{throw new Error('Incomplete release');}})},URL,Request});
 await assert.rejects(new Promise((resolve,reject)=>events.install({waitUntil:p=>p.then(resolve,reject)})),/Incomplete release/);
 assert.equal(skipped,false);
});
test('cached redirect becomes a non-redirect response suitable for page navigation',async()=>{
 const cached=new Response('<!doctype html><title>Kompas</title>',{headers:{'Content-Type':'text/html','Content-Encoding':'gzip','Content-Length':'12'}});
 Object.defineProperty(cached,'redirected',{value:true});
 const env=setup(cached);let promise;
 env.events.fetch({request:{url:'https://map.test/',method:'GET',headers:new Headers(),mode:'navigate',redirect:'manual'},respondWith:p=>promise=p});
 const response=await promise;assert.equal(response.redirected,false);assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'text/html');assert.equal(response.headers.get('Content-Encoding'),null);assert.equal(await response.text(),'<!doctype html><title>Kompas</title>');assert.equal(env.network,0);
});
