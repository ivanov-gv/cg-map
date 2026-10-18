import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = path.join(root, 'dist/web');
const release = JSON.parse(fs.readFileSync(path.join(root, 'data/artifacts/release.json')));
if (!/^montenegro-[a-f0-9]{16}\.pmtiles$/.test(release.archive.file)) throw new Error('Unsafe archive release path');
const archiveBytes = fs.readFileSync(path.join(root, 'data/artifacts', release.archive.file));
if (archiveBytes.length !== release.archive.bytes || crypto.createHash('sha256').update(archiveBytes).digest('hex') !== release.archive.sha256) throw new Error('Reviewed data release integrity check failed');
fs.rmSync(output, {recursive: true, force: true});
fs.cpSync(path.join(root, 'apps/web/public'), output, {recursive: true});
fs.cpSync(path.join(root, 'apps/web/src'), output, {recursive: true});
fs.mkdirSync(path.join(output, 'data'), {recursive: true});
fs.writeFileSync(path.join(output, 'data', release.archive.file), archiveBytes);
fs.copyFileSync(path.join(root, 'data/sources/places.geojson'), path.join(output, 'data/places.geojson'));
fs.copyFileSync(path.join(root, 'data/sources/transport-stops.geojson'), path.join(output, 'data/transport-stops.geojson'));
fs.cpSync(path.join(root, 'data/imagery/podgorica'), path.join(output, 'data/satellite'), {recursive: true, filter: source => !source.endsWith('.md')});
// Keep old /web/ bookmarks working after moving the deployed app back to /.
fs.mkdirSync(path.join(output, 'web'));
fs.copyFileSync(path.join(root, 'platform/pages/legacy-entry.html'), path.join(output, 'web/index.html'));
fs.copyFileSync(path.join(root, 'platform/pages/legacy-sw.js'), path.join(output, 'web/sw.js'));
fs.writeFileSync(path.join(output, '.nojekyll'), '');
execFileSync(process.execPath, [path.join(root, 'apps/web/tools/finalize.mjs')], {cwd: root, stdio: 'inherit'});
console.log('Built deployable web artifact: dist/web/');
