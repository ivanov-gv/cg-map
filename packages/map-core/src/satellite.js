// A bounded, locally bundled sample; no third-party runtime requests.
export const satelliteBounds = [19.25079345703125, 42.43764720010869, 19.26177978515625, 42.44575471885852];
export const satelliteLayerIds = ['satellite-preview', 'satellite-tiles'];
// Install bounded local imagery beneath names; callers control visibility and camera separately.
export function installSatellite(map, baseURL) {
  const assetURL = path => new URL(path, baseURL).href;
  const [west, south, east, north] = satelliteBounds;
  // Keep the complete footprint visible below native tile zoom and while tiles load.
  map.addSource('satellite-preview', {
    type: 'image',
    url: assetURL('data/satellite/podgorica-center.webp'),
    coordinates: [
      [west, north],
      [east, north],
      [east, south],
      [west, south]
    ]
  });
  map.addSource('satellite-tiles', {
    type: 'raster',
    tiles: [assetURL('data/satellite/tiles/') + '17/{x}/{y}.webp'],
    tileSize: 256,
    minzoom: 17,
    maxzoom: 17,
    bounds: satelliteBounds,
    attribution: 'Imagery: <a href="https://emapa.me/" target="_blank" rel="noopener">eMapa · Ortofoto 2025</a>'
  });
  for (const layerId of satelliteLayerIds) {
    map.addLayer(
      {
        id: layerId,
        type: 'raster',
        source: layerId,
        ...(layerId === 'satellite-tiles' ? {minzoom: 17} : {}),
        layout: {visibility: 'none'},
        paint: {'raster-fade-duration': 0}
      },
      'road-labels'
    );
  }
}

// Only toggles the layers; the caller decides whether the camera should move to the sample.
export function setSatelliteVisible(map, isVisible) {
  for (const layerId of satelliteLayerIds) {
    map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
  }
}
