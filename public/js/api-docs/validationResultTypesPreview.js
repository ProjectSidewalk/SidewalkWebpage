/**
 * Validation Result Types Preview Generator.
 *
 * Renders a small table of validation result types (Agree / Disagree / Unsure) with their counts, fetched directly
 * from the Validation Result Types API.
 *
 * @requires DOM element with id 'validation-result-types-preview'
 */

(function () {
  // Configuration options - can be overridden by calling setup().
  let config = {
    apiBaseUrl: '/v3/api',
    containerId: 'validation-result-types-preview',
    maxWidth: 1000,
    endpoint: '/validationResultTypes',
  };

  // The Validate tool's own agree / disagree / unsure palette.
  const RESULT_TOKENS = { Agree: '--color-pine-500', Disagree: '--color-orange-500', Unsure: '--color-banana-500' };

  /** Builds a right-aligned numeric cell. */
  function numCell(value) {
    const cell = document.createElement('td');
    cell.className = 'num';
    cell.textContent = (value ?? 0).toLocaleString();
    return cell;
  }

  window.ValidationResultTypesPreview = {
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

      container.innerHTML = '<div class="loading-message">Loading validation result types...</div>';

      return fetch(`${config.apiBaseUrl}${config.endpoint}?utm_source=apiDocs`)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        })
        .then((data) => this.render(data, container))
        .catch((error) => {
          container.innerHTML = `<div class="message message-error" role="alert">Failed to load validation `
            + `result types: ${error.message}</div>`;
          // The failure is already surfaced in the container above, and init() is fire-and-forget at every call
          // site (app/views/apiDocs/*), so re-rejecting here can only ever become an unhandled rejection.
        });
    },

    /**
     * Render the result-types table.
     * @param {object} data - Validation result types data from the API
     * @param {HTMLElement} container - Container element
     * @returns {HTMLElement} The rendered table
     */
    render(data, container) {
      const types = (data.validation_result_types || []).slice().sort((a, b) => b.count - a.count);
      const maxCount = types.length > 0 ? Math.max.apply(null, types.map((t) => t.count)) : 0;

      const table = document.createElement('table');
      table.className = 'ps-table';

      // Header.
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      ['Result', 'Total Validations', 'Human', 'AI'].forEach((text, i) => {
        const th = document.createElement('th');
        th.textContent = text;
        if (i > 0) th.className = 'num';
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      // Body.
      const tbody = document.createElement('tbody');
      types.forEach((type) => {
        const row = document.createElement('tr');
        const color = ApiDocsTheme.color(RESULT_TOKENS[type.name] || '--color-neutral-500');

        // Result name with a colored swatch.
        const nameCell = document.createElement('td');
        const swatch = document.createElement('span');
        swatch.className = 'api-swatch';
        swatch.style.backgroundColor = color;
        nameCell.appendChild(swatch);
        nameCell.appendChild(document.createTextNode(type.name));
        row.appendChild(nameCell);

        // Total count with a proportional bar.
        const totalCell = document.createElement('td');
        totalCell.className = 'num';
        const num = document.createElement('div');
        num.textContent = type.count.toLocaleString();
        totalCell.appendChild(num);
        const barOuter = document.createElement('div');
        barOuter.className = 'count-bar-container';
        const barInner = document.createElement('div');
        barInner.className = 'count-bar-fill';
        barInner.style.backgroundColor = color;
        barInner.style.width = `${maxCount > 0 ? (type.count / maxCount) * 100 : 0}%`;
        barOuter.appendChild(barInner);
        totalCell.appendChild(barOuter);
        row.appendChild(totalCell);

        // Human and AI counts.
        row.appendChild(numCell(type.count_human));
        row.appendChild(numCell(type.count_ai));

        tbody.appendChild(row);
      });
      table.appendChild(tbody);

      container.innerHTML = '';
      container.appendChild(window.createApiTableWrapper(table, 'Validation result types'));
      return table;
    },
  };
})();
