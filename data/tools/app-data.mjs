// What a map application reads at startup, taken from a reviewed data release and its sources.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// This tool lives in data/tools/ in the repository and in the package root's tools/ once published. In both layouts
// its parent holds artifacts/, sources/ and imagery/, so callers can pass another root without copying the tool.
const localDataRoot = fileURLToPath(new URL('../', import.meta.url));
const archiveFilenamePattern = /^montenegro-[a-f0-9]{16}\.pmtiles$/;

// Returns the reviewed release and its archive bytes. Throws rather than assemble an unreviewed map.
export function readVerifiedRelease(dataRoot = localDataRoot) {
  const root = path.resolve(dataRoot);
  const release = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/release.json')));
  if (!archiveFilenamePattern.test(release.archive.file)) throw new Error('Unsafe archive release path');
  const archiveBytes = fs.readFileSync(path.join(root, 'artifacts', release.archive.file));
  const digest = createHash('sha256').update(archiveBytes).digest('hex');
  const isReviewedArchive = digest === release.archive.sha256 && archiveBytes.length === release.archive.bytes;
  if (!isReviewedArchive) throw new Error('Reviewed data release integrity check failed');
  return {release, archiveBytes};
}

// Copies the verified map data the shared runtime reads at startup into data/ of an artifact. A consumer passes its own
// contract path because the published data package does not contain workspace contracts.
export function copyMapData(outputDirectory, options = {}) {
  const {dataRoot = localDataRoot, contractPath} = options;
  if (!contractPath)
    throw new Error('copyMapData: a contractPath is required; the published data package does not contain contracts');
  const root = path.resolve(dataRoot);
  const {release, archiveBytes} = readVerifiedRelease(root);
  const dataDirectory = path.join(outputDirectory, 'data');
  fs.mkdirSync(dataDirectory, {recursive: true});
  fs.writeFileSync(path.join(dataDirectory, release.archive.file), archiveBytes);
  fs.writeFileSync(path.join(dataDirectory, 'map.json'), JSON.stringify({archive: release.archive.file}));
  for (const filename of ['places.geojson', 'building-labels.geojson']) {
    fs.copyFileSync(path.join(root, 'sources', filename), path.join(dataDirectory, filename));
  }
  fs.copyFileSync(contractPath, path.join(dataDirectory, 'place-visibility.json'));
  fs.cpSync(path.join(root, 'imagery/podgorica'), path.join(dataDirectory, 'satellite'), {
    recursive: true,
    filter: source => !source.endsWith('.md')
  });
}
