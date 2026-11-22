// The one place cross-project tests resolve map data. HEAD is the default; a release run sets MAP_DATA_ROOT.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const configuredRoot = process.env.MAP_DATA_ROOT;
if ('MAP_DATA_ROOT' in process.env && !configuredRoot) throw new Error('MAP_DATA_ROOT is set but empty');

export const dataRoot = configuredRoot ? path.resolve(configuredRoot) : path.join(repositoryRoot, 'data');
export const dataSourceDirectory = path.join(dataRoot, 'sources');

export function dataSourcePath(filename) {
  return path.join(dataSourceDirectory, filename);
}

export function dataSourceURL(filename) {
  return pathToFileURL(dataSourcePath(filename));
}

export function dataToolURL(filename) {
  return pathToFileURL(path.join(dataRoot, 'tools', filename)).href;
}

// The changeset importer expects a disposable root with data/sources and data/artifacts.
export function stageDataInto(destinationRoot) {
  for (const directory of ['sources', 'artifacts']) {
    fs.cpSync(path.join(dataRoot, directory), path.join(destinationRoot, 'data', directory), {recursive: true});
  }
}

export function stagedSourcePath(destinationRoot, filename) {
  return path.join(destinationRoot, 'data', 'sources', filename);
}

export function publishedDataRoot() {
  const installedRoot = path.dirname(require.resolve('@ivanov-gv/map-data/package.json'));
  if (installedRoot === path.join(repositoryRoot, 'data'))
    throw new Error('a release test must resolve an installed @ivanov-gv/map-data package, not repository data');
  return installedRoot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(process.argv[2] === '--published' ? publishedDataRoot() : dataRoot);
