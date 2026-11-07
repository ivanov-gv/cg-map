import {RoadRouter} from './routing.js';
import {planTransit} from './transit-routing.js';
import {distanceKilometres} from './core.js';
const minimumWalkingLegMetres = 10;
const coincidentEndpointKilometres = 0.005;

const elementById = (elementId) => document.getElementById(elementId);
const emptyCollection = () => ({type: 'FeatureCollection', features: []});
const formatMinutes = (seconds) => `${Math.max(1, Math.round(seconds / 60))} min`;
const formatDistance = (metres) =>
  metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
const stepElement = (text) => {
  const listItem = document.createElement('li');
  listItem.textContent = text;
  return listItem;
};
// The provider and transit planner produce different confidence levels; keep that visible without
// implying that a dated bus pattern predicts departures.
function routeNote(result) {
  if (result.mode === 'car') {
    return 'Driving estimate without live traffic. Route may start or end on a nearby accessible road.';
  }
  if (result.mode !== 'transit') {
    return 'Walking route follows mapped footpaths and accessible streets. Route may start or end on a nearby path.';
  }
  const snapshotDate = new Date(result.retrievedAt).toLocaleDateString('en-GB');
  const hasApproximateWalk = result.legs.some((leg) => {
    return leg.kind === 'walk' && leg.approximate && leg.distance > minimumWalkingLegMetres;
  });
  const walkingExplanation = hasApproximateWalk
    ? 'Walking links are approximate.'
    : 'Walking legs follow mapped paths.';
  return `Bus suggestion from the ${snapshotDate} route snapshot. Check departures. Dotted bus lines join stops. ${walkingExplanation} Waiting time is extra.`;
}

// Owns route requests and their UI; a generation prevents cancelled results from reaching the map.
export class RoutePlanner {
  constructor(
    map,
    {router = new RoadRouter(), fetchImpl = (...argumentsList) => fetch(...argumentsList)} = {}
  ) {
    Object.assign(this, {map, router, fetchImpl});
    this.mode = 'car';
    this.generation = 0;
    this.endpoints = {};
    this.installLayers();
    this.registerControls();
  }

  // Route lines stay below endpoint markers in every mode.
  installLayers() {
    this.map.addSource('planned-route', {type: 'geojson', data: emptyCollection()});
    this.map.addLayer(
      {
        id: 'planned-route-casing',
        type: 'line',
        source: 'planned-route',
        paint: {'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9}
      },
      'route-point-circles'
    );
    this.map.addLayer(
      {
        id: 'planned-route-street',
        type: 'line',
        source: 'planned-route',
        filter: ['==', ['get', 'approximate'], false],
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-color': '#195c9e', 'line-width': 5}
      },
      'route-point-circles'
    );
    this.map.addLayer(
      {
        id: 'planned-route-suggestion',
        type: 'line',
        source: 'planned-route',
        filter: ['==', ['get', 'approximate'], true],
        paint: {
          'line-color': ['match', ['get', 'kind'], 'bus', '#195c9e', '#687850'],
          'line-width': 4,
          'line-dasharray': [2, 1]
        }
      },
      'route-point-circles'
    );
  }

  // Controls read current endpoints and mode, even after an earlier request was cancelled.
  registerControls() {
    for (const button of elementById('route-modes').querySelectorAll('button'))
      button.addEventListener('click', () => {
        this.mode = button.dataset.mode;
        for (const otherButton of elementById('route-modes').querySelectorAll('button'))
          otherButton.setAttribute('aria-pressed', String(otherButton === button));
        this.calculate();
      });
    elementById('route-retry').addEventListener('click', () => this.calculate());
    addEventListener('offline', () => {
      if (this.mode !== 'transit') this.invalidate('Car and walking routes need an internet connection.');
    });
  }
  // Cancel before clearing the view so late responses cannot restore stale geometry.
  invalidate(message = 'Choose From and To points on the map.') {
    this.generation++;
    this.controller?.abort();
    this.map.getSource('planned-route').setData(emptyCollection());
    elementById('route-status').textContent = message;
    elementById('route-status').dataset.state = 'idle';
    elementById('route-steps').replaceChildren();
    elementById('route-itinerary').hidden = true;
    elementById('route-retry').hidden = true;
    elementById('route-note').textContent = '';
  }
  setEndpoints(endpoints) {
    this.endpoints = structuredClone(endpoints);
    this.invalidate();
    const hasBothEndpoints = !!endpoints.from && !!endpoints.to;
    for (const button of elementById('route-modes').querySelectorAll('button'))
      button.disabled = !hasBothEndpoints;
    if (hasBothEndpoints) this.calculate();
  }
  // Calculate only complete, distinct endpoints, then render the current generation.
  async calculate() {
    this.invalidate();
    const {from, to} = this.endpoints;
    if (!from || !to) return;
    if (distanceKilometres(from.coordinates, to.coordinates) < coincidentEndpointKilometres) {
      elementById('route-status').textContent =
        'From and To are at the same point. Choose another destination.';
      return;
    }
    if (this.mode !== 'transit' && !navigator.onLine) {
      elementById('route-status').textContent = 'Car and walking routes need an internet connection.';
      return;
    }
    const generation = this.generation;
    const mode = this.mode;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    elementById('route-status').textContent =
      `Finding ${mode === 'transit' ? 'public transport' : mode === 'car' ? 'car' : 'walking'} route…`;
    elementById('route-status').dataset.state = 'loading';
    try {
      let result;
      if (mode === 'transit') result = await this.calculateTransit(from, to, signal, generation);
      else result = await this.router.route(mode, from.coordinates, to.coordinates, signal);
      if (generation !== this.generation) return;
      this.render(result);
    } catch (error) {
      if (generation !== this.generation) return;
      elementById('route-status').textContent =
        error.name === 'TimeoutError' ? 'Routing request timed out. Try again.' : error.message;
      elementById('route-status').dataset.state = 'error';
      elementById('route-retry').hidden = false;
    }
  }
  // An obsolete network response may finish, but must never replace the current snapshot or route.
  async calculateTransit(from, to, signal, generation) {
    if (!this.network) {
      const response = await this.fetchImpl('data/transit-network.json', {signal});
      if (!response.ok) {
        throw new Error(
          'Bus route data could not load. Download the map before using bus suggestions offline.'
        );
      }
      const network = await response.json();
      if (generation !== this.generation) return;
      this.network = network;
    }
    const result = planTransit(this.network, from.coordinates, to.coordinates);
    if (navigator.onLine) await this.refineWalkingLegs(result, signal, generation);
    result.duration = result.legs.reduce((total, leg) => total + leg.duration, 0);
    result.distance = result.legs.reduce((total, leg) => total + leg.distance, 0);
    return result;
  }

  // A failed foot route retains its explicitly approximate straight link; cancellation still aborts.
  async refineWalkingLegs(result, signal, generation) {
    for (let index = 0; index < result.legs.length; index++) {
      const leg = result.legs[index];
      if (leg.kind !== 'walk' || leg.distance < minimumWalkingLegMetres) continue;
      try {
        const routed = await this.router.route('walk', leg.coordinates[0], leg.coordinates.at(-1), signal);
        if (generation !== this.generation) return;
        result.legs[index] = {...leg, ...routed.legs[0], name: leg.name};
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }
  }

  // Call only for the current request with complete endpoints; replace the itinerary and frame its geometry.
  render(result) {
    const isTransitRoute = result.mode === 'transit';
    elementById('route-status').textContent =
      `${isTransitRoute ? '~' : ''}${formatMinutes(result.duration)}${isTransitRoute ? ' + waiting' : ''} · ${formatDistance(result.distance)}`;
    elementById('route-status').dataset.state = 'ready';
    elementById('route-note').textContent = routeNote(result);
    elementById('route-steps').replaceChildren();
    if (isTransitRoute)
      for (const leg of result.legs) {
        if (leg.kind === 'bus')
          elementById('route-steps').append(
            stepElement(`${leg.name}: ${leg.from} → ${leg.to} · ~${formatMinutes(leg.duration)}`)
          );
        else if (leg.distance > minimumWalkingLegMetres)
          elementById('route-steps').append(
            stepElement(`${leg.name} · ~${formatDistance(leg.distance)} / ${formatMinutes(leg.duration)}`)
          );
      }
    else
      for (const step of result.steps)
        elementById('route-steps').append(
          stepElement(`${step.name} · ${formatDistance(step.distance ?? 0)}`)
        );
    elementById('route-itinerary').hidden = false;
    this.renderGeometry(result);
    this.frameRoute(result);
  }

  // Each leg carries its approximation flag so rendering never implies a road-snapped bus path.
  renderGeometry(result) {
    const features = result.legs
      .filter((leg) => leg.coordinates.length >= 2)
      .map((leg) => ({
        type: 'Feature',
        geometry: {type: 'LineString', coordinates: leg.coordinates},
        properties: {kind: leg.kind, approximate: leg.approximate}
      }));
    this.map.getSource('planned-route').setData({type: 'FeatureCollection', features});
  }

  // Include selected endpoints even when the provider snapped its path to a nearby street.
  frameRoute(result) {
    const points = [
      ...result.legs.flatMap((leg) => leg.coordinates),
      this.endpoints.from.coordinates,
      this.endpoints.to.coordinates
    ];
    const bounds = points.reduce(
      (bounds, point) => [
        [Math.min(bounds[0][0], point[0]), Math.min(bounds[0][1], point[1])],
        [Math.max(bounds[1][0], point[0]), Math.max(bounds[1][1], point[1])]
      ],
      [
        [180, 90],
        [-180, -90]
      ]
    );
    this.map.resize();
    this.map.fitBounds(bounds, {
      padding: {top: 115, right: 65, bottom: 90, left: 65},
      maxZoom: 17,
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450
    });
  }
}
