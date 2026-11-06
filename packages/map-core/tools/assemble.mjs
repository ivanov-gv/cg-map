// Build-time half of the map-core contract: every map application assembles its artifact from these
// helpers, so each ships the same runtime, vendored libraries, fonts and reviewed map data.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {archiveFilenamePattern} from '../src/map.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const packageRoot = path.join(repositoryRoot, 'packages/map-core');

// Returns the reviewed release and its archive bytes. Throws rather than assemble an unreviewed map.
export function readVerifiedRelease() {
  const release = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'data/artifacts/release.json')));
  if (!archiveFilenamePattern.test(release.archive.file)) throw new Error('Unsafe archive release path');
  const archiveBytes = fs.readFileSync(path.join(repositoryRoot, 'data/artifacts', release.archive.file));
  const digest = createHash('sha256').update(archiveBytes).digest('hex');
  const isReviewedArchive = digest === release.archive.sha256 && archiveBytes.length === release.archive.bytes;
  if (!isReviewedArchive) throw new Error('Reviewed data release integrity check failed');
  return {release, archiveBytes};
}

// Each artifact carries its own copy of the one maintained runtime, under map-core/.
export function copyMapCore(outputDirectory) {
  fs.cpSync(path.join(packageRoot, 'src'), path.join(outputDirectory, 'map-core'), {recursive: true});
}

// Libraries and fonts are local runtime assets, served beside each application's own files.
export function copyRuntimeAssets(outputDirectory) {
  for (const directory of ['vendor', 'fonts']) {
    fs.cpSync(path.join(packageRoot, 'assets', directory), path.join(outputDirectory, directory), {recursive: true});
  }
}

// Deterministic import relocation keeps source imports executable in Node while the artifact
// remains a standalone static directory. It never changes runtime module behavior.
export function relocateCoreImports(source) {
  return source.replaceAll('../../../packages/map-core/src/', './map-core/');
}

// Copies the verified map data the shared runtime reads at startup.
function copyMapData(outputDirectory) {
  const {release, archiveBytes} = readVerifiedRelease();
  const dataDirectory = path.join(outputDirectory, 'data');
  fs.mkdirSync(dataDirectory, {recursive: true});
  fs.writeFileSync(path.join(dataDirectory, release.archive.file), archiveBytes);
  fs.writeFileSync(path.join(dataDirectory, 'map.json'), JSON.stringify({archive: release.archive.file}));
  for (const filename of ['places.geojson', 'building-labels.geojson']) {
    fs.copyFileSync(path.join(repositoryRoot, 'data/sources', filename), path.join(dataDirectory, filename));
  }
  fs.copyFileSync(
    path.join(repositoryRoot, 'packages/contracts/place-visibility.json'),
    path.join(dataDirectory, 'place-visibility.json')
  );
  fs.cpSync(path.join(repositoryRoot, 'data/imagery/podgorica'), path.join(dataDirectory, 'satellite'), {
    recursive: true,
    filter: source => !source.endsWith('.md')
  });
}

// Replaces dist/<name> with a standalone static artifact of an application without an offline shell.
// Returns the output directory so the application can add its own files.
export function assembleStaticApplication(applicationDirectory) {
  const name = path.basename(applicationDirectory);
  const outputDirectory = path.join(repositoryRoot, 'dist', name);
  fs.rmSync(outputDirectory, {recursive: true, force: true});
  fs.cpSync(path.join(applicationDirectory, 'public'), outputDirectory, {recursive: true});
  const sourceDirectory = path.join(applicationDirectory, 'src');
  const modules = fs.readdirSync(sourceDirectory).filter(filename => filename.endsWith('.js'));
  for (const filename of modules) {
    const source = fs.readFileSync(path.join(sourceDirectory, filename), 'utf8');
    fs.writeFileSync(path.join(outputDirectory, filename), relocateCoreImports(source));
  }
  copyMapCore(outputDirectory);
  copyRuntimeAssets(outputDirectory);
  copyMapData(outputDirectory);
  return outputDirectory;
}
