// Pure helpers to compare two GeoJSON features and produce a diff summary.
// Used by the review panel and its tests; has no DOM dependencies.

// Format a property value for display and comparison.
// Objects and arrays are serialized to JSON so that equal content compares equal
// even across different references.
export function formatValue(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
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
    if (formatValue(beforeValue) !== formatValue(afterValue)) {
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

// Count the vertices in a coordinates array, handling Points, LineStrings, and Polygons.
function countVertices(coordinates) {
  if (Array.isArray(coordinates[0]?.[0])) {
    // Polygon or MultiLineString: array of rings/lines, each an array of points
    return coordinates.flat().length;
  }
  // Point or LineString: flat array of points
  return coordinates.length;
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
