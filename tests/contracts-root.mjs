// The one place cross-project tests resolve shared contracts. HEAD is the default; a release run sets MAP_CONTRACTS_ROOT.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const configuredRoot = process.env.MAP_CONTRACTS_ROOT;
if ('MAP_CONTRACTS_ROOT' in process.env && !configuredRoot) throw new Error('MAP_CONTRACTS_ROOT is set but empty');

export const contractsDirectory = configuredRoot ? path.resolve(configuredRoot) : path.join(repositoryRoot, 'packages/contracts');

export function contractPath(filename) {
  return path.join(contractsDirectory, filename);
}

export function contractURL(filename) {
  return pathToFileURL(contractPath(filename));
}

export function readContractJSON(filename) {
  return JSON.parse(fs.readFileSync(contractPath(filename), 'utf8'));
}

export function publishedContractsRoot() {
  const installedRoot = path.dirname(require.resolve('@ivanov-gv/map-contracts/package.json'));
  if (installedRoot === path.join(repositoryRoot, 'packages/contracts'))
    throw new Error('a release test must resolve an installed @ivanov-gv/map-contracts package, not repository contracts');
  return installedRoot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(process.argv[2] === '--published' ? publishedContractsRoot() : contractsDirectory);
