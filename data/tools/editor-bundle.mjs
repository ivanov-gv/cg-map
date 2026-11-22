import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

const contractFilename = 'editor-bundle.schema.json';

// Version 2 is open while the Feature stack merges: later Features add their files to this list before shipping.
export const currentBundleVersion = 2;

// The pinned 0.1.0 contract is flat, while HEAD lists its versions in oneOf. Only HEAD can publish version 2.
function contractVersion(contract) {
  if (!contract.oneOf) {
    return 1;
  }
  const version = contract.oneOf.at(-1)?.properties.version.const;
  if (version !== currentBundleVersion) {
    throw new Error(`Editor bundle: contract has no version ${currentBundleVersion}`);
  }
  return version;
}

const defaultContractLocation = new URL(`../../packages/contracts/${contractFilename}`, import.meta.url);

async function readBundleContract(contractLocation = defaultContractLocation) {
  try {
    return JSON.parse(await readFile(contractLocation, 'utf8'));
  } catch (error) {
    throw new Error(`writeEditorBundle: cannot read ${contractFilename} at ${contractLocation}`, {cause: error});
  }
}

function contractFileSet(contract, version) {
  const branch = contract.oneOf
    ? contract.oneOf.find(entry => entry.properties.version.const === version)
    : contract;
  if (!branch) {
    throw new Error(`Editor bundle: contract has no version ${version}`);
  }
  return branch.properties.layers.items.properties.filename.enum;
}

// A source file without an editing mode must fail here, not later in the browser.
function assertContractFileSet(sourceFiles, contractFiles) {
  const isContractFileSet = JSON.stringify(sourceFiles) === JSON.stringify([...contractFiles].sort());
  if (!isContractFileSet) {
    throw new Error(
      `Editor bundle: sources must be exactly ${contractFiles.join(', ')}; found ${sourceFiles.join(', ')}`
    );
  }
}

// Bundle the reviewed source snapshot; no geography is regenerated and sources are never modified.
// Hashes bind array-index identities to exactly this revision rather than pretending they are stable IDs. A consumer
// loading this tool from the published data package passes its own contract path, which is not part of that package.
export async function writeEditorBundle(sourceDirectory, outputDirectory, contractLocation) {
  const contract = await readBundleContract(contractLocation);
  const version = contractVersion(contract);
  const directoryEntries = await readdir(sourceDirectory);
  const sourceFiles = directoryEntries.filter(name => name.endsWith('.geojson')).sort();
  assertContractFileSet(sourceFiles, contractFileSet(contract, version));
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
  const manifest = {version, layers};
  await writeFile(path.join(outputDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
