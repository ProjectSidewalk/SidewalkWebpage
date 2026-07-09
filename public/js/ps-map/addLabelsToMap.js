/**
 * Adds labels to the map, creating one Mapbox layer per label type. Resolves once all layers have loaded.
 *
 * @param {object} map The Mapbox map object.
 * @param {object} labelData GeoJSON FeatureCollection of labels to draw on the map.
 * @param {object} params Properties that can change the process of choropleth creation.
 * @param {string} params.mapName Name of the HTML ID of the map.
 * @param {string} [params.highQualityFilter] If true, only show labels from users marked as high quality.
 * @param {boolean} [params.logClicks=true] Whether clicks should be logged.
 * @param {string} [params.uiSource] Used to record the UI used when submitting a validation through the popup.
 * @param {object} [params.popupLabelViewer] Shows a validation popup on labels on the map.
 * @returns {Promise} Promise that resolves with the mapData object.
 */
function addLabelsToMap(map, labelData, params) {
  const colorMapping = util.misc.getLabelColors();
  const mapData = CreateMapLayerTracker();

  // Sort labels into flat arrays by label type.
  for (const feature of labelData.features) {
    const labelType = feature.properties.label_type;
    if (mapData.sortedLabels[labelType]) {
      mapData.sortedLabels[labelType].push(feature);
    }
  }

  // Create one source + layer per label type.
  for (const labelType of Object.keys(mapData.sortedLabels)) {
    mapData.layerNames[labelType] = createLayer(mapData.sortedLabels[labelType], labelType);
  }

  // Apply the initial set of filters (incorrect is unchecked by default). Use highQualityFilter param if provided,
  // defaulting to false so labels aren't hidden before MapSidebarFilter takes over with the correct setting.
  filterLabelLayers('incorrect', map, mapData, params.highQualityFilter || false);

  // Set up label hover and popup functionality.
  if (params.popupLabelViewer) {
    const allLayerNames = Object.values(mapData.layerNames);

    map.on('click', allLayerNames, async (event) => {
      await params.popupLabelViewer.showLabel(event.features[0].properties.label_id, params.uiSource);
    });

    let hoveredLab = null;
    map.on('mousemove', allLayerNames, (event) => {
      const currLab = event.features[0];
      if (hoveredLab && hoveredLab.properties.label_id !== currLab.properties.label_id) {
        map.setFeatureState({ source: hoveredLab.layer.id, id: hoveredLab.properties.label_id }, { hover: false });
        map.setFeatureState({ source: currLab.layer.id, id: currLab.properties.label_id }, { hover: true });
        hoveredLab = currLab;
      } else if (!hoveredLab) {
        map.setFeatureState({ source: currLab.layer.id, id: currLab.properties.label_id }, { hover: true });
        hoveredLab = currLab;
        document.querySelector('.mapboxgl-canvas').style.cursor = 'pointer';
      }
    });
    map.on('mouseleave', allLayerNames, () => {
      if (hoveredLab) {
        map.setFeatureState({ source: hoveredLab.layer.id, id: hoveredLab.properties.label_id }, { hover: false });
        hoveredLab = null;
        document.querySelector('.mapboxgl-canvas').style.cursor = '';
      }
    });
  }

  /**
   * Creates a single Mapbox source and circle layer for the given label type.
   * @param {Array} features GeoJSON features for this label type.
   * @param {string} labelType The label type key.
   * @returns {string} The layer name.
   */
  function createLayer(features, labelType) {
    const layerName = `labels-${labelType}`;
    map.addSource(layerName, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
      promoteId: 'label_id',
    });
    map.addLayer({
      id: layerName,
      type: 'circle',
      source: layerName,
      layout: { visibility: 'visible' },
      paint: {
        'circle-radius': [
          'interpolate', ['exponential', 1.5], ['zoom'],
          12, ['case', ['boolean', ['feature-state', 'hover'], false], 8, 3],
          20, ['case', ['boolean', ['feature-state', 'hover'], false], 20, 8],
        ],
        'circle-opacity': 0.75,
        'circle-stroke-opacity': 0.75,
        'circle-stroke-width': 0.75,
        'circle-color': [
          'case',
          ['all', ['==', ['get', 'expired'], true], ['!=', ['get', 'has_backup'], true]], 'lightgrey',
          colorMapping[labelType].fillStyle,
        ],
        'circle-stroke-color': [
          'case',
          ['all', ['==', ['get', 'expired'], true], ['!=', ['get', 'has_backup'], true]],
          colorMapping[labelType].fillStyle,
          colorMapping[labelType].strokeStyle,
        ],
      },
    });
    return layerName;
  }

  /**
   * Checks if all label layers have been added to the map.
   * @returns {boolean} True if all layers are loaded.
   */
  function allLabelLayersLoaded() {
    return Object.values(mapData.layerNames).every((name) => map.getLayer(name) !== undefined);
  }

  // Return promise that resolves once all layers have been added.
  return new Promise((resolve) => {
    if (allLabelLayersLoaded()) {
      resolve(mapData);
    } else {
      map.on('sourcedataloading', () => {
        if (allLabelLayersLoaded()) {
          resolve(mapData);
        }
      });
    }
  });
}
