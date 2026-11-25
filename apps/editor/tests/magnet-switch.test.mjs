import test from 'node:test';
import assert from 'node:assert/strict';

let importNumber = 0;

// The switch reads storage once, when the module is opened, so each case opens its own copy of it.
async function openSwitch(testContext, storage) {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = storage;
  testContext.after(() => {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  });
  importNumber += 1;
  return import(`../src/magnet-switch.js?case=${importNumber}`);
}

function rememberingStorage(value = null) {
  return {
    getValue: value,
    written: null,
    getItem(_name) {
      return this.getValue;
    },
    setItem(_name, written) {
      this.written = written;
      this.getValue = written;
    }
  };
}

test('the switch is on until this browser remembers it off', async testContext => {
  const storage = rememberingStorage();
  const {isMagnetOn, setMagnetOn} = await openSwitch(testContext, storage);
  assert.equal(isMagnetOn(), true);
  setMagnetOn(false);
  assert.equal(isMagnetOn(), false);
  assert.equal(storage.written, 'off');
  setMagnetOn(true);
  assert.equal(storage.written, 'on');
});

test('a remembered off switch opens off', async testContext => {
  const {isMagnetOn} = await openSwitch(testContext, rememberingStorage('off'));
  assert.equal(isMagnetOn(), false);
});

test('storage that refuses to work leaves a switch that still works for this page', async testContext => {
  const refused = {
    getItem() {
      throw new Error('storage is blocked');
    },
    setItem() {
      throw new Error('storage is blocked');
    }
  };
  const {isMagnetOn, setMagnetOn} = await openSwitch(testContext, refused);
  assert.equal(isMagnetOn(), true);
  setMagnetOn(false);
  assert.equal(isMagnetOn(), false);
});
