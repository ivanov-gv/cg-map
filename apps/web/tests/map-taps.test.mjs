import test from 'node:test';
import assert from 'node:assert/strict';
import {installMapTaps} from '../src/map-taps.js';
function setup(){
 const handlers=new Map(),timers=new Map(),selected=[];let time=0,id=0,moving=false;
 const map={on:(k,v)=>handlers.set(k,v),off:k=>handlers.delete(k),isMoving:()=>moving};
 const dispose=installMapTaps(map,e=>selected.push(e),{now:()=>time,schedule:f=>{timers.set(++id,f);return id;},cancel:id=>timers.delete(id)});
 return {handlers,timers,selected,dispose,fire:(k,e={})=>handlers.get(k)?.(e),advance:()=>{time+=501;const jobs=[...timers.values()];timers.clear();jobs.forEach(f=>f());},move:()=>{moving=true;}};
}
test('single click selects only after the recognition window',()=>{const e=setup();e.fire('click',{id:1});assert.equal(e.selected.length,0);e.advance();assert.deepEqual(e.selected,[{id:1}]);});
test('second contact, double click, movement and cancellation suppress point selection',()=>{
 for(const gesture of ['touchstart','mousedown','dblclick','movestart','touchcancel','remove']){
  const e=setup();e.fire('click');e.fire(gesture);e.advance();assert.equal(e.selected.length,0,gesture);
 }
 const e=setup();e.fire('click',{originalEvent:{detail:2}});e.advance();assert.equal(e.selected.length,0);
});
test('pending callbacks cannot select while moving; disposal clears listeners and timers',()=>{
 const e=setup();e.fire('click');e.move();e.advance();assert.equal(e.selected.length,0);
 e.dispose();assert.equal(e.handlers.size,0);assert.equal(e.timers.size,0);
});
