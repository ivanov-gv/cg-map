import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

const contractURL = new URL('../../packages/contracts/editor-bundle.schema.json', import.meta.url);

// A source file without an editing mode must fail here, not later in the browser.
async function assertContractFileSet(sourceFiles) {
  const contract = JSON.parse(await readFile(contractURL));
  const contractFiles = contract.properties.layers.items.properties.filename.enum;
  const isContractFileSet = JSON.stringify(sourceFiles) === JSON.stringify([...contractFiles].sort());
  if (!isContractFileSet) {
    throw new Error(
      `Editor bundle: sources must be exactly ${contractFiles.join(', ')}; found ${sourceFiles.join(', ')}`
    );
  }
}

// Bundle the reviewed source snapshot; no geography is regenerated and sources are never modified.
// Hashes bind array-index identities to exactly this revision rather than pretending they are stable IDs.
export async function writeEditorBundle(sourceDirectory, outputDirectory) {
  const directoryEntries = await readdir(sourceDirectory);
  const sourceFiles = directoryEntries.filter(name => name.endsWith('.geojson')).sort();
  await assertContractFileSet(sourceFiles);
  const layers = [];
  await mkdir(outputDirectory, {recursive: true});
  for (const filename of sourceFiles) {
    const bytes = await readFile(path.join(sourceDirectory, filename));
    const collection = JSON.parse(bytes);
    if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
      throw new Error(`Editor bundle: ${filename} is not a FeatureCollection`);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    layers.push({filename, sha256, bytes: bytes.length, featureCount: collection.features.length});
    await writeFile(path.join(outputDirectory, filename), bytes);
  }
  const manifest = {version: 1, layers};
  await writeFile(path.join(outputDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
