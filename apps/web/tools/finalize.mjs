// Names the archive by its content, lists the offline shell and writes data/manifest.json and offline-manifest.js
// into dist/web. With --check it changes nothing and fails when either is stale.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assertOfflineModulesIncluded} from './offline-inventory.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const web = path.join(root, 'dist/web');
const isCheck = process.argv.includes('--check');
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'data/sources/provenance.json'), 'utf8'));
const releaseVersion = '0.1.0';
const staleMessage = 'Run npm run release:prepare.';

const sha256 = content => crypto.createHash('sha256').update(content).digest('hex');
const webPath = relativePath => path.join(web, relativePath);

// The build copies the archive under its release name; a finalized artifact already has the content-named one.
function findArchive() {
  const copied = webPath('data/montenegro.pmtiles');
  if (fs.existsSync(copied)) return copied;
  const named = fs.readdirSync(webPath('data')).find(filename => /^montenegro-[a-f0-9]+\.pmtiles$/.test(filename));
  return named && webPath(path.join('data', named));
}

// Returns the content-named path, relative to dist/web. Outside --check, renames the archive to it and removes any
// other archive, so the artifact holds exactly one.
function nameArchive(archivePath, hash) {
  const archiveName = `data/montenegro-${hash.slice(0, 16)}.pmtiles`;
  const isNamed = path.resolve(archivePath) === webPath(archiveName);
  if (isCheck) {
    if (!isNamed) throw new Error(`Archive filename is stale. ${staleMessage}`);
    return archiveName;
  }
  if (!isNamed) fs.renameSync(archivePath, webPath(archiveName));
  for (const filename of fs.readdirSync(webPath('data'))) {
    const isOtherArchive = filename.endsWith('.pmtiles') && `data/${filename}` !== archiveName;
    if (isOtherArchive) fs.unlinkSync(webPath(path.join('data', filename)));
  }
  return archiveName;
}

// Every file the service worker caches for offline use, except the archive, which is downloaded separately.
const appFiles = [
  'index.html',
  'interface.js',
  'app-updates.js',
  'app.js',
  'core.js',
  'dom.js',
  'offline.js',
  'offline-panel.js',
  'place-card.js',
  'public-layers.js',
  'status-text.js',
  'tap-targets.js',
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

function mapCoreModules() {
  return fs
    .readdirSync(webPath('map-core'))
    .filter(filename => filename.endsWith('.js'))
    .map(filename => `map-core/${filename}`);
}

function fontGlyphs() {
  const glyphs = [];
  for (const stack of fs.readdirSync(webPath('fonts'))) {
    const stackPath = webPath(path.join('fonts', stack));
    if (!fs.statSync(stackPath).isDirectory()) continue;
    for (const filename of fs.readdirSync(stackPath)) {
      if (filename.endsWith('.pbf')) glyphs.push(`fonts/${stack}/${filename}`);
    }
  }
  return glyphs;
}

// Satellite is deliberately small: include every sample asset in offline releases.
function satelliteAssets(directory = webPath('data/satellite')) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return satelliteAssets(entryPath);
    if (!/\.(webp|png|json)$/.test(entry.name)) return [];
    return [path.relative(web, entryPath).split(path.sep).join('/')];
  });
}

function shellFiles() {
  const shell = [...appFiles, ...mapCoreModules()];
  const sourceModules = fs.readdirSync(path.join(root, 'apps/web/src')).filter(file => file.endsWith('.js'));
  assertOfflineModulesIncluded(sourceModules, shell);
  return [...shell, ...fontGlyphs(), ...satelliteAssets()];
}

// The cache name changes with any shell file, the worker, or the archive, so a release never reuses an old cache.
function manifestFor(shell, archiveName, archiveHash, archiveBytes) {
  const shellContents = [...shell, 'sw.js'].map(file => fs.readFileSync(webPath(file)));
  const shellHash = sha256(Buffer.concat(shellContents)).slice(0, 16);
  const shellBytes = shell.reduce((total, file) => total + fs.statSync(webPath(file)).size, 0);
  return {
    version: releaseVersion,
    sourceTimestamp: provenance.upstream_snapshot,
    coverage: provenance.coverage,
    archive: {path: archiveName, sha256: archiveHash, bytes: archiveBytes},
    shellCache: `kompas-shell-${shellHash}-${archiveHash.slice(0, 8)}`,
    shell: [...shell, 'data/manifest.json'],
    totalBytes: archiveBytes + shellBytes
  };
}

function writeOrCheck(outputs) {
  for (const [name, content] of Object.entries(outputs)) {
    if (!isCheck) {
      fs.writeFileSync(webPath(name), content);
      continue;
    }
    if (fs.readFileSync(webPath(name), 'utf8') !== content) throw new Error(`${name} is stale. ${staleMessage}`);
  }
}

const archivePath = findArchive();
const archive = fs.readFileSync(archivePath);
const archiveHash = sha256(archive);
const archiveName = nameArchive(archivePath, archiveHash);
const manifest = manifestFor(shellFiles(), archiveName, archiveHash, archive.length);
const workerManifest = {shellCache: manifest.shellCache, shell: manifest.shell};
writeOrCheck({
  'data/manifest.json': JSON.stringify(manifest, null, 2),
  'offline-manifest.js': `self.KOMPAS_OFFLINE=${JSON.stringify(workerManifest)};\n`
});
console.log(
  isCheck ? 'Offline manifests verified.' : 'Offline manifests regenerated.',
  'Archive:',
  archiveName,
  'bytes:',
  archive.length,
  'shell assets:',
  manifest.shell.length
);
