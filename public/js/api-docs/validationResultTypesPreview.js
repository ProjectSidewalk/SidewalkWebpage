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

  // Colors per result type (Project Sidewalk palette).
  const RESULT_COLORS = { Agree: '#78B9AB', Disagree: '#EB734D', Unsure: '#FBD78B' };

  /** Builds a right-aligned numeric cell. */
  function numCell(value) {
    const cell = document.createElement('td');
    cell.style.padding = '8px';
    cell.style.textAlign = 'right';
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

      container.innerHTML = 'Loading validation result types...';

      return fetch(`${config.apiBaseUrl}${config.endpoint}?source=apiDocs`)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        })
        .then((data) => this.render(data, container))
        .catch((error) => {
          container.innerHTML = `<div class="message message-error">Failed to load validation result types: `
            + `${error.message}</div>`;
          return Promise.reject(error);
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
      table.style.width = '100%';
      table.style.borderCollapse = 'collapse';

      // Header.
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      ['Result', 'Total Validations', 'Human', 'AI'].forEach((text, i) => {
        const th = document.createElement('th');
        th.textContent = text;
        th.style.padding = '8px';
        th.style.textAlign = i === 0 ? 'left' : 'right';
        th.style.borderBottom = '2px solid #e0e0e0';
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      // Body.
      const tbody = document.createElement('tbody');
      types.forEach((type) => {
        const row = document.createElement('tr');
        const color = RESULT_COLORS[type.name] || '#999';

        // Result name with a colored swatch.
        const nameCell = document.createElement('td');
        nameCell.style.padding = '8px';
        const swatch = document.createElement('span');
        swatch.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:2px;`
          + `margin-right:8px;background:${color}`;
        nameCell.appendChild(swatch);
        nameCell.appendChild(document.createTextNode(type.name));
        row.appendChild(nameCell);

        // Total count with a proportional bar.
        const totalCell = document.createElement('td');
        totalCell.style.padding = '8px';
        totalCell.style.textAlign = 'right';
        const num = document.createElement('div');
        num.textContent = type.count.toLocaleString();
        totalCell.appendChild(num);
        const barOuter = document.createElement('div');
        barOuter.style.cssText = 'background:#eee;border-radius:3px;height:8px;margin-top:4px';
        const barInner = document.createElement('div');
        barInner.style.cssText = `height:8px;border-radius:3px;background:${color};`
          + `width:${maxCount > 0 ? (type.count / maxCount) * 100 : 0}%`;
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
      container.appendChild(table);
      return table;
    },
  };
})();
