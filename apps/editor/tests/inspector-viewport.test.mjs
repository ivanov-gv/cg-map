import test from 'node:test';
import assert from 'node:assert/strict';
import {installInspectorViewport} from '../src/inspector-viewport.js';

// A viewport and focused field without a browser: only geometry, events and scroll requests matter here.
function viewportEnvironment(t, viewport) {
  const styles = new Map();
  const classes = new Map();
  const writes = [];
  const scrollRequests = [];
  const frames = [];
  const field = {scrollIntoView: options => scrollRequests.push(options)};
  const content = new EventTarget();
  content.contains = element => element === field;
  const document = {
    activeElement: field,
    querySelector: () => content,
    documentElement: {
      clientHeight: 840,
      style: {setProperty: (name, value) => {
        writes.push([name, value]);
        styles.set(name, value);
      }},
      classList: {toggle: (name, isPresent) => classes.set(name, isPresent)}
    }
  };
  const window = new EventTarget();
  window.innerHeight = 840;
  window.visualViewport = viewport;
  const globals = {window, document, requestAnimationFrame: callback => frames.push(callback)};
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
  return {styles, classes, writes, scrollRequests, frames, document, content, window};
}

test('keyboard resize and pan track the visible viewport and reveal only inspector fields', t => {
  const viewport = Object.assign(new EventTarget(), {height: 840, offsetTop: 0});
  const environment = viewportEnvironment(t, viewport);
  const {styles, classes, writes, frames, scrollRequests, document, content, window} = environment;
  installInspectorViewport();
  frames.shift()();
  assert.equal(styles.get('--viewport-bottom'), '0px');
  assert.deepEqual(scrollRequests, [{block: 'nearest'}]);

  window.innerHeight = 430;
  viewport.height = 430;
  viewport.offsetTop = 35;
  viewport.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('resize'));
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(styles.get('--viewport-height'), '430px');
  assert.equal(styles.get('--viewport-top'), '35px');
  assert.equal(styles.get('--viewport-bottom'), '375px');
  assert.equal(scrollRequests.length, 2);
  assert.equal(writes.length, 6);
  viewport.dispatchEvent(new Event('scroll'));
  viewport.dispatchEvent(new Event('resize'));
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(writes.length, 6);
  assert.equal(scrollRequests.length, 2);

  viewport.offsetTop = 50;
  viewport.dispatchEvent(new Event('scroll'));
  document.activeElement = {};
  frames.shift()();
  assert.equal(styles.get('--viewport-bottom'), '360px');
  content.dispatchEvent(new Event('focusin'));
  frames.shift()();
  assert.equal(scrollRequests.length, 2, 'focus outside the inspector must never scroll the map');

  viewport.height = 240;
  viewport.dispatchEvent(new Event('resize'));
  frames.shift()();
  assert.equal(classes.get('has-short-viewport'), true);
  viewport.height = 840;
  viewport.offsetTop = 0;
  window.dispatchEvent(new Event('resize'));
  frames.shift()();
  assert.equal(styles.get('--viewport-bottom'), '0px');
  assert.equal(classes.get('has-short-viewport'), false);
});

test('browsers without visualViewport keep the CSS viewport fallback', t => {
  const {styles, frames} = viewportEnvironment(t, undefined);
  installInspectorViewport();
  assert.equal(styles.size, 0);
  assert.equal(frames.length, 0);
});
