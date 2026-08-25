/**
 * AccessScore: Streets Map Preview Generator.
 *
 * Renders a live map of a sample region's streets, fed directly from /v3/api/accessScoreStreets. Each street is colored
 * on a fixed red→yellow→green ramp by its AccessScore (already in [0, 1]); unaudited streets (null score) are gray.
 * Hover/click a street to see its score and per-type cluster breakdown.
 *
 * @requires A DOM element with id 'access-score-streets-preview'
 * @requires mapbox-gl and js/api-docs/apiDocsMap.js
 */

(function () {
  const STREET_SOURCE = 'access-score-streets';
  const STREET_LAYER = 'access-score-street-lines';

  let config = {
    apiBaseUrl: '/v3/api',
    mainContainerId: 'access-score-streets-preview',
    mapboxApiKey: '',
    endpoint: '/accessScoreStreets',
  };

  const NONE_COLOR = '#888888'; // Unaudited streets (null score).

  // An unaudited street has no score to read, so it's drawn thinner and fainter than one that does.
  const UNAUDITED = ['<', ['coalesce', ['get', 'score'], -1], 0];

  window.AccessScoreStreetsPreview = {
    /** Apply caller config overrides. */
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /** Fetch the data and render the map (or a friendly message on failure). */
    async init() {
      const container = document.getElementById(config.mainContainerId);
      if (!container) {
        console.error('AccessScore streets preview container not found.');
        return;
      }

      const loading = document.createElement('div');
      loading.className = 'loading-message';
      loading.textContent = 'Loading AccessScore data...';
      container.appendChild(loading);

      try {
        // Limit the preview to a single region so it stays legible and the response stays small.
        const regionId = await this.fetchSampleRegionId();
        const streets = await this.fetchStreets(regionId);
        container.innerHTML = '';
        await this.renderMap(container, streets);
      } catch (error) {
        console.error('Error rendering AccessScore streets preview:', error);
        container.innerHTML = '<div class="no-data-message">Unable to load AccessScore data for the preview.</div>';
      }
    },

    /** Pick a sample region (the one with the most labels) to keep the preview focused. Null = whole city. */
    fetchSampleRegionId() {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}/regionWithMostLabels`)
        .then((region) => (region ? region.properties.region_id : null))
        .catch(() => null);
    },

    /** Fetch street AccessScores (optionally scoped to a region) as a GeoJSON FeatureCollection. */
    fetchStreets(regionId) {
      const regionParam = regionId ? `&regionId=${regionId}` : '';
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.endpoint}?inline=true${regionParam}`);
    },

    /** Build the map, draw the street polylines, and add the legend. */
    async renderMap(container, streets) {
      const features = streets.features || [];

      const mapElement = document.createElement('div');
      mapElement.id = 'access-score-streets-map';
      container.appendChild(mapElement);

      const bounds = features.length ? ApiDocsMap.featureCollectionBounds(features) : null;
      const map = await ApiDocsMap.create({
        container: mapElement,
        mapboxApiKey: config.mapboxApiKey,
        ...(bounds ? { bounds } : { center: [0, 0], zoom: 1 }),
      });

      if (!features.length) {
        this.addNoDataMessage(map, 'No streets found for this city.');
        return;
      }

      // promoteId lifts street_edge_id into the feature id that setFeatureState needs for the hover styling below.
      map.addSource(STREET_SOURCE, { type: 'geojson', data: streets, promoteId: 'street_edge_id' });
      map.addLayer({
        id: STREET_LAYER,
        type: 'line',
        source: STREET_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ApiDocsMap.gradientColorExpression('score', ApiDocsMap.ACCESS_SCORE_RAMP, {
            noneColor: NONE_COLOR,
          }),
          'line-width': ApiDocsMap.whenHovered(7, ['case', UNAUDITED, 2, 4]),
          'line-opacity': ApiDocsMap.whenHovered(1, ['case', UNAUDITED, 0.5, 0.9]),
        },
      });
      ApiDocsMap.addHoverState(map, STREET_LAYER, STREET_SOURCE);
      this.addStreetPopups(map);

      const countChip = ApiDocsMap.addOverlay(map, 'top-right', 'map-chip');
      countChip.textContent = `${features.length} street${features.length === 1 ? '' : 's'}`;

      const legend = ApiDocsMap.addOverlay(map, 'bottom-left', 'map-legend');
      ApiDocsMap.renderGradientLegend(legend, 'AccessScore (0 = low, 1 = high)',
        ApiDocsMap.ACCESS_SCORE_RAMP, ['0', '1'], { color: NONE_COLOR, label: 'Unaudited' });
    },

    /** Wire up the click popup for the street layer, including a compact per-type cluster breakdown. */
    addStreetPopups(map) {
      map.on('click', STREET_LAYER, (e) => {
        const p = e.features[0].properties;
        const score = (p.score === null || p.score === undefined) ? 'N/A (unaudited)' : p.score.toFixed(3);
        const counts = ApiDocsMap.featureProp(p, 'cluster_counts') || {};
        const breakdown = Object.keys(counts).filter((k) => counts[k] > 0).map((k) => `${k}: ${counts[k]}`).join(', ')
          || 'no scored features';

        ApiDocsMap.popup(map, e.lngLat, `
          <h4>Street ${p.street_edge_id}</h4>
          <p><span class="as-score">${score}</span> AccessScore</p>
          <p><strong>Audits:</strong> ${p.audit_count} &nbsp; <strong>Labels:</strong> ${p.label_count}</p>
          <p class="as-breakdown"><strong>Clusters:</strong> ${breakdown}</p>
        `);
      });
    },

    /** Show an on-map message (e.g. when there is no data). */
    addNoDataMessage(map, text) {
      const div = document.createElement('div');
      div.className = 'no-data-message';
      div.textContent = text;
      map.getContainer().appendChild(div);
    },
  };
})();
