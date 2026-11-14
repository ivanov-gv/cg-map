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

// Only moving geometry or previewing all edits reaches these, which the offline and viewer tests never do.
const EDITING_ONLY_SOURCES = ['drag-gestures.js', 'geometry-editing.js', 'handle-layer.js', 'edit-preview.js'];
const OFFLINE_SOURCES = ['sw.js', 'offline-cache.js', 'offline-install.js', 'update-quiet.js'];

// The same rule as web's areas: a new editor source falls through to every area until someone maps it. An area limited to
// one project has a partner for the other, and both run the same sources.
export const EDITOR_BROWSER_AREAS = {
  'editing-desktop': {
    specs: 'tests/e2e/editing.spec.mjs --project=root-desktop',
    // Sized from measured test time, so that each share stays inside the job time limit.
    jobs: 3,
    specFiles: ['editing.spec.mjs'],
    sources: EDITING_ONLY_SOURCES
  },
  'editing-mobile': {
    specs: 'tests/e2e/editing.spec.mjs --project=pages-mobile',
    specFiles: ['editing.spec.mjs'],
    sources: EDITING_ONLY_SOURCES
  },
  'offline-desktop': {
    specs: 'tests/e2e/offline.spec.mjs --project=root-desktop',
    specFiles: ['offline.spec.mjs'],
    sources: OFFLINE_SOURCES
  },
  'offline-mobile': {
    specs: 'tests/e2e/offline.spec.mjs --project=pages-mobile',
    specFiles: ['offline.spec.mjs'],
    sources: OFFLINE_SOURCES
  },
  selection: {
    specs: 'tests/e2e/selection.spec.mjs',
    specFiles: ['selection.spec.mjs'],
    sources: ['object-list.js']
  },
  viewer: {
    specs: 'tests/e2e/viewer.spec.mjs',
    specFiles: ['viewer.spec.mjs'],
    sources: []
  }
};

// Every editor browser test goes through these: startup validates the rules and builds the session and review, every mode
// draws and hit tests through the overlay, selecting a feature opens an edit, and the offline tests also edit, save a draft
// and export. So what narrows a change here is mostly whether it is offline code or a spec, not which edit it touches.
export const SHARED_EDITOR_SOURCES = [
  'app.js',
  'feature-diff.js',
  'dom.js',
  'hashing.js',
  'source-bundle.js',
  'draft-store.js',
  'layer-rules.js',
  'source-overlay.js',
  'geometry-validation.js',
  'active-file-commands.js',
  'changeset.js',
  'cross-file-checks.js',
  'edit-session.js',
  'edit-transaction.js',
  'inspector-editing.js',
  'inspector-viewport.js',
  'property-form.js',
  'review-panel.js'
];

const ALL_AREAS = Object.keys(BROWSER_AREAS);
const ALL_EDITOR_AREAS = Object.keys(EDITOR_BROWSER_AREAS);
const EVERYTHING = {folders: FOLDERS, areas: ALL_AREAS, editorAreas: ALL_EDITOR_AREAS};
const WEB_DEPENDENTS = ['apps-web', 'tests', 'platform'];
// Every map application consumes the map-core runtime and the reviewed data release: these are their concrete contracts.
const MAP_APPLICATIONS = ['apps-web', 'apps-editor', 'apps-core-demo'];
const MAP_CONTRACT_DEPENDENTS = ['map-core', ...MAP_APPLICATIONS, 'tests', 'platform'];

// Returns the areas of one project that a changed file needs. Anything not known to be narrower runs every area.
function areasForFile(file, {project, areaTable, sharedSources}) {
  const allAreas = Object.keys(areaTable);
  const name = file.split('/').pop();
  const isUnitTest = file.startsWith(`${project}/tests/`) && !file.includes('/e2e/') && file.endsWith('.test.mjs');
  if (isUnitTest) return [];
  const isSource = file.startsWith(`${project}/src/`);
  if (isSource && sharedSources.includes(name)) return allAreas;
  const isSpec = file.startsWith(`${project}/tests/e2e/`);
  const mapped = allAreas.filter(area => {
    const {sources, specFiles} = areaTable[area];
    return (isSource && sources.includes(name)) || (isSpec && specFiles.includes(name));
  });
  return mapped.length ? mapped : allAreas;
}

const areasForWebFile = file =>
  areasForFile(file, {project: 'apps/web', areaTable: BROWSER_AREAS, sharedSources: SHARED_WEB_SOURCES});
const areasForEditorFile = file =>
  areasForFile(file, {project: 'apps/editor', areaTable: EDITOR_BROWSER_AREAS, sharedSources: SHARED_EDITOR_SOURCES});

// Returns the folders and browser areas one changed path needs. A result without editorAreas that selects apps-editor
// comes from outside the editor, such as its source bundle, and so needs all of them.
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
    return {folders: ['apps-editor', 'tests', 'platform'], areas: [], editorAreas: areasForEditorFile(file)};
  if (file.startsWith('apps/editor/'))
    return {folders: ['apps-editor', 'tests', ...platformFolders], areas: [], editorAreas: areasForEditorFile(file)};
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
  const editorAreasOf = result => (result.folders.includes('apps-editor') ? (result.editorAreas ?? ALL_EDITOR_AREAS) : []);
  const editorAreas = ALL_EDITOR_AREAS.filter(area => results.some(result => editorAreasOf(result).includes(area)));
  return {folders, areas, editorAreas, everything: folders.length === FOLDERS.length && areas.length === ALL_AREAS.length};
}

// An area too slow for one job runs as several, each with its own share of the tests.
function browserJobs(area, areaTable) {
  const {specs, jobs = 1} = areaTable[area];
  if (jobs === 1) return [{area, specs}];
  return Array.from({length: jobs}, (_, index) => ({
    area: `${area}-${index + 1}`,
    specs: `${specs} --shard=${index + 1}/${jobs}`
  }));
}

export function browserMatrix(areas, areaTable = BROWSER_AREAS) {
  return {include: areas.flatMap(area => browserJobs(area, areaTable))};
}

// A change to an app, or to what it is built from, publishes that app's image.
export function imageMatrix(folders) {
  const apps = MAP_APPLICATIONS.filter(folder => folders.includes(folder));
  return {include: apps.map(folder => ({app: folder.replace('apps-', '')}))};
}

export function formatOutputs({folders, areas, editorAreas}) {
  const folderLines = FOLDERS.map(folder => `${folder}=${folders.includes(folder)}`);
  return [
    ...folderLines,
    `browser_matrix=${JSON.stringify(browserMatrix(areas))}`,
    `editor_browser_matrix=${JSON.stringify(browserMatrix(editorAreas, EDITOR_BROWSER_AREAS))}`,
    `image_matrix=${JSON.stringify(imageMatrix(folders))}`
  ].join('\n');
}

export function formatSummary({folders, areas, editorAreas, everything}, reason) {
  return [
    `Selected ${everything ? 'everything' : 'a subset of pipelines'}${reason ? ` (${reason})` : ''}.`,
    `- Folders: ${folders.join(', ') || 'none'}`,
    `- Browser areas: ${areas.join(', ') || 'none'}`,
    `- Editor browser areas: ${editorAreas.join(', ') || 'none'}`
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
