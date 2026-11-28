// Version 5 keeps the released behavior hooks away from files whose fields have changed, then adds the surface's own
// behavior. Nothing here invents a stored value: someone draws a shade at its place and picks a river from the file.
import {riverField} from '../water/river-picker.js';
import {version5PlaceBehaviors} from '../places/layer-places.js';
import {version5RouteBehaviors} from '../routes/layer-routes.js';
import {surfacePreviewFeatures} from '../../map-tools/basemap-layers.js';
import {defaultBehavior, registerBehaviors} from './layer-behaviors.js';
import {
  greenAreaKinds,
  linkedSelection,
  municipalityCompanions,
  movedStoredValue,
  shadeSeed,
  storedPositionFeatures,
  surfaceEditProblem,
  surfaceResultProblemForEdits
} from './surface-edits.js';

const surfaceFile = 'surface.geojson';
const version5Files = [
  surfaceFile,
  'roads.geojson',
  'bridges.geojson',
  'railways.geojson',
  'buildings.geojson',
  'places.geojson',
  'settlements.geojson',
  'relief.geojson',
  'canyon-rims.geojson',
  'transport-stops.geojson',
  'transit-network.json'
];

const storedTools = {
  labelPoint: {label: 'Move label point', prompt: 'Where should the label point go?'},
  labelLine: {label: 'Move label line', prompt: 'Where should the label line go?'},
  iconPoint: {label: 'Move icon point', prompt: 'Where should the icon point go?'}
};

// A version 5 filename can also exist in a released bundle. The shared defaults replace every released hook, and the
// surface below adds only what version 5 means; a new shared hook reaches version 5 without being copied here.
const neutralBehavior = filename => defaultBehavior(filename, null, 5);

export const version5Behaviors = Object.fromEntries(
  version5Files.map(filename => [filename, neutralBehavior(filename)])
);

// A stored position is shown where it is and moved only when someone moves it. A lake POI can place its still unset icon
// once it has a POI kind; a label line keeps its own points and order, shifting together to the picked place.
export function storedPositionTools(feature, edit) {
  // The inspector passes the typed form, but the toolbar also reads these tools from the open feature. Both paths must
  // see the same current values, so a field chosen in the form offers its tool at once.
  const current = edit?.typedFeature?.() ?? feature;
  return Object.entries(storedTools)
    .filter(([field]) =>
      current.properties[field] !== undefined ||
      (field === 'iconPoint' && current.properties.poiKind !== undefined && current.properties.iconPoint === undefined)
    )
    .map(([field, {label, prompt}]) => ({
      label,
      run: async () => {
        const coordinate = await edit.context.pickPoint(prompt);
        if (!coordinate || !edit.isOpen()) return;
        const current = edit.typedFeature();
        edit.setProperties({[field]: movedStoredValue(field, current.properties[field], coordinate)});
      }
    }));
}

const surfaceTitle = ({properties}) => properties.name || `${properties.kind ?? 'surface'}`.replaceAll(/[-_]/g, ' ');

const frameSections = feature => {
  const {kind} = feature.properties;
  if (kind === 'municipality') {
    return [{title: 'Municipality', fields: ['name', 'name:en', 'ISO3166-2', 'population', 'labelPoint']}];
  }
  if (kind === 'context') return [{title: 'Neighbour', fields: ['name', 'labelPoint']}];
  return [];
};

const waterSections = [
  {
    title: 'Water',
    fields: [
      'kind', 'name', 'name:en', 'riverEntityId', 'labelPoint', 'labelLine', 'intermittent', 'tunnel',
      'visibilityOverride', 'poiKind', 'iconPoint', 'name:sr-Latn', 'addr:housenumber', 'phone', 'website', 'email',
      'opening_hours', 'wheelchair', 'cuisine', 'wikidata', 'wikipedia', 'level'
    ]
  }
];

const surfaceSections = feature => {
  const {kind} = feature.properties;
  if (['municipality', 'context', 'sea'].includes(kind)) return frameSections(feature);
  if (kind === 'shade') return [];
  if (kind === 'protected-area') {
    return [{title: 'Protected area', fields: ['osmTag', 'name', 'name:en', 'labelLine']}];
  }
  if (['park', 'garden', 'woods', 'meadow', 'grass', 'scrub', 'sports', 'cemetery', 'playground'].includes(kind)) {
    return null;
  }
  return waterSections;
};

// The drawing tool takes one ring, but the reviewed shade is a MultiPolygon: its own parts can be drawn or split later.
function preparedSurface(feature) {
  if (feature.properties.kind !== 'shade' || feature.geometry?.type !== 'Polygon') return feature;
  return {...feature, geometry: {type: 'MultiPolygon', coordinates: [feature.geometry.coordinates]}};
}

const surfaceBehavior = {
  ...neutralBehavior(surfaceFile),
  kind: ({properties}) => `${properties.kind ?? 'surface'}`.replaceAll(/[-_]/g, ' '),
  title: surfaceTitle,
  sections: surfaceSections,
  tools: storedPositionTools,
  controls: edit => ({riverEntityId: value => riverField(value, edit.context)}),
  prepared: preparedSurface,
  problem: surfaceEditProblem,
  resultProblem: (edits, context) => surfaceResultProblemForEdits(context.session, context, edits),
  // The file is edited by three layers but drawn whole by the public cartography. Kinds filter only what can be picked.
  previewEntries: (filename, {session, sources}) =>
    sources.has(filename) ? session.workingEntries(filename) : null,
  previewFeatures: surfacePreviewFeatures,
  storedPositions: storedPositionFeatures,
  selectionEntry: linkedSelection
};

// The owner chooses the area first; the new shade starts with only its link and is drawn on the map from there.
function addShadeTool(feature, edit) {
  if (!greenAreaKinds.includes(feature.properties.kind)) return [];
  const properties = shadeSeed({key: edit.key, feature});
  if (!properties) return [];
  return [
    {
      label: 'Draw shade',
      run: () => {
        // Starting another feature closes the inspector, so an unsaved change to the parent must be settled first.
        if (edit.hasUnappliedEdit()) {
          edit.showProblem('Apply or Cancel the parent area before drawing its shade.');
          return;
        }
        edit.context.startNew({
          label: 'Draw shade',
          filename: surfaceFile,
          shape: 'Polygon',
          properties
        });
      }
    }
  ];
}

export const version5SurfaceBehaviors = {[surfaceFile]: surfaceBehavior};

export const version5SurfaceBehaviorsByLayer = {
  green: {
    [surfaceFile]: {
      ...surfaceBehavior,
      tools: (feature, edit) => [...addShadeTool(feature, edit), ...storedPositionTools(feature, edit)]
    }
  },
  water: {
    [surfaceFile]: {...surfaceBehavior}
  },
  settlements: {
    [surfaceFile]: {
      ...surfaceBehavior,
      companionEdits: municipalityCompanions
    }
  }
};

// One place for the overlay and its unit tests: the stored fields of the objects on screen, in source order.
export const version5StoredPositions = storedPositionFeatures;

// The app and the version tests register the same hooks; an earlier bundle must never see them.
export function registerVersion5Behaviors() {
  registerBehaviors(version5Behaviors, null, 5);
  registerBehaviors(version5PlaceBehaviors, null, 5);
  registerBehaviors(version5RouteBehaviors, null, 5);
  registerBehaviors(version5SurfaceBehaviors, null, 5);
  for (const [layerId, behaviors] of Object.entries(version5SurfaceBehaviorsByLayer)) {
    registerBehaviors(behaviors, layerId, 5);
  }
}
