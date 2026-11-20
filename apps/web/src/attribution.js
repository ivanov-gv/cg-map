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
  const parsedAttribution = new DOMParser().parseFromString(html, 'text/html');
  const targetDocument = documentObject ?? document;
  const nodes = [];

  for (const child of parsedAttribution.body.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      nodes.push(targetDocument.createTextNode(child.textContent));
    } else if (child.tagName === 'A') {
      const href = child.getAttribute('href');
      if (href && href.startsWith('https://')) {
        const anchor = targetDocument.createElement('a');
        anchor.href = href;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.textContent = child.textContent;
        nodes.push(anchor);
      } else {
        nodes.push(targetDocument.createTextNode(child.textContent));
      }
    } else {
      nodes.push(targetDocument.createTextNode(child.textContent));
    }
  }

  return nodes;
}

const separator = ' · ';

// Builds the version prefix of the dock footer. The compact form keeps the app name and version but drops the commit,
// which cannot fit beside the full licence on a narrow screen. A build without a commit gets no placeholder.
export function buildFooterVersionText(build, {compact = false} = {}) {
  const version = build?.version?.trim();
  if (!version) return '';

  const name = build?.name?.trim();
  const namedVersion = name ? `${name} ${version}` : version;
  if (compact) return `${namedVersion}${separator}`;

  const commit = build?.commit?.trim();
  return `${namedVersion}${commit ? separator + commit : ''}${separator}`;
}

// Remembers the last rendered content and width so repeated calls are cheap, but a resize can re-measure the fit.
let renderedAttribution = {width: null, signature: null};

// Renders the build version followed by the current map's source attributions into #map-attribution.
// Drops only the commit when the full line cannot fit; the licence text and links always stay in the DOM.
export function renderMapAttribution(map, build) {
  const container = document.getElementById('map-attribution');
  if (!container) return;

  const style = map.getStyle();
  const attributions = visibleSourceAttributions(style);
  const fullVersionText = buildFooterVersionText(build);
  const compactVersionText = buildFooterVersionText(build, {compact: true});
  const signature = `${fullVersionText}\n${attributions.join('\n')}`;
  const width = container.clientWidth;

  if (renderedAttribution.width === width && renderedAttribution.signature === signature) return;

  renderAttributionNodes(container, attributions, fullVersionText);
  if (container.scrollWidth > width + 1 && compactVersionText !== fullVersionText) {
    renderAttributionNodes(container, attributions, compactVersionText);
  }

  renderedAttribution = {width, signature};
}

// Replaces the footer nodes with the given version prefix and source attributions.
function renderAttributionNodes(container, attributions, versionText) {
  container.replaceChildren(...buildAttributionNodes(attributions, versionText));
}

// Builds a flat list of DOM nodes from the optional version prefix and attribution HTML strings.
function buildAttributionNodes(attributions, versionText) {
  const childNodes = versionText ? [document.createTextNode(versionText)] : [];

  for (let index = 0; index < attributions.length; index++) {
    if (index > 0) {
      childNodes.push(document.createTextNode(separator));
    }
    childNodes.push(...attributionNodes(attributions[index]));
  }

  return childNodes;
}
