import test from 'node:test';import assert from 'node:assert/strict';
import {fold,matches,selectNearest,safeWebsite} from '../src/core.js';
const feature=(name,category,coordinates)=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{name,category}});
test('search handles Serbian Latin diacritics and Cyrillic',()=>{assert.equal(fold('Његошева улица'),'njegoseva ulica');assert.equal(fold('Đorđević'),'djordjevic');assert.equal(matches(feature('Никшић','sights',[19,42]),'niksic','all'),true);});
test('category filter and nearest ordering operate independently',()=>{const a=feature('Cafe','food',[19.25,42.44]),b=feature('Museum','sights',[18.8,42.4]);assert.equal(matches(a,'cafe','shops'),false);assert.equal(selectNearest([b,a],[19.25,42.44])[0].f,a);});
test('place URLs reject executable and malformed schemes',()=>{for(const value of ['javascript:alert(1)','data:text/html,hello','file:///tmp/x','not a URL'])assert.equal(safeWebsite(value),null);assert.equal(safeWebsite('https://example.org'),'https://example.org/');});
