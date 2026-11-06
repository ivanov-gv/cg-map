import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('concept artifact imports only the public core surface and has no product dependencies', () => {
  const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.deepEqual(imports, ['@ivanov-gv/map-core']);
  assert.doesNotMatch(source, /serviceWorker|localStorage|apps\/web|apps\/editor/);
});
