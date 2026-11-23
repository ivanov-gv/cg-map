import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizePlaces, parseVisibilityConfig, placeBands, placeLayers} from '@ivanov-gv/map-core';

const readContract = name => JSON.parse(readFileSync(new URL(import.meta.resolve(`@ivanov-gv/map-contracts/${name}`))));
const levels = parseVisibilityConfig(readContract('place-visibility.json'));
const place = (id, visibilityLevel, coordinates = [19.26, 42.44]) => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates},
  properties: {id, name: id, category: 'shops', visibilityLevel}
});

test('the pinned contract gives every visibility level its published threshold', () => {
  assert.deepEqual(
    levels.levels.map(level => levels.thresholds.get(level)),
    [12, 14, 15, 16, 17]
  );
  assert.equal(levels.fallback, 5);
});

test('a present but invalid level fails instead of becoming a high-priority place', () => {
  assert.throws(() => normalizePlaces([place('bad', 0)], levels), /invalid visibilityLevel 0/);
  assert.throws(() => parseVisibilityConfig({...readContract('place-visibility.json'), version: 2}), /unsupported/);
});

test('each level opens its icon layer at its own threshold and ignores label collisions', () => {
  const directory = normalizePlaces(
    levels.levels.map(level => place(`l${level}`, level, [19.26 + level / 10000, 42.44])),
    levels
  );
  const icons = placeLayers(placeBands(directory, levels), levels).icons;
  assert.deepEqual(
    icons.map(layer => [layer.id, layer.minzoom]),
    [5, 4, 3, 2, 1].map(level => [`place-icons-${level}-open`, levels.thresholds.get(level)])
  );
  assert.ok(icons.every(layer => layer.layout['icon-allow-overlap'] && layer.layout['icon-ignore-placement']));
});

test('an override admits only its own place in the earlier band', () => {
  const coordinates = [19.26, 42.44];
  const directory = normalizePlaces(
    [
      place('late', 5, coordinates),
      place('stays', 5, coordinates),
      place('early', 2, coordinates),
      place('middle', 3, coordinates)
    ],
    levels
  );
  const promoted = directory.map(feature =>
    feature.properties.id === 'late' ? {...feature, properties: {...feature.properties, visibilityLevel: 3}} : feature
  );
  const bands = placeBands(promoted, levels);
  const transition = bands.find(band => band.id === '3-5');
  assert.deepEqual([transition.start, transition.end], [3, 5]);
  assert.equal(bands.filter(band => band.start === 2).length, 3);
});
