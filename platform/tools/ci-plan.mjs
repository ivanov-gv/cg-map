#!/usr/bin/env node
// Decides which folder pipelines and browser areas a change needs. Anything it cannot classify runs everything.
// Local use: make ci-plan BASE=origin/main. CI use and the rules' reasoning: docs/plans/change-aware-ci.md.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

export const FOLDERS = ['docs', 'workflows', 'platform', 'contracts', 'data', 'backend', 'transit-relay', 'tests', 'apps-web'];

// Each web source file is listed once, so a new file falls through to every area until someone maps it.
export const BROWSER_AREAS = {
  shell: {
    specs: 'tests/e2e/shell.spec.mjs tests/e2e/updates.spec.mjs',
    specFiles: ['shell.spec.mjs', 'updates.spec.mjs'],
    sources: ['sw.js', 'offline.js', 'data-mode.js', 'app-updates.js']
  },
  journeys: {
    specs: 'tests/e2e/journeys.spec.mjs',
    specFiles: ['journeys.spec.mjs'],
    sources: ['routing.js', 'transit-routing.js', 'route-planner.js', 'transport.js', 'vehicle-direction.js', 'point-selection.js', 'object-selection.js', 'map-taps.js', 'satellite.js']
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
    sources: ['place-visibility.js', 'poi-icons.js']
  },
  'poi-mobile': {
    specs: 'tests/e2e/poi-visibility.spec.mjs --project=pages-mobile',
    specFiles: ['poi-visibility.spec.mjs'],
    sources: ['place-visibility.js', 'poi-icons.js']
  }
};

// Every browser test boots these, so a change to one can break any area.
export const SHARED_WEB_SOURCES = ['app.js', 'core.js', 'map-style.js'];

const ALL_AREAS = Object.keys(BROWSER_AREAS);
const EVERYTHING = {folders: FOLDERS, areas: ALL_AREAS};
const WEB_DEPENDENTS = ['apps-web', 'tests', 'platform'];

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
  const isMarkdown = file.endsWith('.md') && !file.startsWith('apps/web/public/');
  if (isMarkdown || file.startsWith('docs/') || file.startsWith('.markdownlint') || file === '.prettierrc.json') return {folders: ['docs'], areas: []};
  if (file.startsWith('.github/') || /^platform\/(tools|tests)\/ci-plan\./.test(file)) return {folders: ['workflows', 'platform'], areas: []};
  if (file.startsWith('.claude/') || file.startsWith('.codex/')) return {folders: ['platform'], areas: []};

  if (/^services\/backend\/(.*\.go|go\.mod|go\.sum)$/.test(file)) return {folders: ['backend'], areas: []};
  if (file.startsWith('services/backend/')) return {folders: ['backend', 'platform'], areas: []};
  if (file.startsWith('services/transit-relay/')) return {folders: ['transit-relay', 'tests', ...(file.endsWith('Makefile') ? ['platform'] : [])], areas: []};
  if (file.startsWith('tests/')) return {folders: ['tests', ...(file.endsWith('Makefile') ? ['platform'] : [])], areas: []};

  if (/^data\/(tools|tests)\//.test(file)) return {folders: ['data'], areas: []};
  if (/^data\/(sources|artifacts|imagery)\//.test(file)) return {folders: ['data', ...WEB_DEPENDENTS], areas: ALL_AREAS};
  if (file === 'data/Makefile' || file === 'data/package.json') return {folders: ['data', 'platform'], areas: []};

  if (file.startsWith('packages/contracts/')) return {folders: ['contracts', 'data', 'backend', ...WEB_DEPENDENTS], areas: ALL_AREAS};
  if (file.startsWith('apps/web/')) return {folders: WEB_DEPENDENTS, areas: areasForWebFile(file)};

  if (file.startsWith('platform/pages/') || file === 'platform/tools/serve.py') return {folders: ['platform', 'apps-web'], areas: ALL_AREAS};
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

// Runs before deploying and nightly must not rely on the area mapping, so a wrong mapping cannot reach users. Any run
// that selects the web builds a deployable artifact, even when the change itself maps to no browser area.
export function withFullBrowser(plan) {
  return plan.folders.includes('apps-web') ? {...plan, areas: ALL_AREAS} : plan;
}

export function browserMatrix(areas) {
  return {include: areas.map(area => ({area, specs: BROWSER_AREAS[area].specs}))};
}

export function formatOutputs({folders, areas}) {
  const folderLines = FOLDERS.map(folder => `${folder}=${folders.includes(folder)}`);
  return [...folderLines, `browser_matrix=${JSON.stringify(browserMatrix(areas))}`].join('\n');
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
    return index < 0 ? '' : args[index + 1] ?? '';
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

  if (args.includes('--full-browser')) plan = withFullBrowser(plan);
  const summary = formatSummary(plan, reason);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${formatOutputs(plan)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
