import path from 'node:path';

// Test targets set MAP_CONTRACTS_ROOT to the exact package a release promotes. A normal build uses the repository's
// pinned package. An explicitly empty value is a configuration error, not a reason to fall back silently.
export function resolveContractsRoot(defaultRoot) {
  if ('MAP_CONTRACTS_ROOT' in process.env && !process.env.MAP_CONTRACTS_ROOT) {
    throw new Error('MAP_CONTRACTS_ROOT is set but empty; release tests must resolve @ivanov-gv/map-contracts');
  }
  return process.env.MAP_CONTRACTS_ROOT ? path.resolve(process.env.MAP_CONTRACTS_ROOT) : defaultRoot;
}
