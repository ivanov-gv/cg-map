#!/usr/bin/env node
// One verification verb for every component: `make verify PKG=<path>`.
// PKG may be a component directory or any file/directory inside one. Without PKG, runs everything.
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';

const components = ['apps/web', 'data', 'packages/contracts', 'services/backend', 'services/transit-relay', 'platform', 'tests', 'docs'];
export const plans = Object.fromEntries(components.map(component => [
  component,
  [['make', '--no-print-directory', '-C', component, 'verify']]
]));
plans.docs = [['make', '--no-print-directory', '-f', 'platform/docs.mk', 'verify']];
const aliases = {'.claude': 'platform', '.codex': 'platform', '.github': 'platform', 'AGENTS.md': 'docs', 'README.md': 'docs'};

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
  if (!existsSync(target)) { console.error(`verify: ${target} does not exist`); return 2; }
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
