import {createElementWithText, elementById} from '../../shared/dom.js';

function layerButton(layer, onChosen) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.layer = layer.id;
  button.className = 'layer-choice';
  button.setAttribute('aria-pressed', 'false');
  button.append(
    createElementWithText('strong', layer.name),
    createElementWithText('span', layer.summary)
  );
  button.onclick = () => onChosen(layer);
  return button;
}

// All layers in their groups, each with what is in it. Choosing the active one again returns to Browse.
export function renderLayerChoices(layers, onChosen) {
  const groups = Map.groupBy(layers, layer => layer.group);
  const elements = [...groups].flatMap(([group, groupLayers]) => [
    createElementWithText('h3', group),
    ...groupLayers.map(layer => layerButton(layer, onChosen))
  ]);
  elementById('layer-choices').replaceChildren(...elements);
}

export function showActiveLayer(activeLayer) {
  for (const button of document.querySelectorAll('[data-layer]')) {
    button.setAttribute('aria-pressed', String(button.dataset.layer === activeLayer?.id));
  }
  for (const row of document.querySelectorAll('[data-source]')) {
    row.setAttribute('aria-current', String(Boolean(activeLayer?.files.includes(row.dataset.source))));
  }
}

// One table row per verified source file, for whoever needs to know what is behind a layer.
export function renderSourceTable(sources) {
  for (const [filename, source] of sources) {
    const row = document.createElement('tr');
    row.dataset.source = filename;
    const name = createElementWithText('th', filename);
    name.scope = 'row';
    row.append(name, createElementWithText('td', String(source.metadata.featureCount)));
    elementById('layers').append(row);
  }
}

export function renderFeatureCounts(countOf) {
  for (const row of document.querySelectorAll('[data-source]')) {
    row.querySelector('td').textContent = countOf(row.dataset.source);
  }
}
