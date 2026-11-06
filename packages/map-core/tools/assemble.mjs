// Build-time half of the map-core contract: every map application assembles its artifact from these helpers, so each ships
// the runtime, vendored libraries and fonts of the map-core version it depends on. Map data is not core's: each application
// adds its own.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const packageName = '@ivanov-gv/map-core';

// Each artifact carries its own copy of the runtime, under map-core/.
export function copyMapCore(outputDirectory) {
  fs.cpSync(path.join(packageRoot, 'src'), path.join(outputDirectory, 'map-core'), {recursive: true});
}

// Libraries and fonts are local runtime assets, served beside each application's own files.
export function copyRuntimeAssets(outputDirectory) {
  for (const directory of ['vendor', 'fonts']) {
    fs.cpSync(path.join(packageRoot, 'assets', directory), path.join(outputDirectory, directory), {recursive: true});
  }
}

// Browsers cannot resolve a package name and there is no bundler, so a deterministic rewrite keeps the source importable
// in Node while the artifact remains a standalone static directory. It never changes runtime module behavior.
export function relocateCoreImports(source) {
  return source
    .replaceAll(`'${packageName}'`, "'./map-core/index.js'")
    .replaceAll(`'${packageName}/src/`, "'./map-core/");
}

// Replaces outputDirectory with a standalone static artifact of an application without an offline shell.
export function assembleStaticApplication(applicationDirectory, outputDirectory) {
  fs.rmSync(outputDirectory, {recursive: true, force: true});
  fs.cpSync(path.join(applicationDirectory, 'public'), outputDirectory, {recursive: true});
  const sourceDirectory = path.join(applicationDirectory, 'src');
  const modules = fs.readdirSync(sourceDirectory).filter(filename => filename.endsWith('.js'));
  for (const filename of modules) {
    const source = fs.readFileSync(path.join(sourceDirectory, filename), 'utf8');
    fs.writeFileSync(path.join(outputDirectory, filename), relocateCoreImports(source));
  }
  copyMapCore(outputDirectory);
  copyRuntimeAssets(outputDirectory);
}
