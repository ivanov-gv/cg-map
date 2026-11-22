// Packaged data tools read shared contracts from a directory supplied by their caller. The published data package does
// not contain contracts: consumers resolve @ivanov-gv/map-contracts, while data validation passes the repository HEAD.
import fs from 'node:fs';
import path from 'node:path';

export function contractPath(contractsDirectory, filename) {
  if (!contractsDirectory)
    throw new Error(`A contracts directory is required to read ${filename}; pass it from the caller`);
  return path.join(contractsDirectory, filename);
}

export function readContract(contractsDirectory, filename) {
  return JSON.parse(fs.readFileSync(contractPath(contractsDirectory, filename), 'utf8'));
}

// Command-line tools fail before reading any data when the caller omits the shared contracts.
export function contractsDirectoryFrom(argv, command) {
  const option = '--contracts-directory';
  const optionIndex = argv.indexOf(option);
  if (optionIndex < 0 || !argv[optionIndex + 1])
    throw new Error(`Usage: ${command} ${option} <directory>`);
  return argv[optionIndex + 1];
}
