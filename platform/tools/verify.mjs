#!/usr/bin/env node
// One verification verb for every component: `make verify PKG=<path>`.
// PKG may be a component directory or any file/directory inside one. Without PKG, runs everything.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const lintGlobs = {
  'apps/web': ['apps/web/src', 'apps/web/tools', 'apps/web/tests'],
  data: ['data/tools', 'data/tests'],
  platform: ['platform'],
  'services/transit-relay': ['services/transit-relay/*.mjs'],
  tests: ['tests']
};
const eslint = (component) => ['npx', '--no-install', 'eslint', ...lintGlobs[component]];
const buildWeb = ['npm', 'run', '-s', 'build:web'];
const repo = ['node', 'platform/tools/check-repo.mjs'];
const agents = ['node', 'platform/agents/gen-agent-rules.mjs', '--check'];

export const plans = {
  'apps/web': [eslint('apps/web'), repo, buildWeb, ['sh', '-c', 'node --test apps/web/tests/*.test.mjs'], ['node', 'apps/web/tools/finalize.mjs', '--check']],
  data: [eslint('data'), ['npm', 'run', '-s', 'check:data'], ['sh', '-c', 'node --test data/tests/*.test.mjs'], ['sh', '-c', 'python3 -m py_compile data/tools/*.py']],
  'packages/contracts': [['npm', 'run', '-s', 'check:data'], buildWeb, ['sh', '-c', 'node --test tests/integration/contracts.test.mjs data/tests/*.test.mjs']],
  'services/backend': [['make', '--no-print-directory', 'check-go']],
  'services/transit-relay': [eslint('services/transit-relay'), ['sh', '-c', 'node --test services/transit-relay/*.test.mjs']],
  platform: [eslint('platform'), repo, agents, buildWeb, ['sh', '-c', 'node --test platform/tests/*.test.mjs'], ['python3', '-m', 'unittest', 'discover', '-s', 'platform/tests', '-p', 'test_*.py'], ['sh', '-c', 'python3 -m py_compile platform/tools/*.py']],
  tests: [eslint('tests'), buildWeb, ['sh', '-c', 'node --test tests/integration/*.test.mjs']],
  docs: [repo, agents]
};
const aliases = {'.claude': 'platform', '.codex': 'platform', '.github': 'platform', 'AGENTS.md': 'docs', 'ARCHITECTURE.md': 'docs', 'README.md': 'docs'};

export function componentFor(target) {
  const rel = target.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (aliases[rel.split('/')[0]]) return aliases[rel.split('/')[0]];
  return Object.keys(plans).filter(c => rel === c || rel.startsWith(`${c}/`)).sort((a, b) => b.length - a.length)[0] ?? null;
}

function main(target) {
  if (!target) {
    const all = [['make', '--no-print-directory', 'check']];
    if (spawnSync('go', ['version']).status === 0) all.push(['make', '--no-print-directory', 'check-go']);
    else console.warn('verify: go not installed; skipping make check-go');
    return runAll('everything', all);
  }
  if (!fs.existsSync(target)) { console.error(`verify: ${target} does not exist`); return 2; }
  const component = componentFor(target);
  if (!component) {
    console.error(`verify: no verification plan covers ${target}. Known: ${Object.keys(plans).join(', ')}. Run \`make check\`, and add a plan in platform/tools/verify.mjs for a new component.`);
    return 2;
  }
  return runAll(component, plans[component]);
}

function runAll(name, steps) {
  for (const step of steps) {
    console.log(`\n> ${step.join(' ')}`);
    const r = spawnSync(step[0], step.slice(1), {stdio: 'inherit'});
    if (r.status !== 0) { console.error(`\nverify ${name}: FAILED at \`${step.join(' ')}\``); return r.status || 1; }
  }
  console.log(`\nverify ${name}: OK`);
  return 0;
}

if (process.argv[1]?.endsWith('verify.mjs')) process.exitCode = main(process.argv[2] || process.env.PKG || '');
