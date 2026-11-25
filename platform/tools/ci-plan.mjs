#!/usr/bin/env node
// Decides which folder pipelines and browser areas a change needs. Anything it cannot classify runs everything.
// Local use: make ci-plan BASE=origin/main. CI use: .github/TESTING.md.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
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

// Each web source file is listed once, so a new file falls through to every area until someone maps it.
export const BROWSER_AREAS = {
  shell: {
    specs: 'tests/e2e/shell.spec.mjs tests/e2e/updates.spec.mjs',
    specFiles: ['shell.spec.mjs', 'updates.spec.mjs'],
    sources: ['sw.js', 'offline.js', 'data-mode.js', 'app-updates.js']
  },
  journeys: {
    specs: 'tests/e2e/journeys.spec.mjs',
    // 3 shards: journeys-1 took 191 s, journeys-2 took 148 s with 2 shards; 3 keep each under ~120 s.
    jobs: 3,
    specFiles: ['journeys.spec.mjs'],
    sources: [
      'routing.js',
      'transit-routing.js',
      'route-planner.js',
      'transport.js',
      'vehicle-direction.js',
      'point-selection.js',
      'object-selection.js',
      'map-taps.js'
    ]
  },
  interface: {
    specs: 'tests/e2e/interface.spec.mjs tests/e2e/search-results.spec.mjs tests/e2e/history.spec.mjs tests/e2e/fold.spec.mjs',
    // 12 shards: run 44906522239 measured 406, 300, 292, 236, 220, 216, 201 and 193 s across the 8 shards, about 2060 s
    // in total. 2060/12 is about 172 s per shard, leaving margin under the 300 s aim; 8 left the slowest at 406 s.
    jobs: 12,
    specFiles: ['interface.spec.mjs', 'search-results.spec.mjs', 'history.spec.mjs', 'fold.spec.mjs'],
    sources: ['interface.js', 'history-steps.js']
  },
  discover: {
    specs: 'tests/e2e/discover.spec.mjs',
    specFiles: ['discover.spec.mjs'],
    sources: ['position.js']
  },
  'poi-desktop': {
    specs: 'tests/e2e/poi-visibility.spec.mjs --project=root-desktop',
    // Runs took 172, 270, 175 and 296 seconds against the 300-second aim.
    jobs: 2,
    specFiles: ['poi-visibility.spec.mjs'],
    sources: []
  },
  'poi-mobile': {
    specs: 'tests/e2e/poi-visibility.spec.mjs --project=pages-mobile',
    specFiles: ['poi-visibility.spec.mjs'],
    sources: []
  }
};

// Every browser test boots these, so a change to one can break any area.
export const SHARED_WEB_SOURCES = [
  'app.js',
  'core.js',
  'dom.js',
  'place-details.js',
  'public-map-layers.js',
  'map-selection.js',
  'offline-controls.js',
  'status-messages.js',
  'place-selection.js',
  'location-controls.js',
  'device-class.js',
  'attribution.js'
];

const ALL_AREAS = Object.keys(BROWSER_AREAS);
const EVERYTHING = {folders: FOLDERS, areas: ALL_AREAS};
// CI calls the root Makefile only through `make verify PKG=<path>` in these folder pipelines and `make check-docs` in
// ci-docs; the lint-workflows and act test targets live in workflows too. Browser jobs, the backend and the browser image
// call their own project Makefiles, so they need no areas here.
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
const WEB_DEPENDENTS = ['apps-web', 'tests', 'platform'];
// Every map application consumes the map-core runtime: that is their concrete contract.
const MAP_APPLICATIONS = ['apps-web', 'apps-editor', 'apps-core-demo'];
// App and platform tests pin a published map-data release. HEAD data reaches only the cross-project integration tests.
const HEAD_DATA_CONSUMERS = ['tests'];

// Returns the web browser areas a changed file needs. Anything not known to be narrower runs every area.
function areasForWebFile(file) {
  const allAreas = Object.keys(BROWSER_AREAS);
  const name = file.split('/').pop();
  const isUnitTest = file.startsWith('apps/web/tests/') && !file.includes('/e2e/') && file.endsWith('.test.mjs');
  if (isUnitTest) return [];
  const isSource = file.startsWith('apps/web/src/');
  if (isSource && SHARED_WEB_SOURCES.includes(name)) return allAreas;
  const isSpec = file.startsWith('apps/web/tests/e2e/');
  const mapped = allAreas.filter(area => {
    const {sources, specFiles} = BROWSER_AREAS[area];
    return (isSource && sources.includes(name)) || (isSpec && specFiles.includes(name));
  });
  return mapped.length ? mapped : allAreas;
}

// Returns the folders and web browser areas one changed path needs. The editor owns its whole browser suite in its
// workflow, so selecting its folder is enough to run it.
export function classify(file) {
  const isPublishedFile = /^apps\/[^/]+\/public\//.test(file);
  const isMarkdown = file.endsWith('.md') && !isPublishedFile;
  if (isMarkdown || file.startsWith('docs/') || file.startsWith('.markdownlint') || file === '.prettierrc.json')
    return {folders: ['docs'], areas: []};
  if (file.startsWith('.github/') || /^platform\/(tools|tests)\/(ci-plan|workflow-test-runs)\./.test(file))
    return {folders: ['workflows', 'platform'], areas: []};
  if (file === 'Makefile') return {folders: ROOT_MAKEFILE_FOLDERS, areas: []};
  if (file.startsWith('.claude/') || file.startsWith('.codex/')) return {folders: ['platform'], areas: []};

  if (/^services\/backend\/(.*\.go|go\.mod|go\.sum)$/.test(file)) return {folders: ['backend'], areas: []};
  if (file.startsWith('services/backend/')) return {folders: ['backend', 'platform'], areas: []};
  if (file.startsWith('services/transit-relay/'))
    return {folders: ['transit-relay', ...(file.endsWith('Makefile') ? ['platform'] : [])], areas: []};
  if (file.startsWith('tests/'))
    return {folders: ['tests', ...(file.endsWith('Makefile') ? ['platform'] : [])], areas: []};

  if (file === 'data/tools/editor-bundle.mjs') return {folders: ['data', 'tests'], areas: []};
  // tests/integration proves that whatever the editor exports, this importer accepts.
  const isImporterSource =
    ['apply-changeset.mjs', 'check-data.mjs', 'apply-place-visibility.mjs'].some(tool => file === `data/tools/${tool}`) ||
    /^data\/tools\/changeset-[a-z-]+\.mjs$/.test(file);
  if (isImporterSource) {
    return {folders: ['data', 'tests'], areas: []};
  }
  // Web browser tests read this fixture from the pinned package, so it belongs to data's own pipeline.
  if (file.startsWith('data/tests/fixtures/')) return {folders: ['data'], areas: []};
  // Dev builds use this tool and the data project files at HEAD, but app tests pin the published package instead.
  if (file === 'data/tools/app-data.mjs' || file === 'data/Makefile' || file === 'data/package.json')
    return {folders: ['data', ...HEAD_DATA_CONSUMERS], areas: []};
  if (/^data\/(tools|tests)\//.test(file)) return {folders: ['data'], areas: []};
  if (/^data\/(sources|artifacts|imagery)\//.test(file))
    return {folders: ['data', ...HEAD_DATA_CONSUMERS], areas: []};

  // A contract change at HEAD is seen by data validation and tests/; published consumers pin a release instead.
  if (file.startsWith('packages/contracts/')) return {folders: ['contracts', 'data', 'tests', 'platform'], areas: []};
  // Only core-demo runs unreleased core. web and editor pin a release, so a core change cannot affect them.
  if (file.startsWith('packages/map-core/')) return {folders: ['map-core', 'apps-core-demo', 'platform'], areas: []};
  const platformFolders = /(^|\/)(Makefile|package\.json)$/.test(file) ? ['platform'] : [];
  // Any editor change runs the app's whole browser suite; the app owns its shard count and specs.
  if (file.startsWith('apps/editor/')) return {folders: ['apps-editor', 'tests', ...platformFolders], areas: []};
  if (file.startsWith('apps/core-demo/')) return {folders: ['apps-core-demo', ...platformFolders], areas: []};
  if (file.startsWith('apps/web/')) return {folders: WEB_DEPENDENTS, areas: areasForWebFile(file)};

  if (file === 'platform/tools/serve.py' || file === 'platform/tools/dev-port.mjs')
    return {folders: ['platform', ...MAP_APPLICATIONS], areas: ALL_AREAS};
  // Only the editor's LAN install uses it.
  if (file === 'platform/tools/lan_certificate.py') return {folders: ['platform', 'apps-editor'], areas: []};
  // The shared parser is imported by the editor's unit test and by platform's web phone-tag check.
  if (file === 'platform/tools/phone-tags.mjs') return {folders: ['platform', 'apps-editor', 'apps-web'], areas: []};
  if (file.startsWith('platform/browser-image/')) return {folders: ['browser-image', 'platform'], areas: []};
  if (file.startsWith('platform/')) return {folders: ['platform'], areas: []};

  return EVERYTHING;
}

// An empty list means the diff could not be trusted, so it selects everything too.
export function planChanges(files) {
  if (files.length === 0) return {...EVERYTHING, everything: true};
  const results = files.map(classify);
  const folders = FOLDERS.filter(folder => results.some(result => result.folders.includes(folder)));
  const areas = ALL_AREAS.filter(area => results.some(result => result.areas.includes(area)));
  return {folders, areas, everything: folders.length === FOLDERS.length && areas.length === ALL_AREAS.length};
}

// An area too slow for one job runs as several, each with its own share of the tests.
function browserJobs(area) {
  const {specs, jobs = 1} = BROWSER_AREAS[area];
  if (jobs === 1) return [{area, specs}];
  return Array.from({length: jobs}, (_, index) => ({
    area: `${area}-${index + 1}`,
    specs: `${specs} --shard=${index + 1}/${jobs}`
  }));
}

export function browserMatrix(areas) {
  return {include: areas.flatMap(area => browserJobs(area))};
}

// A separate web test call proves one short area; a separate editor test call uses its own smoke input. The PR's
// regular browser calls keep the coverage their diffs need.
export const SMOKE_BROWSER_MATRIX = JSON.stringify(browserMatrix(['discover']));

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

export function formatOutputs({folders, areas}, changedFiles = []) {
  const folderLines = FOLDERS.map(folder => `${folder}=${folders.includes(folder)}`);
  const {testRuns, inPlace, separate, proveCdTestRuns} = testRunCallsFor(folders, changedFiles);
  // A changed web workflow with no selected area still needs one browser job to prove its steps. The editor owns its
  // own matrix, so this planner emits no editor output.
  const browserMatrixForCall =
    areas.length === 0 && inPlace.includes('ci-apps-web.yml')
      ? SMOKE_BROWSER_MATRIX
      : JSON.stringify(browserMatrix(areas));
  return [
    ...folderLines,
    `browser_matrix=${browserMatrixForCall}`,
    `image_matrix=${JSON.stringify(imageMatrix(folders))}`,
    `ci_in_place_test_runs=${JSON.stringify(inPlace)}`,
    `ci_test_runs=${JSON.stringify(separate)}`,
    `cd_test_runs=${JSON.stringify(testRuns.cd)}`,
    `prove_cd_test_runs=${proveCdTestRuns}`,
    `manual_test_runs=${JSON.stringify(testRuns.manual)}`,
    `smoke_browser_matrix=${SMOKE_BROWSER_MATRIX}`
  ].join('\n');
}

export function formatSummary({folders, areas, everything}, reason, changedFiles = []) {
  const {testRuns, inPlace, separate, proveCdTestRuns} = testRunCallsFor(folders, changedFiles);
  // formatWorkflowTestRuns still owns the CD and manual lines. Drop its unsplit CI line in favor of the split pair.
  const dispatchLines = formatWorkflowTestRuns({...testRuns, ci: []}).split('\n').slice(1);
  return [
    `Selected ${everything ? 'everything' : 'a subset of pipelines'}${reason ? ` (${reason})` : ''}.`,
    `- Folders: ${folders.join(', ') || 'none'}`,
    `- Browser areas: ${areas.join(', ') || 'none'}`,
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

  const summary = formatSummary(plan, reason, changedFiles);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${formatOutputs(plan, changedFiles)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
