import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Dev builds resolve repository contracts at HEAD. Test targets set MAP_CONTRACTS_ROOT to this app's own pin.
export const repositoryContractsRoot = fileURLToPath(new URL('../../../packages/contracts', import.meta.url));

// Returns the contracts root for this run; an explicitly empty input is a configuration error, not a silent fallback.
export function resolveContractsRoot() {
  if ('MAP_CONTRACTS_ROOT' in process.env && !process.env.MAP_CONTRACTS_ROOT) {
    throw new Error('MAP_CONTRACTS_ROOT is set but empty; test targets must resolve @ivanov-gv/map-contracts');
  }
  return process.env.MAP_CONTRACTS_ROOT ? path.resolve(process.env.MAP_CONTRACTS_ROOT) : repositoryContractsRoot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(resolveContractsRoot());
