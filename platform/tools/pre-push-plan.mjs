#!/usr/bin/env node
// Runs the checks CI's planner selects for the refs git sends to a pre-push hook.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FOLDERS, PROJECT_PIPELINES} from './ci-plan.mjs';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const plannerPath = path.join(toolRoot, 'platform/tools/ci-plan.mjs');
const zeroSha = /^0+$/;
const folderProjects = Object.fromEntries(
  Object.entries(PROJECT_PIPELINES).map(([project, folder]) => [folder, project])
);
// CI's workflows and browser image have folders but no component of their own; platform owns their local checks.
const localProjects = {...folderProjects, docs: 'docs', workflows: 'platform', 'browser-image': 'platform'};

function pushedRefs(input) {
  const refs = input
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const fields = line.split(/\s+/);
      if (fields.length !== 4) throw new Error(`malformed pre-push input: ${line}`);
      const [localRef, localSha, remoteRef, remoteSha] = fields;
      return {localRef, localSha, remoteRef, remoteSha};
    });
  if (refs.length === 0) throw new Error('no pre-push refs');
  return refs;
}

function hasCommit(revision) {
  const result = spawnSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], {
    cwd: process.cwd(),
    stdio: 'ignore'
  });
  return result.status === 0;
}

function readSelectedFolders(outputFile) {
  const selected = fs
    .readFileSync(outputFile, 'utf8')
    .split('\n')
    .filter(line => line.endsWith('=true'))
    .map(line => line.slice(0, -'=true'.length))
    .filter(folder => FOLDERS.includes(folder));
  if (selected.length === 0) throw new Error('planner produced no folders');
  return selected;
}

function planFromPlanner(base, head) {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-pre-push-'));
  try {
    const outputFile = path.join(outputDirectory, 'outputs');
    const env = {...process.env};
    delete env.GITHUB_OUTPUT;
    delete env.GITHUB_STEP_SUMMARY;
    env.GITHUB_OUTPUT = outputFile;
    const result = spawnSync(process.execPath, [plannerPath, '--base', base, '--head', head], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8'
    });
    const warning = (result.stdout ?? '').split('\n').find(line => line.startsWith('::warning::'));
    if (result.error || result.status !== 0) {
      const detail = result.error?.message ?? result.stderr?.trim() ?? `status ${result.status}`;
      throw new Error(`planner failed for ${base}...${head}: ${detail}`);
    }
    if (warning) throw new Error(warning.replace(/^::warning::/, ''));
    return readSelectedFolders(outputFile);
  } finally {
    fs.rmSync(outputDirectory, {recursive: true, force: true});
  }
}

function verifyCommands(folders) {
  const projects = new Set();
  for (const folder of FOLDERS) {
    // Backend needs Go, so it stays outside make check as it was before this hook.
    if (folder === 'backend' || !folders.has(folder)) continue;
    const project = localProjects[folder];
    if (!project) throw new Error(`no local verify path for ${folder}`);
    projects.add(project);
  }
  return [...projects].map(project => ['verify', `PKG=${project}`]);
}

function planPushedRefs(refs) {
  const folders = new Set();
  for (const ref of refs) {
    if (zeroSha.test(ref.localSha)) continue;
    const base = zeroSha.test(ref.remoteSha) ? 'origin/main' : ref.remoteSha;
    if (!hasCommit(base)) throw new Error(`${ref.localRef}: diff base ${base} is not a commit`);
    if (!hasCommit(ref.localSha)) throw new Error(`${ref.localRef}: local sha ${ref.localSha} is not a commit`);
    for (const folder of planFromPlanner(base, ref.localSha)) folders.add(folder);
  }
  return {commands: verifyCommands(folders), backend: folders.has('backend')};
}

function runMake(argumentsList) {
  console.error(`pre-push: make ${argumentsList.join(' ')}`);
  const result = spawnSync('make', ['--no-print-directory', ...argumentsList], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
  if (result.error) {
    console.error(`pre-push: could not run make: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function runBackendChecks() {
  const go = spawnSync('go', ['version'], {stdio: 'ignore'});
  if (go.status === 0) return runMake(['check-go']);
  console.error('pre-push: go not installed; CI will run backend checks');
  return 0;
}

function main() {
  let plan;
  try {
    plan = planPushedRefs(pushedRefs(fs.readFileSync(0, 'utf8')));
  } catch (error) {
    // Without a trusted diff the old hook also ran Go checks; keep that safety net.
    plan = {commands: [['check']], backend: true, reason: error.message};
  }
  if (plan.reason) console.error(`pre-push: ${plan.reason}; running make check`);
  if (!plan.reason) {
    const selected = [
      ...plan.commands.map(command => command.join(' ')),
      ...(plan.backend ? ['check-go'] : [])
    ];
    if (selected.length === 0) {
      console.error('pre-push: deleted refs only; no checks');
      return 0;
    }
    console.error(`pre-push: selected ${selected.join(', ')}`);
  }
  for (const command of plan.commands) {
    const status = runMake(command);
    if (status !== 0) return status;
  }
  if (plan.backend) return runBackendChecks();
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
