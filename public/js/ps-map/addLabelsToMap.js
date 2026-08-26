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

  // Create one (empty) source + layer per label type, then populate through setLabelData — the same path a
  // viewport refetch takes — so initial load and refresh can't drift apart.
  for (const labelType of Object.keys(mapData.sortedLabels)) {
    mapData.layerNames[labelType] = createLayer(labelType);
  }
  setLabelData(map, mapData, labelData);

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
   * Creates a single empty Mapbox source and circle layer for the given label type.
   * @param {string} labelType The label type key.
   * @returns {string} The layer name.
   */
  function createLayer(labelType) {
    const layerName = `labels-${labelType}`;
    map.addSource(layerName, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
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

  // addSource/addLayer are synchronous, so every layer already exists here. 'sourcedataloading' can't be the
  // readiness signal: it refires on every setData, for the life of a viewport-refreshed map.
  return Promise.resolve(mapData);
}

/**
 * Replaces the label data shown on the map — the one sanctioned way to swap it once addLabelsToMap has built
 * the layers. The per-type arrays in mapData.sortedLabels are emptied and refilled rather than reassigned, so
 * every reference-holder (sidebar counts, nearby-label navigator, download control) sees fresh data unre-wired.
 *
 * Layer-level state (setFilter expressions, visibility, paint) survives setData; hover feature-state doesn't,
 * which is fine — the next mousemove restores it, and setFeatureState on an absent id is a silent no-op.
 *
 * @param {object} map The Mapbox map object.
 * @param {object} mapData The layer tracker from CreateMapLayerTracker.
 * @param {object} labelData GeoJSON FeatureCollection of labels to draw.
 */
function setLabelData(map, mapData, labelData) {
  for (const features of Object.values(mapData.sortedLabels)) features.length = 0;
  for (const feature of labelData.features) {
    mapData.sortedLabels[feature.properties.label_type]?.push(feature);
  }
  for (const [labelType, layerName] of Object.entries(mapData.layerNames)) {
    map.getSource(layerName)?.setData({ type: 'FeatureCollection', features: mapData.sortedLabels[labelType] });
  }
}
