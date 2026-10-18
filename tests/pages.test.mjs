import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {publishPages} from '../tools/publish-pages.mjs';
test('root publishing preserves docs, removes obsolete managed assets, and detects drift', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-pages-'));
  try {
    fs.mkdirSync(path.join(root, 'web/data'), {recursive: true});
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(path.join(root, 'docs/guide.md'), 'keep');
    fs.writeFileSync(path.join(root, 'web/AGENTS.md'), 'instructions');
    fs.writeFileSync(path.join(root, 'web/index.html'), 'map');
    fs.writeFileSync(path.join(root, 'web/data/old.pmtiles'), 'old');
    publishPages(root); publishPages(root, {check: true});
    assert.equal(fs.readFileSync(path.join(root, 'docs/guide.md'), 'utf8'), 'keep');
    assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
    fs.unlinkSync(path.join(root, 'web/data/old.pmtiles'));
    publishPages(root);
    assert.equal(fs.existsSync(path.join(root, 'data/old.pmtiles')), false);
    fs.writeFileSync(path.join(root, 'index.html'), 'drift');
    assert.throws(() => publishPages(root, {check: true}), /differs/);
    fs.writeFileSync(path.join(root, '.pages-manifest.json'), JSON.stringify({files: ['docs/guide.md']}));
    assert.throws(() => publishPages(root), /unmanaged/);
    assert.equal(fs.readFileSync(path.join(root, 'docs/guide.md'), 'utf8'), 'keep');
  } finally {fs.rmSync(root, {recursive: true, force: true});}
});
