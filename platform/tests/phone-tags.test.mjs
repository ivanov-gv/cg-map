import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {untaggedPhoneTests} from '../tools/phone-tags.mjs';
import {repoRoot} from '../agents/lib.mjs';

// Each one only chooses how to press something on each layout, so its test checks the same behavior on both.
const NEUTRAL_HELPERS = new Set(['closeCard']);

test('a test that depends on the phone layout is tagged, or a PR would not run it there', () => {
  for (const directory of ['apps/web/tests/e2e', 'apps/editor/tests/e2e']) {
    const names = fs.readdirSync(path.join(repoRoot, directory));
    const read = name => fs.readFileSync(path.join(repoRoot, directory, name), 'utf8');
    const helpers = names.filter(name => name.endsWith('.mjs') && !name.endsWith('.spec.mjs')).map(read);
    for (const spec of names.filter(name => name.endsWith('.spec.mjs'))) {
      assert.deepEqual(untaggedPhoneTests(read(spec), helpers, NEUTRAL_HELPERS), [], `${directory}/${spec}`);
    }
  }
});

test('the tag check finds a dependency in the body of a test', () => {
  const spec = `test('swipes', async ({page, hasTouch}) => { if (hasTouch) await page.reload(); });`;
  assert.deepEqual(untaggedPhoneTests(spec), [`'swipes'`]);
});

test('the tag check finds a test declared inside a loop or a condition', () => {
  const inLoop = `for (const value of [1]) {
    test('swipes in a loop', async ({page}) => { await page.touchscreen.tap(1, 1); });
  }`;
  assert.deepEqual(untaggedPhoneTests(inLoop), [`'swipes in a loop'`]);
  const inCondition = `if (process.env.TOUCH) test('swipes in a condition', async ({page}) => { await page.touchscreen.tap(1, 1); });`;
  assert.deepEqual(untaggedPhoneTests(inCondition), [`'swipes in a condition'`]);
});

test('the tag check accepts a tag on the test or on its describe', () => {
  const tagged = `test('swipes', {tag: '@phone'}, async ({page}) => { await page.touchscreen.tap(1, 1); });`;
  assert.deepEqual(untaggedPhoneTests(tagged), []);
  const inTaggedDescribe = `test.describe('touch', {tag: '@phone'}, () => {
    test('swipes', async ({page}) => { await page.touchscreen.tap(1, 1); });
  });`;
  assert.deepEqual(untaggedPhoneTests(inTaggedDescribe), []);
});

test('the tag check finds a dependency hidden in a helper, directly or through another helper', () => {
  const spec = `const swipe = page => tapTwice(page);
    test('swipes', async ({page}) => { await swipe(page); });
    test('reads', async ({page}) => { await page.reload(); });`;
  const helper = `export const tapTwice = page => page.touchscreen.tap(1, 1);`;
  assert.deepEqual(untaggedPhoneTests(spec, [helper]), [`'swipes'`]);
});

test('the tag check finds a phone-only skip on the describe around a test', () => {
  const spec = `test.describe('touch', () => {
    test.skip(({isMobile}) => !isMobile, 'Touch only');
    test('swipes', async ({page}) => { await page.reload(); });
  });`;
  assert.deepEqual(untaggedPhoneTests(spec), [`'swipes'`]);
});

test('the tag check finds a dependency in a hook of the describe', () => {
  const spec = `test.describe('touch', () => {
    test.beforeEach(async ({page}) => { await page.touchscreen.tap(1, 1); });
    test('swipes', async ({page}) => { await page.reload(); });
  });`;
  assert.deepEqual(untaggedPhoneTests(spec), [`'swipes'`]);
});

test('the tag check lets a desktop-only test through, in its body or from its describe', () => {
  const inBody = `test('hovers', async ({page, isMobile}) => { test.skip(isMobile, 'No hover'); await page.reload(); });`;
  assert.deepEqual(untaggedPhoneTests(inBody), []);
  const inDescribe = `test.describe('hover', () => {
    test.skip(({isMobile}) => isMobile, 'No hover');
    test('hovers', async ({page}) => { await page.reload(); });
  });`;
  assert.deepEqual(untaggedPhoneTests(inDescribe), []);
});

test('the tag check ignores a helper named as only choosing how to press', () => {
  const spec = `test('closes', async ({page}) => { await closeCard(page); });`;
  const helper = `export async function closeCard(page) { if (page.viewportSize().width < 720) await page.reload(); }`;
  assert.deepEqual(untaggedPhoneTests(spec, [helper]), [`'closes'`]);
  assert.deepEqual(untaggedPhoneTests(spec, [helper], new Set(['closeCard'])), []);
});
