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

      container.innerHTML = 'Loading aggregate statistics...';

      return fetch(`${config.apiBaseUrl}${config.endpoint}?source=apiDocs`)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        })
        .then((data) => this.render(data, container))
        .catch((error) => {
          container.innerHTML = `<div class="message message-error">Failed to load aggregate statistics: ${error.message}</div>`;
          return Promise.reject(error);
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
        ['Distance Explored', `${Number(data.km_explored || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`],
        ['Total Labels', fmt(data.total_labels)],
        ['Total Validations', fmt(data.total_validations)],
        ['Total Users', fmt(data.total_users)],
      ];

      const grid = document.createElement('div');
      grid.style.cssText
                = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0 0 24px';
      cards.forEach(([label, value]) => {
        const card = document.createElement('div');
        card.style.cssText
                    = 'text-align:center;padding:12px;background:#f9f9f9;border:1px solid #e0e0e0;border-radius:4px';
        const v = document.createElement('div');
        v.textContent = value;
        v.style.cssText = 'font-size:1.4em;font-weight:bold';
        const l = document.createElement('div');
        l.textContent = label;
        l.style.cssText = 'font-size:0.85em;color:#666';
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
      table.style.cssText = 'width:100%;border-collapse:collapse';

      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      ['Label Type', 'Labels', 'Validated', 'Agreed', 'Disagreed'].forEach((text, i) => {
        const th = document.createElement('th');
        th.textContent = text;
        th.style.cssText = `padding:8px;border-bottom:2px solid #e0e0e0;text-align:${i === 0 ? 'left' : 'right'}`;
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      rows.forEach((r) => {
        const row = document.createElement('tr');

        const nameCell = document.createElement('td');
        nameCell.textContent = r.type;
        nameCell.style.padding = '8px';
        row.appendChild(nameCell);

        // Labels with a proportional bar.
        const labelsCell = document.createElement('td');
        labelsCell.style.cssText = 'padding:8px;text-align:right';
        const num = document.createElement('div');
        num.textContent = fmt(r.labels);
        labelsCell.appendChild(num);
        const barOuter = document.createElement('div');
        barOuter.style.cssText = 'background:#eee;border-radius:3px;height:8px;margin-top:4px';
        const barInner = document.createElement('div');
        barInner.style.cssText
                    = `height:8px;border-radius:3px;background:#78B9AB;width:${maxLabels > 0 ? ((r.labels || 0) / maxLabels) * 100 : 0}%`;
        barOuter.appendChild(barInner);
        labelsCell.appendChild(barOuter);
        row.appendChild(labelsCell);

        [r.labels_validated, r.labels_validated_agree, r.labels_validated_disagree].forEach((v) => {
          const cell = document.createElement('td');
          cell.style.cssText = 'padding:8px;text-align:right';
          cell.textContent = fmt(v);
          row.appendChild(cell);
        });

        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      container.appendChild(table);
    },
  };
})();
