// Edits made the way the editor makes them, by its layer behaviors, and sent through the data-owned importer on a
// disposable copy of the sources. The browser is left out; the facts an edit records and takes along are the same.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {dataToolURL, stageDataInto, stagedSourcePath} from './data-root.mjs';
import {contractsDirectory, readContractJSON, stageContractsInto} from './contracts-root.mjs';
import {buildChangeset} from '../apps/editor/src/changeset.js';
import {EditSession} from '../apps/editor/src/edit-session.js';
import {behaviorOf, registerBehaviors} from '../apps/editor/src/layer-behaviors.js';
import {addressBehaviors} from '../apps/editor/src/layer-addresses.js';
import {buildingBehaviors} from '../apps/editor/src/layer-buildings.js';
import {greenBehaviors} from '../apps/editor/src/layer-green.js';
import {placeBehaviors} from '../apps/editor/src/layer-places.js';
import {roadBehaviors} from '../apps/editor/src/layer-roads.js';
import {reliefBehaviors} from '../apps/editor/src/layer-relief.js';
import {settlementBehaviors} from '../apps/editor/src/layer-settlements.js';
import {waterBehaviors} from '../apps/editor/src/layer-water.js';
import {operationProblem} from '../apps/editor/src/layer-rules.js';
import {collectionOf} from '../apps/editor/src/source-records.js';

const {applyChangeset} = await import(dataToolURL('apply-changeset.mjs'));
const now = '2026-11-25T10:00:00.000Z';
const envelope = {id: 'layer-export', createdAt: now, author: 'Integration Test', reason: 'One layer'};
const rules = readContractJSON('editor-layers.json');
const levels = new Set(readContractJSON('place-visibility.json').levels.map(({level}) => level));

const layerBehaviors = [
  buildingBehaviors,
  addressBehaviors,
  placeBehaviors,
  roadBehaviors,
  greenBehaviors,
  waterBehaviors,
  reliefBehaviors,
  settlementBehaviors
];
layerBehaviors.forEach(behaviors => registerBehaviors(behaviors));

export const newLocalId = () => `local:${crypto.randomUUID()}`;

// The editor without its screen, over the reviewed sources.
export class HeadlessEditor {
  #root;
  #sources;

  constructor(testContext) {
    this.#root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-layer-export-'));
    testContext.after(() => fs.rmSync(this.#root, {recursive: true, force: true}));
    stageContractsInto(this.#root);
    stageDataInto(this.#root);
    this.#sources = new Map(Object.keys(rules.layers).map(filename => [filename, this.#loadSource(filename)]));
    this.session = new EditSession(this.#sources);
    this.context = {
      session: this.session,
      rules,
      levels,
      layer: null,
      isPhone: () => false,
      entriesOf: filename => this.session.workingEntries(filename),
      findEntity: (filename, entityId) =>
        this.session.workingEntries(filename).find(({key, feature}) => (feature.properties.entityId ?? key) === entityId)
    };
  }

  #loadSource(filename) {
    const bytes = fs.readFileSync(stagedSourcePath(this.#root, filename));
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    return {metadata: {filename, sha256}, collection: collectionOf(filename, JSON.parse(bytes))};
  }

  features(filename) {
    return this.#sources.get(filename).collection.features;
  }

  // The first entry that a test can use. It fails by name when the sources have none.
  find(filename, isWanted) {
    const entry = this.session.workingEntries(filename).find(({feature, key}) => isWanted(feature, key));
    assert.ok(entry, `${filename} has an object this test needs`);
    return entry;
  }

  // What a command of the editor records as one step.
  record(edits) {
    this.session.recordEdits('layer', edits);
  }

  // What Apply records. Returns why the editor refuses it, or null.
  apply(filename, key, feature, extras = {}) {
    const behavior = behaviorOf(filename);
    const before = this.session.workingFeature(filename, key);
    const prepared = behavior.prepared(feature, this.context, {isNew: !before, key, filename, extras});
    const edit = {filename, key, feature: prepared, before, extras};
    const problem = behavior.problem(edit, this.context);
    if (problem) return problem;
    const companions = behavior.companionEdits(edit, this.context);
    this.session.recordEdits('layer', [{filename, key, after: prepared}, ...companions]);
    return null;
  }

  // What confirming a deletion records, with the choice of this label if it asks one. Returns the refusal, or null.
  remove(filename, key, choiceLabel = null) {
    const feature = this.session.workingFeature(filename, key);
    const {problem, edits, options = []} = behaviorOf(filename).deletion({filename, key, feature}, this.context);
    if (problem) return problem;
    const choice = options.find(({label}) => label === choiceLabel);
    this.session.recordEdits('layer', [{filename, key, after: null}, ...edits, ...(choice?.edits ?? [])]);
    return null;
  }

  // Exports and imports, as a reviewer does. Returns the operations; the written sources are read with written().
  async exportAndImport() {
    const changeset = JSON.parse(JSON.stringify(await buildChangeset(this.session, this.#sources, envelope)));
    for (const operation of changeset.operations) {
      assert.equal(operationProblem(operation, rules, levels), null, `${operation.filename} passes the editor's rules`);
    }
    applyChangeset(changeset, this.#root, {now, contractsDirectory});
    return changeset.operations;
  }

  written(filename) {
    return this.#loadSource(filename).collection.features;
  }
}
