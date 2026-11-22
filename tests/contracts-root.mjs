// The one place cross-project tests resolve shared contracts. HEAD is the default; a release run sets MAP_CONTRACTS_ROOT.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRequire = createRequire(path.join(repositoryRoot, 'package.json'));
const candidateRequire = createRequire(import.meta.url);
const configuredRoot = process.env.MAP_CONTRACTS_ROOT;
if ('MAP_CONTRACTS_ROOT' in process.env && !configuredRoot) throw new Error('MAP_CONTRACTS_ROOT is set but empty');

export const contractsDirectory = configuredRoot ? path.resolve(configuredRoot) : path.join(repositoryRoot, 'packages/contracts');

// Returns a path inside the contracts root selected for this run.
export function contractPath(filename) {
  return path.join(contractsDirectory, filename);
}

// Returns a file URL for a contract in the selected root.
export function contractURL(filename) {
  return pathToFileURL(contractPath(filename));
}

// Reads and parses one JSON contract from the selected root.
export function readContractJSON(filename) {
  return JSON.parse(fs.readFileSync(contractPath(filename), 'utf8'));
}

// The changeset importer expects a disposable root with contracts at packages/contracts.
export function stageContractsInto(destinationRoot) {
  fs.cpSync(contractsDirectory, path.join(destinationRoot, 'packages/contracts'), {recursive: true});
}

// Returns the installed release root: the repository pin by default, the release candidate in a published run.
export function publishedContractsRoot() {
  const isPublishedRun = process.argv[2] === '--published' || Boolean(process.env.MAP_CONTRACTS_VERSION);
  const installedRequire = isPublishedRun ? candidateRequire : repositoryRequire;
  const installedRoot = path.dirname(installedRequire.resolve('@ivanov-gv/map-contracts/package.json'));
  if (installedRoot === path.join(repositoryRoot, 'packages/contracts'))
    throw new Error('a release test must resolve an installed @ivanov-gv/map-contracts package, not repository contracts');
  return installedRoot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(process.argv[2] === '--published' ? publishedContractsRoot() : contractsDirectory);
