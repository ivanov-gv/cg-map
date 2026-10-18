import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import * as pmtiles from 'pmtiles';import {ArchiveSource} from '../../apps/web/src/offline.js';
const manifest=JSON.parse(fs.readFileSync('dist/web/data/manifest.json')),bytes=fs.readFileSync('dist/web/'+manifest.archive.path);globalThis.pmtiles=pmtiles;
test('a host ignoring Range loads one complete archive and serves valid local slices',async()=>{
 let requests=0;globalThis.fetch=async()=>{requests++;return new Response(bytes,{headers:{'Content-Length':String(bytes.length)}});};
 const source=new ArchiveSource('https://map.test/map.pmtiles',manifest),reader=new pmtiles.PMTiles(source);
 const header=await reader.getHeader();assert.equal(header.maxZoom,16);
 const [a,b]=await Promise.all([source.getBytes(100,25),source.getBytes(1000,30)]);
 assert.deepEqual(Buffer.from(a.data),bytes.subarray(100,125));assert.deepEqual(Buffer.from(b.data),bytes.subarray(1000,1030));assert.equal(requests,1);assert.equal(source.local,null);
});
test('a range-capable host retains partial reads rather than downloading the archive',async()=>{
 let transferred=0;globalThis.fetch=async(url,options)=>{const h=new Headers(options?.headers);const [,first,last]=h.get('Range').match(/bytes=(\d+)-(\d+)/);const start=Number(first),end=Math.min(Number(last),bytes.length-1);const data=bytes.subarray(start,end+1);transferred+=data.length;return new Response(data,{status:206,headers:{'Content-Length':String(data.length),'Content-Range':`bytes ${start}-${end}/${bytes.length}`}});};
 const source=new ArchiveSource('https://map.test/map.pmtiles',manifest),reader=new pmtiles.PMTiles(source);assert.equal((await reader.getHeader()).maxZoom,16);await source.getBytes(500000,200);assert.ok(transferred<100000);assert.equal(source.onlineBlob,null);
});
