// Reads attribution strings from the map's style object at runtime and renders them
// in the dock footer. Because it uses the style's source definitions, the display stays
// correct when sources change or layers are toggled — no hard-coded copies to drift.

// Returns the unique, non-empty attribution strings of sources used by at least one
// visible layer (layout.visibility !== 'none'), in source-order. Pure function, no DOM.
export function visibleSourceAttributions(style) {
  const sources = style.sources;
  const layers = style.layers;
  const usedSourceIds = new Set();

  for (const layer of layers) {
    if (layer.layout?.visibility === 'none') continue;
    if (layer.source && sources[layer.source]) {
      usedSourceIds.add(layer.source);
    }
  }

  // Preserve source order from the style object
  const seen = new Set();
  const result = [];
  for (const sourceId of Object.keys(sources)) {
    if (!usedSourceIds.has(sourceId)) continue;
    const attribution = sources[sourceId].attribution;
    if (attribution && !seen.has(attribution)) {
      seen.add(attribution);
      result.push(attribution);
    }
  }

  return result;
}

// Sanitises an HTML attribution string: keeps text nodes and rebuilds only <a> elements
// whose href starts with https://. All other tags are dropped. Returns a flat node list.
function sanitiseAttributionHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const nodes = [];
  const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);

  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      addTextNode(node, nodes);
    } else if (node.tagName === 'A') {
      addSafeAnchor(node, nodes);
    }
  }

  return nodes;
}

// Adds a trimmed text node to the nodes list if non-empty.
function addTextNode(textNode, nodes) {
  const text = textNode.textContent.trim();
  if (!text) return;
  nodes.push(document.createTextNode(text));
}

// Adds a new anchor to the nodes list if its href starts with https:// and has text.
function addSafeAnchor(element, nodes) {
  const href = element.getAttribute('href');
  if (!href || !href.startsWith('https://')) return;
  const anchorText = element.textContent.trim();
  if (!anchorText) return;
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.textContent = anchorText;
  nodes.push(anchor);
}

// Renders the current map's source attributions into #map-attribution.
// Reads attributions from the map's style object, sanitises the HTML, and joins them
// with a middle dot separator.
export function renderMapAttribution(map) {
  const container = document.getElementById('map-attribution');
  if (!container) return;

  const style = map.getStyle();
  const attributions = visibleSourceAttributions(style);
  const childNodes = buildAttributionNodes(attributions);
  container.replaceChildren(...childNodes);
}

// Builds a flat list of DOM nodes from attribution HTML strings, joined by ' · '.
function buildAttributionNodes(attributions) {
  const childNodes = [];

  for (let index = 0; index < attributions.length; index++) {
    if (index > 0) {
      childNodes.push(document.createTextNode(' · '));
    }
    childNodes.push(...sanitiseAttributionHtml(attributions[index]));
  }

  return childNodes;
}
