/**
 * Validations Preview Generator.
 *
 * Generates validation result distribution charts by label type by fetching data from validations and label types APIs.
 *
 * @requires DOM element with id 'validations-preview'
 * @requires Chart.js library
 *
 * @example
 * // Initialize with default settings.
 * ValidationsPreview.init();
 *
 * // Initialize with custom options.
 * ValidationsPreview.setup({
 *   apiBaseUrl: "https://projectsidewalk.io/v3/api",
 *   containerId: "custom-container"
 * }).init();
 */

(function() {
    // Configuration options - can be overridden by calling setup().
    let config = {
        apiBaseUrl: "/v3/api",
        containerId: "validations-preview",
        validationsEndpoint: "/validations",
        labelTypesEndpoint: "/labelTypes",
        chartHeight: 250,
        maxChartsToShow: 9, // Limit number of charts to prevent overwhelming the page.
        minValidationsToShow: 5 // Only show label types with at least this many validations.
    };

    // Label type colors and mapping (will be populated from API).
    let labelTypeColors = {};
    let labelTypeMapping = {};

    // Public API
    window.ValidationsPreview = {
        /**
         * Configure the validations preview.
         * @param {Object} options - Configuration options
         * @param {string} [options.apiBaseUrl] - Base URL for the API
         * @param {string} [options.containerId] - ID of the container element
         * @param {string} [options.validationsEndpoint] - API endpoint for validations
         * @param {string} [options.labelTypesEndpoint] - API endpoint for label types
         * @param {number} [options.chartHeight] - Height of each chart in pixels
         * @param {number} [options.maxChartsToShow] - Maximum number of charts to display
         * @param {number} [options.minValidationsToShow] - Minimum validations needed to show a chart
         * @returns {Object} The ValidationsPreview object for chaining
         */
        setup: function(options) {
            config = Object.assign(config, options);
            return this;
        },

        /**
         * Initialize the validations preview visualization.
         * @returns {Promise} A promise that resolves when the preview is rendered
         */
        init: function() {
            const container = document.getElementById(config.containerId);

            if (!container) {
                console.error(`Container element with id '${config.containerId}' not found.`);
                return Promise.reject(new Error("Container element not found"));
            }

            // Clear any existing content and show loading state.
            this.showLoadingState(container);

            // First fetch label types to get colors and names.
            return this.fetchLabelTypes()
                .then(() => {
                    // Then fetch validations data.
                    return this.fetchValidations();
                })
                .then(validationsData => {
                    // Process and visualize the data.
                    this.createValidationCharts(container, validationsData);
                    return validationsData;
                })
                .catch(error => {
                    this.showErrorState(container, error);
                    console.error("Validations preview error:", error);
                    return Promise.reject(error);
                });
        },

        /**
         * Show loading state in the container.
         * @param {HTMLElement} container - Container element
         */
        showLoadingState: function(container) {
            container.innerHTML = `
        <div class="validation-loading">
          <div class="loading-spinner"></div>
          <div>Loading validation data...</div>
        </div>
      `;
        },

        /**
         * Show error state in the container.
         * @param {HTMLElement} container - Container element
         * @param {Error} error - The error that occurred
         */
        showErrorState: function(container, error) {
            container.innerHTML = `
        <div class="validation-error">
          Failed to load validation data: ${error.message}
        </div>
      `;
        },

        /**
         * Fetch label types to get colors and display names.
         * @returns {Promise} A promise that resolves with the label types data
         */
        fetchLabelTypes: function() {
            return fetch(`${config.apiBaseUrl}${config.labelTypesEndpoint}`)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to fetch label types: HTTP ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    if (data && data.labelTypes && Array.isArray(data.labelTypes)) {
                        data.labelTypes.forEach(labelType => {
                            labelTypeColors[labelType.id] = labelType.color;
                            labelTypeMapping[labelType.id] = labelType.description;
                        });
                    }
                    return data;
                });
        },

        /**
         * Fetch validations data from the API.
         * @returns {Promise} A promise that resolves with the validations data
         */
        fetchValidations: function() {
            return fetch(`${config.apiBaseUrl}${config.validationsEndpoint}`)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to fetch validations: HTTP ${response.status}`);
                    }
                    return response.json();
                });
        },

        /**
         * Create validation result distribution charts for each label type.
         * @param {HTMLElement} container - Container element for the charts
         * @param {Array} validationsData - Array of validation objects from the API
         */
        createValidationCharts: function(container, validationsData) {
            // Group validations by label type.
            const validationsByType = this.groupValidationsByType(validationsData);

            // Filter and sort label types.
            const filteredTypes = this.filterAndSortTypes(validationsByType);

            // Clear container.
            container.innerHTML = '';

            // Create summary section.
            this.createSummarySection(container, validationsData, filteredTypes);

            // Create charts grid.
            const chartsGrid = document.createElement('div');
            chartsGrid.className = 'validation-charts-grid';
            container.appendChild(chartsGrid);

            // Create a chart for each label type.
            filteredTypes.forEach(([typeId, typeData]) => {
                this.createSingleValidationChart(chartsGrid, typeData);
            });

            // Add summary text.
            this.createFooterSummary(container, validationsData, filteredTypes);
        },

        /**
         * Group validations by label type ID.
         * @param {Array} validationsData - Array of validation objects
         * @returns {Object} Object with label type IDs as keys and aggregated data as values
         */
        groupValidationsByType: function(validationsData) {
            const validationsByType = {};

            validationsData.forEach(validation => {
                const typeId = validation.label_type_id;
                const typeName = validation.label_type;

                if (!validationsByType[typeId]) {
                    validationsByType[typeId] = {
                        name: typeName,
                        displayName: labelTypeMapping[typeId] || typeName,
                        color: labelTypeColors[typeId] || '#999999',
                        agree: 0,
                        disagree: 0,
                        unsure: 0
                    };
                }

                // Count validation results.
                switch (validation.validation_result) {
                    case 1:
                        validationsByType[typeId].agree++;
                        break;
                    case 2:
                        validationsByType[typeId].disagree++;
                        break;
                    case 3:
                        validationsByType[typeId].unsure++;
                        break;
                }
            });

            return validationsByType;
        },

        /**
         * Filter and sort label types for display.
         * @param {Object} validationsByType - Grouped validation data
         * @returns {Array} Array of [typeId, typeData] pairs, filtered and sorted
         */
        filterAndSortTypes: function(validationsByType) {
            return Object.entries(validationsByType)
                // Filter out types with too few validations
                .filter(([, typeData]) => {
                    const total = typeData.agree + typeData.disagree + typeData.unsure;
                    return total >= config.minValidationsToShow;
                })
                // Sort by total validation count (descending).
                .sort(([,a], [,b]) => {
                    const totalA = a.agree + a.disagree + a.unsure;
                    const totalB = b.agree + b.disagree + b.unsure;
                    return totalB - totalA;
                })
                // Limit number of charts.
                .slice(0, config.maxChartsToShow);
        },

        /**
         * Create summary section with overall statistics.
         * @param {HTMLElement} container - Parent container
         * @param {Array} validationsData - Raw validation data
         * @param {Array} filteredTypes - Filtered and sorted types
         */
        createSummarySection: function(container, validationsData, filteredTypes) {
            const summarySection = document.createElement('div');
            summarySection.className = 'validation-summary';
            container.appendChild(summarySection);

            const title = document.createElement('h3');
            title.textContent = 'Validation Results Overview';
            summarySection.appendChild(title);

            const description = document.createElement('p');
            description.textContent = 'Distribution of validation results across label types, showing community agreement patterns.';
            summarySection.appendChild(description);

            // Calculate overall statistics.
            const totalValidations = validationsData.length;
            const totalAgree = validationsData.filter(v => v.validation_result === 1).length;
            const totalDisagree = validationsData.filter(v => v.validation_result === 2).length;
            const totalUnsure = validationsData.filter(v => v.validation_result === 3).length;

            const statsGrid = document.createElement('div');
            statsGrid.className = 'summary-stats-grid';
            summarySection.appendChild(statsGrid);

            this.addSummaryStatItem(statsGrid, totalValidations.toLocaleString(), 'Total Validations');
            this.addSummaryStatItem(statsGrid, `${((totalAgree / totalValidations) * 100).toFixed(1)}%`, 'Agree Rate');
            this.addSummaryStatItem(statsGrid, `${((totalDisagree / totalValidations) * 100).toFixed(1)}%`, 'Disagree Rate');
            this.addSummaryStatItem(statsGrid, `${((totalUnsure / totalValidations) * 100).toFixed(1)}%`, 'Unsure Rate');
            this.addSummaryStatItem(statsGrid, filteredTypes.length.toString(), 'Label Types Shown');
        },

        /**
         * Add a stat item to the summary grid.
         * @param {HTMLElement} grid - Grid container
         * @param {string} value - Stat value
         * @param {string} label - Stat label
         */
        addSummaryStatItem: function(grid, value, label) {
            const item = document.createElement('div');
            item.className = 'summary-stat-item';
            grid.appendChild(item);

            const valueElem = document.createElement('div');
            valueElem.className = 'summary-stat-value';
            valueElem.textContent = value;
            item.appendChild(valueElem);

            const labelElem = document.createElement('div');
            labelElem.className = 'summary-stat-label';
            labelElem.textContent = label;
            item.appendChild(labelElem);
        },

        /**
         * Create a single chart for one label type.
         * @param {HTMLElement} container - Parent container for the chart
         * @param {Object} typeData - Data for this label type
         */
        createSingleValidationChart: function(container, typeData) {
            // Create chart container.
            const chartContainer = document.createElement('div');
            chartContainer.className = 'validation-chart-container';
            container.appendChild(chartContainer);

            // Create chart title.
            const title = document.createElement('div');
            title.className = 'chart-title';
            title.textContent = typeData.displayName;
            chartContainer.appendChild(title);

            // Create canvas container.
            const canvasContainer = document.createElement('div');
            canvasContainer.className = 'chart-canvas-container';
            chartContainer.appendChild(canvasContainer);

            // Calculate total for percentages.
            const total = typeData.agree + typeData.disagree + typeData.unsure;

            if (total === 0) {
                // No validations for this type.
                canvasContainer.innerHTML = '<div class="chart-empty-state">No validations</div>';
                return;
            }

            // Create canvas.
            const canvas = document.createElement('canvas');
            canvasContainer.appendChild(canvas);

            // Create variations of the base color for agree/disagree/unsure.
            const baseColor = typeData.color;
            const colors = [
                this.lightenColor(baseColor, 30),  // Agree - lighter
                baseColor,                                 // Disagree - base color
                this.darkenColor(baseColor, 30)    // Unsure - darker
            ];

            // Create the chart
            new Chart(canvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: ['Agree', 'Disagree', 'Unsure'],
                    datasets: [{
                        label: 'Count',
                        data: [typeData.agree, typeData.disagree, typeData.unsure],
                        backgroundColor: colors,
                        borderColor: colors.map(color => this.darkenColor(color, 20)),
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const count = context.parsed.y;
                                    const percentage = ((count / total) * 100).toFixed(1);
                                    return [
                                        `Count: ${count.toLocaleString()}`,
                                        `Percentage: ${percentage}%`
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Number of Validations'
                            },
                            ticks: {
                                precision: 0
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Validation Result'
                            }
                        }
                    }
                }
            });
        },

        /**
         * Create footer summary text.
         * @param {HTMLElement} container - Parent container
         * @param {Array} validationsData - Raw validation data
         * @param {Array} filteredTypes - Filtered and sorted types
         */
        createFooterSummary: function(container, validationsData, filteredTypes) {
            const summary = document.createElement('p');
            summary.style.textAlign = 'center';
            summary.style.fontStyle = 'italic';
            summary.style.color = '#666';
            summary.style.marginTop = '20px';

            const totalValidations = validationsData.length;
            const shownTypes = filteredTypes.length;
            const totalTypes = Object.keys(this.groupValidationsByType(validationsData)).length;

            let summaryText = `Showing validation result distributions for ${shownTypes} label types with the most validations`;
            if (totalTypes > shownTypes) {
                summaryText += ` (${totalTypes - shownTypes} types with fewer validations not shown)`;
            }
            summaryText += `. Total: ${totalValidations.toLocaleString()} validations.`;

            summary.textContent = summaryText;
            container.appendChild(summary);
        },

        /**
         * Lighten a hex color by a specified amount.
         * @param {string} hex - Hex color code
         * @param {number} amount - Amount to lighten (0-255)
         * @returns {string} Lightened hex color
         */
        lightenColor: function(hex, amount) {
            hex = hex.replace(/^#/, '');

            let r = parseInt(hex.length === 3 ? hex.substring(0, 1).repeat(2) : hex.substring(0, 2), 16);
            let g = parseInt(hex.length === 3 ? hex.substring(1, 2).repeat(2) : hex.substring(2, 4), 16);
            let b = parseInt(hex.length === 3 ? hex.substring(2, 3).repeat(2) : hex.substring(4, 6), 16);

            r = Math.min(255, r + amount);
            g = Math.min(255, g + amount);
            b = Math.min(255, b + amount);

            return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
        },

        /**
         * Darken a hex color by a specified amount.
         * @param {string} hex - Hex color code
         * @param {number} amount - Amount to darken (0-255)
         * @returns {string} Darkened hex color
         */
        darkenColor: function(hex, amount) {
            hex = hex.replace(/^#/, '');

            let r = parseInt(hex.length === 3 ? hex.substring(0, 1).repeat(2) : hex.substring(0, 2), 16);
            let g = parseInt(hex.length === 3 ? hex.substring(1, 2).repeat(2) : hex.substring(2, 4), 16);
            let b = parseInt(hex.length === 3 ? hex.substring(2, 3).repeat(2) : hex.substring(4, 6), 16);

            r = Math.max(0, r - amount);
            g = Math.max(0, g - amount);
            b = Math.max(0, b - amount);

            return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
        }
    };

    // Set up download buttons when the DOM is ready.
    document.addEventListener('DOMContentLoaded', function() {
        // Set up download buttons
        document.querySelectorAll('.download-btn').forEach(button => {
            button.addEventListener('click', function() {
                const format = this.getAttribute('data-format');
                const url = `${config.apiBaseUrl}${config.validationsEndpoint}?filetype=${format}`;

                // Create a temporary link to trigger download.
                const link = document.createElement('a');
                link.href = url;
                link.download = `validations.${format}`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            });
        });
    });

})();
