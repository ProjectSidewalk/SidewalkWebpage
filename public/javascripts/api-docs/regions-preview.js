/**
 * Regions Map Preview Generator.
 *
 * Renders a single live choropleth map of all of a city's regions (neighborhoods), fed directly from the
 * /v3/api/regions endpoint. A metric toggle recolors the same polygons by label count, completed-audit count, or
 * contributing-user count. Hover/click a region to see its full statistics.
 *
 * @requires A DOM element with id 'regions-preview'
 * @requires Leaflet.js library
 */

(function () {
  // Configuration options - can be overridden by calling setup().
  let config = {
    apiBaseUrl: '/v3/api',
    mainContainerId: 'regions-preview',
    regionsEndpoint: '/regions',
    mapHeight: 500,
  };

  // The metrics that can be visualized, keyed by the GeoJSON property name. Each defines the color ramp endpoints
  // (dark-background optimized), a "none" color for regions with a value of zero, and human-readable labels.
  const METRICS = {
    label_count: {
      label: 'Label count', legendTitle: 'Labels per region',
      none: '#3d3d3d', low: '#440154', high: '#f0f921',
    },
    audit_count: {
      label: 'Audit count', legendTitle: 'Completed audits per region',
      none: '#3d3d3d', low: '#0d3b2e', high: '#44ff88',
    },
    user_count: {
      label: 'User count', legendTitle: 'Contributors per region',
      none: '#3d3d3d', low: '#472c7a', high: '#ffffff',
    },
  };

  /**
   * Interpolate between two hex colors.
   * @param {string} color1 - First color in hex format
   * @param {string} color2 - Second color in hex format
   * @param {number} factor - Interpolation factor (0-1)
   * @returns {string} Interpolated color in hex format
   */
  function interpolateColor(color1, color2, factor) {
    const c1 = { r: parseInt(color1.slice(1, 3), 16), g: parseInt(color1.slice(3, 5), 16), b: parseInt(color1.slice(5, 7), 16) };
    const c2 = { r: parseInt(color2.slice(1, 3), 16), g: parseInt(color2.slice(3, 5), 16), b: parseInt(color2.slice(5, 7), 16) };
    const r = Math.round(c1.r + (c2.r - c1.r) * factor);
    const g = Math.round(c1.g + (c2.g - c1.g) * factor);
    const b = Math.round(c1.b + (c2.b - c1.b) * factor);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  window.RegionsPreview = {
    // Internal state, populated during init().
    _map: null,
    _layer: null,
    _legend: null,
    _metric: 'label_count',
    _maxByMetric: {},

    /**
     * Configure the regions preview.
     * @param {object} options - Configuration options
     * @returns {object} The RegionsPreview object for chaining
     */
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Initialize the regions preview map.
     * @returns {Promise} A promise that resolves when the preview is rendered
     */
    init() {
      const container = document.getElementById(config.mainContainerId);
      if (!container) {
        console.error('Regions preview container element not found.');
        return Promise.reject(new Error('Regions preview container element not found'));
      }

      container.style.height = `${config.mapHeight}px`;
      const loading = document.createElement('div');
      loading.className = 'loading-message';
      loading.textContent = 'Loading region data...';
      container.appendChild(loading);

      return this.fetchRegions()
        .then((regions) => {
          container.innerHTML = '';
          this.renderMap(container, regions);
        })
        .catch((error) => {
          console.error('Error rendering regions preview:', error);
          container.innerHTML = '';
          const message = document.createElement('div');
          message.className = 'no-regions-message';
          message.textContent = 'Unable to load region data for the preview.';
          container.appendChild(message);
        });
    },

    /**
     * Fetch all regions for the current city as a GeoJSON FeatureCollection.
     * @returns {Promise} A promise that resolves with the GeoJSON FeatureCollection
     */
    fetchRegions() {
      return fetch(`${config.apiBaseUrl}${config.regionsEndpoint}?inline=true&source=apiDocs`)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        });
    },

    /**
     * Build the Leaflet map, draw the region polygons, and wire up the metric toggle and legend.
     * @param {HTMLElement} container - Container element for the map
     * @param {object} regions - GeoJSON FeatureCollection of regions
     */
    renderMap(container, regions) {
      const features = regions.features || [];

      // Precompute the maximum value of each metric across all regions, used to scale the color ramp.
      Object.keys(METRICS).forEach((metric) => {
        this._maxByMetric[metric] = features.reduce((max, f) => Math.max(max, f.properties[metric] || 0), 0);
      });

      // Build the toolbar (with the metric selector) above the map. Keeping it out of the map means region
      // popups can never render behind it.
      const toolbar = document.createElement('div');
      toolbar.className = 'regions-toolbar';
      const optionsHtml = Object.keys(METRICS)
        .map((metric) => `<option value="${metric}">${METRICS[metric].label}</option>`)
        .join('');
      toolbar.innerHTML = `<label for="region-metric-select">Color by</label>
                <select id="region-metric-select">${optionsHtml}</select>`;
      container.appendChild(toolbar);

      const mapElement = document.createElement('div');
      mapElement.id = 'regions-map';
      container.appendChild(mapElement);

      const map = L.map('regions-map', { scrollWheelZoom: false });
      this._map = map;

      // CartoDB Dark Matter tiles, matching the other API doc previews.
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      if (features.length === 0) {
        map.setView([0, 0], 2);
        this.addNoRegionsMessage(map);
        return;
      }

      this._layer = L.geoJSON(regions, {
        style: (feature) => this.styleForFeature(feature),
        onEachFeature: (feature, layer) => this.bindRegionInteractions(feature, layer),
      }).addTo(map);

      map.fitBounds(this._layer.getBounds(), { padding: [10, 10] });

      // Region counter badge.
      const countDiv = document.createElement('div');
      countDiv.className = 'counter-badge';
      countDiv.textContent = `${features.length} region${features.length === 1 ? '' : 's'}`;
      map.getContainer().appendChild(countDiv);

      // Wire the metric selector to recolor the regions and update the legend.
      const select = document.getElementById('region-metric-select');
      select.value = this._metric;
      select.addEventListener('change', (event) => {
        this._metric = event.target.value;
        this._layer.setStyle((feature) => this.styleForFeature(feature));
        this.updateLegend();
      });

      this.updateLegend();
    },

    /**
     * Compute the Leaflet style for a region feature based on the currently selected metric.
     * @param {object} feature - GeoJSON feature for a region
     * @returns {object} A Leaflet path style object
     */
    styleForFeature(feature) {
      const metricCfg = METRICS[this._metric];
      const value = feature.properties[this._metric] || 0;
      const max = this._maxByMetric[this._metric];
      let fillColor;
      if (value <= 0) {
        fillColor = metricCfg.none;
      } else if (max <= 0) {
        fillColor = metricCfg.low;
      } else {
        fillColor = interpolateColor(metricCfg.low, metricCfg.high, value / max);
      }
      return { color: '#ffffff', weight: 1, opacity: 0.7, fillColor, fillOpacity: 0.7 };
    },

    /**
     * Attach the popup and hover behavior for a single region.
     * @param {object} feature - GeoJSON feature for a region
     * @param {object} layer - The Leaflet layer for the feature
     */
    bindRegionInteractions(feature, layer) {
      const props = feature.properties;
      const firstLabelDate = props.first_label_date ? new Date(props.first_label_date).toLocaleDateString() : 'No labels';
      const lastLabelDate = props.last_label_date ? new Date(props.last_label_date).toLocaleDateString() : 'No labels';

      layer.bindPopup(`
                <div class="region-popup">
                    <h4>${props.name || `Region ${props.region_id}`}</h4>
                    <p><strong>Region ID:</strong> ${props.region_id}</p>
                    <p><strong>Labels:</strong> ${props.label_count}</p>
                    <p><strong>Streets:</strong> ${props.street_count}</p>
                    <p><strong>Contributors:</strong> ${props.user_count}</p>
                    <p><strong>Completed audits:</strong> ${props.audit_count}</p>
                    <p><strong>First Label:</strong> ${firstLabelDate}</p>
                    <p><strong>Last Label:</strong> ${lastLabelDate}</p>
                    <a href="/labelmap?regions=${props.region_id}" class="explore-region-btn" target="_blank">
                        View region on the label map
                    </a>
                </div>
            `, {
        // Pad the auto-pan so an opened popup is nudged clear of the bottom-right legend.
        autoPanPaddingTopLeft: L.point(10, 10),
        autoPanPaddingBottomRight: L.point(260, 130),
      });

      layer.on('mouseover', function () {
        this.setStyle({ weight: 3, opacity: 1, fillOpacity: 0.85 });
        this.bringToFront();
      });
      layer.on('mouseout', () => this._layer.resetStyle(layer));
    },

    /**
     * (Re)build the continuous gradient legend for the currently selected metric.
     */
    updateLegend() {
      const map = this._map;
      const metricCfg = METRICS[this._metric];
      const max = this._maxByMetric[this._metric];

      if (this._legend) {
        map.removeControl(this._legend);
      }

      const legend = L.control({ position: 'bottomright' });
      legend.onAdd = function () {
        const div = L.DomUtil.create('div', 'info legend continuous-legend');
        div.innerHTML = `<h4>${metricCfg.legendTitle}</h4>`;

        const gradientContainer = L.DomUtil.create('div', 'gradient-container', div);
        gradientContainer.style.cssText = 'width: 200px; height: 20px; position: relative; margin: 5px 0;';
        const gradientBar = L.DomUtil.create('div', 'gradient-bar', gradientContainer);
        gradientBar.style.cssText
                    = `width: 100%; height: 100%; background: linear-gradient(to right, ${metricCfg.low}, ${metricCfg.high});`;

        const labelsContainer = L.DomUtil.create('div', 'legend-labels', div);
        labelsContainer.style.cssText = 'display: flex; justify-content: space-between; width: 200px;';
        const minTick = L.DomUtil.create('div', 'legend-tick', labelsContainer);
        minTick.textContent = '0';
        const maxTick = L.DomUtil.create('div', 'legend-tick', labelsContainer);
        maxTick.textContent = max.toLocaleString();

        return div;
      };
      legend.addTo(map);
      this._legend = legend;
    },

    /**
     * Show a message when there are no regions to display.
     * @param {object} map - The Leaflet map object
     */
    addNoRegionsMessage(map) {
      const div = document.createElement('div');
      div.className = 'no-regions-message';
      div.textContent = 'No regions found for this city.';
      map.getContainer().appendChild(div);
    },
  };
})();
