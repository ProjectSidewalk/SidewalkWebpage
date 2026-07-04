/**
 * Admin.ApiAnalytics
 *
 * Renders the API Analytics tab on the admin page, showing v3 public API usage aggregated from the
 * webpage_activity log. Includes endpoint breakdown, daily call volume chart, unique IPs, and format
 * (filetype) breakdown. A toggle lets admins exclude `source=apiDocs` traffic (doc-preview calls)
 * from all counts.
 */
class AdminApiAnalytics {
  /** @type {object|null} - last fetched analytics payload from the server. */
  #data = null;

  /** @type {boolean} - whether `source=apiDocs` requests are excluded from counts. */
  #excludeApiDocs = true;

  /** @type {number} - number of past days to show (0 = all time). */
  #days = 30;

  /** @type {boolean} - prevents concurrent fetches. */
  #loading = false;

  /**
     * Sets up event listeners on the filter controls.
     */
  constructor() {
    const excludeToggle = document.getElementById('api-analytics-exclude-docs');
    const daysSelect = document.getElementById('api-analytics-days');

    if (excludeToggle) {
      excludeToggle.addEventListener('change', () => {
        this.#excludeApiDocs = excludeToggle.checked;
        this.#fetchAndRender();
      });
    }

    if (daysSelect) {
      daysSelect.addEventListener('change', () => {
        this.#days = parseInt(daysSelect.value, 10);
        this.#fetchAndRender();
      });
    }
  }

  /**
     * Loads analytics data from the server and renders all panels. Safe to call multiple times.
     * @returns {Promise<void>}
     */
  async load() {
    if (this.#loading) return;
    await this.#fetchAndRender();
  }

  /**
     * Fetches analytics data from `/adminapi/apiAnalytics` and re-renders all panels.
     * @returns {Promise<void>}
     */
  async #fetchAndRender() {
    if (this.#loading) return;
    this.#loading = true;
    this.#showLoading();

    try {
      const url = `/adminapi/apiAnalytics?excludeApiDocs=${this.#excludeApiDocs}&days=${this.#days}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.#data = await response.json();
      this.#render();
    } catch (err) {
      this.#showError(`Failed to load API analytics: ${err.message}`);
      console.error('AdminApiAnalytics fetch error:', err);
    } finally {
      this.#loading = false;
    }
  }

  /** Renders all panels from the cached `#data`. */
  #render() {
    if (!this.#data) return;
    this.#renderSummary();
    this.#renderEndpointTable();
    this.#renderDailyChart();
    this.#renderFormatTable();
  }

  /**
     * Renders the summary stats panel (total calls, unique IPs).
     */
  #renderSummary() {
    const el = document.getElementById('api-analytics-summary');
    if (!el) return;
    const rangeLabel = this.#days === 0 ? 'all time' : `last ${this.#days} days`;

    el.innerHTML = `
            <div class="api-analytics-summary-cards">
                <div class="api-analytics-card">
                    <div class="api-analytics-card-value">${this.#data.total_calls.toLocaleString()}</div>
                    <div class="api-analytics-card-label">Total API Calls (${rangeLabel})</div>
                </div>
                <div class="api-analytics-card">
                    <div class="api-analytics-card-value">${this.#data.unique_ips.toLocaleString()}</div>
                    <div class="api-analytics-card-label">Unique IPs</div>
                </div>
                <div class="api-analytics-card">
                    <div class="api-analytics-card-value">${this.#data.endpoint_counts.length}</div>
                    <div class="api-analytics-card-label">Distinct Endpoints</div>
                </div>
            </div>
        `;
  }

  /**
     * Renders the endpoint breakdown table.
     */
  #renderEndpointTable() {
    const el = document.getElementById('api-analytics-endpoint-table');
    if (!el) return;

    if (this.#data.endpoint_counts.length === 0) {
      el.innerHTML = '<p>No API calls recorded for this period.</p>';
      return;
    }

    const rows = this.#data.endpoint_counts.map((row) => `
            <tr>
                <td><code>${row.endpoint}</code></td>
                <td class="text-right">${row.count.toLocaleString()}</td>
                <td>
                    <div class="api-analytics-bar-outer">
                        <div class="api-analytics-bar-inner"
                             style="width:${Math.round(100 * row.count / this.#data.total_calls)}%"></div>
                    </div>
                </td>
            </tr>
        `).join('');

    el.innerHTML = `
            <h3>Calls by Endpoint</h3>
            <table class="table table-striped table-condensed api-analytics-table">
                <thead>
                    <tr><th>Endpoint</th><th class="text-right">Calls</th><th>Share</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
  }

  /**
     * Renders the daily call volume line chart using Vega-Lite (already loaded on the admin page).
     */
  #renderDailyChart() {
    const el = document.getElementById('api-analytics-daily-chart');
    if (!el) return;

    if (this.#data.daily_counts.length === 0) {
      el.innerHTML = '';
      return;
    }

    el.innerHTML = '<h3>Daily Call Volume</h3><div id="api-analytics-vega-chart"></div>';

    // The admin page loads vega-embed 3.0.0-beta.17, which does not return a Promise from embed().
    // Use the same pattern as the rest of Admin.js: pass mode as an option, no $schema field.
    const spec = {
      width: 700,
      height: 200,
      data: { values: this.#data.daily_counts, format: { type: 'json' } },
      mark: { type: 'line', point: true },
      encoding: {
        x: {
          field: 'date',
          type: 'temporal',
          axis: { title: 'Date', format: '%b %d' },
        },
        y: {
          field: 'count',
          type: 'quantitative',
          axis: { title: 'API Calls' },
        },
      },
    };

    if (typeof vega !== 'undefined') {
      const opt = { mode: 'vega-lite', actions: false };
      vega.embed('#api-analytics-vega-chart', spec, opt);
    }
  }

  /**
     * Renders the filetype/format breakdown table.
     */
  #renderFormatTable() {
    const el = document.getElementById('api-analytics-format-table');
    if (!el) return;

    if (this.#data.format_counts.length === 0) {
      el.innerHTML = '';
      return;
    }

    const rows = this.#data.format_counts.map((row) => `
            <tr>
                <td><code>${row.endpoint}</code></td>
                <td>${row.format}</td>
                <td class="text-right">${row.count.toLocaleString()}</td>
            </tr>
        `).join('');

    el.innerHTML = `
            <h3>Calls by Format</h3>
            <table class="table table-striped table-condensed api-analytics-table">
                <thead>
                    <tr><th>Endpoint</th><th>Format</th><th class="text-right">Calls</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
  }

  /** Shows a loading indicator while data is being fetched. */
  #showLoading() {
    const summaryEl = document.getElementById('api-analytics-summary');
    if (summaryEl) summaryEl.innerHTML = '<p>Loading...</p>';
    ['api-analytics-endpoint-table', 'api-analytics-daily-chart', 'api-analytics-format-table'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
  }

  /**
     * Shows an error message in the summary panel.
     * @param {string} message - The error message to display.
     */
  #showError(message) {
    const summaryEl = document.getElementById('api-analytics-summary');
    if (summaryEl) summaryEl.innerHTML = `<p class="text-danger">${message}</p>`;
  }
}
