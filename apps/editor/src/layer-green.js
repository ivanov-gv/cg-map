// Parks and green areas: their type, their holes and how much an edit adds or takes away.
import {createElementWithText} from './dom.js';
import {editTools} from './edit-transaction.js';
import {withoutHole} from './geometry-editing.js';
import {formatArea, geometryAreaSquareMetres, ringAreaSquareMetres} from './geometry-measures.js';

const landFile = 'land.geojson';
const protectedAreasFile = 'protected-areas.geojson';

const isPolygon = geometry => geometry?.type === 'Polygon';

// The area, and what a pending edit adds to it or takes away.
export function areaFacts({geometry}, before) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return [];
  const area = geometryAreaSquareMetres(geometry);
  const change = before ? area - geometryAreaSquareMetres(before.geometry) : 0;
  const isChanged = Math.abs(change) >= 1;
  const changeText = isChanged ? ` (${change > 0 ? '+' : '−'}${formatArea(Math.abs(change))})` : '';
  const holeText = isPolygon(geometry) ? `Holes ${geometry.coordinates.length - 1}` : '';
  return [`Area ${formatArea(area)}${changeText}`, holeText].filter(Boolean);
}

export const holeTool = label => (feature, edit) =>
  isPolygon(feature.geometry) ? [{label, run: () => edit.startTool(editTools.cutHole)}] : [];

// Each hole with its size, so that one drawn by mistake can be taken back.
export const renderHoles = holeName => (container, edit) => {
  const {geometry} = edit.feature;
  if (!isPolygon(geometry)) return;
  geometry.coordinates.slice(1).forEach((ring, index) => {
    const row = document.createElement('div');
    row.className = 'button-row';
    const remove = createElementWithText('button', 'Remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${holeName.toLowerCase()} ${index + 1}`);
    remove.onclick = () => edit.setGeometry(withoutHole(geometry, index + 1));
    const size = formatArea(ringAreaSquareMetres(ring.slice(0, -1)));
    row.append(createElementWithText('span', `${holeName} ${index + 1} · ${size}`), remove);
    container.append(row);
  });
};

function renderGreenExtras(container, edit) {
  renderHoles('Hole')(container, edit);
  const note = createElementWithText('p', 'Paths inside belong to Roads & paths and stay when the outline moves.');
  note.className = 'hint';
  container.append(note);
}

export const greenBehaviors = {
  [landFile]: {
    kind: () => 'Green area',
    sections: () => [{title: 'Type and name', fields: ['kind', 'name', 'name:en', 'destination']}],
    tools: holeTool('Cut a hole'),
    renderExtras: renderGreenExtras,
    measures: areaFacts
  },
  [protectedAreasFile]: {
    sections: () => [{title: 'Name', fields: ['name', 'name:en']}],
    measures: areaFacts
  }
};
