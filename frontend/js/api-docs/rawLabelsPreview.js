/**
 * Raw Labels Map Preview Generator.
 *
 * This script generates a live map preview of raw PS labels by fetching data directly from the Raw Labels API.
 *
 * @requires DOM element with id 'raw-labels-preview'
 * @requires mapbox-gl and js/api-docs/apiDocsMap.js
 */

import { geometryBounds } from '../common/geoBounds.js';
import { util } from '../common/utilities.js';
import { ApiDocsMap } from './apiDocsMap.js';
import { ApiDocsTheme } from './apiDocsTheme.js';

export const LABELS_LAYER = 'raw-labels';
export const REGION_SOURCE = 'preview-region';

// Presentational only — it mirrors no backend value, and is picked to stay distinct from every label type color
// against the dimmed basemap.
export const REGION_COLOR = ApiDocsTheme.color('--color-link-200');

export let config = {
  apiBaseUrl: '/v3/api',
  containerId: 'raw-labels-preview',
  mapboxApiKey: '',
  rawLabelsEndpoint: '/rawLabels',
  labelTypesEndpoint: '/labelTypes',
  regionWithMostLabelsEndpoint: '/regionWithMostLabels',
};

export let labelTypeInfo = {};

export const RawLabelsPreview = {
  /**
   * Configure the raw labels preview.
   * @param {object} options - Configuration options
   * @returns {typeof RawLabelsPreview} The RawLabelsPreview object for chaining
   */
  setup(options) {
    config = Object.assign(config, options);
    return this;
  },

  /**
   * Initialize the raw labels preview map.
   * @returns {Promise} A promise that resolves when the preview is rendered
   */
  async init() {
    const container = document.getElementById(config.containerId);

    if (!container) {
      console.error(`Container element with id '${config.containerId}' not found.`);
      return Promise.reject(new Error('Container element not found'));
    }

    const loadingMessage = document.createElement('div');
    loadingMessage.className = 'loading-message';
    loadingMessage.textContent = 'Loading raw labels data...';
    container.appendChild(loadingMessage);

    try {
      const typeData = await this.fetchLabelTypes();
      labelTypeInfo = typeData.label_types.reduce((acc, type) => {
        acc[type.name] = { color: type.color, display: type.display_name, description: type.description };
        return acc;
      }, {});

      const regionData = await this.fetchRegionWithMostLabels();
      container.innerHTML = '';
      const map = await this.createMap(container, regionData);

      const labels = await this.fetchLabelsByRegionId(regionData.properties.region_id);
      this.displayLabelsOnMap(map, labels);
    } catch (error) {
      container.innerHTML = `<div class="message message-error" role="alert">Failed to load raw labels: `
        + `${util.escapeHTML(error.message)}</div>`;
      console.error('Raw labels preview error:', error);
      // The failure is already surfaced in the container above, and init() is fire-and-forget at every call
      // site (app/views/apiDocs/*), so re-rejecting here can only ever become an unhandled rejection.
    }
  },

  /**
   * Fetch label types from the API.
   * @returns {Promise} A promise that resolves with the label types data
   */
  fetchLabelTypes() {
    return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.labelTypesEndpoint}`);
  },

  /**
   * Fetch region with the most labels.
   * @returns {Promise} A promise that resolves with the region data
   */
  fetchRegionWithMostLabels() {
    return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.regionWithMostLabelsEndpoint}`)
      .catch((error) => {
        console.error('Error fetching region with most labels:', error);
        throw new Error('Failed to fetch region with most labels');
      });
  },

  /**
   * Fetch labels by region ID.
   * @param {number} regionId - ID of the region
   * @returns {Promise} A promise that resolves with the labels data
   */
  fetchLabelsByRegionId(regionId) {
    return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.rawLabelsEndpoint}?regionId=${regionId}`);
  },

  /**
   * Create the map, framed on the region the preview is scoped to and with that region outlined.
   * @param {HTMLElement} container - Container element for the map
   * @param {GeoJSON.Feature} regionData - GeoJSON Feature for the region to display
   * @returns {Promise<mapboxgl.Map>} A promise that resolves with the loaded Mapbox map
   */
  async createMap(container, regionData) {
    const map = await ApiDocsMap.create({
      container,
      mapboxApiKey: config.mapboxApiKey,
      bounds: geometryBounds(regionData.geometry),
    });

    // Outline the region so it's clear which slice of the city the labels below are drawn from.
    map.addSource(REGION_SOURCE, { type: 'geojson', data: regionData });
    map.addLayer({
      id: 'region-fill',
      type: 'fill',
      source: REGION_SOURCE,
      paint: { 'fill-color': REGION_COLOR, 'fill-opacity': 0.1 },
    });
    map.addLayer({
      id: 'region-outline',
      type: 'line',
      source: REGION_SOURCE,
      paint: { 'line-color': REGION_COLOR, 'line-width': 2, 'line-opacity': 0.7 },
    });

    const regionTitle = ApiDocsMap.addOverlay(map, 'top-right', 'map-chip');
    const regionName = regionData.properties.name || 'Sample Region';
    regionTitle.innerHTML = `<strong>Region:</strong> ${util.escapeHTML(regionName)}`;

    return map;
  },

  /**
   * Display labels on the map.
   * @param {mapboxgl.Map} map - The Mapbox map object
   * @param {GeoJSON.FeatureCollection} labels - GeoJSON data containing the labels
   */
  displayLabelsOnMap(map, labels) {
    if (!labels.features || labels.features.length === 0) {
      const noLabelsDiv = document.createElement('div');
      noLabelsDiv.className = 'map-message';
      noLabelsDiv.setAttribute('role', 'status');
      noLabelsDiv.textContent = 'No labels found in this region.';
      map.getContainer().appendChild(noLabelsDiv);
      return;
    }

    map.addSource(LABELS_LAYER, { type: 'geojson', data: labels });
    map.addLayer({
      id: LABELS_LAYER,
      type: 'circle',
      source: LABELS_LAYER,
      paint: {
        'circle-radius': 4,
        'circle-color': ApiDocsMap.labelTypeColorExpression(labelTypeInfo),
        'circle-opacity': 0.75,
        'circle-stroke-color': ApiDocsTheme.color('--color-neutral-black'),
        'circle-stroke-width': 1,
      },
    });

    this.addLabelPopups(map);

    const countChip = ApiDocsMap.addOverlay(map, 'top-right', 'map-chip');
    countChip.textContent = `Showing ${labels.features.length} labels`;

    // The legend lists only the types actually drawn, so it never advertises one this region has none of.
    const typesInData = [...new Set(labels.features.map((feature) => feature.properties.label_type))];
    const legend = ApiDocsMap.addOverlay(map, 'bottom-left', 'map-legend');
    ApiDocsMap.renderLabelTypeLegend(legend, 'Label Types', typesInData, labelTypeInfo,
      'No labels in this region');
  },

  /**
   * Wire up the click popup and hover cursor for the label layer.
   * @param {mapboxgl.Map} map - The Mapbox map object
   */
  addLabelPopups(map) {
    map.on('click', LABELS_LAYER, (e) => {
      const feature = e.features[0];
      const props = feature.properties;

      const severity = props.severity ? `Severity: ${util.escapeHTML(props.severity)}` : 'No severity rating';
      const tagList = ApiDocsMap.featureProp(props, 'tags');
      const tags = tagList && tagList.length ? `Tags: ${util.escapeHTML(tagList.join(', '))}` : 'No tags';
      const timeCreated = props.time_created ? new Date(props.time_created).toLocaleDateString() : 'Unknown date';

      const votes = `${util.escapeHTML(props.agree_count)} agree, ${util.escapeHTML(props.disagree_count)} disagree`;
      let validationStatus = 'Not validated';
      if (props.correct === true) {
        validationStatus = `Validated (${votes})`;
      } else if (props.correct === false) {
        validationStatus = `Invalidated (${votes})`;
      }

      // Absent for providers without a public viewer (e.g. infra3d).
      const panoLink = props.pano_url
        ? `<p><a href="${util.escapeHTML(props.pano_url)}" target="_blank" rel="noopener noreferrer">
            View panorama
          </a></p>`
        : '';

      ApiDocsMap.popup(map, feature.geometry.coordinates.slice(), `
        <h4>${util.escapeHTML(labelTypeInfo[props.label_type]?.display) || util.escapeHTML(props.label_type)}</h4>
        <p>${util.escapeHTML(labelTypeInfo[props.label_type]?.description || '')}</p>
        <p>${severity}</p>
        <p>${tags}</p>
        <p>Created: ${timeCreated}</p>
        <p>${validationStatus}</p>
        <p>Label ID: ${util.escapeHTML(props.label_id)}</p>
        ${panoLink}
      `);
    });

    map.on('mouseenter', LABELS_LAYER, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', LABELS_LAYER, () => {
      map.getCanvas().style.cursor = '';
    });
  },
};
