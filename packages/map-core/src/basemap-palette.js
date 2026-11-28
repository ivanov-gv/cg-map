// Default-state colours of the basemap primitives, from the Penpot card "7 · Map primitives (Core)" and the Core page
// rules. One token per primitive part, so the style never repeats a literal colour and a design change is one edit.
// Returns the red, green and blue channels (0–255) of a '#rrggbb' token.
export function colorChannels(hex) {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}

export const basemapColors = {
  background: '#f2f1e7',
  land: '#efeee2',
  park: '#d6e6c3',
  sunlitSlope: '#c9ddb2',
  shadedSlope: '#b3cf98',
  contour: '#8c7a5e',
  // Halfway between land and the sunlit slope: most heights sit on land, the hill heights the wiki cares about on green.
  contourLabelHalo: '#dce6ca',
  summit: '#5e5040',
  summitHalo: '#f6f3ea',
  parkName: '#4e7a3e',
  parkNameHalo: '#e8f0dc',
  settlementLabel: '#3c5945',
  settlementLabelHalo: '#fafaf0',
  water: '#aad3df',
  canyonWallAtWater: '#a69880',
  canyonWallAtRim: '#e2dbcb',
  canyonRim: '#d3cab8',
  // Neutral grey deck surface, kept distinct from the warm building fill and from water and ground.
  bridgeDeck: '#c9c9c6',
  bridgeDeckEdge: '#4e463c',
  // Soft greys near land and minor-road casings keep tracks visible without competing with streets or labels.
  railwayTrack: '#b0ada4',
  railwayTie: '#e6e4db',
  railwayPlatform: '#e2e1da',
  railwaySymbol: '#454d4c',
  building: '#d9d0c9',
  buildingOutline: '#c7bcb1',
  majorStreet: '#e8c27c',
  majorStreetCasing: '#c9a15a',
  minorStreet: '#ffffff',
  minorStreetCasing: '#d3cdc3',
  pedestrianStreet: '#f4ead6',
  meadow: '#e3edd3',
  cityFootpath: '#b8a089',
  trail: '#9c8a6e',
  parkRoute: '#fbf7ee',
  parkRouteCasing: '#cdbb9c',
  cycleway: '#2c6fb0',
  stairway: '#b9a88e',
  streetLabel: '#7b7b69',
  streetLabelHalo: '#f8f8ee',
  houseNumber: '#514d44',
  houseNumberHalo: '#fffef8'
};
