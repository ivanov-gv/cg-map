import {buildPlaceMarkers, markerKeys, normalizePlaces} from '@ivanov-gv/map-core';

// Shows the map as a rebuild would, with every pending edit in every file applied and drawn in the public cartography.
// It is not a rebuild: tiles simplify geometry and leave out minor roads at low zoom, which this does not, so it shows
// more detail than the release below street scale. At street scale the two match.
const previewPrefix = 'edit-preview-';
const placesFile = 'places.geojson';
const labelsFile = 'building-labels.geojson';
const placesSource = 'places';
const labelsSource = 'building-addresses';
// Hides a published layer while keeping it in the style, so its own filter can be put back.
export const hiddenLayerFilter = ['==', ['literal', 1], 0];

const featureCollection = features => ({type: 'FeatureCollection', features});

// Copies of the published layers that draw one file, reading a GeoJSON source instead of the vector archive. Paint,
// layout, filters and zoom ranges stay as they are, so the edit looks as it will once released.
export function previewLayers(publishedLayers, sourceName) {
  return publishedLayers.map(layer => {
    const copy = {...layer, id: previewPrefix + layer.id, source: sourceName};
    delete copy['source-layer'];
    return copy;
  });
}

// The markers the public map would draw for these places. Throws on a place it could not publish, as the public app does.
// The place layers stay those built for the published places, so in the rare case that an edit puts places of a new
// combination of levels on one spot, that marker is missing from the preview.
function placeMarkers(features, visibilityConfig) {
  const directory = normalizePlaces(features, visibilityConfig);
  return featureCollection(buildPlaceMarkers(directory, markerKeys(directory)));
}

export class EditPreview {
  #map;
  #basemapLayers;
  #visibilityConfig;
  #publishedPlaces;
  #hiddenFilters = new Map();
  #addedLayerIds = [];
  #addedSourceIds = [];
  #replacedSources = new Map();
  #isShown = false;

  // basemapLayers maps a source file to the published layers that draw it from the vector archive. publishedPlaces are
  // the places as released, to put back when the preview ends.
  constructor({map, basemapLayers, visibilityConfig, publishedPlaces}) {
    this.#map = map;
    this.#basemapLayers = basemapLayers;
    this.#visibilityConfig = visibilityConfig;
    this.#publishedPlaces = publishedPlaces;
  }

  get isShown() {
    return this.#isShown;
  }

  // Replaces what is shown with these files. Each entry is a changed file and all its working features; a file with no
  // entry keeps its published form. Everything that can fail is built before the map changes, so a throw, such as a place
  // the public map would refuse, leaves the published map as it was and the preview hidden.
  show(workingFeaturesByFile) {
    this.hide();
    const placeData = workingFeaturesByFile.has(placesFile)
      ? placeMarkers(workingFeaturesByFile.get(placesFile), this.#visibilityConfig)
      : null;
    const publishedPlaceData = placeData ? this.#publishedData(placesSource) : null;
    if (placeData) this.#replaceSourceData(placesSource, placeData, publishedPlaceData);
    for (const [filename, features] of workingFeaturesByFile) {
      if (filename === labelsFile)
        this.#replaceSourceData(labelsSource, featureCollection(features), this.#publishedData(labelsSource));
      else if (this.#basemapLayers[filename]) this.#drawInsteadOfBasemap(filename, features);
    }
    this.#isShown = true;
  }

  // Puts the published map back exactly as it was.
  hide() {
    for (const layerId of this.#addedLayerIds) this.#map.removeLayer(layerId);
    for (const sourceId of this.#addedSourceIds) this.#map.removeSource(sourceId);
    for (const [layerId, filter] of this.#hiddenFilters) this.#map.setFilter(layerId, filter);
    for (const [sourceId, data] of this.#replacedSources) this.#map.getSource(sourceId).setData(data);
    this.#addedLayerIds = [];
    this.#addedSourceIds = [];
    this.#hiddenFilters = new Map();
    this.#replacedSources = new Map();
    this.#isShown = false;
  }

  #replaceSourceData(sourceId, data, publishedData) {
    this.#replacedSources.set(sourceId, publishedData);
    this.#map.getSource(sourceId).setData(data);
  }

  // Labels are loaded from a URL, which the style still holds. Places are built in the browser, so build them again.
  #publishedData(sourceId) {
    if (sourceId === placesSource) return placeMarkers(this.#publishedPlaces, this.#visibilityConfig);
    return this.#map.getStyle().sources[sourceId].data;
  }

  // Each copy goes directly below its hidden original, so the drawing order stays the published one.
  #drawInsteadOfBasemap(filename, features) {
    const sourceId = previewPrefix + filename;
    this.#map.addSource(sourceId, {type: 'geojson', data: featureCollection(features)});
    this.#addedSourceIds.push(sourceId);
    const layerIds = this.#basemapLayers[filename];
    const publishedLayers = this.#map.getStyle().layers.filter(layer => layerIds.includes(layer.id));
    for (const layer of previewLayers(publishedLayers, sourceId)) {
      const originalId = layer.id.slice(previewPrefix.length);
      this.#map.addLayer(layer, originalId);
      this.#addedLayerIds.push(layer.id);
      this.#hiddenFilters.set(originalId, this.#map.getFilter(originalId) ?? null);
      this.#map.setFilter(originalId, hiddenLayerFilter);
    }
  }
}
