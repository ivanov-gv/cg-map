import fs from 'node:fs';
fs.rmSync('dist', {recursive: true, force: true});
fs.cpSync('web', 'dist', {recursive: true, filter: source => !source.endsWith('.md')});
fs.writeFileSync('dist/.nojekyll', '');
console.log('Prepared standalone application in dist/.');
