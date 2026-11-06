// Describes one release for the service worker: every file with its hash, and a release ID derived from them.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sha256Of = bytes => createHash('sha256').update(bytes).digest('hex');
const generatedManifestFile = 'offline-manifest.js';
// The browser fetches the worker itself, so it is never read from the cache it fills.
const workerFile = 'sw.js';

function artifactFiles(outputDirectory) {
  const entries = fs.readdirSync(outputDirectory, {recursive: true, withFileTypes: true});
  return entries
    .filter(entry => entry.isFile())
    .map(entry => path.relative(outputDirectory, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

// The archive is listed apart because the worker stores it in its own cache, named by content.
export function offlineManifest(outputDirectory, archivePath) {
  const hashed = artifactFiles(outputDirectory).map(filePath => ({
    path: filePath,
    sha256: sha256Of(fs.readFileSync(path.join(outputDirectory, filePath)))
  }));
  const release = sha256Of(JSON.stringify(hashed)).slice(0, 16);
  const stored = hashed.filter(({path: filePath}) => filePath !== workerFile && filePath !== generatedManifestFile);
  return {
    release,
    archive: stored.find(({path: filePath}) => filePath === archivePath),
    files: stored.filter(({path: filePath}) => filePath !== archivePath)
  };
}

// Stamps the worker with the release, because a browser looks for an update by comparing the worker's own bytes.
export function writeOfflineManifest(outputDirectory, archivePath) {
  const {release, archive, files} = offlineManifest(outputDirectory, archivePath);
  const moduleText = [
    `export const release = ${JSON.stringify(release)};`,
    `export const archive = ${JSON.stringify(archive)};`,
    `export const files = ${JSON.stringify(files)};`,
    ''
  ].join('\n');
  fs.writeFileSync(path.join(outputDirectory, generatedManifestFile), moduleText);
  const workerPath = path.join(outputDirectory, workerFile);
  fs.writeFileSync(workerPath, `// Release ${release}.\n${fs.readFileSync(workerPath, 'utf8')}`);
  return release;
}
