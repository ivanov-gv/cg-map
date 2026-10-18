import test from 'node:test';
import assert from 'node:assert/strict';
import {roadURL,parseRoadRoute,RoadRouter} from '../src/routing.js';
import {planTransit} from '../src/transit-routing.js';
export const network={version:1,retrievedAt:'2026-10-18T19:00:00Z',stops:{a:{name:'A',coordinates:[19.2,42.44]},b:{name:'B',coordinates:[19.22,42.44]},c:{name:'C',coordinates:[19.24,42.44]}},patterns:[{route:'1',name:'One',headsign:'B',stops:['a','b'],offsets:[0,300]},{route:'2',name:'Two',headsign:'C',stops:['b','c'],offsets:[0,360]}]};
const road=()=>({code:'Ok',routes:[{distance:1200,duration:180,geometry:{type:'LineString',coordinates:[[19.2,42.44],[19.24,42.44]]},legs:[{steps:[]}]}]});
test('walk uses the separate foot profile; invalid coordinates and service routes are rejected',()=>{
 assert.match(roadURL('walk',[19,42],[20,43]),/routed-foot/);assert.match(roadURL('car',[19,42],[20,43]),/routed-car/);
 assert.throws(()=>roadURL('walk',[NaN,42],[20,43]));assert.throws(()=>parseRoadRoute({code:'NoRoute'},'car'));
 const bad=road();bad.routes[0].geometry.coordinates[0]=[Infinity,42];assert.throws(()=>parseRoadRoute(bad,'car'));
});
test('road results are cached and cancelled queued requests do not fetch',async()=>{
 let calls=0;const router=new RoadRouter(async()=>{calls++;return Response.json(road());});
 await router.route('car',[19.2,42.44],[19.24,42.44]);await router.route('car',[19.2,42.44],[19.24,42.44]);assert.equal(calls,1);
 const c=new AbortController();c.abort();await assert.rejects(router.route('walk',[19.2,42.44],[19.24,42.44],c.signal));assert.equal(calls,1);
});
test('transit supports direct buses and one transfer without fabricating waiting times',()=>{
 const direct=planTransit(network,[19.2,42.44],[19.22,42.44]);assert.equal(direct.legs.filter(l=>l.kind==='bus').length,1);assert.equal(direct.duration,300);
 const transfer=planTransit(network,[19.2,42.44],[19.24,42.44]);assert.deepEqual(transfer.legs.filter(l=>l.kind==='bus').map(l=>l.route),['1','2']);assert.equal(transfer.duration,660);
 assert.throws(()=>planTransit(network,[19.24,42.44],[19.2,42.44]),/No bus suggestion/);
 assert.throws(()=>planTransit(network,[18,43],[20,43]),/No bus suggestion/);
});

test('a provider response arriving after cancellation cannot enter the route cache',async()=>{
 let respond,started;const waiting=new Promise(resolve=>{started=resolve;});
 const router=new RoadRouter(()=>new Promise(resolve=>{respond=resolve;started();}));
 const controller=new AbortController();
 const pending=router.route('car',[19.2,42.44],[19.24,42.44],controller.signal);
 await waiting;controller.abort();respond(Response.json(road()));
 await assert.rejects(pending);assert.equal(router.cache.size,0);
});
