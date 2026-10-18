// A bounded, locally bundled sample; no third-party runtime requests.
export const satelliteBounds = [19.25079345703125, 42.43764720010869, 19.26177978515625, 42.44575471885852];
export const satelliteLayerIds = ['satellite-preview', 'satellite-tiles'];
export function installSatellite(map, baseURL) {
  const absolute = path => new URL(path, baseURL).href;
  const [west, south, east, north] = satelliteBounds;
  // Keep the complete footprint visible below native tile zoom and while tiles load.
  map.addSource('satellite-preview', {
    type: 'image', url: absolute('data/satellite/podgorica-center.webp'),
    coordinates: [[west, north], [east, north], [east, south], [west, south]]
  });
  map.addSource('satellite-tiles', {
    type: 'raster',
    tiles: [absolute('data/satellite/tiles/') + '17/{x}/{y}.webp'],
    tileSize: 256, minzoom: 17, maxzoom: 17, bounds: satelliteBounds,
    attribution: 'Imagery: <a href="https://emapa.me/" target="_blank" rel="noopener">eMapa · Ortofoto 2025</a>'
  });
  for (const id of satelliteLayerIds) {
    map.addLayer({id, type: 'raster', source: id,
      ...(id === 'satellite-tiles' ? {minzoom: 17} : {}),
      layout: {visibility: 'none'}, paint: {'raster-fade-duration': 0}
    }, 'road-labels');
  }
}
export function setSatelliteVisible(map, visible) {
  for (const id of satelliteLayerIds) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}
