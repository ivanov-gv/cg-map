import fileSystem from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {discoverShellAssets, assertShellIncludesModules} from './offline-shell.mjs';
import {findRuntimeModules} from './runtime-modules.mjs';
import {resolveDataRoot} from './data-root.mjs';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outputDirectory = path.join(repositoryRoot, 'dist/web');
const isCheck = process.argv.includes('--check');
// The manifest describes the data the build used. Test targets pin this root to the same package as the build.
const releaseBuild = process.env.WEB_RELEASE === '1';
const dataRoot = resolveDataRoot(path.join(repositoryRoot, 'data'), {release: releaseBuild});
const provenance = JSON.parse(
  fileSystem.readFileSync(path.join(dataRoot, 'sources/provenance.json'), 'utf8')
);
const webPackage = JSON.parse(
  fileSystem.readFileSync(path.join(repositoryRoot, 'apps/web/package.json'), 'utf8')
);
const webManifest = JSON.parse(
  fileSystem.readFileSync(path.join(repositoryRoot, 'apps/web/public/manifest.webmanifest'), 'utf8')
);

// The footer shows the commit that produced the artifact. Git is authoritative for a checkout; GITHUB_SHA covers
// builds from a source tree without .git. A missing commit is rendered as version-only, never as a placeholder.
function shortBuildCommit() {
  let commit;
  try {
    commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    commit = process.env.GITHUB_SHA ?? '';
  }
  return /^[0-9a-f]{7,40}$/.test(commit) ? commit.slice(0, 7) : null;
}

const build = {
  name: webManifest.short_name,
  version: webPackage.version,
  commit: shortBuildCommit()
};
const sha256Hex = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let archivePath = path.join(outputDirectory, 'data/montenegro.pmtiles');
if (!fileSystem.existsSync(archivePath)) {
  archivePath = fileSystem
    .readdirSync(path.join(outputDirectory, 'data'))
    .filter(filePath => /^montenegro-[a-f0-9]+\.pmtiles$/.test(filePath))
    .map(filePath => path.join(outputDirectory, 'data', filePath))[0];
}
const archiveBytes = fileSystem.readFileSync(archivePath);
const archiveHash = sha256Hex(archiveBytes);
const archiveName = 'data/montenegro-' + archiveHash.slice(0, 16) + '.pmtiles';
if (isCheck && path.resolve(archivePath) !== path.join(outputDirectory, archiveName))
  throw new Error('Archive filename is stale. Run npm run release:prepare.');
if (!isCheck && path.resolve(archivePath) !== path.join(outputDirectory, archiveName))
  fileSystem.renameSync(archivePath, path.join(outputDirectory, archiveName));
for (const name of fileSystem.readdirSync(path.join(outputDirectory, 'data')))
  if (!isCheck && name.endsWith('.pmtiles') && 'data/' + name !== archiveName)
    fileSystem.unlinkSync(path.join(outputDirectory, 'data', name));
const shell = discoverShellAssets(outputDirectory);
assertShellIncludesModules(findRuntimeModules(path.join(repositoryRoot, 'apps/web/src')), shell);
const shellHash = sha256Hex(
  Buffer.concat(
    [...shell, 'sw.js'].map(filename => fileSystem.readFileSync(path.join(outputDirectory, filename)))
  )
).slice(0, 16);
const manifest = {
  version: build.version,
  build,
  sourceTimestamp: provenance.upstream_snapshot,
  coverage: provenance.coverage,
  archive: {path: archiveName, sha256: archiveHash, bytes: archiveBytes.length},
  shellCache: 'kompas-shell-' + shellHash + '-' + archiveHash.slice(0, 8),
  shell: [...shell, 'data/manifest.json'],
  totalBytes:
    archiveBytes.length +
    shell.reduce(
      (totalBytes, filename) => totalBytes + fileSystem.statSync(path.join(outputDirectory, filename)).size,
      0
    )
};
const outputs = {
  'data/manifest.json': JSON.stringify(manifest, null, 2),
  'offline-manifest.js':
    'self.KOMPAS_OFFLINE=' + JSON.stringify({shellCache: manifest.shellCache, shell: manifest.shell}) + ';\n'
};
for (const [name, content] of Object.entries(outputs)) {
  if (isCheck) {
    if (fileSystem.readFileSync(path.join(outputDirectory, name), 'utf8') !== content)
      throw new Error(`${name} is stale. Run npm run release:prepare.`);
  } else fileSystem.writeFileSync(path.join(outputDirectory, name), content);
}
console.log(
  isCheck ? 'Offline manifests verified.' : 'Offline manifests regenerated.',
  'Archive:',
  archiveName,
  'bytes:',
  archiveBytes.length,
  'shell assets:',
  manifest.shell.length
);
