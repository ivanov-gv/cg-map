// Assembles dist/editor from this app's own files, the map-core build contract and the data-owned source bundle.
import fileSystem from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolveContractsRoot} from './contracts-root.mjs';
import {importCoreModule, resolveCoreRoot} from './core-root.mjs';
import {writeOfflineManifest} from './offline-manifest.mjs';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const outputDirectory = fileURLToPath(new URL('../../../dist/editor/', import.meta.url));
// A build that is not a release takes core, data and contracts from its own commit. Test targets and a release use the
// pins this app declares; EDITOR_RELEASE marks the release invocation so another core cannot be substituted.
function resolveDataRoot(defaultRoot) {
  if ('MAP_DATA_ROOT' in process.env && !process.env.MAP_DATA_ROOT) {
    throw new Error('MAP_DATA_ROOT is set but empty; test targets must resolve the pinned @ivanov-gv/map-data package');
  }
  return process.env.MAP_DATA_ROOT ? path.resolve(process.env.MAP_DATA_ROOT) : defaultRoot;
}

const dataRoot = resolveDataRoot(path.join(repositoryRoot, 'data'));
const contractsRoot = resolveContractsRoot();
const releaseBuild = process.env.EDITOR_RELEASE === '1';
const coreRoot = resolveCoreRoot({release: releaseBuild});
const {copyMapCore, copyRuntimeAssets} = await importCoreModule('tools/assemble.mjs', coreRoot);
const dataToolsURL = pathToFileURL(path.join(dataRoot, 'tools/app-data.mjs')).href;
const editorBundleURL = pathToFileURL(path.join(dataRoot, 'tools/editor-bundle.mjs')).href;
const {copyMapData, readVerifiedRelease} = await import(dataToolsURL);
const {writeEditorBundle} = await import(editorBundleURL);
const applicationDirectory = fileURLToPath(new URL('..', import.meta.url));

// map-core's relocateCoreImports only rewrites depth-0 files; the editor keeps src/ folders in the artifact, so each
// file needs a prefix that matches its depth.
function relocateCoreImportsForFile(source, filePath) {
  const depth = filePath.split(path.sep).length - 1;
  const prefix = depth === 0 ? './map-core/' : `${'../'.repeat(depth)}map-core/`;
  return source
    .replaceAll("'@ivanov-gv/map-core'", `'${prefix}index.js'`)
    .replaceAll("'@ivanov-gv/map-core/src/", `'${prefix}`);
}

function isTestFile(filename) {
  return filename.endsWith('.test.js');
}

// The editor has its own assembly because src/ folders are served as they are and test files must stay out of the artifact.
function assembleEditor(applicationDirectory, outputDirectory) {
  fileSystem.rmSync(outputDirectory, {recursive: true, force: true});
  fileSystem.cpSync(path.join(applicationDirectory, 'public'), outputDirectory, {recursive: true});
  const sourceDirectory = path.join(applicationDirectory, 'src');
  fileSystem.cpSync(sourceDirectory, outputDirectory, {
    recursive: true,
    filter: sourcePath => !isTestFile(path.basename(sourcePath))
  });
  const sourceFiles = fileSystem
    .readdirSync(outputDirectory, {recursive: true, withFileTypes: true})
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => path.join(entry.parentPath, entry.name));
  for (const filePath of sourceFiles) {
    const relativePath = path.relative(outputDirectory, filePath);
    const source = fileSystem.readFileSync(filePath, 'utf8');
    fileSystem.writeFileSync(filePath, relocateCoreImportsForFile(source, relativePath));
  }
  copyMapCore(outputDirectory);
  copyRuntimeAssets(outputDirectory);
}

assembleEditor(applicationDirectory, outputDirectory);
copyMapData(outputDirectory, {
  dataRoot,
  contractPath: path.join(contractsRoot, 'place-visibility.json')
});
await writeEditorBundle(
  path.join(dataRoot, 'sources'),
  path.join(outputDirectory, 'sources'),
  path.join(contractsRoot, 'editor-bundle.schema.json')
);
// The editing rules are a shared contract: the importer reads the same file.
fileSystem.copyFileSync(
  path.join(contractsRoot, 'editor-layers.json'),
  path.join(outputDirectory, 'data/editor-layers.json')
);
// Last, because the manifest hashes every other file in the artifact.
const {release} = readVerifiedRelease(dataRoot);
const offlineRelease = writeOfflineManifest(outputDirectory, `data/${release.archive.file}`);
console.log(`Built dist/editor/ (release ${offlineRelease}; core from ${coreRoot})`);
