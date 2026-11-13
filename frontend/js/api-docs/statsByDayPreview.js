/**
 * The previews on the two by-day API docs pages: one city, and every city summed (which also shows AI activity).
 * Both chart the last 90 days that have data.
 */

import { Chart } from './apiDocsChart.js';
import { util } from '../common/utilities.js';
import { ApiDocsTheme } from './apiDocsTheme.js';
import '../common/utilitiesSidewalk.js';

/**
 * @param {HTMLElement} container
 * @param {string} msg
 */
function showError(container, msg) {
  container.innerHTML = `<div class="message message-error" role="alert">${msg}</div>`;
}

/**
 * Keeps only rows from the most recent `maxDays` unique dates in the data.
 * @param {Array<Record<string, any>>} data
 * @param {number} maxDays
 * @returns {Array<Record<string, any>>}
 */
function trimToRecentDays(data, maxDays) {
  const dates = Array.from(new Set(data.map((r) => r.date))).sort();
  const cutoff = dates.length > maxDays ? dates[dates.length - maxDays] : dates[0];
  return data.filter((r) => r.date >= cutoff);
}

/**
 * Builds a lookup: date → { labelType → record } from the flat data array.
 * @param {Array<Record<string, any>>} data
 * @returns {Map<string, Map<string, Record<string, any>>>}
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
 * @param {Map<string, Map<string, Record<string, any>>>} byDay
 * @param {string} field
 * @returns {number[]}
 */
function dailyTotals(dates, byDay, field) {
  return dates.map((d) => {
    let total = 0;
    byDay.get(d).forEach((row) => {
      total += (row[field] || 0);
    });
    return total;
  });
}

/**
 * Renders the summary stats bar and charts.
 * @param {HTMLElement} container
 * @param {Array<Record<string, any>>} data
 * @param {StatsByDayVariant} variant - Which page's preview this is.
 * @param {{cityName: string}} config - The preview's settings.
 */
function render(container, data, variant, config) {
  if (!data.length) {
    container.innerHTML = '<p class="preview-note" role="status">No data available for this period.</p>';
    return;
  }

  const byDay = buildDailyMap(data);
  const dates = Array.from(byDay.keys()).sort();
  const sum = (field) => data.reduce((s, r) => s + r[field], 0);

  // ── Summary stats ──────────────────────────────────────────────────────
  const totalAgree = sum('human_validations_agree');
  const humanValidations = totalAgree + sum('human_validations_disagree') + sum('human_validations_unsure');
  const totalValidations = variant.withAi
    ? humanValidations + sum('ai_validations_agree') + sum('ai_validations_disagree') + sum('ai_validations_unsure')
    : humanValidations;
  const accuracy = humanValidations > 0
    ? `${((totalAgree / humanValidations) * 100).toFixed(1)}%`
    : 'N/A';

  const summaryEl = document.createElement('div');
  summaryEl.className = 'preview-section preview-stat-grid';
  summaryEl.innerHTML = `
    <div class="preview-stat"><span class="preview-stat-value">${dates.length}</span>
      <span class="preview-stat-label">Days shown</span>
    </div>
    <div class="preview-stat"><span class="preview-stat-value">${sum('human_labels').toLocaleString()}</span>
      <span class="preview-stat-label">Human labels</span>
    </div>
    <div class="preview-stat"><span class="preview-stat-value">${sum('ai_labels').toLocaleString()}</span>
      <span class="preview-stat-label">AI labels</span>
    </div>
    <div class="preview-stat"><span class="preview-stat-value">${totalValidations.toLocaleString()}</span>
      <span class="preview-stat-label">${util.escapeHTML(variant.validationsLabel)}</span>
    </div>
    <div class="preview-stat"><span class="preview-stat-value">${accuracy}</span>
      <span class="preview-stat-label">${util.escapeHTML(variant.agreementLabel)}</span>
    </div>
  `;
  container.appendChild(summaryEl);

  // ── Chart 1: Labels per day ────────────────────────────────────────────
  const labelLine = (label, field, color, alpha, fillAlpha) => ({
    label,
    data: dailyTotals(dates, byDay, field),
    borderColor: ApiDocsTheme.color(color, alpha),
    backgroundColor: ApiDocsTheme.color(color, fillAlpha),
    fill: true,
    tension: 0.3,
    pointRadius: dates.length > 60 ? 0 : 3,
  });
  const labelDatasets = [labelLine('Human Labels', 'human_labels', '--color-link-200', undefined, 0.12)];
  if (variant.withAi) labelDatasets.push(labelLine('AI Labels', 'ai_labels', '--color-purple-500', 0.9, 0.08));
  container.appendChild(makeChart(...variant.labelsChart(config), (chartContainer) => {
    const canvas = document.createElement('canvas');
    chartContainer.appendChild(canvas);
    new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: dates, datasets: labelDatasets },
      options: chartOptions('Labels placed'),
    });
  }));

  // ── Chart 2: Human validations per day, stacked by result ──────────────
  const validationBar = (label, field, color) => ({
    label,
    data: dailyTotals(dates, byDay, field),
    backgroundColor: ApiDocsTheme.color(color, 0.8),
    stack: 'val',
  });
  container.appendChild(makeChart(...variant.validationsChart(config), (chartContainer) => {
    const canvas = document.createElement('canvas');
    chartContainer.appendChild(canvas);
    new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: dates,
        datasets: [
          validationBar('Agree', 'human_validations_agree', '--color-pine-500'),
          validationBar('Disagree', 'human_validations_disagree', '--color-orange-500'),
          validationBar('Unsure', 'human_validations_unsure', '--color-banana-600'),
        ],
      },
      options: chartOptions('Validations', { stacked: true }),
    });
  }));

  // ── Chart 3: Human labels per day by type ──────────────────────────────
  const labelTypes = Array.from(new Set(data.map((r) => r.label_type))).sort();
  container.appendChild(makeChart(...variant.byTypeChart, (chartContainer) => {
    const canvas = document.createElement('canvas');
    chartContainer.appendChild(canvas);
    new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: dates,
        datasets: labelTypes.map((lt) => ({
          label: lt,
          data: dates.map((d) => byDay.get(d).get(lt)?.human_labels || 0),
          borderColor: util.misc.getLabelColors(lt),
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: dates.length > 60 ? 0 : 2,
        })),
      },
      options: chartOptions('Labels placed'),
    });
  }));
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
    <h3 class="preview-title">${util.escapeHTML(title)}</h3>
    <p class="preview-desc">${util.escapeHTML(description)}</p>
  `;
  const inner = document.createElement('div');
  inner.className = 'chart-container';
  wrap.appendChild(inner);
  builder(inner);
  return wrap;
}

/**
 * @typedef {object} StatsByDayVariant
 * @property {string} name - Names the preview in console errors.
 * @property {string} endpoint - The API endpoint, under the base URL.
 * @property {string} containerId - The element the preview fills.
 * @property {boolean} withAi - Whether AI labels are charted and AI validations counted in the total.
 * @property {string} validationsLabel - The total-validations card's label.
 * @property {string} agreementLabel - The agreement-rate card's label.
 * @property {(config: {cityName: string}) => [string, string]} labelsChart - That chart's title and description.
 * @property {(config: {cityName: string}) => [string, string]} validationsChart - Same, for validations.
 * @property {[string, string]} byTypeChart - Same, for labels by type.
 */

/**
 * Builds one by-day preview.
 * @param {StatsByDayVariant} variant - Which page, and how its preview words and counts things.
 * @returns {{setup: Function, init: Function}} The preview.
 */
function createStatsByDayPreview(variant) {
  let config = { apiBaseUrl: '/v3/api', containerId: variant.containerId, cityName: 'this city' };
  return {
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

      return fetch(`${config.apiBaseUrl}/${variant.endpoint}?utm_source=apiDocs`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((json) => {
          container.innerHTML = '';
          render(container, trimToRecentDays(json.data || [], 90), variant, config);
        })
        .catch((err) => {
          showError(container, `Failed to load preview: ${util.escapeHTML(err.message)}`);
          console.error(`${variant.name} error:`, err);
        });
    },
  };
}

export const OverallStatsByDayPreview = createStatsByDayPreview({
  name: 'OverallStatsByDayPreview',
  endpoint: 'overallStatsByDay',
  containerId: 'overall-stats-by-day-preview',
  withAi: false,
  validationsLabel: 'Validations',
  agreementLabel: 'Agreement rate',
  labelsChart: (config) => [
    'Human Labels per Day', `Daily new labels placed by human contributors in ${config.cityName}`,
  ],
  validationsChart: (config) => [
    'Validations per Day', `Daily validation activity breakdown in ${config.cityName}`,
  ],
  byTypeChart: ['Human Labels per Day by Label Type', 'Each line represents one label type'],
});

export const AggregateStatsByDayPreview = createStatsByDayPreview({
  name: 'AggregateStatsByDayPreview',
  endpoint: 'aggregateStatsByDay',
  containerId: 'aggregate-stats-by-day-preview',
  withAi: true,
  validationsLabel: 'Total validations',
  agreementLabel: 'Human agreement rate',
  labelsChart: () => ['Labels per Day (All Deployments)', 'Daily new labels placed across all Project Sidewalk cities'],
  validationsChart: () => [
    'Human Validations per Day (All Deployments)', 'Daily validation activity breakdown across all cities',
  ],
  byTypeChart: [
    'Human Labels per Day by Label Type (All Deployments)',
    'Each line represents one label type summed across all cities',
  ],
});
