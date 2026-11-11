// Pure helpers to compare two GeoJSON features and produce a diff summary.
// Used by the review panel and its tests; has no DOM dependencies.

// Display JSON values with their type visible; undefined represents a missing property.
export function formatValue(value) {
  if (value === undefined) return '(missing)';
  return JSON.stringify(value);
}

// Compare two property objects and return the keys that changed versus unchanged.
// Uses JSON serialization so that object and array values are compared by value, not by reference.
export function diffProperties(beforeProperties, afterProperties) {
  const allKeys = new Set([
    ...Object.keys(beforeProperties ?? {}),
    ...Object.keys(afterProperties ?? {})
  ]);
  const changed = [];
  const unchanged = [];
  for (const key of [...allKeys].sort()) {
    const beforeValue = beforeProperties?.[key];
    const afterValue = afterProperties?.[key];
    const hasBefore = Object.hasOwn(beforeProperties ?? {}, key);
    const hasAfter = Object.hasOwn(afterProperties ?? {}, key);
    if (hasBefore !== hasAfter || JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changed.push(key);
    } else {
      unchanged.push(key);
    }
  }
  return {changed, unchanged};
}

// Return whether the geometry changed between two features.
export function geometryChanged(beforeGeometry, afterGeometry) {
  return JSON.stringify(beforeGeometry ?? {}) !== JSON.stringify(afterGeometry ?? {});
}

// Count coordinate tuples at any GeoJSON nesting depth, including optional altitude.
function countVertices(coordinates) {
  if (typeof coordinates[0] === 'number') return 1;
  return coordinates.reduce((count, part) => count + countVertices(part), 0);
}

// Summarize a geometry change for compact display, e.g. "moved" or "vertices: 4 → 5".
// Returns null if coordinates are identical (should not be called in that case).
export function summarizeGeometryChange(beforeGeometry, afterGeometry) {
  if (!beforeGeometry || !afterGeometry) {
    return 'geometry changed';
  }
  const beforeCoordinates = beforeGeometry.coordinates;
  const afterCoordinates = afterGeometry.coordinates;
  if (JSON.stringify(beforeCoordinates) === JSON.stringify(afterCoordinates)) {
    return null;
  }
  const beforeVertexCount = countVertices(beforeCoordinates);
  const afterVertexCount = countVertices(afterCoordinates);
  if (beforeVertexCount !== afterVertexCount) {
    return `vertices: ${beforeVertexCount} → ${afterVertexCount}`;
  }
  return 'moved';
}
