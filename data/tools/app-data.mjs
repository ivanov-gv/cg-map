// What a map application reads at startup, taken from this repository's reviewed release and sources.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const archiveFilenamePattern = /^montenegro-[a-f0-9]{16}\.pmtiles$/;

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

// Copies the verified map data the shared runtime reads at startup into data/ of an artifact.
export function copyMapData(outputDirectory) {
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
