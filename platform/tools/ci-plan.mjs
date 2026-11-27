#!/usr/bin/env node
// Decides which folder pipelines a change needs. Anything it cannot classify runs everything.
// Local use: make ci-plan BASE=origin/main. CI use: .github/TESTING.md.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {formatWorkflowTestRuns, selectWorkflowTestRuns} from './workflow-test-runs.mjs';

export const FOLDERS = [
  'docs',
  'workflows',
  'platform',
  'contracts',
  'browser-image',
  'data',
  'backend',
  'transit-relay',
  'tests',
  'map-core',
  'apps-web',
  'apps-editor',
  'apps-core-demo'
];

// CI folders mirror the root Makefile's PROJECTS: apps keep their group prefix, other projects use their last folder.
// Lint config discovery uses this map, so the planner never needs a second list of projects that lint.
const makeProjects = fs
  .readFileSync(new URL('../../Makefile', import.meta.url), 'utf8')
  .match(/^PROJECTS := (.+)$/m)[1]
  .split(' ');
const appsFolderPrefix = 'apps/';
export const PROJECT_PIPELINES = Object.fromEntries(
  makeProjects.map(project => [
    project,
    project.startsWith(appsFolderPrefix)
      ? `apps-${project.slice(appsFolderPrefix.length)}`
      : project.split('/').pop()
  ])
);

const EVERYTHING = {folders: FOLDERS};
// CI calls the root Makefile only through `make verify PKG=<path>` in these folder pipelines and `make check-docs` in
// ci-docs; the lint-workflows and act test targets live in workflows too. Browser jobs, the backend and the browser image
// call their own project Makefiles, so they need no special entry here.
const ROOT_MAKEFILE_FOLDERS = [
  'docs',
  'workflows',
  'platform',
  'contracts',
  'data',
  'transit-relay',
  'tests',
  'map-core',
  'apps-web',
  'apps-editor',
  'apps-core-demo'
];
// Platform still checks web files: check:repo (allowed imports, dynamic-import ban, gesture guard), build-web and
// hosting tests, package pins, Makefiles and dev-site tests. Issue #456 moves those checks out of platform.
const WEB_DEPENDENTS = ['apps-web', 'tests', 'platform'];
// Every map application consumes the map-core runtime: that is their concrete contract.
const MAP_APPLICATIONS = ['apps-web', 'apps-editor', 'apps-core-demo'];
// App and platform tests pin a published map-data release. HEAD data reaches only the cross-project integration tests.
const HEAD_DATA_CONSUMERS = ['tests'];
const SHARED_ESLINT_RULES = 'platform/eslint-rules.mjs';
const ESLINT_CONFIG_NAME = 'eslint.config.mjs';
const LOCKFILE = 'package-lock.json';
// Returns config paths for known projects that have one under root. A missing config leaves that project on the root
// file and outside the shared-rule consumers; tests use scratch fixtures, not the current checkout's config set.
export function discoveredLintConfigs(root = process.cwd()) {
  return Object.keys(PROJECT_PIPELINES)
    .map(project => `${project}/${ESLINT_CONFIG_NAME}`)
    .filter(file => fs.existsSync(path.join(root, file)));
}
function configPipeline(file, lintConfigs) {
  if (!file.endsWith(`/${ESLINT_CONFIG_NAME}`)) return '';
  const project = file.slice(0, -`/${ESLINT_CONFIG_NAME}`.length);
  return lintConfigs.includes(file) ? PROJECT_PIPELINES[project] ?? '' : '';
}

// Shared rules select only projects whose config exists in this checkout. An app without a config still uses the root
// file, so it is not a consumer here; once an app owns a config, its folder joins and its workflow runs its browser suite.
function toolingPlan(consumers) {
  const selected = new Set(consumers);
  return {folders: FOLDERS.filter(folder => selected.has(folder))};
}

// Returns the folders one changed path needs. Each app owns its whole browser suite in its workflow, so selecting its
// folder is enough to run it.
export function classify(file, lintConfigFiles = discoveredLintConfigs()) {
  if (file === SHARED_ESLINT_RULES)
    return toolingPlan(lintConfigFiles.map(config => configPipeline(config, lintConfigFiles)));
  const pipeline = configPipeline(file, lintConfigFiles);
  if (pipeline) return {folders: [pipeline]};
  const isPublishedFile = /^apps\/[^/]+\/public\//.test(file);
  const isMarkdown = file.endsWith('.md') && !isPublishedFile;
  if (isMarkdown || file.startsWith('docs/') || file.startsWith('.markdownlint') || file === '.prettierrc.json')
    return {folders: ['docs']};
  if (file.startsWith('.github/') || /^platform\/(tools|tests)\/(ci-plan|workflow-test-runs)\./.test(file))
    return {folders: ['workflows', 'platform']};
  if (file === 'Makefile') return {folders: ROOT_MAKEFILE_FOLDERS};
  if (file.startsWith('.claude/') || file.startsWith('.codex/')) return {folders: ['platform']};

  if (/^services\/backend\/(.*\.go|go\.mod|go\.sum)$/.test(file)) return {folders: ['backend']};
  if (file.startsWith('services/backend/')) return {folders: ['backend', 'platform']};
  if (file.startsWith('services/transit-relay/'))
    return {folders: ['transit-relay', ...(file.endsWith('Makefile') ? ['platform'] : [])]};
  if (file.startsWith('tests/'))
    return {folders: ['tests', ...(file.endsWith('Makefile') ? ['platform'] : [])]};

  if (file === 'data/tools/editor-bundle.mjs') return {folders: ['data', 'tests']};
  // tests/integration proves that whatever the editor exports, this importer accepts.
  const isImporterSource =
    ['apply-changeset.mjs', 'check-data.mjs', 'apply-place-visibility.mjs'].some(tool => file === `data/tools/${tool}`) ||
    /^data\/tools\/changeset-[a-z-]+\.mjs$/.test(file);
  if (isImporterSource) {
    return {folders: ['data', 'tests']};
  }
  // Web browser tests read this fixture from the pinned package, so it belongs to data's own pipeline.
  if (file.startsWith('data/tests/fixtures/')) return {folders: ['data']};
  // Dev builds use this tool and the data project files at HEAD, but app tests pin the published package instead.
  if (file === 'data/tools/app-data.mjs' || file === 'data/Makefile' || file === 'data/package.json')
    return {folders: ['data', ...HEAD_DATA_CONSUMERS]};
  if (/^data\/(tools|tests)\//.test(file)) return {folders: ['data']};
  if (/^data\/(sources|artifacts|imagery)\//.test(file))
    return {folders: ['data', ...HEAD_DATA_CONSUMERS]};

  // A contract change at HEAD is seen by data validation and tests/; published consumers pin a release instead.
  if (file.startsWith('packages/contracts/')) return {folders: ['contracts', 'data', 'tests', 'platform']};
  // Only core-demo runs unreleased core. web and editor pin a release, so a core change cannot affect them.
  if (file.startsWith('packages/map-core/')) return {folders: ['map-core', 'apps-core-demo', 'platform']};
  // A web change selects the app, its cross-project consumer and platform's checks of web files. The app owns its shards.
  if (file.startsWith('apps/web/')) return {folders: WEB_DEPENDENTS};
  const platformFolders = /(^|\/)(Makefile|package\.json)$/.test(file) ? ['platform'] : [];
  // Any editor change runs the app's whole browser suite; the app owns its shard count and specs.
  if (file.startsWith('apps/editor/')) return {folders: ['apps-editor', 'tests', ...platformFolders]};
  if (file.startsWith('apps/core-demo/')) return {folders: ['apps-core-demo', ...platformFolders]};

  if (file === 'platform/tools/serve.py' || file === 'platform/tools/dev-port.mjs')
    return {folders: ['platform', ...MAP_APPLICATIONS]};
  // Only the editor's LAN install uses it.
  if (file === 'platform/tools/lan_certificate.py') return {folders: ['platform', 'apps-editor']};
  // The platform tag check and both apps' own unit tests read this tool; no runtime app imports it.
  if (file === 'platform/tools/phone-tags.mjs') return {folders: ['platform', 'apps-web', 'apps-editor']};
  if (file.startsWith('platform/browser-image/')) return {folders: ['browser-image', 'platform']};
  if (file.startsWith('platform/')) return {folders: ['platform']};

  // The root eslint.config.mjs still governs every app, so a change to it keeps the whole-plan selection until the
  // app-owned configs land. Narrowing it now would hide lint checks the apps still run.
  return EVERYTHING;
}

// Returns the pipeline of the workspace that owns a lockfile entry, or '' when no project owns it.
function workspacePipeline(lockfileEntry) {
  const workspace = Object.keys(PROJECT_PIPELINES)
    .filter(project => lockfileEntry === project || lockfileEntry.startsWith(`${project}/`))
    .sort((left, right) => right.length - left.length)[0];
  return workspace ? PROJECT_PIPELINES[workspace] : '';
}

// Fail-safe result: the reason reaches the summary and the optional error reaches the action log.
function everythingPlan(reason, error = '') {
  return {folders: FOLDERS, everything: true, reason, error};
}

// Compares the two committed lockfiles and returns the projects whose `packages` entries differ. Shared or unknown
// entries, and unreadable or unparsable files, select everything because they can affect any project.
function planLockfileChanges(base, head) {
  const packagesByRevision = {};
  for (const [name, revision] of [
    ['base', base],
    ['head', head]
  ]) {
    let source;
    try {
      source = execFileSync('git', ['show', `${revision}:${LOCKFILE}`], {encoding: 'utf8'});
    } catch (error) {
      return everythingPlan('lockfile read failed', `Could not read ${name} lockfile at ${revision}: ${error.message}`);
    }
    try {
      const packages = JSON.parse(source).packages;
      if (!packages || typeof packages !== 'object' || Array.isArray(packages)) throw new Error('no packages map');
      packagesByRevision[name] = packages;
    } catch (error) {
      return everythingPlan('lockfile parse failed', `Could not parse ${name} lockfile: ${error.message}`);
    }
  }

  const entries = new Set([...Object.keys(packagesByRevision.base), ...Object.keys(packagesByRevision.head)]);
  const folders = new Set();
  for (const entry of entries) {
    const isUnchanged = JSON.stringify(packagesByRevision.base[entry]) === JSON.stringify(packagesByRevision.head[entry]);
    if (isUnchanged) continue;
    if (entry === '' || entry.startsWith('node_modules/')) return everythingPlan('shared lockfile entry');
    const pipeline = workspacePipeline(entry);
    if (!pipeline) return everythingPlan('unmapped lockfile entry', `Unknown lockfile entry ${entry}`);
    folders.add(pipeline);
  }
  return {folders: FOLDERS.filter(folder => folders.has(folder)), everything: false, reason: '', error: ''};
}

// An empty list means the diff could not be trusted, so it selects everything too.
export function planChanges(files, options = {}) {
  if (files.length === 0) return {...EVERYTHING, everything: true};
  const lintConfigFiles = options.lintConfigFiles ?? discoveredLintConfigs();
  // The lockfile needs git, so callers pass its compared folders; without them the default still selects everything.
  const lockfileFolders = files.includes(LOCKFILE) ? options.lockfileFolders : undefined;
  const results = files
    .filter(file => file !== LOCKFILE || lockfileFolders === undefined)
    .map(file => classify(file, lintConfigFiles));
  if (lockfileFolders !== undefined) results.push({folders: lockfileFolders});
  const folders = FOLDERS.filter(folder => results.some(result => result.folders.includes(folder)));
  return {folders, everything: folders.length === FOLDERS.length};
}

// A change to an app, or to what it is built from, publishes that app's image.
export function imageMatrix(folders) {
  const apps = MAP_APPLICATIONS.filter(folder => folders.includes(folder));
  return {include: apps.map(folder => ({app: folder.replace('apps-', '')}))};
}

// A changed folder workflow already has a regular call whose folder the diff selected, so that call runs in test-run
// mode instead of adding a second call. Workflows without a folder call, such as ci-publish, keep a separate one.
function partitionCiTestRuns(ciWorkflows, folders) {
  const inPlace = ciWorkflows.filter(workflow => {
    const folder = workflow.replace(/^ci-/, '').replace(/\.yml$/, '');
    return FOLDERS.includes(folder) && folders.includes(folder);
  });
  return {inPlace, separate: ciWorkflows.filter(workflow => !inPlace.includes(workflow))};
}

// Both the job outputs and the human summary use this one decision, so they cannot report different calls.
function testRunCallsFor(folders, changedFiles) {
  const testRuns = selectWorkflowTestRuns(changedFiles);
  const {inPlace, separate} = partitionCiTestRuns(testRuns.ci, folders);
  // The dispatcher would skip an in-place workflows change with no CD changes. Its empty-list path can prove the job.
  const proveCdTestRuns = inPlace.includes('ci-workflows.yml') && testRuns.cd.length === 0;
  return {testRuns, inPlace, separate, proveCdTestRuns};
}

export function formatOutputs({folders}, changedFiles = []) {
  const folderLines = FOLDERS.map(folder => `${folder}=${folders.includes(folder)}`);
  const {testRuns, inPlace, separate, proveCdTestRuns} = testRunCallsFor(folders, changedFiles);
  return [
    ...folderLines,
    `image_matrix=${JSON.stringify(imageMatrix(folders))}`,
    `ci_in_place_test_runs=${JSON.stringify(inPlace)}`,
    `ci_test_runs=${JSON.stringify(separate)}`,
    `cd_test_runs=${JSON.stringify(testRuns.cd)}`,
    `prove_cd_test_runs=${proveCdTestRuns}`,
    `manual_test_runs=${JSON.stringify(testRuns.manual)}`
  ].join('\n');
}

export function formatSummary({folders, everything}, reason, changedFiles = []) {
  const {testRuns, inPlace, separate, proveCdTestRuns} = testRunCallsFor(folders, changedFiles);
  // formatWorkflowTestRuns still owns the CD and manual lines. Drop its unsplit CI line in favor of the split pair.
  const dispatchLines = formatWorkflowTestRuns({...testRuns, ci: []}).split('\n').slice(1);
  return [
    `Selected ${everything ? 'everything' : 'a subset of pipelines'}${reason ? ` (${reason})` : ''}.`,
    `- Folders: ${folders.join(', ') || 'none'}`,
    `- CI test-run calls (separate): ${separate.join(', ') || 'none'}`,
    `- CI test runs in place: ${inPlace.join(', ') || 'none'}`,
    ...(proveCdTestRuns ? ['- CD proof flag: true'] : []),
    ...dispatchLines
  ].join('\n');
}

function listChangedFiles(base, head) {
  // --no-renames lists both sides of a rename, so both folders are checked.
  const diff = execFileSync('git', ['diff', '--name-only', '--no-renames', `${base}...${head}`], {encoding: 'utf8'});
  return diff.split('\n').filter(Boolean);
}

function main(args) {
  const option = name => {
    const index = args.indexOf(name);
    return index < 0 ? '' : (args[index + 1] ?? '');
  };
  const base = option('--base');
  const head = option('--head') || 'HEAD';
  const isZeroBase = /^0+$/.test(base);

  let plan;
  let changedFiles = [];
  let reason = '';
  if (args.includes('--all')) {
    plan = planChanges([]);
    reason = 'requested';
  } else if (!base || isZeroBase) {
    plan = planChanges([]);
    reason = 'no base commit';
  } else {
    try {
      changedFiles = listChangedFiles(base, head);
      plan = planChanges(changedFiles);
    } catch (error) {
      console.log(`::warning::Could not diff ${base}...${head}, so everything runs: ${error.message}`);
      plan = planChanges([]);
      reason = 'diff failed';
    }
  }
  if (changedFiles.includes(LOCKFILE)) {
    const lockPlan = planLockfileChanges(base, head);
    if (lockPlan.error) console.log(`::warning::${lockPlan.error}, so everything runs`);
    if (lockPlan.reason) reason = lockPlan.reason;
    plan = lockPlan.everything
      ? planChanges([])
      : planChanges(changedFiles, {lockfileFolders: lockPlan.folders});
  }

  const summary = formatSummary(plan, reason, changedFiles);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${formatOutputs(plan, changedFiles)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
