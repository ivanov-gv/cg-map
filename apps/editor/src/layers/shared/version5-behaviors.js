// Version 5 keeps the released behavior hooks away from files whose fields have changed, then adds the surface's own
// behavior. Nothing here invents a stored value: a new shade is only seeded inside the area it belongs to.
import {isArea} from '../../geometry/area-magnet.js';
import {routeBehaviors} from '../routes/layer-routes.js';
import {registerBehaviors} from './layer-behaviors.js';
import {kindLabel, objectName} from './object-names.js';
import {
  greenAreaKinds,
  linkedSelection,
  movedStoredValue,
  municipalityCompanions,
  shadeForArea,
  shadeProblem,
  storedPositionFeatures
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

// transit-routes.json keeps its released behavior: its contract and route hooks are unchanged in version 5.
const storedTools = {
  labelPoint: {label: 'Move label point', prompt: 'Where should the label point go?'},
  labelLine: {label: 'Move label line', prompt: 'Where should the label line go?'},
  iconPoint: {label: 'Move icon point', prompt: 'Where should the icon point go?'}
};

// A released behavior can still have a hook under the same filename. Each of these resets one, so version 5 starts from
// its own rules rather than from a field or a follow that no longer exists in the file.
function neutralBehavior(filename) {
  return {
    kind: () => kindLabel(filename),
    title: feature => objectName(feature, filename),
    sections: () => null,
    tools: () => [],
    renderExtras: () => {},
    controls: () => ({}),
    usualValues: () => ({}),
    listsDependOn: [],
    measures: () => [],
    vertexTools: () => [],
    marks: () => [],
    joinsLines: false,
    joinedPoints: () => [],
    isDerived: false,
    isReshapable: () => true,
    hasMagnet: (feature, isDrawingOutline) => isDrawingOutline || isArea(feature.geometry),
    mayContainOthers: true,
    closesLines: false,
    isViewOnly: () => false,
    snappedPoint: () => null,
    limitedGeometry: geometry => geometry,
    prepared: feature => feature,
    problem: () => null,
    companionEdits: () => [],
    deletion: () => ({message: '', edits: []}),
    applyLabel: () => 'Apply',
    afterApply: () => {},
    dragTarget: () => null,
    selectionEntry: entry => entry
  };
}

export const version5Behaviors = Object.fromEntries(
  version5Files.map(filename => [filename, neutralBehavior(filename)])
);

// A stored position is shown where it is and moved only when someone moves it. The point is picked on the map; a label
// line keeps its own points and their order, shifting together to the picked place.
export function storedPositionTools(feature, edit) {
  return Object.entries(storedTools)
    .filter(([field]) => feature.properties[field] !== undefined)
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
  if (kind === 'municipality') return [{title: 'Municipality', fields: ['name', 'name:en', 'ISO3166-2', 'population']}];
  if (kind === 'context') return [{title: 'Neighbour', fields: ['name']}];
  if (kind === 'sea') return [];
  return null;
};

const surfaceSections = feature => {
  const {kind} = feature.properties;
  if (['municipality', 'context', 'sea', 'shade'].includes(kind)) return frameSections(feature);
  if (kind === 'protected-area') {
    return [{title: 'Protected area', fields: ['osmTag', 'name', 'name:en', 'labelLine']}];
  }
  return [
    {
      title: 'Surface',
      fields: ['kind', 'name', 'name:en', 'destination', 'labelLine', 'poiKind', 'iconPoint', 'name:sr-Latn',
        'phone', 'website', 'email', 'opening_hours', 'wheelchair', 'cuisine', 'wikidata', 'wikipedia', 'level']
    }
  ];
};

const surfaceBehavior = {
  ...neutralBehavior(surfaceFile),
  kind: ({properties}) => `${properties.kind ?? 'surface'}`.replaceAll(/[-_]/g, ' '),
  title: surfaceTitle,
  sections: surfaceSections,
  tools: storedPositionTools,
  problem: shadeProblem,
  selectionEntry: linkedSelection
};

function addShadeTool(feature, edit) {
  if (!feature.properties.greenAreaEntityId && !isArea(feature.geometry)) return [];
  if (!greenAreaKinds.includes(feature.properties.kind)) return [];
  return [
    {
      label: 'Add shade',
      run: () => {
        const shade = shadeForArea({key: edit.key, feature});
        if (!shade) {
          edit.showProblem('This area has no room inside it for a shade.');
          return;
        }
        const problem = shadeProblem({key: 'new-shade', feature: shade}, edit.context);
        if (problem) {
          edit.showProblem(problem);
          return;
        }
        edit.replaceWith(
          [{filename: surfaceFile, key: `local:${crypto.randomUUID()}`, after: shade}],
          `Added a shade for ${surfaceTitle(feature)}`
        );
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
    [surfaceFile]: {
      ...surfaceBehavior,
      tools: (feature, edit) => storedPositionTools(feature, edit)
    }
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
  registerBehaviors(routeBehaviors, null, 5);
  registerBehaviors(version5SurfaceBehaviors, null, 5);
  for (const [layerId, behaviors] of Object.entries(version5SurfaceBehaviorsByLayer)) {
    registerBehaviors(behaviors, layerId, 5);
  }
}
