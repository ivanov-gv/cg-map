// Renders map source attributions in the dock footer instead of a floating control.
// The attribution strings come from the map's own source definitions, so they stay
// correct when sources change or the satellite layer is toggled.

// Basemap attribution text and link, matching map-core/src/map-style.js.
const basemapAttribution = {
  text: '© OpenStreetMap contributors · ODbL · Natural Earth',
  linkText: 'OpenStreetMap contributors',
  linkURL: 'https://www.openstreetmap.org/copyright'
};

// Satellite imagery attribution, matching map-core/src/satellite.js.
const satelliteAttribution = {
  text: 'Imagery: eMapa · Ortofoto 2025',
  linkText: 'eMapa',
  linkURL: 'https://emapa.me/'
};

// Builds a <p> containing the basemap attribution with a link, using createElement
// so no innerHTML is needed. The link opens in a new tab with safe rel attributes.
function buildAttributionLink(text, url) {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = text;
  return link;
}

// Returns the full attribution paragraph for the given sources.
// When satellite is visible, both attributions appear separated by a middle dot.
function buildAttributionElement(showSatellite) {
  const paragraph = document.createElement('p');
  paragraph.className = 'map-attribution';

  // Build "© <a>OpenStreetMap contributors</a> · ODbL · Natural Earth"
  const copyrightSymbol = document.createTextNode('© ');
  paragraph.appendChild(copyrightSymbol);

  const osmLink = buildAttributionLink(basemapAttribution.linkText, basemapAttribution.linkURL);
  paragraph.appendChild(osmLink);

  const osmSuffix = document.createTextNode(' · ODbL · Natural Earth');
  paragraph.appendChild(osmSuffix);

  if (showSatellite) {
    const separator = document.createTextNode(' · ');
    paragraph.appendChild(separator);

    const satelliteText = document.createTextNode('Imagery: ');
    paragraph.appendChild(satelliteText);

    const emapaLink = buildAttributionLink(satelliteAttribution.linkText, satelliteAttribution.linkURL);
    paragraph.appendChild(emapaLink);

    const satelliteSuffix = document.createTextNode(' · Ortofoto 2025');
    paragraph.appendChild(satelliteSuffix);
  }

  return paragraph;
}

// Updates the dock footer attribution to reflect which sources are currently visible.
// Reads the map's source attributions at runtime so the display stays in sync with
// the actual sources, rather than relying on a static copy.
export function updateDockAttribution(map, showSatellite) {
  const container = document.getElementById('map-attribution');
  if (!container) return;

  container.innerHTML = '';
  container.appendChild(buildAttributionElement(showSatellite));
}

// Convenience: render the initial attribution (basemap only, no satellite).
export function renderInitialAttribution() {
  const container = document.getElementById('map-attribution');
  if (!container) return;
  container.appendChild(buildAttributionElement(false));
}
