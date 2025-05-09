/**
 * Project Sidewalk Overall Stats Visualization Generator
 * 
 * This script generates visualizations for the Overall Stats API preview
 * by fetching data directly from the API endpoint.
 * 
 * @requires DOM element with id 'overall-stats-preview'
 * @requires Chart.js library
 */

(function() {
  // Configuration options - can be overridden by calling setup()
  let config = {
    // API URL - will be updated to production URL in production
    apiBaseUrl: "http://localhost:9000/v3/api",
    containerId: "overall-stats-preview",
    chartHeight: 300, // Fixed height for each chart
    overallStatsEndpoint: "/overallStats",
    labelTypesEndpoint: "/labelTypes",
    chartBackgroundColor: '#f9f9f9',
    chartBorderColor: '#e0e0e0',
    colors: {}, // Will be populated from labelTypes API
    pieColors: [
      '#36A2EB', // blue
      '#FF6384', // red
      '#4BC0C0', // teal
      '#FF9F40', // orange
      '#9966FF', // purple
      '#FFCD56', // yellow
      '#C9CBCF', // grey
      '#7BC043', // green
      '#F08CAB'  // pink
    ]
  };

  // Label type mapping (API field name to display name)
  // This will be populated from the labelTypes API
  let labelTypeMapping = {
    "CurbRamp": "Curb Ramp",
    "NoCurbRamp": "Missing Curb Ramp",
    "Obstacle": "Obstacle",
    "SurfaceProblem": "Surface Problem",
    "NoSidewalk": "No Sidewalk",
    "Crosswalk": "Crosswalk",
    "Signal": "Pedestrian Signal",
    "Occlusion": "Can't See Sidewalk",
    "Other": "Other"
  };

  // Public API
  window.OverallStatsPreview = {
    /**
     * Configure the overall stats preview
     * @param {Object} options - Configuration options
     * @returns {Object} The OverallStatsPreview object for chaining
     */
    setup: function(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Initialize the overall stats preview visualization
     * @returns {Promise} A promise that resolves when the preview is rendered
     */
    init: function() {
      const container = document.getElementById(config.containerId);
      
      if (!container) {
        console.error(`Container element with id '${config.containerId}' not found.`);
        return Promise.reject(new Error("Container element not found"));
      }

      // Clear any existing content
      container.innerHTML = "";
      
      // Add loading message
      const loadingMessage = document.createElement('div');
      loadingMessage.className = 'loading-message';
      loadingMessage.textContent = "Loading project statistics...";
      loadingMessage.style.textAlign = "center";
      loadingMessage.style.padding = "50px 0";
      loadingMessage.style.color = "#666";
      container.appendChild(loadingMessage);
      
      // Try to get API URL from page if available
      const apiBaseUrl = document.documentElement.getAttribute('data-api-base-url');
      if (apiBaseUrl) {
        config.apiBaseUrl = apiBaseUrl;
      }
      
      // First fetch the label types to get official colors and descriptions
      return this.fetchLabelTypes()
        .then(labelTypesData => {
          // Then fetch overall stats data and create visualizations
          return this.fetchOverallStats()
            .then(statsData => {
              // Remove loading message
              container.removeChild(loadingMessage);
              
              // Create visualization elements
              this.createVisualizations(container, statsData);
              
              return statsData;
            });
        })
        .catch(error => {
          container.innerHTML = `<div class="error-message" style="color: red; text-align: center; padding: 50px 0;">Failed to load data: ${error.message}</div>`;
          console.error("Overall stats preview error:", error);
          return Promise.reject(error);
        });
    },
    
    /**
     * Fetch label types from the API to get proper colors and descriptions
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
          // Process the label types data to populate the colors and mapping
          if (data && data.labelTypes && Array.isArray(data.labelTypes)) {
            data.labelTypes.forEach(labelType => {
              // Update the colors map
              config.colors[labelType.name] = labelType.color;
              
              // Update the label type mapping
              labelTypeMapping[labelType.name] = labelType.description;
            });
          }
          
          return data;
        });
    },

    /**
     * Fetch overall statistics from the API
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
     * Create all visualizations in the container
     * @param {HTMLElement} container - Container element for the visualizations
     * @param {Object} data - Project Sidewalk stats data
     */
    createVisualizations: function(container, data) {
      // Create main dashboard container
      const dashboard = document.createElement('div');
      dashboard.className = 'stats-dashboard';
      dashboard.style.display = 'grid';
      dashboard.style.gridTemplateColumns = 'repeat(12, 1fr)';
      dashboard.style.gap = '20px';
      container.appendChild(dashboard);
      
      // Create key metrics section
      const keyMetrics = document.createElement('div');
      keyMetrics.className = 'key-metrics';
      keyMetrics.style.gridColumn = 'span 12';
      keyMetrics.style.display = 'grid';
      keyMetrics.style.gridTemplateColumns = 'repeat(4, 1fr)';
      keyMetrics.style.gap = '15px';
      keyMetrics.style.marginBottom = '20px';
      dashboard.appendChild(keyMetrics);
      
      // Add key metric cards
      this.createMetricCard(keyMetrics, 'Total Distance', `${data.kmExplored.toLocaleString()} km`, 'Distance covered by all users');
      this.createMetricCard(keyMetrics, 'Unique Distance', `${data.kmExploreNoOverlap.toLocaleString()} km`, 'Non-overlapping coverage');
      this.createMetricCard(keyMetrics, 'Total Users', data.nUsers.toLocaleString(), 'Contributors to the project');
      this.createMetricCard(keyMetrics, 'Total Labels', data.totalLabels.toLocaleString(), 'Accessibility issues identified');
      
      // Create chart sections - using a 2x2 grid layout
      const chartGrid = document.createElement('div');
      chartGrid.className = 'chart-grid';
      chartGrid.style.display = 'grid';
      chartGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
      chartGrid.style.gap = '20px';
      chartGrid.style.gridColumn = 'span 12';
      dashboard.appendChild(chartGrid);
      
      // Create the four chart sections in a grid
      this.createChartSection(
        chartGrid, 
        'Label Distribution by Type', 
        'Breakdown of accessibility issues by category', 
        (chartContainer) => this.createLabelDistributionChart(chartContainer, data)
      );
      
      this.createChartSection(
        chartGrid, 
        'Label Accuracy by Type', 
        'Percentage of labels validated as correct', 
        (chartContainer) => this.createAccuracyBarChart(chartContainer, data)
      );
      
      this.createChartSection(
        chartGrid, 
        'User Participation', 
        'Breakdown of user types', 
        (chartContainer) => this.createUserDistributionChart(chartContainer, data)
      );
      
      this.createChartSection(
        chartGrid, 
        'Average Severity by Label Type', 
        'Higher values indicate more severe accessibility issues', 
        (chartContainer) => this.createSeverityBarChart(chartContainer, data)
      );
      
      // Add project info section
      const projectInfo = document.createElement('div');
      projectInfo.className = 'project-info';
      projectInfo.style.gridColumn = 'span 12';
      projectInfo.style.marginTop = '20px';
      projectInfo.style.padding = '15px';
      projectInfo.style.backgroundColor = '#f9f9f9';
      projectInfo.style.borderRadius = '4px';
      projectInfo.style.fontSize = '0.9em';
      projectInfo.style.color = '#666';
      projectInfo.style.textAlign = 'center';
      
      // Format launch date
      const launchDate = new Date(data.launchDate);
      const launchDateStr = launchDate.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      
      // Format recent activity date
      const recentActivity = new Date(data.avgTimestampLast100Labels);
      const recentActivityStr = recentActivity.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      
      projectInfo.innerHTML = `
        <div>Project launched on <strong>${launchDateStr}</strong> | Recent activity: <strong>${recentActivityStr}</strong></div>
        <div style="margin-top: 10px;">Total validations: <strong>${data.nValidations.toLocaleString()}</strong></div>
      `;
      
      dashboard.appendChild(projectInfo);
    },
    
    /**
     * Create a metric card for the key metrics section
     * @param {HTMLElement} container - Parent container
     * @param {string} title - Metric title
     * @param {string} value - Metric value
     * @param {string} description - Metric description
     */
    createMetricCard: function(container, title, value, description) {
      const card = document.createElement('div');
      card.className = 'metric-card';
      card.style.backgroundColor = 'white';
      card.style.padding = '15px';
      card.style.borderRadius = '4px';
      card.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
      card.style.textAlign = 'center';
      
      const titleEl = document.createElement('div');
      titleEl.className = 'metric-title';
      titleEl.textContent = title;
      titleEl.style.fontSize = '0.9em';
      titleEl.style.fontWeight = 'bold';
      titleEl.style.color = '#555';
      titleEl.style.marginBottom = '8px';
      
      const valueEl = document.createElement('div');
      valueEl.className = 'metric-value';
      valueEl.textContent = value;
      valueEl.style.fontSize = '1.8em';
      valueEl.style.fontWeight = 'bold';
      valueEl.style.color = '#333';
      valueEl.style.marginBottom = '5px';
      
      const descEl = document.createElement('div');
      descEl.className = 'metric-description';
      descEl.textContent = description;
      descEl.style.fontSize = '0.8em';
      descEl.style.color = '#777';
      
      card.appendChild(titleEl);
      card.appendChild(valueEl);
      card.appendChild(descEl);
      
      container.appendChild(card);
    },
    
    /**
     * Create a section for a chart with a header and description
     * @param {HTMLElement} container - Parent container
     * @param {string} title - Section title
     * @param {string} description - Description text
     * @param {Function} chartCreator - Function to create the chart (receives the chart container)
     */
    createChartSection: function(container, title, description, chartCreator) {
      // Create section container
      const section = document.createElement('div');
      section.className = 'chart-section';
      section.style.padding = '15px';
      section.style.backgroundColor = config.chartBackgroundColor;
      section.style.border = `1px solid ${config.chartBorderColor}`;
      section.style.borderRadius = '4px';
      container.appendChild(section);
      
      // Create section header
      const header = document.createElement('h3');
      header.textContent = title;
      header.style.textAlign = 'center';
      header.style.margin = '0 0 5px 0';
      header.style.fontSize = '1.1em';
      section.appendChild(header);
      
      // Create description
      const desc = document.createElement('p');
      desc.textContent = description;
      desc.style.textAlign = 'center';
      desc.style.fontSize = '0.85em';
      desc.style.color = '#666';
      desc.style.margin = '0 0 15px 0';
      section.appendChild(desc);
      
      // Create chart container
      const chartContainer = document.createElement('div');
      chartContainer.className = 'chart-container';
      chartContainer.style.height = `${config.chartHeight}px`;
      chartContainer.style.width = '100%';
      chartContainer.style.position = 'relative';
      section.appendChild(chartContainer);
      
      // Create the chart
      chartCreator(chartContainer);
    },

    /**
     * Create a pie chart showing the distribution of labels by type
     * @param {HTMLElement} container - Container element for the chart
     * @param {Object} data - Project Sidewalk stats data
     */
    createLabelDistributionChart: function(container, data) {
      // Create canvas for the chart
      const canvas = document.createElement('canvas');
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
      container.appendChild(canvas);
      
      // Prepare data for chart
      const labelTypes = Object.keys(data.severityByLabelType);
      const labelCounts = labelTypes.map(type => data.severityByLabelType[type].n);
      const labelNames = labelTypes.map(type => labelTypeMapping[type] || type);
      
      // Use custom colors from labelTypes API if available, or fallback to defaults
      const chartColors = labelTypes.map((type, index) => 
        config.colors[type] || config.pieColors[index % config.pieColors.length]
      );
      
      // Create the chart
      new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: {
          labels: labelNames,
          datasets: [{
            data: labelCounts,
            backgroundColor: chartColors,
            borderColor: 'white',
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: {
                boxWidth: 12,
                padding: 10,
                font: {
                  size: 11
                }
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const label = context.label || '';
                  const value = context.raw;
                  const percentage = ((value / data.totalLabels) * 100).toFixed(1);
                  return `${label}: ${value.toLocaleString()} (${percentage}%)`;
                }
              }
            }
          }
        }
      });
    },

    /**
     * Create a horizontal bar chart showing the accuracy rate by label type
     * @param {HTMLElement} container - Container element for the chart
     * @param {Object} data - Project Sidewalk stats data
     */
    createAccuracyBarChart: function(container, data) {
      // Create canvas for the chart
      const canvas = document.createElement('canvas');
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
      container.appendChild(canvas);
      
      // Prepare data for chart - we'll only include label types with validation data
      const labelTypesWithAccuracy = Object.keys(data.accuracyByLabelType)
        .filter(type => data.accuracyByLabelType[type].accuracy !== null)
        .sort((a, b) => data.accuracyByLabelType[b].accuracy - data.accuracyByLabelType[a].accuracy);
      
      const accuracyValues = labelTypesWithAccuracy.map(type => 
        (data.accuracyByLabelType[type].accuracy * 100).toFixed(1)
      );
      
      const labelNames = labelTypesWithAccuracy.map(type => 
        labelTypeMapping[type] || type
      );
      
      // Use custom colors from labelTypes API if available, or fallback to defaults
      const chartColors = labelTypesWithAccuracy.map((type, index) => 
        config.colors[type] || config.pieColors[index % config.pieColors.length]
      );
      
      // Create the chart
      new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: labelNames,
          datasets: [{
            label: 'Accuracy (%)',
            data: accuracyValues,
            backgroundColor: chartColors,
            borderColor: chartColors.map(color => color),
            borderWidth: 1
          }]
        },
        options: {
          indexAxis: 'y', // Horizontal bar chart
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const type = labelTypesWithAccuracy[context.dataIndex];
                  const stats = data.accuracyByLabelType[type];
                  return [
                    `Accuracy: ${context.raw}%`,
                    `Agree: ${stats.nAgree.toLocaleString()}`,
                    `Disagree: ${stats.nDisagree.toLocaleString()}`,
                    `Total Validated: ${stats.n.toLocaleString()}`
                  ];
                }
              }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              max: 100,
              title: {
                display: true,
                text: 'Accuracy (%)'
              }
            },
            y: {
              title: {
                display: false
              }
            }
          }
        }
      });
    },

    /**
     * Create a pie chart showing the distribution of users by type
     * @param {HTMLElement} container - Container element for the chart
     * @param {Object} data - Project Sidewalk stats data
     */
    createUserDistributionChart: function(container, data) {
      // Create canvas for the chart
      const canvas = document.createElement('canvas');
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
      container.appendChild(canvas);
      
      // Prepare data for chart
      const userTypes = [
        { name: 'Registered', count: data.nRegistered },
        { name: 'Anonymous', count: data.nAnon },
        { name: 'Turker', count: data.nTurker },
        { name: 'Researcher', count: data.nResearcher }
      ];
      
      const userColors = [
        '#36A2EB', // blue - registered
        '#FFCD56', // yellow - anonymous
        '#FF6384', // red - turker
        '#4BC0C0'  // teal - researcher
      ];
      
      // Create the chart
      new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: {
          labels: userTypes.map(type => type.name),
          datasets: [{
            data: userTypes.map(type => type.count),
            backgroundColor: userColors,
            borderColor: 'white',
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: {
                boxWidth: 12,
                padding: 10,
                font: {
                  size: 11
                }
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const label = context.label || '';
                  const value = context.raw;
                  const percentage = ((value / data.nUsers) * 100).toFixed(1);
                  return `${label}: ${value.toLocaleString()} (${percentage}%)`;
                }
              }
            }
          }
        }
      });
    },

    /**
     * Create a horizontal bar chart showing average severity by label type
     * @param {HTMLElement} container - Container element for the chart
     * @param {Object} data - Project Sidewalk stats data
     */
    createSeverityBarChart: function(container, data) {
      // Create canvas for the chart
      const canvas = document.createElement('canvas');
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
      container.appendChild(canvas);
      
      // Prepare data for chart - filter out label types without severity data
      const labelTypesWithSeverity = Object.keys(data.severityByLabelType)
        .filter(type => data.severityByLabelType[type].severityMean !== null)
        .sort((a, b) => 
          data.severityByLabelType[b].severityMean - data.severityByLabelType[a].severityMean
        );
      
      const severityValues = labelTypesWithSeverity.map(type => 
        data.severityByLabelType[type].severityMean
      );
      
      const labelNames = labelTypesWithSeverity.map(type => 
        labelTypeMapping[type] || type
      );
      
      // Use custom colors from labelTypes API if available, or fallback to defaults
      const chartColors = labelTypesWithSeverity.map((type, index) => 
        config.colors[type] || config.pieColors[index % config.pieColors.length]
      );
      
      // Create the chart
      new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: labelNames,
          datasets: [{
            label: 'Average Severity',
            data: severityValues,
            backgroundColor: chartColors,
            borderColor: chartColors.map(color => color),
            borderWidth: 1
          }]
        },
        options: {
          indexAxis: 'y', // Horizontal bar chart
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const type = labelTypesWithSeverity[context.dataIndex];
                  const stats = data.severityByLabelType[type];
                  return [
                    `Average Severity: ${stats.severityMean.toFixed(1)} / 5`,
                    `Standard Deviation: ${stats.severitySD.toFixed(1)}`,
                    `Labels with Severity: ${stats.nWithSeverity.toLocaleString()}`,
                    `Total Labels: ${stats.n.toLocaleString()}`
                  ];
                }
              }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              max: 5,
              title: {
                display: true,
                text: 'Average Severity (1-5)'
              }
            },
            y: {
              title: {
                display: false
              }
            }
          }
        }
      });
    }
  };
})();