/**
 * Project Sidewalk User Stats Visualization Generator.
 *
 * This script generates visualizations for the User Stats API preview by fetching data directly from the API endpoint.
 *
 * @requires DOM element with id 'user-stats-preview'
 * @requires Chart.js library
 */

(function () {
  // Configuration options - can be overridden by calling setup().
  let config = {
    // API URL - will be updated to production URL in production.
    apiBaseUrl: 'http://localhost:9000/v3/api',
    containerId: 'user-stats-preview',
    chartHeight: 300, // Fixed height for each chart.
    userStatsEndpoint: '/userStats',
    labelTypesEndpoint: '/labelTypes', // Min number of labels for a user to be included in the visualization.
    minLabels: 10,
    maxUsers: 10, // Max number of users to show in the top contributors chart.
    colors: {}, // Default chart colors (will be overridden by colors from labelTypes API).
  };

  // userStats field name (snake_case) -> localized display name (populated from the labelTypes API).
  const labelTypeMapping = {};

  // Map from API response name (PascalCase) to userStats field name (snake_case).
  const labelTypeAPIMapping = {
    CurbRamp: 'curb_ramp',
    NoCurbRamp: 'no_curb_ramp',
    Obstacle: 'obstacle',
    SurfaceProblem: 'surface_problem',
    NoSidewalk: 'no_sidewalk',
    Crosswalk: 'marked_crosswalk',
    Signal: 'pedestrian_signal',
    Occlusion: 'cant_see_sidewalk',
    Other: 'other',
  };

  // Public API.
  window.UserStatsPreview = {
    /**
     * Configure the user stats preview.
     * @param {object} options - Configuration options
     * @returns {object} The UserStatsPreview object for chaining
     */
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Initialize the user stats preview visualization.
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
      loadingMessage.textContent = 'Loading user statistics...';
      container.appendChild(loadingMessage);

      // Try to get API URL from page if available.
      const apiBaseUrl = document.documentElement.getAttribute('data-api-base-url');
      if (apiBaseUrl) {
        config.apiBaseUrl = apiBaseUrl;
      }

      // First fetch the label types to get official colors and descriptions.
      return this.fetchLabelTypes()
        .then(() => {
          // Then fetch user stats data and create visualizations
          return this.fetchUserStats()
            .then((userStatsData) => {
              // Filter and prepare data.
              const filteredData = this.filterData(userStatsData);

              // Remove loading message.
              container.removeChild(loadingMessage);

              // Create visualization elements.
              this.createVisualizations(container, filteredData);

              return filteredData;
            });
        })
        .catch((error) => {
          container.innerHTML = `<div class="message message-error" role="alert">Failed to load data: `
            + `${error.message}</div>`;
          console.error('User stats preview error:', error);
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
              const snakeCaseKey = labelTypeAPIMapping[labelType.name] || labelType.name.toLowerCase();

              // Update the colors map.
              config.colors[snakeCaseKey] = labelType.color;

              // Update the label type mapping.
              labelTypeMapping[snakeCaseKey] = labelType.display_name;
            });
          }

          return data;
        });
    },

    /**
     * Fetch user statistics from the API.
     * @returns {Promise} A promise that resolves with the user stats data
     */
    fetchUserStats() {
      const params = new URLSearchParams({
        minLabels: config.minLabels,
      });

      return fetch(`${config.apiBaseUrl}${config.userStatsEndpoint}?${params}&utm_source=apiDocs`)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        });
    },

    /**
     * Filter and prepare the data for visualization.
     * @param {Array} userStatsData - The raw user statistics data
     * @returns {object} Processed data ready for visualization
     */
    filterData(userStatsData) {
      // Filter out users with empty stats or 0 labels.
      const validUsers = userStatsData.filter((user) => user.labels > 0);

      // Sort users by number of labels (descending).
      const sortedUsers = [...validUsers].sort((a, b) => b.labels - a.labels);

      // Take top N users for visualization.
      const topUsers = sortedUsers.slice(0, config.maxUsers);

      // Sort users by validations given (for the validators chart).
      const sortedByValidations = [...validUsers]
        .sort((a, b) => b.validations_given - a.validations_given)
        .filter((user) => user.validations_given > 0)
        .slice(0, config.maxUsers);

      // Prepare data for accuracy vs. contributions chart.
      const accuracyData = sortedUsers
        .filter((user) => user.label_accuracy !== null && user.validated_labels > 5)
        .map((user) => ({
          userId: user.user_id,
          accuracy: user.label_accuracy,
          validatedLabels: user.validated_labels,
          totalLabels: user.labels,
          metersExplored: user.meters_explored,
        }));

      return {
        allUsers: sortedUsers,
        topUsers,
        topValidators: sortedByValidations,
        accuracyData,
      };
    },

    /**
     * Create all visualizations in the container.
     * @param {HTMLElement} container - Container element for the visualizations
     * @param {object} data - Processed data for visualizations
     */
    createVisualizations(container, data) {
      // Create top contributors chart section.
      this.createChartSection(
        container,
        `Top Labelers in ${config.cityName}`,
        `Users who have contributed the most labels in ${config.cityName}`,
        (chartContainer) => this.createTopContributorsChart(chartContainer, data.topUsers),
      );

      // Create label type breakdown chart section.
      this.createChartSection(
        container,
        `Top Labelers with Label Type in ${config.cityName}`,
        'Breakdown of label types placed by top contributors',
        (chartContainer) => this.createLabelTypeBreakdownChart(chartContainer, data.topUsers),
      );

      // Create accuracy scatter chart section.
      this.createChartSection(
        container,
        'Label Accuracy vs. Contribution Volume',
        'The relationship between user accuracy and number of contributions (bubble size represents validated labels)',
        (chartContainer) => this.createAccuracyScatterChart(chartContainer, data.accuracyData),
      );

      // Add a note about the data.
      const note = document.createElement('p');
      note.className = 'preview-note';
      note.textContent = `Showing data for ${data.allUsers.length} users with at least ${config.minLabels} labels.`;
      container.appendChild(note);
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
     * Create a bar chart showing top contributors by total labels.
     * @param {HTMLElement} container - Container element for the chart
     * @param {Array} topUsers - Array of top users data
     */
    createTopContributorsChart(container, topUsers) {
      // No users yet is an ordinary state for a young deployment; an empty set of axes reads as a broken preview.
      if (!topUsers.length) {
        const emptyMsg = document.createElement('div');
        emptyMsg.textContent = 'No user contributions yet.';
        emptyMsg.className = 'message message-info';
        emptyMsg.setAttribute('role', 'status');
        container.appendChild(emptyMsg);
        return;
      }

      // Create canvas for the chart.
      const canvas = document.createElement('canvas');
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
      container.appendChild(canvas);

      // Prepare data for chart.
      const labels = topUsers.map((user) => {
        // Use first 8 chars of user ID for display.
        return `${user.user_id.substring(0, 8)}...`;
      });

      const data = topUsers.map((user) => user.labels);

      // Create the chart.
      new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Total Labels',
            data,
            backgroundColor: ApiDocsTheme.color('--color-link-100'),
            borderColor: ApiDocsTheme.color('--color-link-200'),
            borderWidth: 1,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false,
            },
            tooltip: {
              callbacks: {
                title(tooltipItems) {
                  const index = tooltipItems[0].dataIndex;
                  return `User: ${topUsers[index].user_id}`;
                },
                label(context) {
                  const user = topUsers[context.dataIndex];
                  return [
                    `Labels: ${user.labels}`,
                    `Meters explored: ${Math.round(user.meters_explored)}`,
                  ];
                },
              },
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
                text: 'User ID (abbreviated)',
              },
            },
          },
        },
      });
    },

    /**
     * Create a stacked bar chart showing the breakdown of label types for top users.
     * @param {HTMLElement} container - Container element for the chart
     * @param {Array} topUsers - Array of top users data
     */
    createLabelTypeBreakdownChart(container, topUsers) {
      // Create canvas for the chart.
      const canvas = document.createElement('canvas');
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
      container.appendChild(canvas);

      // No users yet is an ordinary state for a young deployment, not a fault; only a user row missing its
      // label-type breakdown means the response shape is actually wrong.
      if (!topUsers.length) {
        const emptyMsg = document.createElement('div');
        emptyMsg.textContent = 'No user contributions yet.';
        emptyMsg.className = 'message message-info';
        emptyMsg.setAttribute('role', 'status');
        container.appendChild(emptyMsg);
        return;
      }
      if (!topUsers[0].stats_by_label_type) {
        console.error('User data doesn\'t have the expected structure for label types');
        const errorMsg = document.createElement('div');
        errorMsg.textContent = 'Unable to render chart: Invalid data structure';
        errorMsg.className = 'message message-error';
        errorMsg.setAttribute('role', 'alert');
        container.appendChild(errorMsg);
        return;
      }

      // Get all label types from the data.
      const labelTypes = Object.keys(topUsers[0].stats_by_label_type);

      // Prepare datasets for each label type.
      const datasets = labelTypes.map((labelType) => {
        return {
          label: labelTypeMapping[labelType] || labelType,
          data: topUsers.map((user) => user.stats_by_label_type[labelType].labels),
          backgroundColor: config.colors[labelType] || ApiDocsTheme.color('--color-neutral-500'),
        };
      }).filter((dataset) => {
        // Filter out label types with no data.
        return dataset.data.some((val) => val > 0);
      });

      // Sort datasets by total value (highest first).
      datasets.sort((a, b) => {
        const sumA = a.data.reduce((sum, val) => sum + val, 0);
        const sumB = b.data.reduce((sum, val) => sum + val, 0);
        return sumB - sumA;
      });

      // Prepare x-axis labels.
      const labels = topUsers.map((user) => {
        return `${user.user_id.substring(0, 8)}...`;
      });

      // Create the chart.
      new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              reverse: true, // Do not reverse the order of legend items.
              // This ensures the legend keeps the same order as the stacked bars (datasets).
              labels: {
                usePointStyle: true, // More compact legend display.
                padding: 15,
              },
            },
            tooltip: {
              callbacks: {
                title(tooltipItems) {
                  const index = tooltipItems[0].dataIndex;
                  return `User: ${topUsers[index].user_id}`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              title: {
                display: true,
                text: 'User ID (abbreviated)',
              },
            },
            y: {
              stacked: true,
              beginAtZero: true,
              title: {
                display: true,
                text: 'Number of Labels',
              },
            },
          },
        },
      });
    },

    /**
     * Create a scatter chart showing the relationship between accuracy and contribution volume.
     * @param {HTMLElement} container - Container element for the chart
     * @param {Array} accuracyData - Array of user accuracy data
     */
    createAccuracyScatterChart(container, accuracyData) {
      // Create canvas for the chart.
      const canvas = document.createElement('canvas');
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
      container.appendChild(canvas);

      // If no accuracy data is available, show a message.
      if (!accuracyData || accuracyData.length === 0) {
        const errorMsg = document.createElement('div');
        errorMsg.className = 'preview-note';
        errorMsg.setAttribute('role', 'status');
        errorMsg.textContent = 'No users with sufficient validation data available';
        container.appendChild(errorMsg);
        return;
      }

      // Prepare data points.
      const dataPoints = accuracyData.map((user) => ({
        x: user.totalLabels,
        y: user.accuracy,
        r: Math.min(20, Math.max(5, Math.sqrt(user.validatedLabels) * 0.8)), // Bubble size based on validated labels
        userId: user.userId,
        validatedLabels: user.validatedLabels,
        metersExplored: user.metersExplored,
      }));

      // Create the chart.
      new Chart(canvas.getContext('2d'), {
        type: 'bubble',
        data: {
          datasets: [{
            label: 'User Accuracy',
            data: dataPoints,
            // The severity/quality ramp: jade is good, banana middling, orange bad.
            backgroundColor: dataPoints.map((point) => {
              if (point.y > 0.9) return ApiDocsTheme.color('--color-jade-400', 0.6);
              if (point.y > 0.75) return ApiDocsTheme.color('--color-banana-600', 0.6);
              return ApiDocsTheme.color('--color-orange-500', 0.6);
            }),
            borderColor: dataPoints.map((point) => {
              if (point.y > 0.9) return ApiDocsTheme.color('--color-jade-700');
              if (point.y > 0.75) return ApiDocsTheme.color('--color-banana-800');
              return ApiDocsTheme.color('--color-orange-700');
            }),
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
                  const user = dataPoints[index];
                  return `User: ${user.userId}`;
                },
                label(context) {
                  const user = dataPoints[context.dataIndex];
                  return [
                    `Accuracy: ${(user.y * 100).toFixed(1)}%`,
                    `Total Labels: ${user.x}`,
                    `Validated Labels: ${user.validatedLabels}`,
                    `Meters Explored: ${Math.round(user.metersExplored)}`,
                  ];
                },
              },
            },
            legend: {
              display: false,
            },
          },
          scales: {
            x: {
              type: 'logarithmic',
              title: {
                display: true,
                text: 'Total Labels (log scale)',
              },
            },
            y: {
              min: 0,
              max: 1.1,
              title: {
                display: true,
                text: 'Accuracy',
              },
              ticks: {
                // Define explicit tick values to avoid floating-point precision issues.
                callback(value) {
                  // Format tick labels to show clean percentages.
                  if (value === 0) return '0%';
                  if (value === 0.25) return '25%';
                  if (value === 0.5) return '50%';
                  if (value === 0.75) return '75%';
                  if (value === 1) return '100%';
                  return ''; // Don't display labels above 100%.
                },
                // Force Chart.js to use these specific values for ticks.
                stepSize: 0.25,
              },
            },
          },
        },
      });
    },
  };
})();
