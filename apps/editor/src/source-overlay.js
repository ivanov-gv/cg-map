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

// Returns the source feature behind a rendered hit, or null when the hit belongs to another file.
// After a mode switch the map keeps rendering the previous file until its worker finishes, and an
// index alone would resolve against the new file to an unrelated feature.
export function sourceFeatureForHit(hit, filename, features) {
  if (hit?.properties.sourceFile !== filename) return null;
  return features[hit.id] ?? null;
}

// A feature may be hit in several tiles or both fill and outline layers. Resolve each display index once,
// in source order, retaining working keys after deletions have changed the display indices.
export function sourceEntriesForHits(hits, filename, entries) {
  const indices = new Set();
  for (const hit of hits) {
    if (hit?.properties?.sourceFile !== filename) continue;
    if (!Number.isInteger(hit.id) || !entries[hit.id]) continue;
    indices.add(hit.id);
  }
  return [...indices].sort((first, second) => first - second).map(index => entries[index]);
}

// Geometry and the revision-bound key distinguish unnamed objects and names shared by several sources.
export function objectLabel({key, feature}) {
  const properties = feature.properties;
  const name = properties.name || properties['addr:housenumber'] || feature.geometry.type;
  return `${name} · ${feature.geometry.type} · feature ${key}`;
}
