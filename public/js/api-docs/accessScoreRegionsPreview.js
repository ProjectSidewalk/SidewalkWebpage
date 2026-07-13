/**
 * AccessScore: Regions Map Preview Generator.
 *
 * Renders a live choropleth of a city's regions, fed directly from /v3/api/accessScoreRegions. Regions are colored on a
 * fixed red→yellow→green ramp by AccessScore (default) or audit coverage — both already in [0, 1], so no rescaling is
 * needed. Hover/click a region to see its score, coverage, and audited-street counts.
 *
 * @requires A DOM element with id 'access-score-regions-preview'
 * @requires Leaflet.js
 */

(function () {
  let config = {
    apiBaseUrl: '/v3/api',
    mainContainerId: 'access-score-regions-preview',
    endpoint: '/accessScoreRegions',
    mapHeight: 500,
  };

  // Metrics that can be visualized. Both are already normalized to [0, 1], so the ramp domain is fixed.
  const METRICS = {
    score: { label: 'AccessScore', legendTitle: 'AccessScore (0 = low, 1 = high)' },
    coverage: { label: 'Audit coverage', legendTitle: 'Fraction of streets audited' },
  };

  // A diverging red→yellow→green ramp (ColorBrewer RdYlGn): low accessibility is red, high is green (per the paper).
  const RAMP = ['#d7191c', '#fdae61', '#ffffbf', '#a6d96a', '#1a9641'];
  const NONE_COLOR = '#3d3d3d'; // Regions with no audited streets (null score).

  /** Interpolates between two hex colors by a 0–1 factor. */
  function interpolateColor(color1, color2, factor) {
    const c1 = {
      r: parseInt(color1.slice(1, 3), 16), g: parseInt(color1.slice(3, 5), 16), b: parseInt(color1.slice(5, 7), 16),
    };
    const c2 = {
      r: parseInt(color2.slice(1, 3), 16), g: parseInt(color2.slice(3, 5), 16), b: parseInt(color2.slice(5, 7), 16),
    };
    const r = Math.round(c1.r + (c2.r - c1.r) * factor);
    const g = Math.round(c1.g + (c2.g - c1.g) * factor);
    const b = Math.round(c1.b + (c2.b - c1.b) * factor);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  /** Maps a value in [0, 1] to a color along the multi-stop RAMP. */
  function rampColor(value) {
    const v = Math.max(0, Math.min(1, value));
    const segments = RAMP.length - 1;
    const scaled = v * segments;
    const i = Math.min(Math.floor(scaled), segments - 1);
    return interpolateColor(RAMP[i], RAMP[i + 1], scaled - i);
  }

  window.AccessScoreRegionsPreview = {
    _map: null,
    _layer: null,
    _legend: null,
    _metric: 'score',

    /** Apply caller config overrides. */
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /** Fetch the data and render the map (or a friendly message on failure). */
    init() {
      const container = document.getElementById(config.mainContainerId);
      if (!container) {
        console.error('AccessScore regions preview container not found.');
        return Promise.reject(new Error('container not found'));
      }
      container.style.height = `${config.mapHeight}px`;
      const loading = document.createElement('div');
      loading.className = 'loading-message';
      loading.textContent = 'Loading AccessScore data...';
      container.appendChild(loading);

      return this.fetchRegions()
        .then((regions) => {
          container.innerHTML = '';
          this.renderMap(container, regions);
        })
        .catch((error) => {
          console.error('Error rendering AccessScore regions preview:', error);
          container.innerHTML = '';
          const message = document.createElement('div');
          message.className = 'no-data-message';
          message.textContent = 'Unable to load AccessScore data for the preview.';
          container.appendChild(message);
        });
    },

    /** Fetch region AccessScores as a GeoJSON FeatureCollection. */
    fetchRegions() {
      return fetch(`${config.apiBaseUrl}${config.endpoint}?inline=true&utm_source=apiDocs`)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
          return response.json();
        });
    },

    /** Build the map, draw region polygons, and wire the metric toggle and legend. */
    renderMap(container, regions) {
      const features = regions.features || [];

      const toolbar = document.createElement('div');
      toolbar.className = 'as-toolbar';
      const optionsHtml = Object.keys(METRICS)
        .map((metric) => `<option value="${metric}">${METRICS[metric].label}</option>`).join('');
      toolbar.innerHTML = `<label for="as-region-metric-select">Color by</label>
        <select id="as-region-metric-select">${optionsHtml}</select>`;
      container.appendChild(toolbar);

      const mapElement = document.createElement('div');
      mapElement.id = 'access-score-regions-map';
      container.appendChild(mapElement);

      const map = L.map('access-score-regions-map', { scrollWheelZoom: false });
      this._map = map;
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors '
          + '&copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd', maxZoom: 19,
      }).addTo(map);

      if (features.length === 0) {
        map.setView([0, 0], 2);
        this.addNoDataMessage(map, 'No regions found for this city.');
        return;
      }

      this._layer = L.geoJSON(regions, {
        style: (feature) => this.styleForFeature(feature),
        onEachFeature: (feature, layer) => this.bindInteractions(feature, layer),
      }).addTo(map);
      map.fitBounds(this._layer.getBounds(), { padding: [10, 10] });

      const countDiv = document.createElement('div');
      countDiv.className = 'counter-badge';
      countDiv.textContent = `${features.length} region${features.length === 1 ? '' : 's'}`;
      map.getContainer().appendChild(countDiv);

      const select = document.getElementById('as-region-metric-select');
      select.value = this._metric;
      select.addEventListener('change', (event) => {
        this._metric = event.target.value;
        this._layer.setStyle((feature) => this.styleForFeature(feature));
        this.updateLegend();
      });
      this.updateLegend();
    },

    /** Leaflet style for a region based on the selected metric (gray when the value is null). */
    styleForFeature(feature) {
      const value = feature.properties[this._metric];
      const fillColor = (value === null || value === undefined) ? NONE_COLOR : rampColor(value);
      return { color: '#ffffff', weight: 1, opacity: 0.7, fillColor, fillOpacity: 0.75 };
    },

    /** Popup + hover behavior for a region. */
    bindInteractions(feature, layer) {
      const p = feature.properties;
      const score = (p.score === null || p.score === undefined) ? 'N/A (no audited streets)' : p.score.toFixed(3);
      const coverage = `${Math.round((p.coverage || 0) * 100)}%`;
      layer.bindPopup(`
        <div class="as-popup">
          <h4>${p.name || `Region ${p.region_id}`}</h4>
          <p><span class="as-score">${score}</span> AccessScore</p>
          <p><strong>Coverage:</strong> ${coverage}
            (${p.audited_street_count} of ${p.total_street_count} streets audited)</p>
          <p><strong>Region ID:</strong> ${p.region_id}</p>
          <a href="/v3/api/accessScoreRegions?regionId=${p.region_id}&inline=true"
            class="explore-region-btn" target="_blank">
            View this region's JSON
          </a>
        </div>
      `, { autoPanPaddingTopLeft: L.point(10, 10), autoPanPaddingBottomRight: L.point(260, 130) });

      layer.on('mouseover', function () {
        this.setStyle({ weight: 3, opacity: 1, fillOpacity: 0.9 });
        this.bringToFront();
      });
      layer.on('mouseout', () => this._layer.resetStyle(layer));
    },

    /** (Re)build the fixed 0→1 gradient legend for the selected metric. */
    updateLegend() {
      const map = this._map;
      const metricCfg = METRICS[this._metric];
      if (this._legend) map.removeControl(this._legend);

      const legend = L.control({ position: 'bottomright' });
      legend.onAdd = function () {
        const div = L.DomUtil.create('div', 'info legend continuous-legend');
        div.innerHTML = `<h4>${metricCfg.legendTitle}</h4>`;
        const gradientContainer = L.DomUtil.create('div', 'gradient-container', div);
        gradientContainer.style.cssText = 'width: 200px; height: 20px; position: relative; margin: 5px 0;';
        const gradientBar = L.DomUtil.create('div', 'gradient-bar', gradientContainer);
        gradientBar.style.cssText
                    = `width: 100%; height: 100%; background: linear-gradient(to right, ${RAMP.join(', ')});`;
        const labelsContainer = L.DomUtil.create('div', 'legend-labels', div);
        labelsContainer.style.cssText = 'display: flex; justify-content: space-between; width: 200px;';
        L.DomUtil.create('div', 'legend-tick', labelsContainer).textContent = '0';
        L.DomUtil.create('div', 'legend-tick', labelsContainer).textContent = '1';
        return div;
      };
      legend.addTo(map);
      this._legend = legend;
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
