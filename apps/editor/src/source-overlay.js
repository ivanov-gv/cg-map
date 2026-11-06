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
