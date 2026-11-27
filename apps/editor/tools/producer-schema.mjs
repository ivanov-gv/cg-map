import fileSystem from 'node:fs';
import path from 'node:path';
import {bundleFilesByVersion} from '../src/source-data/source-bundle.js';

// The pinned data package still checks a flat filename enum, while the contract now records every bundle version
// under oneOf. Give that check the producer's own GeoJSON files, but only once they match a version the editor reads.
export function writeProducerBundleSchema(schemaDirectory, sourceDirectory) {
  const filenames = fileSystem.readdirSync(sourceDirectory).filter(filename => filename.endsWith('.geojson')).sort();
  const isSupported = Object.values(bundleFilesByVersion).some(files =>
    JSON.stringify(files.filter(filename => filename.endsWith('.geojson')).sort()) === JSON.stringify(filenames)
  );
  if (!isSupported) throw new Error('Editor bundle: source files do not match a supported bundle version.');
  fileSystem.mkdirSync(schemaDirectory, {recursive: true});
  const schemaPath = path.join(schemaDirectory, 'editor-bundle-producer.schema.json');
  const schema = {properties: {layers: {items: {properties: {filename: {enum: filenames}}}}}};
  fileSystem.writeFileSync(schemaPath, JSON.stringify(schema, null, 2) + '\n');
  return schemaPath;
}
