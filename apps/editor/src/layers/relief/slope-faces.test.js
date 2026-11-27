import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {slopeFaceFeatures, splitFaces} from './slope-faces.js';

const fixture = JSON.parse(readFileSync(new URL('../../../tests/fixtures/slope-faces.json', import.meta.url), 'utf8'));
const caseNamed = name => fixture.cases.find(entry => entry.name === name);

// A face is identified by where it lies in the green area, never by the direction its ridge was drawn.
function faceCentroid(ring) {
  let twiceArea = 0;
  let east = 0;
  let north = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    const cross = start[0] * end[1] - end[0] * start[1];
    twiceArea += cross;
    east += (start[0] + end[0]) * cross;
    north += (start[1] + end[1]) * cross;
  }
  return [east / (3 * twiceArea), north / (3 * twiceArea)].map(value => Math.round(value * 1e6) / 1e6);
}

const seen = faces => faces
  .map(face => ({
    aspect: face.aspect,
    centroid: faceCentroid(face.geometry.coordinates[0]),
    areaSquareMetres: face.areaSquareMetres
  }))
  .sort((first, second) => first.centroid[1] - second.centroid[1]);

const expected = cases => [...cases].sort((first, second) => first.centroid[1] - second.centroid[1]);

for (const {name, ridges, azimuthDegrees, expected: wanted} of fixture.cases) {
  test(name, () => {
    const faces = splitFaces(
      fixture.green,
      ridges.map(coordinates => ({type: 'LineString', coordinates})),
      {azimuthDegrees, metresPerDegree: fixture.metresPerDegree}
    );
    assert.deepEqual(seen(faces), expected(wanted));
  });
}

test('a ridge whose bounds miss a green area cannot split it', () => {
  const farRidge = {type: 'LineString', coordinates: [[20, 20], [30, 20]]};
  assert.deepEqual(splitFaces(fixture.green, [farRidge], {metresPerDegree: [1, 1]}), []);
});

test('preview slopes leave flat faces and faces below the minimum area out', () => {
  const land = [{type: 'Feature', properties: {kind: 'park'}, geometry: fixture.green}];
  const boundaryRidge = {
    type: 'LineString',
    coordinates: caseNamed('a horizontal ridge has a sunlit south face and a shaded north face').ridges[0]
  };
  const danglingRidge = {
    type: 'LineString',
    coordinates: caseNamed('a ridge that does not reach the outline leaves the rest flat').ridges[0]
  };
  const options = {metresPerDegree: [10, 10]};
  assert.deepEqual(
    slopeFaceFeatures(land, [boundaryRidge], options).map(feature => feature.properties.aspect).sort(),
    ['shaded', 'sunlit']
  );
  assert.deepEqual(slopeFaceFeatures(land, [danglingRidge], options), []);
  assert.deepEqual(
    slopeFaceFeatures(land, [boundaryRidge], {metresPerDegree: [0.1, 0.1]}),
    []
  );
});
