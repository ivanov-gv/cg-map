import fs from 'node:fs';
fs.rmSync('dist',{recursive:true,force:true});
fs.cpSync('web','dist',{recursive:true});
console.log('Copied portable web assets to dist for the optional hosted demo.');
