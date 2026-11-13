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

// Parses an HTML attribution string and returns a flat list of DOM nodes.
// Walks only the top-level children of the parsed body (no recursion).
// Text nodes are copied as-is. <a> elements with an https:// href are rebuilt
// with safe target/rel attributes. Any other element (including unsafe links)
// is flattened to its text content.
// Accepts an optional documentObject so tests can pass a fake document;
// defaults to the global document when omitted.
export function attributionNodes(html, documentObject) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const parsedDocument = documentObject ?? document;
  const nodes = [];

  for (const child of doc.body.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      nodes.push(parsedDocument.createTextNode(child.textContent));
    } else if (child.tagName === 'A') {
      const href = child.getAttribute('href');
      if (href && href.startsWith('https://')) {
        const anchor = parsedDocument.createElement('a');
        anchor.href = href;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.textContent = child.textContent;
        nodes.push(anchor);
      } else {
        nodes.push(parsedDocument.createTextNode(child.textContent));
      }
    } else {
      nodes.push(parsedDocument.createTextNode(child.textContent));
    }
  }

  return nodes;
}

// Renders the current map's source attributions into #map-attribution.
// Reads attributions from the map's style object, parses the HTML, and joins them
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
    childNodes.push(...attributionNodes(attributions[index]));
  }

  return childNodes;
}
