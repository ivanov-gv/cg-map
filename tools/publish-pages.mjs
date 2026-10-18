import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Only these paths can be generated or removed. Never mirror over the repository.
const outputs = new Set(['index.html', 'app.js', 'core.js', 'offline.js', 'map-style.js',
  'satellite.js', 'style.css', 'sw.js', 'offline-manifest.js', 'manifest.webmanifest',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'data', 'fonts', 'vendor']);
const inventoryName = '.pages-manifest.json';
function allowed(file) {
  return !path.isAbsolute(file) && !file.split('/').includes('..') &&
    outputs.has(file.split('/')[0]) && !file.endsWith('.md');
}
function filesUnder(directory, prefix = '') {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const rel = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not a publishable asset: ${rel}`);
    return entry.isDirectory() ? filesUnder(path.join(directory, entry.name), rel + '/') : [rel];
  });
}
export function publishPages(root, {check = false} = {}) {
  const source = path.join(root, 'web');
  const files = filesUnder(source).filter(file => !file.endsWith('.md')).sort();
  for (const file of files) if (!allowed(file)) throw new Error(`Unrecognized runtime asset ${file}; update the publisher allowlist deliberately.`);
  const inventory = path.join(root, inventoryName);
  const previous = fs.existsSync(inventory) ? JSON.parse(fs.readFileSync(inventory, 'utf8')).files : [];
  if (!Array.isArray(previous) || previous.some(file => typeof file !== 'string' || !allowed(file))) {
    throw new Error('Invalid Pages inventory; refusing to touch unmanaged paths.');
  }
  if (check) {
    if (JSON.stringify(previous) !== JSON.stringify(files)) throw new Error('Pages inventory is stale. Run npm run release:prepare.');
    for (const file of files) {
      const target = path.join(root, file);
      if (!fs.existsSync(target) || !fs.readFileSync(target).equals(fs.readFileSync(path.join(source, file)))) {
        throw new Error(`Pages output differs: ${file}. Run npm run release:prepare.`);
      }
    }
    if (!fs.existsSync(path.join(root, '.nojekyll'))) throw new Error('Root .nojekyll is missing.');
    return files;
  }
  for (const file of previous) if (!files.includes(file)) fs.rmSync(path.join(root, file), {force: true});
  for (const file of files) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(path.join(source, file), target);
  }
  fs.writeFileSync(path.join(root, '.nojekyll'), '');
  fs.writeFileSync(inventory, JSON.stringify({version: 1, files}, null, 2) + '\n');
  return files;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const check = process.argv.includes('--check');
  const files = publishPages(root, {check});
  console.log(`${check ? 'Verified' : 'Prepared'} ${files.length} root Pages assets; docs/ is documentation. Pages setting: main / (root).`);
}
