import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'data/artifacts');
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'data/sources/provenance.json')));
const previous = fs.existsSync(path.join(dir, 'release.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'release.json'))) : null;
const input = fs.existsSync(path.join(dir, 'montenegro.pmtiles')) ? 'montenegro.pmtiles' : previous?.archive.file ?? fs.readdirSync(dir).find(file => /^montenegro-[a-f0-9]+\.pmtiles$/.test(file));
const bytes = fs.readFileSync(path.join(dir, input));
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
const file = `montenegro-${hash.slice(0, 16)}.pmtiles`;
if (input !== file) fs.renameSync(path.join(dir, input), path.join(dir, file));
fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify({version: 1, sourceTimestamp: provenance.upstream_snapshot,
  coverage: provenance.coverage, archive: {file, sha256: hash, bytes: bytes.length}}, null, 2) + '\n');
console.log('Recorded data release:', file);
