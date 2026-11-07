import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {reachableFiles, unreachableInstructions} from '../tools/instruction-reach.mjs';

// A throwaway repository: path -> Markdown text.
function repository(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'instruction-reach-'));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

test('files linked from the root, directly or through other Markdown, are reachable', () => {
  const root = repository({
    'AGENTS.md': '[web](apps/web/AGENTS.md) and [docs](docs/)',
    'apps/web/AGENTS.md': '[guide](../../docs/guide.md)',
    'docs/AGENTS.md': 'Docs rules.',
    'docs/guide.md': 'Guide.'
  });
  try {
    const reached = reachableFiles(root);
    for (const file of ['AGENTS.md', 'apps/web/AGENTS.md', 'docs/AGENTS.md', 'docs/guide.md']) {
      assert.ok(reached.has(file), file);
    }
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('an instruction file nothing links to is reported, and external links are ignored', () => {
  const root = repository({
    'AGENTS.md': '[site](https://example.org/AGENTS.md) and [template](.github/pull_request_template.md)',
    '.github/pull_request_template.md': '# Change',
    'services/api/AGENTS.md': 'Never read.'
  });
  try {
    const instructions = ['AGENTS.md', '.github/pull_request_template.md', 'services/api/AGENTS.md'];
    assert.deepEqual(unreachableInstructions(root, instructions), ['services/api/AGENTS.md']);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
