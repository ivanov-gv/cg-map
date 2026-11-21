// Shared line-oriented GeoJSON writer. The Python extractor writes the same bytes.
function sortedKeys(value) {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedKeys(value[key])]));
  }
  return value;
}

// Sort by source identity, then part, then the canonical feature bytes.
function compareRecords(first, second) {
  if (first.entityId !== second.entityId) return first.entityId < second.entityId ? -1 : 1;
  if (first.part !== second.part) return first.part - second.part;
  if (first.json === second.json) return 0;
  return first.json < second.json ? -1 : 1;
}

// Write one sorted feature per line in the shared canonical format.
export function serializeSourceCollection(collection) {
  const records = collection.features.map(feature => {
    const properties = feature.properties ?? {};
    return {
      entityId: properties.entityId ?? '',
      part: properties.entityPart ?? -1,
      json: JSON.stringify(sortedKeys(feature))
    };
  });
  const features = records.sort(compareRecords).map(record => record.json);
  const marker = collection.entitySchemaVersion === 1 ? '"entitySchemaVersion":1,' : '';
  return `{${marker}"features":[\n${features.join(',\n')}\n],"type":"FeatureCollection"}\n`;
}
