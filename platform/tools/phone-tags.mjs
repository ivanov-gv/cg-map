// Finds browser tests that depend on the phone layout but have no @phone tag, which a PR would then not run there. Reads
// the syntax tree, so that a dependency in a helper or a describe-level skip counts as well as one in the test's own body.
// Only the nightly run would otherwise catch those: docs/verification/testing.md, "Phone layout tests".
import * as espree from 'espree';

const PHONE_DEPENDENCY = /\b(isMobile|hasTouch)\b|touchscreen|viewportSize\(\)\.width/;
const PHONE_TAG = '@phone';
const HOOKS = new Set(['beforeEach', 'beforeAll', 'afterEach', 'afterAll']);

const parse = text => espree.parse(text, {ecmaVersion: 'latest', sourceType: 'module', range: true});
const sourceOf = (node, text) => text.slice(...node.range);

function childNodes(node) {
  return Object.values(node)
    .flat()
    .filter(value => typeof value?.type === 'string');
}

// Visits a node and everything under it. A visitor returning false skips what is under that node.
function walk(node, visit) {
  if (visit(node) === false) return;
  for (const child of childNodes(node)) walk(child, visit);
}

const isFunction = node => /Function/.test(node?.type ?? '');

// 'test', 'test.describe', 'test.describe.parallel' or 'test.skip' for such a call, and null for anything else.
function testCallName(node) {
  if (node.type !== 'CallExpression') return null;
  const parts = [];
  let callee = node.callee;
  while (callee.type === 'MemberExpression') {
    parts.unshift(callee.property.name);
    callee = callee.object;
  }
  return callee.type === 'Identifier' && callee.name === 'test' ? ['test', ...parts].join('.') : null;
}

// Every named function in a file, as name and source text. Test callbacks have no name, so they do not appear.
function namedFunctions(text) {
  const functions = new Map();
  walk(parse(text), node => {
    if (node.type === 'FunctionDeclaration') functions.set(node.id.name, sourceOf(node, text));
    const isNamedArrow = node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && isFunction(node.init);
    if (isNamedArrow) functions.set(node.id.name, sourceOf(node.init, text));
  });
  return functions;
}

const callsAny = (body, names) => [...names].some(name => new RegExp(`\\b${name}\\(`).test(body));

// Names of the functions that depend on the phone layout, directly or through another function.
function phoneDependentFunctions(functions) {
  const dependent = new Set();
  let hasGrown = true;
  while (hasGrown) {
    hasGrown = false;
    for (const [name, body] of functions) {
      if (dependent.has(name)) continue;
      if (!PHONE_DEPENDENCY.test(body) && !callsAny(body, dependent)) continue;
      dependent.add(name);
      hasGrown = true;
    }
  }
  return dependent;
}

const hasPhoneTag = (call, text) => call.arguments.slice(0, -1).some(argument => sourceOf(argument, text).includes(PHONE_TAG));

// What a test.skip in a test or describe says about the phone layout.
function skipKinds(body) {
  return {
    isDesktopOnly: /test\.skip\(\s*(\(\{[^}]*\}\)\s*=>\s*)?isMobile/.test(body),
    isPhoneOnly: /test\.skip\(\s*(\(\{[^}]*\}\)\s*=>\s*)?!isMobile/.test(body)
  };
}

// Statements of a describe or file that apply to each test in it: its skips, and its hooks.
function sharedSetup(statements, text) {
  return statements
    .filter(statement => {
      const name = statement.type === 'ExpressionStatement' ? testCallName(statement.expression) : null;
      return name === 'test.skip' || HOOKS.has(name?.split('.').pop());
    })
    .map(statement => sourceOf(statement, text))
    .join('\n');
}

function collectTests(statements, text, inherited, tests) {
  const setup = `${inherited.setup}\n${sharedSetup(statements, text)}`;
  for (const statement of statements) {
    const call = statement.type === 'ExpressionStatement' ? statement.expression : null;
    const name = call ? testCallName(call) : null;
    if (!name) continue;
    const callback = call.arguments.at(-1);
    if (!isFunction(callback)) continue;
    const isTagged = inherited.isTagged || hasPhoneTag(call, text);
    if (name.startsWith('test.describe')) {
      collectTests(callback.body.body, text, {setup, isTagged}, tests);
    } else if (name === 'test') {
      tests.push({title: sourceOf(call.arguments[0], text), isTagged, body: `${setup}\n${sourceOf(callback, text)}`});
    }
  }
}

// Returns the titles of the untagged tests in one spec that depend on the phone layout. helperTexts are the sources of
// the helper files it may import. neutralHelpers are helpers that only choose how to press something on each layout: a
// test using one checks the same behavior on both, so a PR running it on desktop alone loses nothing.
export function untaggedPhoneTests(specText, helperTexts = [], neutralHelpers = new Set()) {
  const functions = new Map();
  for (const text of [...helperTexts, specText]) {
    for (const [name, body] of namedFunctions(text)) functions.set(name, body);
  }
  for (const name of neutralHelpers) functions.delete(name);
  const dependentFunctions = phoneDependentFunctions(functions);
  const tests = [];
  collectTests(parse(specText).body, specText, {setup: '', isTagged: false}, tests);
  return tests
    .filter(({body, isTagged}) => {
      if (isTagged) return false;
      const {isDesktopOnly, isPhoneOnly} = skipKinds(body);
      if (isDesktopOnly) return false;
      return isPhoneOnly || PHONE_DEPENDENCY.test(body) || callsAny(body, dependentFunctions);
    })
    .map(({title}) => title);
}
