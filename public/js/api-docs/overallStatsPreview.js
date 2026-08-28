/**
 * Project Sidewalk Overall Stats Visualization Generator
 *
 * Generates visualizations for the Overall Stats API preview by fetching data directly from the API endpoint.
 *
 * @requires DOM element with id 'overall-stats-preview'
 * @requires Chart.js library
 *
 * @example
 * // Initialize with default settings.
 * OverallStatsPreview.init();
 *
 * // Initialize with custom options.
 * OverallStatsPreview.setup({
 *   apiBaseUrl: "https://projectsidewalk.io/v3/api",
 *   containerId: "custom-container"
 * }).init();
 */

(function () {
  // Configuration options - can be overridden by calling setup().
  let config = {
    // API URL - will be updated to production URL in production.
    apiBaseUrl: 'http://localhost:9000/v3/api',
    containerId: 'overall-stats-preview',
    chartHeight: 300, // Fixed height for each chart.
    overallStatsEndpoint: '/overallStats',
    labelTypesEndpoint: '/labelTypes',
  };

  const labelTypeMapping = {}; // Machine name -> localized display name (populated from the labelTypes API).
  const labelTypeColors = {};  // Colors map (will be populated from labelTypes API).
  const labelTypeIcons = {};   // Icons map (will be populated from labelTypes API).

  // Public API.
  window.OverallStatsPreview = {
    /**
     * Configure the overall stats preview.
     * @param {object} options - Configuration options
     * @returns {object} The OverallStatsPreview object for chaining
     */
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Initialize the overall stats preview visualization.
     * @returns {Promise} A promise that resolves when the preview is rendered
     */
    init() {
      const container = document.getElementById(config.containerId);

      if (!container) {
        console.error(`Container element with id '${config.containerId}' not found.`);
        return Promise.reject(new Error('Container element not found'));
      }

      // Clear any existing content.
      container.innerHTML = '';

      // Add loading message.
      const loadingMessage = document.createElement('div');
      loadingMessage.className = 'loading-message';
      loadingMessage.textContent = 'Loading overall statistics...';
      container.appendChild(loadingMessage);

      // Try to get API URL from page if available.
      const apiBaseUrl = document.documentElement.getAttribute('data-api-base-url');
      if (apiBaseUrl) {
        config.apiBaseUrl = apiBaseUrl;
      }

      // First fetch the label types to get official colors and descriptions.
      return this.fetchLabelTypes()
        .then(() => {
          // Then fetch overall stats data and create visualizations
          return this.fetchOverallStats()
            .then((overallStatsData) => {
              // Remove loading message.
              container.removeChild(loadingMessage);

              // Create visualization elements.
              this.createVisualizations(container, overallStatsData);

              return overallStatsData;
            });
        })
        .catch((error) => {
          container.innerHTML = `<div class="message message-error">Failed to load data: ${error.message}</div>`;
          console.error('Overall stats preview error:', error);
          // The failure is already surfaced in the container above, and init() is fire-and-forget at every call
          // site (app/views/apiDocs/*), so re-rejecting here can only ever become an unhandled rejection.
        });
    },

    /**
     * Fetch label types from the API to get proper colors and descriptions.
     * @returns {Promise} A promise that resolves with the label types data
     */
    fetchLabelTypes() {
      return fetch(`${config.apiBaseUrl}${config.labelTypesEndpoint}?utm_source=apiDocs`)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        })
        .then((data) => {
          // Process the label types data to populate the colors and mapping.
          if (data && data.label_types && Array.isArray(data.label_types)) {
            data.label_types.forEach((labelType) => {
              // Update the colors map.
              labelTypeColors[labelType.name] = labelType.color;

              // Update the label type mapping.
              labelTypeMapping[labelType.name] = labelType.display_name;

              // Store icon URLs.
              labelTypeIcons[labelType.name] = labelType.small_icon_url;
            });
          }

          return data;
        });
    },

    /**
     * Fetch overall statistics from the API.
     * @returns {Promise} A promise that resolves with the overall stats data
     */
    fetchOverallStats() {
      return fetch(`${config.apiBaseUrl}${config.overallStatsEndpoint}?utm_source=apiDocs`)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        });
    },

    /**
     * Create all visualizations in the container.
     * @param {HTMLElement} container - Container element for the visualizations
     * @param {object} data - Overall stats data for visualizations
     */
    createVisualizations(container, data) {
      // Add additional info section.
      this.createInfoSection(container, data);

      // Create label counts chart section.
      this.createChartSection(
        container,
        'Label Counts by Type',
        'Number of raw labels placed by type',
        (chartContainer) => this.createLabelCountsChart(chartContainer, data),
      );

      // Create mean severity chart section.
      this.createChartSection(
        container,
        'Mean Severity by Label Type',
        'Average severity rating (1-3) where 3 is most severe',
        (chartContainer) => this.createMeanSeverityChart(chartContainer, data),
      );

      // Create accuracy chart section.
      this.createChartSection(
        container,
        'Label Accuracy by Type',
        'Percentage of labels that were agreed upon during validation',
        (chartContainer) => this.createAccuracyChart(chartContainer, data),
      );
    },

    /**
     * Create a section for a chart with a header and description.
     * @param {HTMLElement} container - Parent container
     * @param {string} title - Section title
     * @param {string} description - Description text
     * @param {Function} chartCreator - Function to create the chart (receives the chart container)
     */
    createChartSection(container, title, description, chartCreator) {
      // Create section container.
      const section = document.createElement('div');
      section.className = 'preview-section';
      container.appendChild(section);

      // Create section header.
      const header = document.createElement('h3');
      header.className = 'preview-title';
      header.textContent = title;
      section.appendChild(header);

      // Create description.
      const desc = document.createElement('p');
      desc.className = 'preview-desc';
      desc.textContent = description;
      section.appendChild(desc);

      // Create chart container.
      const chartContainer = document.createElement('div');
      chartContainer.className = 'chart-container';
      chartContainer.style.height = `${config.chartHeight}px`;
      section.appendChild(chartContainer);

      // Create the chart.
      chartCreator(chartContainer);
    },

    /**
     * Create a bar chart showing label counts by type.
     * @param {HTMLElement} container - Container element for the chart
     * @param {object} data - Overall stats data
     */
    createLabelCountsChart(container, data) {
      // Create canvas for the chart.
      const canvas = document.createElement('canvas');
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
      container.appendChild(canvas);

      // Get label types and counts from data.
      const labelTypes = Object.keys(data.labels).filter((key) => util.misc.VALID_LABEL_TYPES.includes(key));

      // Sort label types by count (descending).
      labelTypes.sort((a, b) => data.labels[b].count - data.labels[a].count);

      // Prepare data for chart.
      const counts = labelTypes.map((type) => data.labels[type].count);
      const colors = labelTypes.map((type) => labelTypeColors[type] || ApiDocsTheme.color('--color-neutral-500'));

      // Create chart instance.
      new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: labelTypes.map((type) => labelTypeMapping[type] || type),
          datasets: [{
            label: 'Label Count',
            data: counts,
            backgroundColor: colors,
            borderColor: colors.map((color) => this.darkenColor(color, 20)),
            borderWidth: 1,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            tooltip: {
              callbacks: {
                title(tooltipItems) {
                  const index = tooltipItems[0].dataIndex;
                  return labelTypeMapping[labelTypes[index]] || labelTypes[index];
                },
                label(context) {
                  const type = labelTypes[context.dataIndex];
                  const count = data.labels[type].count;
                  const percent = ((count / data.labels.label_count) * 100).toFixed(1);
                  return [
                    `Count: ${count.toLocaleString()}`,
                    `Percentage: ${percent}%`,
                  ];
                },
              },
            },
            legend: {
              display: false,
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Number of Labels',
              },
            },
            x: {
              title: {
                display: true,
                text: 'Label Type',
              },
            },
          },
        },
      });
    },

    /**
     * Create a bar chart showing mean severity by label type.
     * @param {HTMLElement} container - Container element for the chart
     * @param {object} data - Overall stats data
     */
    createMeanSeverityChart(container, data) {
      // Create canvas for the chart.
      const canvas = document.createElement('canvas');
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
      container.appendChild(canvas);

      // Get label types with severity data.
      const labelTypes = Object.keys(data.labels)
        .filter((key) => key !== 'label_count'
          && data.labels[key].severity_mean !== undefined);

      // Sort label types by severity (descending).
      labelTypes.sort((a, b) => data.labels[b].severity_mean - data.labels[a].severity_mean);

      // Prepare data for chart.
      const severities = labelTypes.map((type) => data.labels[type].severity_mean);
      const colors = labelTypes.map((type) => labelTypeColors[type] || ApiDocsTheme.color('--color-neutral-500'));

      // Create chart instance.
      new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: labelTypes.map((type) => labelTypeMapping[type] || type),
          datasets: [{
            label: 'Mean Severity',
            data: severities,
            backgroundColor: colors,
            borderColor: colors.map((color) => this.darkenColor(color, 20)),
            borderWidth: 1,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            tooltip: {
              callbacks: {
                title(tooltipItems) {
                  const index = tooltipItems[0].dataIndex;
                  return labelTypeMapping[labelTypes[index]] || labelTypes[index];
                },
                label(context) {
                  const type = labelTypes[context.dataIndex];
                  const mean = data.labels[type].severity_mean.toFixed(2);
                  const sd = data.labels[type].severity_sd.toFixed(2);
                  const countWithSeverity = data.labels[type].count_with_severity;
                  return [
                    `Mean Severity: ${mean}`,
                    `Standard Deviation: ${sd}`,
                    `Labels with Severity: ${countWithSeverity.toLocaleString()}`,
                  ];
                },
              },
            },
            legend: {
              display: false,
            },
          },
          scales: {
            y: {
              min: 1,
              max: 3,
              title: {
                display: true,
                text: 'Mean Severity (1-3)',
              },
            },
            x: {
              title: {
                display: true,
                text: 'Label Type',
              },
            },
          },
        },
      });
    },

    /**
     * Create a bar chart showing accuracy by label type.
     * @param {HTMLElement} container - Container element for the chart
     * @param {object} data - Overall stats data
     */
    createAccuracyChart(container, data) {
      // Create canvas for the chart.
      const canvas = document.createElement('canvas');
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
      container.appendChild(canvas);

      // Get label types with validation data.
      const labelTypes = Object.keys(data.validations.combined)
        .filter((key) => key !== 'total_validations' && key !== 'Overall'
          && data.validations.combined[key].accuracy !== undefined
          && data.validations.combined[key].validated > 0);

      // Sort label types by accuracy (descending).
      labelTypes.sort((a, b) => data.validations.combined[b].accuracy - data.validations.combined[a].accuracy);

      // Prepare data for chart.
      // Convert to percentage.
      const accuracies = labelTypes.map((type) => data.validations.combined[type].accuracy * 100);
      const colors = labelTypes.map((type) => labelTypeColors[type] || ApiDocsTheme.color('--color-neutral-500'));

      // Create chart instance.
      new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: labelTypes.map((type) => labelTypeMapping[type] || type),
          datasets: [{
            label: 'Accuracy',
            data: accuracies,
            backgroundColor: colors,
            borderColor: colors.map((color) => this.darkenColor(color, 20)),
            borderWidth: 1,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            tooltip: {
              callbacks: {
                title(tooltipItems) {
                  const index = tooltipItems[0].dataIndex;
                  return labelTypeMapping[labelTypes[index]] || labelTypes[index];
                },
                label(context) {
                  const type = labelTypes[context.dataIndex];
                  const accuracy = (data.validations.combined[type].accuracy * 100).toFixed(1);
                  const validated = data.validations.combined[type].validated;
                  const agreed = data.validations.combined[type].agreed;
                  const disagreed = data.validations.combined[type].disagreed;
                  return [
                    `Accuracy: ${accuracy}%`,
                    `Validations: ${validated.toLocaleString()}`,
                    `Agreed: ${agreed.toLocaleString()}`,
                    `Disagreed: ${disagreed.toLocaleString()}`,
                  ];
                },
              },
            },
            legend: {
              display: false,
            },
          },
          scales: {
            y: {
              min: 0,
              max: 100,
              title: {
                display: true,
                text: 'Accuracy (%)',
              },
            },
            x: {
              title: {
                display: true,
                text: 'Label Type',
              },
            },
          },
        },
      });
    },

    /**
     * Create an information section with overall stats summary.
     * @param {HTMLElement} container - Container element for the info section
     * @param {object} data - Overall stats data
     */
    createInfoSection(container, data) {
      // Create info section container.
      const section = document.createElement('div');
      section.className = 'preview-section';
      container.appendChild(section);

      // Create info section header.
      const header = document.createElement('h3');
      header.className = 'preview-title';
      header.textContent = `Summary Statistics in ${config.cityName}`;
      section.appendChild(header);

      // Create grid for stats display.
      const grid = document.createElement('div');
      grid.className = 'preview-stat-grid';
      section.appendChild(grid);

      // Add stat items.
      this.addStatItem(grid, 'Launch Date', this.formatDate(data.launch_date));
      this.addStatItem(grid, 'Total Labels', data.labels.label_count.toLocaleString());
      this.addStatItem(grid, 'Total Validations', data.validations.combined.total_validations.toLocaleString());
      this.addStatItem(grid, 'Overall Accuracy', `${(data.validations.combined.Overall.accuracy * 100).toFixed(1)}%`);
      this.addStatItem(grid, 'Distance Explored', `${data.km_explored.toFixed(2)} km`);
      this.addStatItem(grid, 'Distance Explored (No Overlap)', `${data.km_explored_no_overlap.toFixed(2)} km`);
      this.addStatItem(grid, 'Total Users', data.user_counts.all_users.toLocaleString());
      this.addStatItem(grid, 'Active Labelers', data.user_counts.labelers.toLocaleString());
      this.addStatItem(grid, 'Active Validators', data.user_counts.validators.toLocaleString());

      // Add last activity info.
      const lastActivity = document.createElement('p');
      lastActivity.className = 'preview-note';
      lastActivity.textContent = `Last activity: ${this.formatDateTime(data.avg_timestamp_last_100_labels)}`;
      section.appendChild(lastActivity);
    },

    /**
     * Add a stat item to the grid.
     * @param {HTMLElement} grid - Grid container
     * @param {string} label - Stat label
     * @param {string} value - Stat value
     */
    addStatItem(grid, label, value) {
      const item = document.createElement('div');
      item.className = 'preview-stat';
      grid.appendChild(item);

      const valueElem = document.createElement('div');
      valueElem.className = 'preview-stat-value';
      valueElem.textContent = value;
      item.appendChild(valueElem);

      const labelElem = document.createElement('div');
      labelElem.className = 'preview-stat-label';
      labelElem.textContent = label;
      item.appendChild(labelElem);
    },

    /**
     * Format a date string (YYYY-MM-DD).
     * @param {string} dateStr - Date string
     * @returns {string} Formatted date
     */
    formatDate(dateStr) {
      if (!dateStr) return 'N/A';
      const date = new Date(dateStr);
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    },

    /**
     * Format a datetime string.
     * TODO This should be using the moment.js library.
     * @param {string} dateTimeStr - Datetime string
     * @returns {string} Formatted datetime
     */
    formatDateTime(dateTimeStr) {
      if (!dateTimeStr) return 'N/A';
      const date = new Date(dateTimeStr);
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    },

    /**
     * Darken a hex color by a specified amount.
     * @param {string} hex - Hex color code
     * @param {number} amount - Amount to darken (0-255)
     * @returns {string} Darkened hex color
     */
    darkenColor(hex, amount) {
      // Remove the hash at the front if present.
      hex = hex.replace(/^#/, '');

      // Parse the color components.
      let r = parseInt(hex.length === 3 ? hex.substring(0, 1).repeat(2) : hex.substring(0, 2), 16);
      let g = parseInt(hex.length === 3 ? hex.substring(1, 2).repeat(2) : hex.substring(2, 4), 16);
      let b = parseInt(hex.length === 3 ? hex.substring(2, 3).repeat(2) : hex.substring(4, 6), 16);

      // Darken each component.
      r = Math.max(0, r - amount);
      g = Math.max(0, g - amount);
      b = Math.max(0, b - amount);

      // Convert back to hex
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    },
  };
})();
