import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const readText = relativePath => fs.readFileSync(`${repositoryRoot}${relativePath}`, 'utf8');

test('the chooser links relatively to exactly the apps on the dev site', () => {
  const links = [...readText('platform/pages/index.html').matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(links.toSorted(), ['core-demo/', 'editor/', 'web/']);
});

// A manifest id resolves against the origin, and all apps share one on Pages. Equal ids would make them the same app to a
// browser, so installing one could be treated as installing the other. Without an id, each takes its own start URL.
for (const application of ['apps/web', 'apps/editor']) {
  test(`${application} is its own installable app, wherever it is served`, () => {
    const manifest = JSON.parse(readText(`${application}/public/manifest.webmanifest`));
    assert.equal(manifest.id, undefined);
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
  });
}
