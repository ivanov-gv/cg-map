#!/usr/bin/env node
// Lints staged JavaScript with the config that owns each file.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const configFileName = 'eslint.config.mjs';
const rootFolder = '.';

// A project is the first two segments under a two-level group, or the named single-level service. Other files, including
// those in a project without its own config, stay with the repository root.
export function projectFolder(file) {
  const segments = file.split('/');
  const isTwoLevelGroup = (segments[0] === 'apps' || segments[0] === 'packages') && segments.length > 2;
  if (isTwoLevelGroup) return segments.slice(0, 2).join('/');
  if (segments[0] === 'services' && segments[1] === 'transit-relay') return 'services/transit-relay';
  if (['data', 'platform', 'tests'].includes(segments[0])) return segments[0];
  return rootFolder;
}

function configPath(project) {
  return project === rootFolder ? configFileName : `${project}/${configFileName}`;
}

// Files in a project without a config keep their repository paths, because ESLint finds the root config from there.
export function lintGroups(files, configExists = file => fs.existsSync(file)) {
  const groups = new Map();
  for (const file of files) {
    const project = projectFolder(file);
    const hasOwnConfig = configExists(configPath(project));
    const folder = hasOwnConfig ? project : rootFolder;
    const group = groups.get(folder) ?? {cwd: folder, files: []};
    const isInsideProject = hasOwnConfig && project !== rootFolder;
    group.files.push(isInsideProject ? file.slice(`${project}/`.length) : file);
    groups.set(folder, group);
  }
  return [...groups.values()];
}

// Returns the first nonzero runEslint status and stops there, or 0 when every group passes. configExists decides which
// config owns each file; runEslint receives that config's folder and paths relative to it.
export function lintStaged(files, runEslint, configExists) {
  for (const group of lintGroups(files, configExists)) {
    const status = runEslint(group.cwd, group.files);
    if (status !== 0) return status || 1;
  }
  return 0;
}

function runEslintFromProject(cwd, files) {
  const result = spawnSync('npx', ['--no-install', 'eslint', '--no-warn-ignored', ...files], {cwd, stdio: 'inherit'});
  return result.status;
}

if (process.argv[1]?.endsWith('staged-lint.mjs'))
  process.exitCode = lintStaged(process.argv.slice(2), runEslintFromProject);
