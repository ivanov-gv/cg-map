import test from 'node:test';
import {assertReadabilityRules} from '../../../platform/tools/eslint-readability-probe.mjs';

test('core-demo readability rules are enforced by its ESLint config', async () => {
  await assertReadabilityRules(new URL('..', import.meta.url));
});
