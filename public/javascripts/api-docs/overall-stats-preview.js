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

(function() {
    // Configuration options - can be overridden by calling setup().
    let config = {
        // API URL - will be updated to production URL in production.
        apiBaseUrl: "http://localhost:9000/v3/api",
        containerId: "overall-stats-preview",
        chartHeight: 300, // Fixed height for each chart.
        overallStatsEndpoint: "/overallStats",
        labelTypesEndpoint: "/labelTypes",
        chartBackgroundColor: '#f9f9f9',
        chartBorderColor: '#e0e0e0'
    };

    // Label type mapping (API field name to display name).
    // This will be populated from the labelTypes API.
    let labelTypeMapping = {
        CurbRamp: 'Curb Ramp',
        NoCurbRamp: 'Missing Curb Ramp',
        Obstacle: 'Obstacle in a Path',
        SurfaceProblem: 'Surface Problem',
        NoSidewalk: 'No Sidewalk',
        Crosswalk: 'Marked Crosswalk',
        Signal: 'Pedestrian Signal',
        Occlusion: 'Can\'t See Sidewalk',
        Other: 'Other'
    };

    let labelTypeColors = {}; // Colors map (will be populated from labelTypes API).
    let labelTypeIcons = {};  // Icons map (will be populated from labelTypes API).

    // Public API.
    window.OverallStatsPreview = {
        /**
         * Configure the overall stats preview.
         * @param {object} options - Configuration options
         * @returns {object} The OverallStatsPreview object for chaining
         */
        setup: function(options) {
            config = Object.assign(config, options);
            return this;
        },

        /**
         * Initialize the overall stats preview visualization.
         * @returns {Promise} A promise that resolves when the preview is rendered
         */
        init: function() {
            const container = document.getElementById(config.containerId);

            if (!container) {
                console.error(`Container element with id '${config.containerId}' not found.`);
                return Promise.reject(new Error("Container element not found"));
            }

            // Clear any existing content.
            container.innerHTML = "";

            // Add loading message.
            const loadingMessage = document.createElement('div');
            loadingMessage.className = 'loading-message';
            loadingMessage.textContent = "Loading overall statistics...";
            loadingMessage.style.textAlign = "center";
            loadingMessage.style.padding = "50px 0";
            loadingMessage.style.color = "#666";
            container.appendChild(loadingMessage);

            // Try to get API URL from page if available.
            const apiBaseUrl = document.documentElement.getAttribute('data-api-base-url');
            if (apiBaseUrl) {
                config.apiBaseUrl = apiBaseUrl;
            }

            // First fetch the label types to get official colors and descriptions.
            return this.fetchLabelTypes()
                .then(labelTypesData => {
                    // Then fetch overall stats data and create visualizations
                    return this.fetchOverallStats()
                        .then(overallStatsData => {
                            // Remove loading message.
                            container.removeChild(loadingMessage);

                            // Create visualization elements.
                            this.createVisualizations(container, overallStatsData);

                            return overallStatsData;
                        });
                })
                .catch(error => {
                    container.innerHTML = `<div class="error-message" style="color: red; text-align: center; padding: 50px 0;">Failed to load data: ${error.message}</div>`;
                    console.error("Overall stats preview error:", error);
                    return Promise.reject(error);
                });
        },

        /**
         * Fetch label types from the API to get proper colors and descriptions.
         * @returns {Promise} A promise that resolves with the label types data
         */
        fetchLabelTypes: function() {
            return fetch(`${config.apiBaseUrl}${config.labelTypesEndpoint}`)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! Status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    // Process the label types data to populate the colors and mapping.
                    if (data && data.labelTypes && Array.isArray(data.labelTypes)) {
                        data.labelTypes.forEach(labelType => {
                            // Update the colors map.
                            labelTypeColors[labelType.name] = labelType.color;

                            // Update the label type mapping.
                            labelTypeMapping[labelType.name] = labelType.description;

                            // Store icon URLs.
                            labelTypeIcons[labelType.name] = labelType.smallIconUrl;
                        });
                    }

                    return data;
                });
        },

        /**
         * Fetch overall statistics from the API.
         * @returns {Promise} A promise that resolves with the overall stats data
         */
        fetchOverallStats: function() {
            return fetch(`${config.apiBaseUrl}${config.overallStatsEndpoint}`)
                .then(response => {
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
        createVisualizations: function(container, data) {

            // Add additional info section.
            this.createInfoSection(container, data);

            // Create label counts chart section.
            this.createChartSection(
                container,
                'Label Counts by Type',
                'Number of raw labels placed by type',
                (chartContainer) => this.createLabelCountsChart(chartContainer, data)
            );

            // Create mean severity chart section.
            this.createChartSection(
                container,
                'Mean Severity by Label Type',
                'Average severity rating (1-5) where 5 is most severe',
                (chartContainer) => this.createMeanSeverityChart(chartContainer, data)
            );

            // Create accuracy chart section.
            this.createChartSection(
                container,
                'Label Accuracy by Type',
                'Percentage of labels that were agreed upon during validation',
                (chartContainer) => this.createAccuracyChart(chartContainer, data)
            );

        },

        /**
         * Create a section for a chart with a header and description.
         * @param {HTMLElement} container - Parent container
         * @param {string} title - Section title
         * @param {string} description - Description text
         * @param {Function} chartCreator - Function to create the chart (receives the chart container)
         */
        createChartSection: function(container, title, description, chartCreator) {
            // Create section container.
            const section = document.createElement('div');
            section.className = 'chart-section';
            section.style.marginBottom = '40px';
            section.style.padding = '10px';
            section.style.backgroundColor = config.chartBackgroundColor;
            section.style.border = `1px solid ${config.chartBorderColor}`;
            section.style.borderRadius = '4px';
            container.appendChild(section);

            // Create section header.
            const header = document.createElement('h3');
            header.textContent = title;
            header.style.textAlign = 'center';
            header.style.margin = '10px 0';
            header.style.fontSize = '1.2em';
            section.appendChild(header);

            // Create description.
            const desc = document.createElement('p');
            desc.textContent = description;
            desc.style.textAlign = 'center';
            desc.style.fontSize = '0.9em';
            desc.style.color = '#666';
            desc.style.margin = '0 0 15px 0';
            section.appendChild(desc);

            // Create chart container.
            const chartContainer = document.createElement('div');
            chartContainer.className = 'chart-container';
            chartContainer.style.height = `${config.chartHeight}px`;
            chartContainer.style.width = '100%';
            chartContainer.style.position = 'relative';
            section.appendChild(chartContainer);

            // Create the chart.
            chartCreator(chartContainer);
        },

        /**
         * Create a bar chart showing label counts by type.
         * @param {HTMLElement} container - Container element for the chart
         * @param {object} data - Overall stats data
         */
        createLabelCountsChart: function(container, data) {
            // Create canvas for the chart.
            const canvas = document.createElement('canvas');
            canvas.width = container.offsetWidth;
            canvas.height = container.offsetHeight;
            container.appendChild(canvas);

            // Get label types and counts from data.
            const labelTypes = Object.keys(data.labels).filter(key => util.misc.VALID_LABEL_TYPES.includes(key));

            // Sort label types by count (descending).
            labelTypes.sort((a, b) => data.labels[b].count - data.labels[a].count);

            // Prepare data for chart.
            const counts = labelTypes.map(type => data.labels[type].count);
            const colors = labelTypes.map(type => labelTypeColors[type] || '#999');

            // Create chart instance.
            new Chart(canvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: labelTypes.map(type => labelTypeMapping[type] || type),
                    datasets: [{
                        label: 'Label Count',
                        data: counts,
                        backgroundColor: colors,
                        borderColor: colors.map(color => this.darkenColor(color, 20)),
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        tooltip: {
                            callbacks: {
                                title: function(tooltipItems) {
                                    const index = tooltipItems[0].dataIndex;
                                    return labelTypeMapping[labelTypes[index]] || labelTypes[index];
                                },
                                label: function(context) {
                                    const type = labelTypes[context.dataIndex];
                                    const count = data.labels[type].count;
                                    const percent = ((count / data.labels.label_count) * 100).toFixed(1);
                                    return [
                                        `Count: ${count.toLocaleString()}`,
                                        `Percentage: ${percent}%`
                                    ];
                                }
                            }
                        },
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Number of Labels'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Label Type'
                            }
                        }
                    }
                }
            });

            // Add icon images to x-axis labels if possible.
            this.addIconsToXAxis(canvas, labelTypes);
        },

        /**
         * Create a bar chart showing mean severity by label type.
         * @param {HTMLElement} container - Container element for the chart
         * @param {object} data - Overall stats data
         */
        createMeanSeverityChart: function(container, data) {
            // Create canvas for the chart.
            const canvas = document.createElement('canvas');
            canvas.width = container.offsetWidth;
            canvas.height = container.offsetHeight;
            container.appendChild(canvas);

            // Get label types with severity data.
            const labelTypes = Object.keys(data.labels)
                .filter(key => key !== 'label_count' &&
                    data.labels[key].severity_mean !== undefined);

            // Sort label types by severity (descending).
            labelTypes.sort((a, b) => data.labels[b].severity_mean - data.labels[a].severity_mean);

            // Prepare data for chart.
            const severities = labelTypes.map(type => data.labels[type].severity_mean);
            const colors = labelTypes.map(type => labelTypeColors[type] || '#999');

            // Create chart instance.
            new Chart(canvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: labelTypes.map(type => labelTypeMapping[type] || type),
                    datasets: [{
                        label: 'Mean Severity',
                        data: severities,
                        backgroundColor: colors,
                        borderColor: colors.map(color => this.darkenColor(color, 20)),
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        tooltip: {
                            callbacks: {
                                title: function(tooltipItems) {
                                    const index = tooltipItems[0].dataIndex;
                                    return labelTypeMapping[labelTypes[index]] || labelTypes[index];
                                },
                                label: function(context) {
                                    const type = labelTypes[context.dataIndex];
                                    const mean = data.labels[type].severity_mean.toFixed(2);
                                    const sd = data.labels[type].severity_sd.toFixed(2);
                                    const countWithSeverity = data.labels[type].count_with_severity;
                                    return [
                                        `Mean Severity: ${mean}`,
                                        `Standard Deviation: ${sd}`,
                                        `Labels with Severity: ${countWithSeverity.toLocaleString()}`
                                    ];
                                }
                            }
                        },
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            min: 1,
                            max: 5,
                            title: {
                                display: true,
                                text: 'Mean Severity (1-5)'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Label Type'
                            }
                        }
                    }
                }
            });

            // Add icon images to x-axis labels if possible.
            this.addIconsToXAxis(canvas, labelTypes);
        },

        /**
         * Create a bar chart showing accuracy by label type.
         * @param {HTMLElement} container - Container element for the chart
         * @param {object} data - Overall stats data
         */
        createAccuracyChart: function(container, data) {
            // Create canvas for the chart.
            const canvas = document.createElement('canvas');
            canvas.width = container.offsetWidth;
            canvas.height = container.offsetHeight;
            container.appendChild(canvas);

            // Get label types with validation data.
            const labelTypes = Object.keys(data.validations)
                .filter(key => key !== 'total_validations' && key !== 'Overall' &&
                    data.validations[key].accuracy !== undefined &&
                    data.validations[key].validated > 0);

            // Sort label types by accuracy (descending).
            labelTypes.sort((a, b) => data.validations[b].accuracy - data.validations[a].accuracy);

            // Prepare data for chart.
            const accuracies = labelTypes.map(type => data.validations[type].accuracy * 100); // Convert to percentage
            const colors = labelTypes.map(type => labelTypeColors[type] || '#999');

            // Create chart instance.
            new Chart(canvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: labelTypes.map(type => labelTypeMapping[type] || type),
                    datasets: [{
                        label: 'Accuracy',
                        data: accuracies,
                        backgroundColor: colors,
                        borderColor: colors.map(color => this.darkenColor(color, 20)),
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        tooltip: {
                            callbacks: {
                                title: function(tooltipItems) {
                                    const index = tooltipItems[0].dataIndex;
                                    return labelTypeMapping[labelTypes[index]] || labelTypes[index];
                                },
                                label: function(context) {
                                    const type = labelTypes[context.dataIndex];
                                    const accuracy = (data.validations[type].accuracy * 100).toFixed(1);
                                    const validated = data.validations[type].validated;
                                    const agreed = data.validations[type].agreed;
                                    const disagreed = data.validations[type].disagreed;
                                    return [
                                        `Accuracy: ${accuracy}%`,
                                        `Validations: ${validated.toLocaleString()}`,
                                        `Agreed: ${agreed.toLocaleString()}`,
                                        `Disagreed: ${disagreed.toLocaleString()}`
                                    ];
                                }
                            }
                        },
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            min: 0,
                            max: 100,
                            title: {
                                display: true,
                                text: 'Accuracy (%)'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Label Type'
                            }
                        }
                    }
                }
            });

            // Add icon images to x-axis labels if possible.
            this.addIconsToXAxis(canvas, labelTypes);
        },

        /**
         * Create an information section with overall stats summary.
         * @param {HTMLElement} container - Container element for the info section
         * @param {object} data - Overall stats data
         */
        createInfoSection: function(container, data) {
            // Create info section container.
            const section = document.createElement('div');
            section.className = 'info-section';
            section.style.marginBottom = '20px';
            section.style.padding = '15px';
            section.style.backgroundColor = config.chartBackgroundColor;
            section.style.border = `1px solid ${config.chartBorderColor}`;
            section.style.borderRadius = '4px';
            container.appendChild(section);

            // Create info section header.
            const header = document.createElement('h3');
            header.textContent = 'Summary Statistics in ' + `${config.cityName}`;
            header.style.textAlign = 'center';
            header.style.margin = '0 0 15px 0';
            header.style.fontSize = '1.2em';
            section.appendChild(header);

            // Create grid for stats display.
            const grid = document.createElement('div');
            grid.style.display = 'grid';
            grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(250px, 1fr))';
            grid.style.gap = '15px';
            section.appendChild(grid);

            // Add stat items.
            this.addStatItem(grid, 'Launch Date', this.formatDate(data.launch_date));
            this.addStatItem(grid, 'Total Labels', data.labels.label_count.toLocaleString());
            this.addStatItem(grid, 'Total Validations', data.validations.total_validations.toLocaleString());
            this.addStatItem(grid, 'Overall Accuracy', `${(data.validations.Overall.accuracy * 100).toFixed(1)}%`);
            this.addStatItem(grid, 'Distance Explored', `${data.km_explored.toFixed(2)} km`);
            this.addStatItem(grid, 'Distance Explored (No Overlap)', `${data.km_explored_no_overlap.toFixed(2)} km`);
            this.addStatItem(grid, 'Total Users', data.user_counts.all_users.toLocaleString());
            this.addStatItem(grid, 'Active Labelers', data.user_counts.labelers.toLocaleString());
            this.addStatItem(grid, 'Active Validators', data.user_counts.validators.toLocaleString());

            // Add last activity info.
            const lastActivity = document.createElement('p');
            lastActivity.textContent = `Last activity: ${this.formatDateTime(data.avg_timestamp_last_100_labels)}`;
            lastActivity.style.textAlign = 'center';
            lastActivity.style.fontSize = '0.7em';
            lastActivity.style.fontStyle = 'italic';
            lastActivity.style.color = '#666';
            lastActivity.style.marginTop = '15px';
            section.appendChild(lastActivity);
        },

        /**
         * Add a stat item to the grid.
         * @param {HTMLElement} grid - Grid container
         * @param {string} label - Stat label
         * @param {string} value - Stat value
         */
        addStatItem: function(grid, label, value) {
            const item = document.createElement('div');
            item.className = 'stat-item';
            item.style.textAlign = 'center';
            grid.appendChild(item);

            const valueElem = document.createElement('div');
            valueElem.className = 'stat-value';
            valueElem.textContent = value;
            valueElem.style.fontSize = '1.4em';
            valueElem.style.fontWeight = 'bold';
            item.appendChild(valueElem);

            const labelElem = document.createElement('div');
            labelElem.className = 'stat-label';
            labelElem.textContent = label;
            labelElem.style.fontSize = '0.9em';
            labelElem.style.color = '#666';
            item.appendChild(labelElem);
        },

        /**
         * Add icon images to x-axis labels.
         * @param {HTMLElement} canvas - Chart canvas element
         * @param {Array} labelTypes - Array of label types used in the chart
         */
        addIconsToXAxis: function(canvas, labelTypes) {
            // This is a placeholder for future implementation
            // Adding icons to Chart.js x-axis labels requires custom plugins
            // or modifying the DOM after chart creation, which is beyond the
            // scope of this simple implementation

            // In a real implementation, we would use a Chart.js plugin to
            // render images alongside the x-axis labels
            console.log('Adding icons to chart would require Chart.js plugins');
        },

        /**
         * Format a date string (YYYY-MM-DD).
         * @param {string} dateStr - Date string
         * @returns {string} Formatted date
         */
        formatDate: function(dateStr) {
            if (!dateStr) return 'N/A';
            const date = new Date(dateStr);
            return date.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        },

        /**
         * Format a datetime string.
         * TODO This should be using the moment.js library.
         * @param {string} dateTimeStr - Datetime string
         * @returns {string} Formatted datetime
         */
        formatDateTime: function(dateTimeStr) {
            if (!dateTimeStr) return 'N/A';
            const date = new Date(dateTimeStr);
            return date.toLocaleString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        },

        /**
         * Darken a hex color by a specified amount.
         * @param {string} hex - Hex color code
         * @param {number} amount - Amount to darken (0-255)
         * @returns {string} Darkened hex color
         */
        darkenColor: function(hex, amount) {
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
        }
    };
})();
