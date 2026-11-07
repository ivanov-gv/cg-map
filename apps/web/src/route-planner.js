// The route panel: plans car, walking or bus routes between the From and To points and draws the result.
// Every calculation bumps a generation, so an answer that arrives after the endpoints or mode changed is dropped.
import {RoadRouter} from './routing.js';
import {planTransit} from './transit-routing.js';
import {distanceKilometres, formatDistance} from './core.js';
import {animationMilliseconds, elementById} from './dom.js';

// Closer than this, From and To are the same point.
const samePointKilometres = 0.005;
// Shorter walks are not worth a step in the itinerary or a request to the routing service.
const minListedWalkMetres = 10;
const routePadding = {top: 115, right: 65, bottom: 90, left: 65};
const routeMaxZoom = 17;
const fitMilliseconds = 450;
const routeColor = '#195c9e';
const offlineRoadMessage = 'Car and walking routes need an internet connection.';
const modeNames = {transit: 'public transport', car: 'car', walk: 'walking'};

const emptyCollection = () => ({type: 'FeatureCollection', features: []});
const formatMinutes = seconds => `${Math.max(1, Math.round(seconds / 60))} min`;

function listItem(text) {
  const item = document.createElement('li');
  item.textContent = text;
  return item;
}

// [[west, south], [east, north]] around every point.
function boundsOf(points) {
  const initial = [
    [180, 90],
    [-180, -90]
  ];
  return points.reduce(
    ([[west, south], [east, north]], [longitude, latitude]) => [
      [Math.min(west, longitude), Math.min(south, latitude)],
      [Math.max(east, longitude), Math.max(north, latitude)]
    ],
    initial
  );
}

function routeNote(result) {
  if (result.mode === 'car') {
    return 'Driving estimate without live traffic. Route may start or end on a nearby accessible road.';
  }
  if (result.mode !== 'transit') {
    return 'Walking route follows mapped footpaths and accessible streets. Route may start or end on a nearby path.';
  }
  const snapshotDate = new Date(result.retrievedAt).toLocaleDateString('en-GB');
  const hasApproximateWalk = result.legs.some(
    leg => leg.kind === 'walk' && leg.approximate && leg.distance > minListedWalkMetres
  );
  const walkNote = hasApproximateWalk ? 'Walking links are approximate.' : 'Walking legs follow mapped paths.';
  return `Bus suggestion from the ${snapshotDate} route snapshot. Check departures. Dotted bus lines join stops. ${walkNote} Waiting time is extra.`;
}

function itineraryItems(result) {
  if (result.mode !== 'transit') {
    return result.steps.map(step => listItem(`${step.name} · ${formatDistance(step.distance ?? 0)}`));
  }
  const items = [];
  for (const leg of result.legs) {
    if (leg.kind === 'bus') {
      items.push(listItem(`${leg.name}: ${leg.from} → ${leg.to} · ~${formatMinutes(leg.duration)}`));
    } else if (leg.distance > minListedWalkMetres) {
      items.push(listItem(`${leg.name} · ~${formatDistance(leg.distance)} / ${formatMinutes(leg.duration)}`));
    }
  }
  return items;
}

export class RoutePlanner {
  constructor(map, {router = new RoadRouter(), fetchImpl = (...args) => fetch(...args)} = {}) {
    Object.assign(this, {map, router, fetchImpl});
    this.mode = 'car';
    this.generation = 0;
    this.endpoints = {};
    this.#installLayers();
    for (const button of this.#modeButtons()) button.addEventListener('click', () => this.#selectMode(button));
    elementById('route-retry').addEventListener('click', () => this.calculate());
    addEventListener('offline', () => {
      if (this.mode !== 'transit') this.invalidate(offlineRoadMessage);
    });
  }

  #installLayers() {
    const below = 'route-point-circles';
    this.map.addSource('planned-route', {type: 'geojson', data: emptyCollection()});
    this.map.addLayer(
      {
        id: 'planned-route-casing',
        type: 'line',
        source: 'planned-route',
        paint: {'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9}
      },
      below
    );
    this.map.addLayer(
      {
        id: 'planned-route-street',
        type: 'line',
        source: 'planned-route',
        filter: ['==', ['get', 'approximate'], false],
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-color': routeColor, 'line-width': 5}
      },
      below
    );
    // Bus legs join stops in straight lines and walk links are estimates, so both are dashed.
    this.map.addLayer(
      {
        id: 'planned-route-suggestion',
        type: 'line',
        source: 'planned-route',
        filter: ['==', ['get', 'approximate'], true],
        paint: {
          'line-color': ['match', ['get', 'kind'], 'bus', routeColor, '#687850'],
          'line-width': 4,
          'line-dasharray': [2, 1]
        }
      },
      below
    );
  }

  #modeButtons() {
    return elementById('route-modes').querySelectorAll('button');
  }

  #selectMode(selectedButton) {
    this.mode = selectedButton.dataset.mode;
    for (const button of this.#modeButtons()) button.setAttribute('aria-pressed', String(button === selectedButton));
    this.calculate();
  }

  #setStatus(message, state) {
    elementById('route-status').textContent = message;
    if (state) elementById('route-status').dataset.state = state;
  }

  // Drops the drawn route and any calculation in flight.
  invalidate(message = 'Choose From and To points on the map.') {
    this.generation++;
    this.controller?.abort();
    this.map.getSource('planned-route').setData(emptyCollection());
    this.#setStatus(message, 'idle');
    elementById('route-steps').replaceChildren();
    elementById('route-itinerary').hidden = true;
    elementById('route-retry').hidden = true;
    elementById('route-note').textContent = '';
  }

  setEndpoints(endpoints) {
    this.endpoints = structuredClone(endpoints);
    this.invalidate();
    const isReady = Boolean(endpoints.from) && Boolean(endpoints.to);
    for (const button of this.#modeButtons()) button.disabled = !isReady;
    if (isReady) this.calculate();
  }

  async calculate() {
    this.invalidate();
    const {from, to} = this.endpoints;
    if (!from || !to) return;
    if (distanceKilometres(from.coordinates, to.coordinates) < samePointKilometres) {
      this.#setStatus('From and To are at the same point. Choose another destination.');
      return;
    }
    if (this.mode !== 'transit' && !navigator.onLine) {
      this.#setStatus(offlineRoadMessage);
      return;
    }
    const generation = this.generation;
    const isCurrent = () => generation === this.generation;
    const mode = this.mode;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.#setStatus(`Finding ${modeNames[mode]} route…`, 'loading');
    try {
      const result =
        mode === 'transit'
          ? await this.#planTransit(from.coordinates, to.coordinates, signal, isCurrent)
          : await this.router.route(mode, from.coordinates, to.coordinates, signal);
      if (!isCurrent()) return;
      this.render(result);
    } catch (error) {
      if (!isCurrent()) return;
      this.#setStatus(error.name === 'TimeoutError' ? 'Routing request timed out. Try again.' : error.message, 'error');
      elementById('route-retry').hidden = false;
    }
  }

  // Bus data is bundled, so a bus plan works offline. Online, its walks follow mapped paths where the service can
  // route them; a walk it cannot route keeps its straight-line estimate. Returns null once superseded.
  async #planTransit(from, to, signal, isCurrent) {
    if (!this.network) {
      const response = await this.fetchImpl('data/transit-network.json', {signal});
      if (!response.ok) {
        throw new Error('Bus route data could not load. Download the map before using bus suggestions offline.');
      }
      const network = await response.json();
      if (!isCurrent()) return null;
      this.network = network;
    }
    const result = planTransit(this.network, from, to);
    if (navigator.onLine) {
      const isRouted = await this.#routeWalkLegs(result.legs, signal, isCurrent);
      if (!isRouted) return null;
    }
    result.duration = result.legs.reduce((sum, leg) => sum + leg.duration, 0);
    result.distance = result.legs.reduce((sum, leg) => sum + leg.distance, 0);
    return result;
  }

  // Replaces walk legs in place with routed ones. Returns false once superseded.
  async #routeWalkLegs(legs, signal, isCurrent) {
    for (let index = 0; index < legs.length; index++) {
      const leg = legs[index];
      if (leg.kind !== 'walk' || leg.distance < minListedWalkMetres) continue;
      try {
        const routed = await this.router.route('walk', leg.coordinates[0], leg.coordinates.at(-1), signal);
        if (!isCurrent()) return false;
        legs[index] = {...leg, ...routed.legs[0], name: leg.name};
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }
    return true;
  }

  render(result) {
    const isTransit = result.mode === 'transit';
    const estimatePrefix = isTransit ? '~' : '';
    const waitingSuffix = isTransit ? ' + waiting' : '';
    this.#setStatus(
      `${estimatePrefix}${formatMinutes(result.duration)}${waitingSuffix} · ${formatDistance(result.distance)}`,
      'ready'
    );
    elementById('route-note').textContent = routeNote(result);
    elementById('route-steps').replaceChildren(...itineraryItems(result));
    elementById('route-itinerary').hidden = false;
    const features = result.legs
      .filter(leg => leg.coordinates.length >= 2)
      .map(leg => ({
        type: 'Feature',
        geometry: {type: 'LineString', coordinates: leg.coordinates},
        properties: {kind: leg.kind, approximate: leg.approximate}
      }));
    this.map.getSource('planned-route').setData({type: 'FeatureCollection', features});
    const points = [
      ...result.legs.flatMap(leg => leg.coordinates),
      this.endpoints.from.coordinates,
      this.endpoints.to.coordinates
    ];
    this.map.resize();
    this.map.fitBounds(boundsOf(points), {
      padding: routePadding,
      maxZoom: routeMaxZoom,
      duration: animationMilliseconds(fitMilliseconds)
    });
  }
}
