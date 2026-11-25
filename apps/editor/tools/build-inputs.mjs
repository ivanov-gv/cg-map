// Which core, data and contracts an artifact is made of, for whoever reads a build log. Only the packages this app pins
// are released ones; everything else is the checked-out commit.
import path from 'node:path';

const isInstalled = root => root.split(path.sep).includes('node_modules');

export function describeInputs(roots) {
  return Object.entries(roots)
    .map(([name, root]) => `${name} ${isInstalled(root) ? 'pinned' : 'from this commit'}`)
    .join(', ');
}
