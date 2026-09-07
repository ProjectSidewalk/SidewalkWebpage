/**
 * AccessScore: Intersections Map Preview Generator (#5095).
 *
 * Renders a live map of a sample region's intersections, fed directly from /v3/api/accessScoreIntersections. Each
 * intersection is colored on a fixed red→yellow→green ramp by its AccessScore (already in [0, 1]); unscored ones (null
 * score) are gray, and grade-separated crossings are drawn hollow. Hover/click an intersection to see its score and
 * per-type cluster breakdown.
 *
 * @requires A DOM element with id 'access-score-intersections-preview'
 * @requires mapbox-gl and js/api-docs/apiDocsMap.js
 */

(function () {
  const INTERSECTION_SOURCE = 'access-score-intersections';
  const INTERSECTION_LAYER = 'access-score-intersection-points';

  let config = {
    apiBaseUrl: '/v3/api',
    mainContainerId: 'access-score-intersections-preview',
    mapboxApiKey: '',
    endpoint: '/accessScoreIntersections',
  };

  const NONE_COLOR = ApiDocsTheme.color('--color-neutral-600'); // Unscored intersections (null score).

  // An unscored intersection has no score to read, so it's drawn smaller and fainter than one that does.
  const UNSCORED = ['<', ['coalesce', ['get', 'score'], -1], 0];
  const GRADE_SEPARATED = ['==', ['get', 'grade_separated'], true];

  window.AccessScoreIntersectionsPreview = {
    /** Apply caller config overrides. */
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /** Fetch the data and render the map (or a friendly message on failure). */
    async init() {
      const container = document.getElementById(config.mainContainerId);
      if (!container) {
        console.error('AccessScore intersections preview container not found.');
        return;
      }

      const loading = document.createElement('div');
      loading.className = 'loading-message';
      loading.textContent = 'Loading AccessScore data...';
      container.appendChild(loading);

      try {
        // Limit the preview to a single region so it stays legible and the response stays small.
        const regionId = await this.fetchSampleRegionId();
        const intersections = await this.fetchIntersections(regionId);
        container.innerHTML = '';
        await this.renderMap(container, intersections);
      } catch (error) {
        console.error('Error rendering AccessScore intersections preview:', error);
        container.innerHTML = '<div class="map-message" role="alert">Unable to load AccessScore data '
          + 'for the preview.</div>';
      }
    },

    /** Pick a sample region (the one with the most labels) to keep the preview focused. Null = whole city. */
    fetchSampleRegionId() {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}/regionWithMostLabels`)
        .then((region) => (region ? region.properties.region_id : null))
        .catch(() => null);
    },

    /** Fetch intersection AccessScores (optionally scoped to a region) as a GeoJSON FeatureCollection. */
    fetchIntersections(regionId) {
      const regionParam = regionId ? `&regionId=${regionId}` : '';
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.endpoint}?inline=true${regionParam}`);
    },

    /** Build the map, draw the intersection points, and add the legend. */
    async renderMap(container, intersections) {
      const features = intersections.features || [];

      const mapElement = document.createElement('div');
      mapElement.id = 'access-score-intersections-map';
      container.appendChild(mapElement);

      const bounds = features.length ? ApiDocsMap.featureCollectionBounds(features) : null;
      const map = await ApiDocsMap.create({
        container: mapElement,
        mapboxApiKey: config.mapboxApiKey,
        ...(bounds ? { bounds } : { center: [0, 0], zoom: 1 }),
      });

      if (!features.length) {
        this.addNoDataMessage(map, 'No intersections found for this city.');
        return;
      }

      // promoteId lifts intersection_id into the feature id that setFeatureState needs for the hover styling below.
      map.addSource(INTERSECTION_SOURCE, { type: 'geojson', data: intersections, promoteId: 'intersection_id' });
      const scoreColor = ApiDocsMap.gradientColorExpression('score', ApiDocsMap.ACCESS_SCORE_RAMP, {
        noneColor: NONE_COLOR,
      });
      map.addLayer({
        id: INTERSECTION_LAYER,
        type: 'circle',
        source: INTERSECTION_SOURCE,
        paint: {
          // A grade-separated crossing is a hollow ring: nothing to cross there.
          'circle-color': ['case', GRADE_SEPARATED, 'rgba(0, 0, 0, 0)', scoreColor],
          'circle-stroke-color': ['case', GRADE_SEPARATED, NONE_COLOR, scoreColor],
          'circle-stroke-width': ['case', GRADE_SEPARATED, 2, 1],
          'circle-radius': ApiDocsMap.whenHovered(9, ['case', UNSCORED, 4, 6]),
          'circle-opacity': ApiDocsMap.whenHovered(1, ['case', UNSCORED, 0.5, 0.9]),
        },
      });
      ApiDocsMap.addHoverState(map, INTERSECTION_LAYER, INTERSECTION_SOURCE);
      this.addIntersectionPopups(map);

      const countChip = ApiDocsMap.addOverlay(map, 'top-right', 'map-chip');
      countChip.textContent = `${features.length} intersection${features.length === 1 ? '' : 's'}`;

      const legend = ApiDocsMap.addOverlay(map, 'bottom-left', 'map-legend');
      ApiDocsMap.renderGradientLegend(legend, 'AccessScore (0 = low, 1 = high)',
        ApiDocsMap.ACCESS_SCORE_RAMP, ['0', '1'], { color: NONE_COLOR, label: 'Unscored' });
    },

    /** Wire up the click popup for the intersection layer, including a compact per-type cluster breakdown. */
    addIntersectionPopups(map) {
      map.on('click', INTERSECTION_LAYER, (e) => {
        const p = e.features[0].properties;
        const score = (p.score === null || p.score === undefined) ? 'N/A (unscored)' : p.score.toFixed(3);
        const counts = ApiDocsMap.featureProp(p, 'cluster_counts') || {};
        const breakdown = Object.keys(counts).filter((k) => counts[k] > 0).map((k) => `${k}: ${counts[k]}`).join(', ')
          || 'no scored features';
        const kind = p.grade_separated ? ' (grade-separated crossing)' : '';

        ApiDocsMap.popup(map, e.lngLat, `
          <h4>Intersection ${p.intersection_id}${kind}</h4>
          <p><span class="as-score">${score}</span> AccessScore</p>
          <p><strong>Streets:</strong> ${p.degree} &nbsp; <strong>Audits:</strong> ${p.audit_count} &nbsp;
            <strong>Labels:</strong> ${p.label_count}</p>
          <p class="as-breakdown"><strong>Clusters:</strong> ${breakdown}</p>
        `);
      });
    },

    /** Show an on-map message (e.g. when there is no data). */
    addNoDataMessage(map, text) {
      const div = document.createElement('div');
      div.className = 'map-message';
      div.setAttribute('role', 'status');
      div.textContent = text;
      map.getContainer().appendChild(div);
    },
  };
})();
