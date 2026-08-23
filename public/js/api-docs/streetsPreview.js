/**
 * Streets Map Preview Generator.
 *
 * Renders three live maps of one region's street segments, fed directly from /v3/api/streets. The three differ only
 * in what they color and scale the lines by: contributors, audit age, or label count.
 *
 * @requires DOM elems with ids streets-user-count-preview, streets-audit-age-preview, and streets-label-count-preview.
 * @requires mapbox-gl and js/api-docs/apiDocsMap.js
 */

(function () {
  const REGION_SOURCE = 'preview-region';
  const STREET_SOURCE = 'streets';
  const STREET_LAYER = 'street-lines';
  const REGION_COLOR = '#ffffff';
  const DAY_MS = 24 * 60 * 60 * 1000;

  // A street with no labels has no age to place on the ramp, so it's drawn thinner and fainter than one that has.
  const UNAUDITED = ['<', ['coalesce', ['get', 'days_since_label'], -1], 0];

  let config = {
    apiBaseUrl: '/v3/api',
    mapboxApiKey: '',
    streetsEndpoint: '/streets',
    regionWithMostLabelsEndpoint: '/regionWithMostLabels',
  };

  /** Widens a line by 2px while it's hovered, whatever its base width expression works out to. */
  function hoverWidth(base) {
    return ['+', base, ApiDocsMap.whenHovered(2, 0)];
  }

  /**
   * Ticks for a count ramp: the ends, plus a midpoint once the range is wide enough for one to mean anything.
   *
   * @param {number} min - Low end of the range.
   * @param {number} max - High end of the range.
   * @param {number} midThreshold - Range width above which a midpoint tick is added.
   * @returns {Array<string>} Tick labels, low to high.
   */
  function countTicks(min, max, midThreshold) {
    if (max <= min) return [String(min)];
    if (max - min > midThreshold) return [String(min), String(Math.round((min + max) / 2)), String(max)];
    return [String(min), String(max)];
  }

  /** Compact age for a legend tick: days, then months, then years. */
  function formatDaysLabel(days) {
    if (days < 30) return `${Math.round(days)}d`;
    if (days < 365) return `${Math.round(days / 30)}m`;
    return `${Math.round(days / 365)}y`;
  }

  /** Spelled-out age for the summary panel. */
  function formatAvgAge(days) {
    if (days === null) return 'N/A';
    if (days < 30) return `${days} days`;
    if (days < 365) return `${Math.round(days / 30)} months`;
    return `${Math.round(days / 365)} years`;
  }

  /**
   * Human-readable age of a street's most recent label.
   *
   * @param {string|null} lastLabelDate - ISO date of the last label, or null if never labeled.
   * @returns {string} e.g. 'Today', '3 weeks ago', 'Never audited'.
   */
  function formatAuditAge(lastLabelDate) {
    if (!lastLabelDate) return 'Never audited';

    const daysDiff = (Date.now() - new Date(lastLabelDate)) / DAY_MS;
    if (daysDiff < 1) return 'Today';
    if (daysDiff < 7) {
      const days = Math.floor(daysDiff);
      return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    }
    if (daysDiff < 30) {
      const weeks = Math.floor(daysDiff / 7);
      return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    }
    if (daysDiff < 365) {
      const months = Math.floor(daysDiff / 30);
      return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    }
    const years = Math.floor(daysDiff / 365);
    return `${years} ${years === 1 ? 'year' : 'years'} ago`;
  }

  // What each of the three maps colors and scales its lines by. `domain` and `ticks` read the summary built by
  // summarize(), since both ends of a ramp depend on what this region actually contains.
  const METRICS = [
    {
      containerId: 'streets-user-count-preview',
      loadingText: 'Loading user count data...',
      property: 'user_count',
      legendTitle: 'Users per Street',
      ramp: ['#472c7a', '#ffffff'],
      none: { color: '#3d3d3d', label: 'Unaudited' },
      // Zero contributors is a category of its own rather than the bottom of the ramp.
      noneAtOrBelow: 0,
      domain: (stats) => ({ min: 1, max: stats.maxUserCount }),
      ticks: (stats) => countTicks(1, stats.maxUserCount, 3),
      width: () => hoverWidth(['max', 2, ['min', 6, ['+', 2, ['coalesce', ['get', 'user_count'], 0]]]]),
      opacity: () => ApiDocsMap.whenHovered(1, 0.8),
      statRows: (stats) => [
        ['Total Streets', stats.total],
        ['Audited', `${stats.auditedPercent}%`],
        ['Total Labels', stats.totalLabels],
        ['Way Types', stats.wayTypes.size],
      ],
    },
    {
      containerId: 'streets-audit-age-preview',
      loadingText: 'Loading audit age data...',
      property: 'days_since_label',
      legendTitle: 'Audit Age',
      ramp: ['#44ff44', '#ff4444'],
      none: { color: '#d3d3d3', label: 'Never audited' },
      // The ramp runs from today rather than from the freshest street here, so the colors mean the same thing
      // whichever region the preview lands on.
      domain: (stats) => ({ min: 0, max: stats.maxDays }),
      ticks: (stats) => (stats.maxDays > 90
        ? ['Today', formatDaysLabel(stats.maxDays / 2), formatDaysLabel(stats.maxDays)]
        : ['Today', formatDaysLabel(stats.maxDays)]),
      width: () => hoverWidth(['case', UNAUDITED, 1, 3]),
      opacity: () => ApiDocsMap.whenHovered(1, ['case', UNAUDITED, 0.4, 0.8]),
      statRows: (stats) => [
        ['Total Streets', stats.total],
        ['Audited', `${stats.auditedPercent}%`],
        ['Avg. Age', formatAvgAge(stats.avgAge)],
        ['Way Types', stats.wayTypes.size],
      ],
    },
    {
      containerId: 'streets-label-count-preview',
      loadingText: 'Loading label count data...',
      property: 'label_count',
      legendTitle: 'Labels per Street',
      ramp: ['#440154', '#f0f921'],
      none: { color: '#3d3d3d', label: 'No labels' },
      noneAtOrBelow: 0,
      domain: (stats) => ({ min: 1, max: stats.maxLabelCount }),
      ticks: (stats) => countTicks(1, stats.maxLabelCount, 5),
      width: () => hoverWidth(
        ['max', 1, ['min', 5, ['+', 1, ['floor', ['/', ['coalesce', ['get', 'label_count'], 0], 5]]]]],
      ),
      opacity: () => ApiDocsMap.whenHovered(1, 0.8),
      statRows: (stats) => [
        ['Total Streets', stats.total],
        ['Audited', `${stats.auditedPercent}%`],
        ['Total Labels', stats.totalLabels],
        ['Avg. Labels', stats.audited > 0 ? Math.round(stats.totalLabels / stats.audited) : 0],
      ],
    },
  ];

  /**
   * Stamps each street with its age in days, since Mapbox expressions have no date arithmetic to derive it from
   * `last_label_date` at paint time.
   *
   * @param {object} streets - The GeoJSON FeatureCollection from the API.
   * @returns {object} The same collection with `days_since_label` on every feature.
   */
  function withAge(streets) {
    const now = Date.now();
    return {
      ...streets,
      features: (streets.features || []).map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          days_since_label: feature.properties.last_label_date
            ? (now - new Date(feature.properties.last_label_date)) / DAY_MS
            : null,
        },
      })),
    };
  }

  /**
   * Rolls up the figures the three summary panels and color ramps draw on.
   *
   * @param {Array<object>} features - The street features, after withAge().
   * @returns {object} Totals, maxima, and the way types present.
   */
  function summarize(features) {
    const stats = {
      total: features.length, audited: 0, totalLabels: 0, wayTypes: new Set(),
      maxUserCount: 0, maxLabelCount: 0, maxDays: 0, totalDays: 0, datedCount: 0,
    };
    features.forEach(({ properties }) => {
      const userCount = properties.user_count || 0;
      const labelCount = properties.label_count || 0;
      if (userCount > 0) stats.audited++;
      stats.totalLabels += labelCount;
      stats.wayTypes.add(properties.way_type);
      stats.maxUserCount = Math.max(stats.maxUserCount, userCount);
      stats.maxLabelCount = Math.max(stats.maxLabelCount, labelCount);
      if (properties.days_since_label !== null) {
        stats.maxDays = Math.max(stats.maxDays, properties.days_since_label);
        stats.totalDays += properties.days_since_label;
        stats.datedCount++;
      }
    });
    stats.auditedPercent = stats.total > 0 ? Math.round((stats.audited / stats.total) * 100) : 0;
    stats.avgAge = stats.datedCount > 0 ? Math.round(stats.totalDays / stats.datedCount) : null;
    return stats;
  }

  window.StreetsPreview = {
    /**
     * Configure the streets previews.
     * @param {object} options - Configuration options
     * @returns {object} The StreetsPreview object for chaining
     */
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Build all three preview maps.
     * @returns {Promise} Resolves once every map has been rendered
     */
    async init() {
      const containers = METRICS.map((metric) => document.getElementById(metric.containerId));
      if (containers.some((container) => !container)) {
        console.error('Streets preview container elements not found.');
        return;
      }

      containers.forEach((container, i) => {
        const loading = document.createElement('div');
        loading.className = 'loading-message';
        loading.textContent = METRICS[i].loadingText;
        container.appendChild(loading);
      });

      try {
        const regionData = await this.fetchRegionWithMostLabels();
        const streets = withAge(await this.fetchStreetsByRegionId(regionData.properties.region_id));
        const stats = summarize(streets.features);

        // Settled rather than all so that one failing to render doesn't prevent the others from rendering.
        const rendered = await Promise.allSettled(
          METRICS.map((metric, i) => this.renderMap(containers[i], metric, regionData, streets, stats)));
        rendered.forEach((result, i) => {
          if (result.status === 'rejected') this.showError(containers[i], result.reason);
        });
      } catch (error) {
        // Everything ahead of the render is shared, so a failure there is a failure for all three.
        containers.forEach((container) => this.showError(container, error));
      }
    },

    /**
     * Replace a preview's contents with a failure message.
     * @param {HTMLElement} container - The preview's container
     * @param {Error} error - What went wrong
     */
    showError(container, error) {
      console.error('Streets preview error:', error);
      container.innerHTML = `<div class="message message-error">Failed to load streets: ${error.message}</div>`;
    },

    /**
     * Fetch the region the previews are scoped to.
     * @returns {Promise} Resolves with the region data
     */
    fetchRegionWithMostLabels() {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.regionWithMostLabelsEndpoint}`)
        .catch((error) => {
          console.error('Error fetching region with most labels:', error);
          throw new Error('Failed to fetch region with most labels');
        });
    },

    /**
     * Fetch a region's streets as a GeoJSON FeatureCollection.
     * @param {number} regionId - ID of the region
     * @returns {Promise} Resolves with the streets data
     */
    fetchStreetsByRegionId(regionId) {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.streetsEndpoint}?regionId=${regionId}`);
    },

    /**
     * Build one of the three maps, tearing it back down if anything fails to draw.
     *
     * @param {HTMLElement} container - Container element for this map
     * @param {object} metric - The METRICS entry driving this map
     * @param {object} regionData - GeoJSON Feature for the region the preview is scoped to
     * @param {object} streets - GeoJSON FeatureCollection of streets
     * @param {object} stats - The rollup from summarize()
     * @returns {Promise} Resolves once the map has loaded and drawn
     */
    async renderMap(container, metric, regionData, streets, stats) {
      container.innerHTML = '';
      const map = await ApiDocsMap.create({
        container,
        mapboxApiKey: config.mapboxApiKey,
        bounds: ApiDocsMap.geometryBounds(regionData.geometry),
      });
      try {
        this.drawMap(map, metric, regionData, streets, stats);
      } catch (error) {
        // A half-drawn map still holds a WebGL context, and browsers cap how many can be live. This page wants three.
        map.remove();
        throw error;
      }
    },

    /**
     * Draw one map's region outline, streets, legend, and summary onto a loaded map.
     *
     * @param {object} map - The loaded Mapbox map
     * @param {object} metric - The METRICS entry driving this map
     * @param {object} regionData - GeoJSON Feature for the region the preview is scoped to
     * @param {object} streets - GeoJSON FeatureCollection of streets
     * @param {object} stats - The rollup from summarize()
     */
    drawMap(map, metric, regionData, streets, stats) {
      map.addSource(REGION_SOURCE, { type: 'geojson', data: regionData });
      map.addLayer({
        id: 'region-fill',
        type: 'fill',
        source: REGION_SOURCE,
        paint: { 'fill-color': REGION_COLOR, 'fill-opacity': 0.05 },
      });
      map.addLayer({
        id: 'region-outline',
        type: 'line',
        source: REGION_SOURCE,
        paint: { 'line-color': REGION_COLOR, 'line-width': 1, 'line-opacity': 0.6 },
      });

      const regionTitle = ApiDocsMap.addOverlay(map, 'top-right', 'map-chip');
      regionTitle.innerHTML = `<strong>Region:</strong> ${regionData.properties.name || 'Sample Region'}`;

      if (!streets.features.length) {
        const message = ApiDocsMap.addOverlay(map, 'top-right', 'map-chip');
        message.textContent = 'No streets found in this region.';
        return;
      }

      const { min, max } = metric.domain(stats);
      // promoteId lifts street_edge_id into the feature id that setFeatureState needs for the hover styling below.
      map.addSource(STREET_SOURCE, { type: 'geojson', data: streets, promoteId: 'street_edge_id' });
      map.addLayer({
        id: STREET_LAYER,
        type: 'line',
        source: STREET_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ApiDocsMap.gradientColorExpression(metric.property, metric.ramp, {
            min,
            max,
            noneColor: metric.none.color,
            noneAtOrBelow: metric.noneAtOrBelow,
          }),
          'line-width': metric.width(),
          'line-opacity': metric.opacity(),
        },
      });
      ApiDocsMap.addHoverState(map, STREET_LAYER, STREET_SOURCE);
      this.addStreetPopups(map);

      const legend = ApiDocsMap.addOverlay(map, 'bottom-left', 'map-legend');
      ApiDocsMap.renderGradientLegend(legend, metric.legendTitle, metric.ramp, metric.ticks(stats), metric.none);

      const summary = ApiDocsMap.addOverlay(map, 'top-right', 'map-stats');
      summary.innerHTML = `
        <h4>Summary</h4>
        ${metric.statRows(stats).map(([label, value]) => `<div><strong>${label}:</strong> ${value}</div>`).join('')}
      `;
    },

    /**
     * Wire up the click popup for the street layer.
     * @param {object} map - The Mapbox map object
     */
    addStreetPopups(map) {
      map.on('click', STREET_LAYER, (e) => {
        const props = e.features[0].properties;
        const userCount = props.user_count || 0;
        const firstLabelDate = props.first_label_date
          ? new Date(props.first_label_date).toLocaleDateString()
          : 'No labels';
        const lastLabelDate = props.last_label_date
          ? new Date(props.last_label_date).toLocaleDateString()
          : 'No labels';
        const auditStatus = userCount === 0
          ? 'Unaudited'
          : `Labeled by ${userCount} user${userCount > 1 ? 's' : ''}`;
        const osmLink = props.osm_way_id
          ? `<a href="https://www.openstreetmap.org/way/${props.osm_way_id}" target="_blank"
              rel="noopener noreferrer">${props.osm_way_id}</a>`
          : 'N/A';

        ApiDocsMap.popup(map, e.lngLat, `
          <h4>Street Segment ${props.street_edge_id}</h4>
          <p><strong>Type:</strong> ${props.way_type || 'Unknown'}</p>
          <p><strong>Status:</strong> ${auditStatus}</p>
          <p><strong>Labels:</strong> ${props.label_count || 0}</p>
          <p><strong>First Label:</strong> ${firstLabelDate}</p>
          <p><strong>Last Label:</strong> ${lastLabelDate}</p>
          <p><strong>Audit Age:</strong> ${formatAuditAge(props.last_label_date)}</p>
          <p><strong>OSM ID:</strong> ${osmLink}</p>
          <a href="/explore?streetEdgeId=${props.street_edge_id}" class="button-ps button--primary button--tiny"
            target="_blank">
            Explore Street in Project Sidewalk
          </a>
        `);
      });
    },
  };
})();
