import {buildPlaceMarkers, markerKeys, normalizePlaces, placeBands, placeLayers} from '@ivanov-gv/map-core';
import {basemapLayersFromStyle} from './basemap-layers.js';

// Draws changed files, and the files of the active layer, with the public cartography from their working features. It is
// not a rebuild: tiles simplify geometry and leave out minor roads at low zoom, which this does not, so it shows
// more detail than the release below street scale. At street scale the two match.
const previewPrefix = 'edit-preview-';
const fadedOpacity = 0.2;
const placesFile = 'places.geojson';
const labelsFile = 'building-labels.geojson';
const placesSource = 'places';
const labelsSource = 'building-addresses';
// Hides a published layer while keeping it in the style, so its own filter can be put back.
export const hiddenLayerFilter = ['==', ['literal', 1], 0];

const featureCollection = features => ({type: 'FeatureCollection', features});

// Copies of the published layers that draw one file, reading a GeoJSON source instead of the vector archive. Paint,
// layout, filters and zoom ranges stay as they are, so the edit looks as it will once released.
// A shared source holds several files, so each copy then draws only its own.
export function previewLayers(publishedLayers, sourceName, sharedFilename = null) {
  return publishedLayers.map(layer => {
    const copy = {...layer, id: previewPrefix + layer.id, source: sourceName};
    delete copy['source-layer'];
    if (sharedFilename) {
      const isOwnFile = ['==', ['get', 'sourceFile'], sharedFilename];
      copy.filter = layer.filter ? ['all', layer.filter, isOwnFile] : isOwnFile;
    }
    return copy;
  });
}

function placeIdentity(feature) {
  const identity =
    feature.properties.entityId ?? feature.properties.id ?? feature.properties.selectionKey ?? feature.id;
  if (typeof identity === 'string' && identity) return identity;
  if (typeof identity === 'number' && Number.isFinite(identity)) return String(identity);
  return undefined;
}

// Map-core resolves visibility from overrides, stored levels and the policy; the editor only adds identity for
// features that carry it outside properties, such as local working features keyed by selectionKey.
function withPlaceIdentity(features) {
  return features.map(feature => {
    const identity = placeIdentity(feature);
    const needsIdentity =
      identity !== undefined && feature.properties.entityId === undefined && feature.properties.id === undefined;
    return needsIdentity ? {...feature, properties: {...feature.properties, entityId: identity}} : feature;
  });
}

// The markers the public map would draw for these places. Throws on a place it could not publish, as the public app does.
function placeMarkers(features, visibilityConfig) {
  const directory = normalizePlaces(withPlaceIdentity(features), visibilityConfig);
  return featureCollection(buildPlaceMarkers(directory, markerKeys(directory)));
}

export class WorkingMap {
  #map;
  #basemapLayers;
  #visibilityConfig;
  #publishedPlaces;
  #sharedSource;
  #previewFeaturesByFile;
  #previewSources = new Map();
  #hiddenFilters = new Map();
  #addedLayerIds = [];
  #addedSourceIds = [];
  #replacedSources = new Map();
  #previewOriginalIds = new Map();
  #usedPreviewLayerIds = new Set();
  #shownLevel = null;
  #shownSignature = null;

  // basemapLayers maps a source file to the published layers that draw it from the vector archive. By default it comes
  // from the map's own style, so no edit relies on a list of cartographic layers kept in the Editor. publishedPlaces
  // are the places as released, to put back when the preview ends.
  constructor({
    map,
    basemapLayers = basemapLayersFromStyle(map.getStyle().layers),
    visibilityConfig,
    publishedPlaces,
    sharedSource = null,
    previewFeaturesByFile = null
  }) {
    this.#map = map;
    this.#basemapLayers = basemapLayers;
    this.#visibilityConfig = visibilityConfig;
    this.#publishedPlaces = publishedPlaces;
    this.#sharedSource = sharedSource;
    this.#previewFeaturesByFile = previewFeaturesByFile;
  }

  // Only rendered normal cartography is selectable when edit guides are off. Sources replaced in place keep their layers.
  get layerIds() {
    const replacedSources = new Set(this.#replacedSources.keys());
    const layers = this.#map.getStyle().layers;
    return [...this.#addedLayerIds, ...layers.filter(layer => replacedSources.has(layer.source)).map(layer => layer.id)];
  }

  // Replaces what is shown with these files. Each entry is a file and all its working features; a file with no entry keeps
  // its published form. Files in sharedFiles are already in the shared source, where their features can be picked.
  // Everything that can fail is built before the map changes, so a throw, such as a place
  // the public map would refuse, leaves the published map as it was and the preview hidden.
  show(workingFeaturesByFile, sharedFiles = new Set()) {
    let placeData;
    let publishedPlaceData;
    try {
      placeData = workingFeaturesByFile.has(placesFile)
        ? placeMarkers(workingFeaturesByFile.get(placesFile), this.#visibilityConfig)
        : null;
      publishedPlaceData = placeData ? this.#publishedData(placesSource) : null;
    } catch (error) {
      this.hide();
      throw error;
    }
    const signature = this.#previewSignature(workingFeaturesByFile, sharedFiles);
    if (this.#shownSignature === signature) {
      this.#updatePreviewData(workingFeaturesByFile, sharedFiles, placeData);
      return;
    }
    this.hide();
    if (placeData) {
      this.#replaceSourceData(placesSource, placeData, publishedPlaceData);
      this.#installWorkingPlaceBands(workingFeaturesByFile.get(placesFile));
    }
    for (const [filename, features] of workingFeaturesByFile) {
      if (filename === labelsFile)
        this.#replaceSourceData(labelsSource, featureCollection(features), this.#publishedData(labelsSource));
      else if (this.#basemapLayers[filename]) {
        this.#drawInsteadOfBasemap(filename, features, sharedFiles.has(filename));
      }
    }
    this.#shownSignature = signature;
  }

  // The copied layers depend on which files are shown, not on the value of every feature. Place bands are the exception:
  // their names and icons come from the markers themselves. A repeat with the same signature only needs new source data.
  #previewSignature(workingFeaturesByFile, sharedFiles) {
    const files = [...workingFeaturesByFile].map(([filename, features]) => [
      filename,
      filename === placesFile ? JSON.stringify(features) : null,
      sharedFiles.has(filename)
    ]);
    return JSON.stringify(files);
  }

  // Updates the data behind layers that are already on the map. A derived file, such as a version 5 surface, keeps one
  // source per published layer even when the overlay also draws it, so those sources must be refreshed here. An ordinary
  // shared file is refreshed by the overlay; the other files use their one preview source.
  #updatePreviewData(workingFeaturesByFile, sharedFiles, placeData) {
    if (placeData) this.#map.getSource(placesSource).setData(placeData);
    const labels = workingFeaturesByFile.get(labelsFile);
    if (labels) this.#map.getSource(labelsSource).setData(featureCollection(labels));
    for (const [filename, features] of workingFeaturesByFile) {
      if (!this.#basemapLayers[filename]) continue;
      if (!this.#previewFeaturesByFile?.has(filename)) {
        if (sharedFiles.has(filename)) continue;
        this.#map.getSource(previewPrefix + filename).setData(featureCollection(features));
        continue;
      }
      for (const [sourceId, {filename: sourceFilename, publishedId}] of this.#previewSources) {
        if (sourceFilename !== filename) continue;
        const published = this.#map.getStyle().layers.find(layer => layer.id === publishedId);
        const drawn = this.#previewFeaturesByFile.get(filename)(published, features);
        this.#map.getSource(sourceId).setData(featureCollection(drawn));
      }
    }
  }

  // Fades what is under or over the shown level, so that its own lines stand out. null shows every level as published.
  setShownLevel(level) {
    const isAnythingFaded = this.#shownLevel !== null || level !== null;
    this.#shownLevel = level;
    if (!isAnythingFaded) return;
    const layers = this.#map.getStyle().layers.filter(({id, type}) => type === 'line' && this.#addedLayerIds.includes(id));
    for (const {id} of layers) this.#map.setPaintProperty(id, 'line-opacity', this.#opacityOf(id));
  }

  #opacityOf(layerId) {
    const originalId = this.#previewOriginalIds.get(layerId);
    const published = this.#map.getPaintProperty(originalId, 'line-opacity');
    if (this.#shownLevel === null) return published;
    const isOnLevel = ['any', ['!', ['has', 'levelKeys']], ['in', `,${this.#shownLevel},`, ['get', 'levelKeys']]];
    return ['case', isOnLevel, published ?? 1, fadedOpacity];
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
    this.#previewOriginalIds = new Map();
    this.#usedPreviewLayerIds = new Set();
    this.#previewSources = new Map();
    this.#shownSignature = null;
  }

  // A move or addition can create a shared marker with a level combination absent from the release. Install its bands
  // in the public drawing order, and remove only these extra layers when restoring the published map.
  #installWorkingPlaceBands(features) {
    const directory = normalizePlaces(withPlaceIdentity(features), this.#visibilityConfig);
    const {names, icons} = placeLayers(placeBands(directory, this.#visibilityConfig), this.#visibilityConfig);
    let nextLayerId = 'road-labels';
    for (const layer of [...names, ...icons].reverse()) {
      if (!this.#map.getLayer(layer.id)) {
        this.#map.addLayer(layer, nextLayerId);
        this.#addedLayerIds.push(layer.id);
      }
      nextLayerId = layer.id;
    }
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

  // Two files can share a published layer, such as land and protected areas sharing park names. Each working copy
  // needs its own id, but the published layer is hidden and restored only once.
  #previewIdFor(layerId, filename) {
    const sharedId = `${previewPrefix}${layerId}`;
    if (!this.#usedPreviewLayerIds.has(sharedId)) return sharedId;
    const withFilename = `${sharedId}-${filename}`;
    if (!this.#usedPreviewLayerIds.has(withFilename)) return withFilename;
    let number = 2;
    while (this.#usedPreviewLayerIds.has(`${withFilename}-${number}`)) number += 1;
    return `${withFilename}-${number}`;
  }

  // Each copy goes directly below its hidden original, so the drawing order stays the published one. A file whose
  // features differ per published layer, such as a surface whose labels are stored on the objects, gets one source per
  // layer; the other files keep the single source they had.
  #drawInsteadOfBasemap(filename, features, isShared) {
    const layerIds = this.#basemapLayers[filename];
    const publishedLayers = this.#map.getStyle().layers.filter(layer => layerIds.includes(layer.id));
    if (publishedLayers.length === 0) return;
    const derivation = this.#previewFeaturesByFile?.get(filename) ?? null;
    // Several published layers can draw one file. They share one preview source; only a per-layer derivation needs its
    // own. MapLibre refuses a second registration of the same source ID.
    const fileSourceId = !derivation && !isShared ? previewPrefix + filename : null;
    if (fileSourceId) {
      this.#map.addSource(fileSourceId, {type: 'geojson', data: featureCollection(features)});
      this.#addedSourceIds.push(fileSourceId);
    }
    for (const published of publishedLayers) {
      const sourceId = derivation
        ? `${previewPrefix}${filename}-${published.id}`
        : isShared
          ? this.#sharedSource
          : fileSourceId;
      const drawnFeatures = derivation ? derivation(published, features) : features;
      if (derivation) {
        this.#map.addSource(sourceId, {type: 'geojson', data: featureCollection(drawnFeatures)});
        this.#addedSourceIds.push(sourceId);
        this.#previewSources.set(sourceId, {filename, publishedId: published.id});
      }
      const [copy] = previewLayers([published], sourceId, !derivation && isShared ? filename : null);
      copy.id = this.#previewIdFor(published.id, filename);
      this.#usedPreviewLayerIds.add(copy.id);
      this.#previewOriginalIds.set(copy.id, published.id);
      this.#map.addLayer(copy, published.id);
      this.#addedLayerIds.push(copy.id);
      if (this.#hiddenFilters.has(published.id)) continue;
      this.#hiddenFilters.set(published.id, this.#map.getFilter(published.id) ?? null);
      this.#map.setFilter(published.id, hiddenLayerFilter);
    }
  }
}
