/**
 * Project Sidewalk Aggregate Stats by Day Preview Generator.
 *
 * Renders a live time-series visualization for the Aggregate Stats by Day API endpoint, showing daily label and
 * validation activity summed across all Project Sidewalk deployments over the most recent 90 days with data.
 *
 * @requires DOM element with id 'aggregate-stats-by-day-preview'
 * @requires Chart.js library (chart-4.5.1.min.js)
 */
(function () {
  /** @type {{apiBaseUrl: string, containerId: string}} */
  let config = {
    apiBaseUrl: '/v3/api',
    containerId: 'aggregate-stats-by-day-preview',
  };

  /** @param {string} msg */
  function showError(container, msg) {
    container.innerHTML = `<div class="message message-error">${msg}</div>`;
  }

  /**
   * Keeps only rows from the most recent `maxDays` unique dates in the data.
   * @param {Array<object>} data
   * @param {number} maxDays
   * @returns {Array<object>}
   */
  function trimToRecentDays(data, maxDays) {
    const dates = Array.from(new Set(data.map((r) => r.date))).sort();
    const cutoff = dates.length > maxDays ? dates[dates.length - maxDays] : dates[0];
    return data.filter((r) => r.date >= cutoff);
  }

  /**
   * Builds a lookup: date → { labelType → record } from the flat data array.
   * @param {Array<object>} data
   * @returns {Map<string, Map<string, object>>}
   */
  function buildDailyMap(data) {
    const map = new Map();
    data.forEach((row) => {
      if (!map.has(row.date)) map.set(row.date, new Map());
      map.get(row.date).set(row.label_type, row);
    });
    return map;
  }

  /**
   * Aggregates daily totals (summed across all label types) for a field.
   * @param {string[]} dates - Sorted date strings
   * @param {Map<string, Map<string, object>>} byDay
   * @param {string} field
   * @returns {number[]}
   */
  function dailyTotals(dates, byDay, field) {
    return dates.map((d) => {
      let total = 0;
      (byDay.get(d) || new Map()).forEach((row) => {
        total += (row[field] || 0);
      });
      return total;
    });
  }

  /**
   * Renders the summary stats bar and charts.
   * @param {HTMLElement} container
   * @param {Array<object>} data
   */
  function render(container, data) {
    if (!data.length) {
      container.innerHTML = '<p class="preview-note">No data available for this period.</p>';
      return;
    }

    const byDay = buildDailyMap(data);
    const dates = Array.from(byDay.keys()).sort();

    // ── Summary stats ──────────────────────────────────────────────────────
    const totalHumanLabels = data.reduce((s, r) => s + r.human_labels, 0);
    const totalAiLabels = data.reduce((s, r) => s + r.ai_labels, 0);
    const totalAgree = data.reduce((s, r) => s + r.human_validations_agree, 0);
    const totalDisagree = data.reduce((s, r) => s + r.human_validations_disagree, 0);
    const totalUnsure = data.reduce((s, r) => s + r.human_validations_unsure, 0);
    const totalAiAgree = data.reduce((s, r) => s + r.ai_validations_agree, 0);
    const totalAiDisagree = data.reduce((s, r) => s + r.ai_validations_disagree, 0);
    const totalValidations = totalAgree + totalDisagree + totalUnsure + totalAiAgree + totalAiDisagree
      + data.reduce((s, r) => s + r.ai_validations_unsure, 0);
    const humanValidations = totalAgree + totalDisagree + totalUnsure;
    const accuracy = humanValidations > 0
      ? ((totalAgree / humanValidations) * 100).toFixed(1)
      : 'N/A';

    const summaryEl = document.createElement('div');
    summaryEl.className = 'preview-section preview-stat-grid';
    summaryEl.innerHTML = `
      <div class="preview-stat"><span class="preview-stat-value">${dates.length}</span>
        <span class="preview-stat-label">Days shown</span>
      </div>
      <div class="preview-stat"><span class="preview-stat-value">${totalHumanLabels.toLocaleString()}</span>
        <span class="preview-stat-label">Human labels</span>
      </div>
      <div class="preview-stat"><span class="preview-stat-value">${totalAiLabels.toLocaleString()}</span>
        <span class="preview-stat-label">AI labels</span>
      </div>
      <div class="preview-stat"><span class="preview-stat-value">${totalValidations.toLocaleString()}</span>
        <span class="preview-stat-label">Total validations</span>
      </div>
      <div class="preview-stat"><span class="preview-stat-value">${accuracy}%</span>
        <span class="preview-stat-label">Human agreement rate</span>
      </div>
    `;
    container.appendChild(summaryEl);

    // ── Chart 1: Human + AI labels per day ─────────────────────────────────
    container.appendChild(makeChart(
      'Labels per Day (All Deployments)',
      'Daily new labels placed across all Project Sidewalk cities',
      (chartContainer) => {
        const canvas = document.createElement('canvas');
        chartContainer.appendChild(canvas);
        new Chart(canvas.getContext('2d'), {
          type: 'line',
          data: {
            labels: dates,
            datasets: [
              {
                label: 'Human Labels',
                data: dailyTotals(dates, byDay, 'human_labels'),
                borderColor: ApiDocsTheme.color('--color-link-200'),
                backgroundColor: ApiDocsTheme.color('--color-link-200', 0.12),
                fill: true,
                tension: 0.3,
                pointRadius: dates.length > 60 ? 0 : 3,
              },
              {
                label: 'AI Labels',
                data: dailyTotals(dates, byDay, 'ai_labels'),
                borderColor: ApiDocsTheme.color('--color-purple-500', 0.9),
                backgroundColor: ApiDocsTheme.color('--color-purple-500', 0.08),
                fill: true,
                tension: 0.3,
                pointRadius: dates.length > 60 ? 0 : 3,
              },
            ],
          },
          options: chartOptions('Labels placed'),
        });
      },
    ));

    // ── Chart 2: Validations per day (stacked agree/disagree/unsure) ───────
    container.appendChild(makeChart(
      'Human Validations per Day (All Deployments)',
      'Daily validation activity breakdown across all cities',
      (chartContainer) => {
        const canvas = document.createElement('canvas');
        chartContainer.appendChild(canvas);
        new Chart(canvas.getContext('2d'), {
          type: 'bar',
          data: {
            labels: dates,
            datasets: [
              {
                label: 'Agree',
                data: dailyTotals(dates, byDay, 'human_validations_agree'),
                backgroundColor: ApiDocsTheme.color('--color-pine-500', 0.8),
                stack: 'val',
              },
              {
                label: 'Disagree',
                data: dailyTotals(dates, byDay, 'human_validations_disagree'),
                backgroundColor: ApiDocsTheme.color('--color-orange-500', 0.8),
                stack: 'val',
              },
              {
                label: 'Unsure',
                data: dailyTotals(dates, byDay, 'human_validations_unsure'),
                backgroundColor: ApiDocsTheme.color('--color-banana-600', 0.8),
                stack: 'val',
              },
            ],
          },
          options: chartOptions('Validations', { stacked: true }),
        });
      },
    ));

    // ── Chart 3: Labels per day by type (all cities, human only) ───────────
    const labelTypes = Array.from(
      new Set(data.map((r) => r.label_type)),
    ).sort();
    container.appendChild(makeChart(
      'Human Labels per Day by Label Type (All Deployments)',
      'Each line represents one label type summed across all cities',
      (chartContainer) => {
        const canvas = document.createElement('canvas');
        chartContainer.appendChild(canvas);
        new Chart(canvas.getContext('2d'), {
          type: 'line',
          data: {
            labels: dates,
            datasets: labelTypes.map((lt) => ({
              label: lt,
              data: dates.map((d) => ((byDay.get(d) || new Map()).get(lt) || {}).human_labels || 0),
              borderColor: util.misc.getLabelColors(lt) || ApiDocsTheme.color('--color-neutral-500'),
              backgroundColor: 'transparent',
              tension: 0.3,
              pointRadius: dates.length > 60 ? 0 : 2,
            })),
          },
          options: chartOptions('Labels placed'),
        });
      },
    ));
  }

  /**
   * Builds a standard Chart.js options object.
   * @param {string} yLabel
   * @param {{stacked?: boolean}} [opts]
   * @returns {object}
   */
  function chartOptions(yLabel, opts = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: {
        x: {
          ticks: { maxTicksLimit: 10, maxRotation: 45 },
          stacked: !!opts.stacked,
        },
        y: {
          beginAtZero: true,
          stacked: !!opts.stacked,
          title: { display: true, text: yLabel },
        },
      },
    };
  }

  /**
   * Creates a labelled chart wrapper div.
   * @param {string} title
   * @param {string} description
   * @param {Function} builder - Receives the inner div and should append a canvas.
   * @returns {HTMLElement}
   */
  function makeChart(title, description, builder) {
    const wrap = document.createElement('div');
    wrap.className = 'preview-section';
    wrap.innerHTML = `
      <h3 class="preview-title">${title}</h3>
      <p class="preview-desc">${description}</p>
    `;
    const inner = document.createElement('div');
    inner.className = 'chart-container';
    wrap.appendChild(inner);
    builder(inner);
    return wrap;
  }

  window.AggregateStatsByDayPreview = {
    /**
     * @param {object} options
     * @returns {object} this
     */
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Fetch data and render charts.
     * @returns {Promise}
     */
    init() {
      const container = document.getElementById(config.containerId);
      if (!container) return Promise.reject(new Error('Container not found'));

      container.innerHTML = '<div class="loading-message">Loading…</div>';

      const url = `${config.apiBaseUrl}/aggregateStatsByDay?utm_source=apiDocs`;

      return fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((json) => {
          container.innerHTML = '';
          // Trim to the most recent 90 days that have data for readability.
          render(container, trimToRecentDays(json.data || [], 90));
        })
        .catch((err) => {
          showError(container, `Failed to load preview: ${err.message}`);
          console.error('AggregateStatsByDayPreview error:', err);
        });
    },
  };
})();
