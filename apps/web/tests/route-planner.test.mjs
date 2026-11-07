import test from 'node:test';
import assert from 'node:assert/strict';
import {RoutePlanner} from '../src/route-planner.js';

// The UI boundary is small: record its visible text, mode states and published route geometry.
function plannerEnvironment(testContext, {router, fetchImpl} = {}) {
  const previousGlobals = new Map();
  const installGlobal = (name, value) => {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {value, configurable: true});
  };
  testContext.after(() => {
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const buttons = ['car', 'walk', 'transit'].map(mode => ({
    dataset: {mode},
    attributes: new Map(),
    addEventListener(_type, listener) {
      this.click = listener;
    },
    setAttribute(name, value) {
      this.attributes.set(name, value);
    }
  }));
  const elements = new Map();
  const elementById = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        dataset: {},
        textContent: '',
        hidden: true,
        replaceChildren() {},
        addEventListener() {},
        querySelectorAll: () => buttons
      });
    }
    return elements.get(id);
  };
  installGlobal('document', {getElementById: elementById});
  installGlobal('navigator', {onLine: true});
  installGlobal('addEventListener', () => {});
  const publishedRoutes = [];
  const map = {
    addSource() {},
    addLayer() {},
    getSource: () => ({setData: data => publishedRoutes.push(data)})
  };
  const planner = new RoutePlanner(map, {router, fetchImpl});
  return {planner, buttons, elementById, publishedRoutes};
}

const from = {coordinates: [19.2, 42.44]};
const to = {coordinates: [19.24, 42.44]};

test('choosing a mode presses only that mode and recalculates once', testContext => {
  const {planner, buttons} = plannerEnvironment(testContext);
  let calculations = 0;
  planner.calculate = () => {
    calculations++;
  };
  buttons[1].click();
  assert.equal(planner.mode, 'walk');
  assert.deepEqual(
    buttons.map(button => button.attributes.get('aria-pressed')),
    ['false', 'true', 'false']
  );
  assert.equal(calculations, 1);
});

test('clearing endpoints while transit data loads prevents the late route from rendering', async testContext => {
  let respond;
  const fetchImpl = () =>
    new Promise(resolve => {
      respond = resolve;
    });
  const {planner, elementById, publishedRoutes} = plannerEnvironment(testContext, {fetchImpl});
  planner.mode = 'transit';
  planner.endpoints = {from, to};
  let rendered = false;
  planner.render = () => {
    rendered = true;
  };
  const pending = planner.calculate();
  planner.setEndpoints({});
  respond(Response.json({stops: {}, patterns: []}));
  await pending;
  assert.equal(rendered, false);
  assert.equal(planner.network, undefined);
  assert.equal(elementById('route-status').dataset.state, 'idle');
  assert.equal(publishedRoutes.at(-1).features.length, 0);
});

test('an unavailable foot router keeps the approximate walking link', async testContext => {
  const router = {
    route: async () => {
      throw new Error('Provider unavailable');
    }
  };
  const {planner} = plannerEnvironment(testContext, {router});
  const leg = {
    kind: 'walk',
    coordinates: [from.coordinates, to.coordinates],
    distance: 100,
    approximate: true
  };
  const result = {legs: [leg]};
  await planner.refineWalkingLegs(result, new AbortController().signal, planner.generation);
  assert.equal(result.legs[0], leg);
});

test('a cancelled walking refinement propagates cancellation instead of using a stale result', async testContext => {
  const controller = new AbortController();
  const router = {
    route: async () => {
      controller.abort();
      controller.signal.throwIfAborted();
    }
  };
  const {planner} = plannerEnvironment(testContext, {router});
  const result = {legs: [{kind: 'walk', coordinates: [from.coordinates, to.coordinates], distance: 100}]};
  await assert.rejects(planner.refineWalkingLegs(result, controller.signal, planner.generation), {
    name: 'AbortError'
  });
});
