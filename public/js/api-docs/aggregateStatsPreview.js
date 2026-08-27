/**
 * Aggregate Stats Preview Generator.
 *
 * Renders headline project-wide totals (cities, countries, languages, distance, labels, validations) plus a
 * per-label-type breakdown, fetched directly from the Aggregate Stats API.
 *
 * @requires DOM element with id 'aggregate-stats-preview'
 */

(function () {
  // Configuration options - can be overridden by calling setup().
  let config = {
    apiBaseUrl: '/v3/api',
    containerId: 'aggregate-stats-preview',
    maxWidth: 1000,
    endpoint: '/aggregateStats',
  };

  /** Formats a number with thousands separators (null-safe). */
  function fmt(value) {
    return (value ?? 0).toLocaleString();
  }

  window.AggregateStatsPreview = {
    /**
     * Configure the preview.
     * @param {object} options - Configuration options
     * @returns {object} The preview object for chaining
     */
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Initialize the preview.
     * @returns {Promise} A promise that resolves when the preview is rendered
     */
    init() {
      const container = document.getElementById(config.containerId);
      if (!container) {
        console.error(`Container element with id '${config.containerId}' not found.`);
        return Promise.reject(new Error('Container element not found'));
      }

      if (config.maxWidth) {
        container.style.maxWidth = `${config.maxWidth}px`;
        container.style.width = '100%';
        container.style.margin = '20px 0';
      }

      container.innerHTML = '<div class="loading-message">Loading aggregate statistics...</div>';

      return fetch(`${config.apiBaseUrl}${config.endpoint}?utm_source=apiDocs`)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        })
        .then((data) => this.render(data, container))
        .catch((error) => {
          container.innerHTML = `<div class="message message-error">Failed to load aggregate statistics: `
            + `${error.message}</div>`;
          // The failure is already surfaced in the container above, and init() is fire-and-forget at every call
          // site (app/views/apiDocs/*), so re-rejecting here can only ever become an unhandled rejection.
        });
    },

    /**
     * Render the headline stat cards and per-label-type table.
     * @param {object} data - Aggregate stats data from the API
     * @param {HTMLElement} container - Container element
     */
    render(data, container) {
      container.innerHTML = '';

      // Headline stat cards.
      const cards = [
        ['Cities', fmt(data.num_cities)],
        ['Countries', fmt(data.num_countries)],
        ['Languages', fmt(data.num_languages)],
        ['Distance Explored',
          `${Number(data.km_explored || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`],
        ['Total Labels', fmt(data.total_labels)],
        ['Total Validations', fmt(data.total_validations)],
        ['Total Users', fmt(data.total_users)],
      ];

      const grid = document.createElement('div');
      grid.className = 'preview-section preview-stat-grid';
      cards.forEach(([label, value]) => {
        const card = document.createElement('div');
        card.className = 'preview-stat';
        const v = document.createElement('div');
        v.className = 'preview-stat-value';
        v.textContent = value;
        const l = document.createElement('div');
        l.className = 'preview-stat-label';
        l.textContent = label;
        card.appendChild(v);
        card.appendChild(l);
        grid.appendChild(card);
      });
      container.appendChild(grid);

      // Per-label-type breakdown.
      const byType = data.by_label_type || {};
      const rows = Object.keys(byType)
        .map((k) => ({ type: k, ...byType[k] }))
        .sort((a, b) => (b.labels || 0) - (a.labels || 0));

      if (rows.length === 0) return;
      const maxLabels = Math.max.apply(null, rows.map((r) => r.labels || 0));

      const table = document.createElement('table');
      table.className = 'ps-table';

      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      ['Label Type', 'Labels', 'Validated', 'Agreed', 'Disagreed'].forEach((text, i) => {
        const th = document.createElement('th');
        th.textContent = text;
        if (i > 0) th.className = 'num';
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      rows.forEach((r) => {
        const row = document.createElement('tr');

        const nameCell = document.createElement('td');
        nameCell.textContent = r.type;
        row.appendChild(nameCell);

        // Labels with a proportional bar.
        const labelsCell = document.createElement('td');
        labelsCell.className = 'num';
        const num = document.createElement('div');
        num.textContent = fmt(r.labels);
        labelsCell.appendChild(num);
        const barOuter = document.createElement('div');
        barOuter.className = 'count-bar-container';
        const barInner = document.createElement('div');
        barInner.className = 'count-bar-fill';
        barInner.style.width = `${maxLabels > 0 ? ((r.labels || 0) / maxLabels) * 100 : 0}%`;
        barOuter.appendChild(barInner);
        labelsCell.appendChild(barOuter);
        row.appendChild(labelsCell);

        [r.labels_validated, r.labels_validated_agree, r.labels_validated_disagree].forEach((v) => {
          const cell = document.createElement('td');
          cell.className = 'num';
          cell.textContent = fmt(v);
          row.appendChild(cell);
        });

        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      container.appendChild(window.createApiTableWrapper(table, 'Labels by label type'));
    },
  };
})();
