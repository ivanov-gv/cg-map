import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {copyMapCore, copyRuntimeAssets, relocateCoreImports} from '@ivanov-gv/map-core/tools/assemble.mjs';
import {parseVisibilityConfig, assertPublishedPlaces} from '@ivanov-gv/map-core/src/place-visibility.js';
import {readVerifiedRelease} from '../../../data/tools/app-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = path.join(root, 'dist/web');
const {release, archiveBytes} = readVerifiedRelease();
fs.rmSync(output, {recursive: true, force: true});
fs.cpSync(path.join(root, 'apps/web/public'), output, {recursive: true});
fs.cpSync(path.join(root, 'apps/web/src'), output, {recursive: true});
copyMapCore(output);
copyRuntimeAssets(output);
const webModules = fs.readdirSync(path.join(root, 'apps/web/src')).filter(name => name.endsWith('.js'));
for (const filename of webModules) {
  const source = fs.readFileSync(path.join(output, filename), 'utf8');
  fs.writeFileSync(path.join(output, filename), relocateCoreImports(source));
}
fs.mkdirSync(path.join(output, 'data'), {recursive: true});
fs.writeFileSync(path.join(output, 'data', release.archive.file), archiveBytes);
assertPublishedPlaces(JSON.parse(fs.readFileSync(path.join(root, 'data/sources/places.geojson'))).features, parseVisibilityConfig(JSON.parse(fs.readFileSync(path.join(root, 'packages/contracts/place-visibility.json')))));
fs.copyFileSync(path.join(root, 'data/sources/places.geojson'), path.join(output, 'data/places.geojson'));
fs.copyFileSync(path.join(root, 'packages/contracts/place-visibility.json'), path.join(output, 'data/place-visibility.json'));
fs.copyFileSync(path.join(root, 'data/sources/building-labels.geojson'), path.join(output, 'data/building-labels.geojson'));
fs.copyFileSync(path.join(root, 'data/sources/transit-network.json'), path.join(output, 'data/transit-network.json'));
fs.copyFileSync(path.join(root, 'data/sources/transport-stops.geojson'), path.join(output, 'data/transport-stops.geojson'));
fs.cpSync(path.join(root, 'data/imagery/podgorica'), path.join(output, 'data/satellite'), {recursive: true, filter: source => !source.endsWith('.md')});
fs.writeFileSync(path.join(output, '.nojekyll'), '');
execFileSync(process.execPath, [path.join(root, 'apps/web/tools/finalize.mjs')], {cwd: root, stdio: 'inherit'});
console.log('Built deployable web artifact: dist/web/');
