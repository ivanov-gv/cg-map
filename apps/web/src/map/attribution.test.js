import test from 'node:test';
import assert from 'node:assert/strict';
import {attributionNodes, buildFooterVersionText, visibleSourceAttributions} from './attribution.js';

class FakeAttributionNode {
  constructor(nodeType, textContent, {tagName = null, attributes = {}} = {}) {
    this.nodeType = nodeType;
    this.textContent = textContent;
    this.tagName = tagName;
    this.attributes = attributes;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
}

// attributionNodes only reads the parsed body's top-level children. A small parser for the fixtures below keeps this
// a unit test without adding a DOM implementation as a dependency.
class FakeAttributionParser {
  parseFromString(html) {
    const body = {childNodes: []};
    const markupPattern = /<(?<tag>[a-z]+)(?<attributes>[^>]*)>(?<content>.*?)<\/\k<tag>>|(?<text>[^<]+)/gi;

    for (const match of html.matchAll(markupPattern)) {
      if (match.groups.text !== undefined) {
        body.childNodes.push(new FakeAttributionNode(3, match.groups.text));
        continue;
      }

      const attributes = {};
      const attributePattern = /(?<name>[\w:-]+)="(?<value>[^"]*)"/g;
      for (const attribute of match.groups.attributes.matchAll(attributePattern))
        attributes[attribute.groups.name] = attribute.groups.value;
      body.childNodes.push(
        new FakeAttributionNode(1, match.groups.content.replace(/<[^>]*>/g, ''), {
          tagName: match.groups.tag.toUpperCase(),
          attributes
        })
      );
    }

    return {body};
  }
}

globalThis.DOMParser = FakeAttributionParser;
globalThis.Node = {TEXT_NODE: 3, ELEMENT_NODE: 1};

const fakeTargetDocument = () => ({
  createTextNode: text => new FakeAttributionNode(3, text),
  createElement: tagName => new FakeAttributionNode(1, '', {tagName: tagName.toUpperCase()})
});

function fakeStyle(sources, layers) {
  return {sources, layers};
}

test('visibleSourceAttributions returns attributions for visible layers in source order', () => {
  const style = fakeStyle(
    {
      basemap: {attribution: '© OSM'},
      'satellite-preview': {type: 'image'},
      'satellite-tiles': {attribution: 'Imagery: eMapa'}
    },
    [
      {id: 'background', type: 'background'},
      {id: 'land', type: 'fill', source: 'basemap'},
      {id: 'satellite-preview', type: 'raster', source: 'satellite-preview', layout: {visibility: 'none'}},
      {id: 'satellite-tiles', type: 'raster', source: 'satellite-tiles', layout: {visibility: 'none'}}
    ]
  );

  // Only basemap is visible (satellite layers are hidden)
  const result = visibleSourceAttributions(style);
  assert.deepEqual(result, ['© OSM']);
});

test('visibleSourceAttributions includes satellite attribution when visible', () => {
  const style = fakeStyle(
    {
      basemap: {attribution: '© OSM'},
      'satellite-preview': {type: 'image'},
      'satellite-tiles': {attribution: 'Imagery: eMapa'}
    },
    [
      {id: 'background', type: 'background'},
      {id: 'land', type: 'fill', source: 'basemap'},
      {id: 'satellite-preview', type: 'raster', source: 'satellite-preview', layout: {visibility: 'visible'}},
      {id: 'satellite-tiles', type: 'raster', source: 'satellite-tiles', layout: {visibility: 'visible'}}
    ]
  );

  const result = visibleSourceAttributions(style);
  assert.deepEqual(result, ['© OSM', 'Imagery: eMapa']);
});

test('visibleSourceAttributions collapses duplicate attributions', () => {
  const sharedAttribution = '© Shared';
  const style = fakeStyle(
    {
      sourceA: {attribution: sharedAttribution},
      sourceB: {attribution: sharedAttribution}
    },
    [
      {id: 'layerA', type: 'fill', source: 'sourceA'},
      {id: 'layerB', type: 'line', source: 'sourceB'}
    ]
  );

  const result = visibleSourceAttributions(style);
  assert.deepEqual(result, [sharedAttribution]);
});

test('visibleSourceAttributions skips sources with empty attribution', () => {
  const style = fakeStyle(
    {
      basemap: {attribution: '© OSM'},
      geojson: {type: 'geojson'}
    },
    [
      {id: 'land', type: 'fill', source: 'basemap'},
      {id: 'markers', type: 'symbol', source: 'geojson'}
    ]
  );

  const result = visibleSourceAttributions(style);
  assert.deepEqual(result, ['© OSM']);
});

test('visibleSourceAttributions skips sources with no visible layers', () => {
  const style = fakeStyle(
    {
      basemap: {attribution: '© OSM'},
      hidden: {attribution: 'Hidden source'}
    },
    [
      {id: 'land', type: 'fill', source: 'basemap'},
      {id: 'hidden-layer', type: 'fill', source: 'hidden', layout: {visibility: 'none'}}
    ]
  );

  const result = visibleSourceAttributions(style);
  assert.deepEqual(result, ['© OSM']);
});

test('buildFooterVersionText includes the app name, version and short commit', () => {
  const build = {name: 'Kompas', version: '0.1.0', commit: 'a1b2c3d'};

  assert.equal(buildFooterVersionText(build), 'Kompas 0.1.0 · a1b2c3d · ');
});

test('buildFooterVersionText omits the commit when the build does not know one', () => {
  const build = {name: 'Kompas', version: '0.1.0', commit: null};

  assert.equal(buildFooterVersionText(build), 'Kompas 0.1.0 · ');
});

test('buildFooterVersionText keeps the version but drops the commit in the compact form', () => {
  const build = {name: 'Kompas', version: '0.1.0', commit: 'a1b2c3d'};

  assert.equal(buildFooterVersionText(build, {compact: true}), 'Kompas 0.1.0 · ');
});

test('attributionNodes rebuilds only safe top-level links', () => {
  const nodes = attributionNodes('<a href="https://example.org/">Safe</a>', fakeTargetDocument());

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].nodeType, Node.ELEMENT_NODE);
  assert.equal(nodes[0].tagName, 'A');
  assert.equal(nodes[0].href, 'https://example.org/');
  assert.equal(nodes[0].target, '_blank');
  assert.equal(nodes[0].rel, 'noopener noreferrer');
  assert.equal(nodes[0].textContent, 'Safe');
});

test('attributionNodes flattens unsafe, non-https and nested markup', () => {
  const html =
    '© OSM <a href="javascript:alert(1)">Unsafe</a> <a href="http://example.org/">Plain</a> ' +
    '<b>Bold</b> <span><a href="https://example.org/">Nested</a></span>';
  const nodes = attributionNodes(html, fakeTargetDocument());

  assert.ok(nodes.every(node => node.nodeType === Node.TEXT_NODE));
  assert.deepEqual(
    nodes.map(node => node.textContent),
    ['© OSM ', 'Unsafe', ' ', 'Plain', ' ', 'Bold', ' ', 'Nested']
  );
});
