import fs from 'node:fs';

// GitHub Pages branch publishing accepts the repository root or /docs.
fs.rmSync('docs', { recursive: true, force: true });
fs.cpSync('web', 'docs', { recursive: true });
fs.writeFileSync('docs/.nojekyll', '');
console.log('Published web/ to docs/. Commit docs/ and use main /docs in Pages settings.');
