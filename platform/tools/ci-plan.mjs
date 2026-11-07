#!/usr/bin/env node
// Decides which folder pipelines and browser areas a change needs. Anything it cannot classify runs everything.
// Local use: make ci-plan BASE=origin/main. CI use: .github/TESTING.md.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

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
    // One job took 313 seconds against the 300-second aim.
    jobs: 2,
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
    specs: 'tests/e2e/interface.spec.mjs',
    specFiles: ['interface.spec.mjs'],
    sources: ['interface.js']
  },
  discover: {
    specs: 'tests/e2e/discover.spec.mjs',
    specFiles: ['discover.spec.mjs'],
    sources: ['position.js']
  },
  'poi-desktop': {
    specs: 'tests/e2e/poi-visibility.spec.mjs --project=root-desktop',
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
  'app.js', 'core.js', 'dom.js', 'place-details.js', 'public-map-layers.js', 'map-selection.js',
  'offline-controls.js', 'status-messages.js', 'place-selection.js', 'location-controls.js'
];

const ALL_AREAS = Object.keys(BROWSER_AREAS);
const EVERYTHING = {folders: FOLDERS, areas: ALL_AREAS};
const WEB_DEPENDENTS = ['apps-web', 'tests', 'platform'];
// Every map application consumes the map-core runtime and the reviewed data release: these are their concrete contracts.
const MAP_APPLICATIONS = ['apps-web', 'apps-editor', 'apps-core-demo'];
const MAP_CONTRACT_DEPENDENTS = ['map-core', ...MAP_APPLICATIONS, 'tests', 'platform'];

function areasForWebFile(file) {
  const name = file.split('/').pop();
  if (/^apps\/web\/tests\/[^/]+\.test\.mjs$/.test(file)) return [];
  if (file.startsWith('apps/web/src/') && SHARED_WEB_SOURCES.includes(name)) return ALL_AREAS;
  const isSource = file.startsWith('apps/web/src/');
  const isSpec = file.startsWith('apps/web/tests/e2e/');
  const mapped = ALL_AREAS.filter(area => {
    const {sources, specFiles} = BROWSER_AREAS[area];
    return (isSource && sources.includes(name)) || (isSpec && specFiles.includes(name));
  });
  return mapped.length ? mapped : ALL_AREAS;
}

// Returns the folders and browser areas one changed path needs.
export function classify(file) {
  const isPublishedFile = /^apps\/[^/]+\/public\//.test(file);
  const isMarkdown = file.endsWith('.md') && !isPublishedFile;
  if (isMarkdown || file.startsWith('docs/') || file.startsWith('.markdownlint') || file === '.prettierrc.json')
    return {folders: ['docs'], areas: []};
  if (file.startsWith('.github/') || /^platform\/(tools|tests)\/ci-plan\./.test(file))
    return {folders: ['workflows', 'platform'], areas: []};
  if (file.startsWith('.claude/') || file.startsWith('.codex/')) return {folders: ['platform'], areas: []};

  if (/^services\/backend\/(.*\.go|go\.mod|go\.sum)$/.test(file)) return {folders: ['backend'], areas: []};
  if (file.startsWith('services/backend/')) return {folders: ['backend', 'platform'], areas: []};
  if (file.startsWith('services/transit-relay/'))
    return {folders: ['transit-relay', ...(file.endsWith('Makefile') ? ['platform'] : [])], areas: []};
  if (file.startsWith('tests/'))
    return {folders: ['tests', ...(file.endsWith('Makefile') ? ['platform'] : [])], areas: []};

  if (file === 'data/tools/editor-bundle.mjs') return {folders: ['data', 'apps-editor', 'tests'], areas: []};
  // tests/integration proves that whatever the editor exports, this importer accepts.
  if (
    ['apply-changeset.mjs', 'check-data.mjs', 'apply-place-visibility.mjs'].some(tool => file === `data/tools/${tool}`)
  ) {
    return {folders: ['data', 'tests'], areas: []};
  }
  // The web browser tests search and select against this fixture.
  if (file.startsWith('data/tests/fixtures/')) return {folders: ['data', ...WEB_DEPENDENTS], areas: ALL_AREAS};
  // What every map application copies into its artifact.
  if (file === 'data/tools/app-data.mjs') return {folders: ['data', ...MAP_CONTRACT_DEPENDENTS], areas: ALL_AREAS};
  if (/^data\/(tools|tests)\//.test(file)) return {folders: ['data'], areas: []};
  if (/^data\/(sources|artifacts|imagery)\//.test(file))
    return {folders: ['data', ...MAP_CONTRACT_DEPENDENTS], areas: ALL_AREAS};
  if (file === 'data/Makefile' || file === 'data/package.json') return {folders: ['data', 'platform'], areas: []};

  if (file.startsWith('packages/contracts/'))
    return {folders: ['contracts', 'data', 'backend', ...MAP_CONTRACT_DEPENDENTS], areas: ALL_AREAS};
  // Only core-demo runs unreleased core. web and editor pin a release, so a core change cannot affect them.
  if (file.startsWith('packages/map-core/')) return {folders: ['map-core', 'apps-core-demo', 'platform'], areas: []};
  const platformFolders = /(^|\/)(Makefile|package\.json)$/.test(file) ? ['platform'] : [];
  // platform checks that a phone-only browser test is tagged.
  if (file.startsWith('apps/editor/tests/e2e/') || file === 'apps/editor/playwright.config.mjs')
    return {folders: ['apps-editor', 'tests', 'platform'], areas: []};
  if (file.startsWith('apps/editor/')) return {folders: ['apps-editor', 'tests', ...platformFolders], areas: []};
  if (file.startsWith('apps/core-demo/')) return {folders: ['apps-core-demo', ...platformFolders], areas: []};
  if (file.startsWith('apps/web/')) return {folders: WEB_DEPENDENTS, areas: areasForWebFile(file)};

  if (file === 'platform/tools/serve.py' || file === 'platform/tools/dev-port.mjs')
    return {folders: ['platform', ...MAP_APPLICATIONS], areas: ALL_AREAS};
  // Only the editor's LAN install uses it.
  if (file === 'platform/tools/lan_certificate.py') return {folders: ['platform', 'apps-editor'], areas: []};
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
  return {include: areas.flatMap(browserJobs)};
}

// A change to an app, or to what it is built from, publishes that app's image.
export function imageMatrix(folders) {
  const apps = MAP_APPLICATIONS.filter(folder => folders.includes(folder));
  return {include: apps.map(folder => ({app: folder.replace('apps-', '')}))};
}

export function formatOutputs({folders, areas}) {
  const folderLines = FOLDERS.map(folder => `${folder}=${folders.includes(folder)}`);
  return [
    ...folderLines,
    `browser_matrix=${JSON.stringify(browserMatrix(areas))}`,
    `image_matrix=${JSON.stringify(imageMatrix(folders))}`
  ].join('\n');
}

export function formatSummary({folders, areas, everything}, reason) {
  return [
    `Selected ${everything ? 'everything' : 'a subset of pipelines'}${reason ? ` (${reason})` : ''}.`,
    `- Folders: ${folders.join(', ') || 'none'}`,
    `- Browser areas: ${areas.join(', ') || 'none'}`
  ].join('\n');
}

function changedFiles(base, head) {
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
  let reason = '';
  if (args.includes('--all')) {
    plan = planChanges([]);
    reason = 'requested';
  } else if (!base || isZeroBase) {
    plan = planChanges([]);
    reason = 'no base commit';
  } else {
    try {
      plan = planChanges(changedFiles(base, head));
    } catch (error) {
      console.log(`::warning::Could not diff ${base}...${head}, so everything runs: ${error.message}`);
      plan = planChanges([]);
      reason = 'diff failed';
    }
  }

  const summary = formatSummary(plan, reason);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${formatOutputs(plan)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
