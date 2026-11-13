import fileSystem from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assertOfflineModulesIncluded} from './offline-inventory.js';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outputDirectory = path.join(repositoryRoot, 'dist/web');
const isCheck = process.argv.includes('--check');
const provenance = JSON.parse(
  fileSystem.readFileSync(path.join(repositoryRoot, 'data/sources/provenance.json'), 'utf8')
);
const sha256Hex = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let archivePath = path.join(outputDirectory, 'data/montenegro.pmtiles');
if (!fileSystem.existsSync(archivePath)) {
  archivePath = fileSystem
    .readdirSync(path.join(outputDirectory, 'data'))
    .filter(filePath => /^montenegro-[a-f0-9]+\.pmtiles$/.test(filePath))
    .map(filePath => path.join(outputDirectory, 'data', filePath))[0];
}
const archiveBytes = fileSystem.readFileSync(archivePath);
const archiveHash = sha256Hex(archiveBytes);
const archiveName = 'data/montenegro-' + archiveHash.slice(0, 16) + '.pmtiles';
if (isCheck && path.resolve(archivePath) !== path.join(outputDirectory, archiveName))
  throw new Error('Archive filename is stale. Run npm run release:prepare.');
if (!isCheck && path.resolve(archivePath) !== path.join(outputDirectory, archiveName))
  fileSystem.renameSync(archivePath, path.join(outputDirectory, archiveName));
for (const name of fileSystem.readdirSync(path.join(outputDirectory, 'data')))
  if (!isCheck && name.endsWith('.pmtiles') && 'data/' + name !== archiveName)
    fileSystem.unlinkSync(path.join(outputDirectory, 'data', name));
const shell = [
  'index.html',
  'device-class.js',
  'interface.js',
  'app-updates.js',
  'app.js',
  'dom.js',
  'place-details.js',
  'public-map-layers.js',
  'map-selection.js',
  'offline-controls.js',
  'status-messages.js',
  'place-selection.js',
  'location-controls.js',
  'core.js',
  'offline.js',
  'transport.js',
  'vehicle-direction.js',
  'data-mode.js',
  'point-selection.js',
  'object-selection.js',
  'map-taps.js',
  'position.js',
  'routing.js',
  'transit-routing.js',
  'route-planner.js',
  'style.css',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'manifest.webmanifest',
  'vendor/maplibre-gl.js',
  'vendor/maplibre-gl.css',
  'vendor/pmtiles.js',
  'data/places.geojson',
  'data/place-visibility.json',
  'data/transport-stops.geojson',
  'data/transit-network.json',
  'data/building-labels.geojson'
];
const mapCoreModules = fileSystem
  .readdirSync(path.join(outputDirectory, 'map-core'))
  .filter(filename => filename.endsWith('.js'));
for (const filename of mapCoreModules) {
  shell.push(`map-core/${filename}`);
}
assertOfflineModulesIncluded(
  fileSystem.readdirSync(path.join(repositoryRoot, 'apps/web/src')).filter(file => file.endsWith('.js')),
  shell
);
for (const stack of fileSystem.readdirSync(path.join(outputDirectory, 'fonts'))) {
  const filePath = path.join(outputDirectory, 'fonts', stack);
  if (!fileSystem.statSync(filePath).isDirectory()) continue;
  const glyphFiles = fileSystem.readdirSync(filePath).filter(filename => filename.endsWith('.pbf'));
  for (const filename of glyphFiles) shell.push('fonts/' + stack + '/' + filename);
}
// Satellite is deliberately small: include every sample asset in offline releases.
function collectSatellite(directory) {
  for (const item of fileSystem.readdirSync(directory, {withFileTypes: true})) {
    const filePath = path.join(directory, item.name);
    if (item.isDirectory()) collectSatellite(filePath);
    else if (/\.(webp|png|json)$/.test(item.name))
      shell.push(path.relative(outputDirectory, filePath).split(path.sep).join('/'));
  }
}
collectSatellite(path.join(outputDirectory, 'data/satellite'));
const shellHash = sha256Hex(
  Buffer.concat(
    [...shell, 'sw.js'].map(filename => fileSystem.readFileSync(path.join(outputDirectory, filename)))
  )
).slice(0, 16);
const manifest = {
  version: '0.1.0',
  sourceTimestamp: provenance.upstream_snapshot,
  coverage: provenance.coverage,
  archive: {path: archiveName, sha256: archiveHash, bytes: archiveBytes.length},
  shellCache: 'kompas-shell-' + shellHash + '-' + archiveHash.slice(0, 8),
  shell: [...shell, 'data/manifest.json'],
  totalBytes:
    archiveBytes.length +
    shell.reduce(
      (totalBytes, filename) => totalBytes + fileSystem.statSync(path.join(outputDirectory, filename)).size,
      0
    )
};
const outputs = {
  'data/manifest.json': JSON.stringify(manifest, null, 2),
  'offline-manifest.js':
    'self.KOMPAS_OFFLINE=' + JSON.stringify({shellCache: manifest.shellCache, shell: manifest.shell}) + ';\n'
};
for (const [name, content] of Object.entries(outputs)) {
  if (isCheck) {
    if (fileSystem.readFileSync(path.join(outputDirectory, name), 'utf8') !== content)
      throw new Error(`${name} is stale. Run npm run release:prepare.`);
  } else fileSystem.writeFileSync(path.join(outputDirectory, name), content);
}
console.log(
  isCheck ? 'Offline manifests verified.' : 'Offline manifests regenerated.',
  'Archive:',
  archiveName,
  'bytes:',
  archiveBytes.length,
  'shell assets:',
  manifest.shell.length
);
