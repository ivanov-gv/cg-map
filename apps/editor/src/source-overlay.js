// Display copies carry only what rendering and hit testing need. MapLibre needs a numeric feature ID,
// so the array index stands in for it here while the source feature keeps its own ID untouched.
export function overlayCollection(filename, features) {
  const displayFeatures = features.map((feature, index) => ({
    type: 'Feature',
    id: index,
    geometry: feature.geometry,
    properties: {sourceFile: filename}
  }));
  return {type: 'FeatureCollection', features: displayFeatures};
}

// A feature may be hit in several tiles or both fill and outline layers. Resolve each display index once,
// in source order, retaining working keys after deletions have changed the display indices. After a mode switch,
// workers may still render the previous file: its indices must never resolve against the active file.
export function sourceEntriesForHits(hits, filename, entries) {
  const indices = new Set();
  for (const hit of hits) {
    if (hit?.properties?.sourceFile !== filename) continue;
    if (!Number.isInteger(hit.id) || !entries[hit.id]) continue;
    indices.add(hit.id);
  }
  return [...indices].sort((first, second) => first - second).map(index => entries[index]);
}

// The inspector and object list share one display name; geometry and revision keys belong in list context only.
export function objectName(feature) {
  const properties = feature.properties;
  return properties.name || properties['addr:housenumber'] || 'Unnamed';
}

// Geometry and the revision-bound key distinguish unnamed objects and names shared by several sources.
export function objectLabel({key, feature}) {
  const name = objectName(feature);
  return `${name} · ${feature.geometry.type} · feature ${key}`;
}
