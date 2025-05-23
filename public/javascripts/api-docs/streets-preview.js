/**
 * Streets Map Preview Generator
 *
 * This script generates three live map previews of Project Sidewalk street segments:
 * 1. User Count visualization - colored by number of unique contributors
 * 2. Audit Age visualization - colored by recency of last audit
 * 3. Label Count visualization - colored by number of labels
 *
 * @requires DOM elements with ids 'streets-user-count-preview', 'streets-audit-age-preview', and 'streets-label-count-preview'
 * @requires Leaflet.js library
 */

(function() {
  // Configuration options - can be overridden by calling setup()
  let config = {
    apiBaseUrl: "/v3/api",
    mainContainerId: "streets-preview",
    mapHeight: 400,
    streetsEndpoint: "/streets",
    regionWithMostLabelsEndpoint: "/regionWithMostLabels"
  };

  // Color endpoints for continuous scaling (dark background optimized)
  const userCountColorEndpoints = {
    unaudited: '#3d3d3d',  // Dark gray for unaudited streets
    minUsers: '#472c7a',   // Dark purple for minimum users
    maxUsers: '#ffffff'    // White for maximum users
  };

  const labelCountColorEndpoints = {
    noLabels: '#3d3d3d',   // Dark gray for no labels
    minLabels: '#440154',  // Dark purple for minimum labels
    maxLabels: '#f0f921'   // Bright yellow for maximum labels
  };

  const auditAgeColorEndpoints = {
    neverAudited: 'lightgray', // Light gray for never audited
    newest: '#44ff44',       // Bright green for newest audits
    oldest: '#ff4444'        // Bright red for oldest audits
  };

  /**
   * Function to interpolate between two colors
   * @param {string} color1 - First color in hex format
   * @param {string} color2 - Second color in hex format
   * @param {number} factor - Interpolation factor (0-1)
   * @returns {string} Interpolated color in hex format
   */
  function interpolateColor(color1, color2, factor) {
    const c1 = {
      r: parseInt(color1.slice(1, 3), 16),
      g: parseInt(color1.slice(3, 5), 16),
      b: parseInt(color1.slice(5, 7), 16)
    };
    const c2 = {
      r: parseInt(color2.slice(1, 3), 16),
      g: parseInt(color2.slice(3, 5), 16),
      b: parseInt(color2.slice(5, 7), 16)
    };

    const r = Math.round(c1.r + (c2.r - c1.r) * factor);
    const g = Math.round(c1.g + (c2.g - c1.g) * factor);
    const b = Math.round(c1.b + (c2.b - c1.b) * factor);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  // Public API
  window.StreetsPreview = {
    /**
     * Configure the streets preview
     * @param {Object} options - Configuration options
     * @returns {Object} The StreetsPreview object for chaining
     */
    setup: function(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Initialize all three streets preview maps
     * @returns {Promise} A promise that resolves when all previews are rendered
     */
    init: function() {
      const mainContainer = document.getElementById(config.mainContainerId);

      if (!mainContainer) {
        console.error('Main container element not found.');
        return Promise.reject(new Error("Main container element not found"));
      }

      // Create the HTML structure for all three visualizations
      this.createVisualizationStructure(mainContainer);

      // Get references to the created containers
      const userCountContainer = document.getElementById('streets-user-count-preview');
      const auditAgeContainer = document.getElementById('streets-audit-age-preview');
      const labelCountContainer = document.getElementById('streets-label-count-preview');

      // Set height for all map containers
      userCountContainer.style.height = `${config.mapHeight}px`;
      auditAgeContainer.style.height = `${config.mapHeight}px`;
      labelCountContainer.style.height = `${config.mapHeight}px`;

      // Initialize with loading messages
      const loadingMessage1 = document.createElement('div');
      loadingMessage1.className = 'loading-message';
      loadingMessage1.textContent = "Loading user count data...";
      userCountContainer.appendChild(loadingMessage1);

      const loadingMessage2 = document.createElement('div');
      loadingMessage2.className = 'loading-message';
      loadingMessage2.textContent = "Loading audit age data...";
      auditAgeContainer.appendChild(loadingMessage2);

      const loadingMessage3 = document.createElement('div');
      loadingMessage3.className = 'loading-message';
      loadingMessage3.textContent = "Loading label count data...";
      labelCountContainer.appendChild(loadingMessage3);

      // First get region with most labels, then load streets for all maps
      return this.fetchRegionWithMostLabels()
        .then(regionData => {
          return this.fetchStreetsByRegionId(regionData.region_id)
            .then(streets => {
              // Clear loading messages
              userCountContainer.innerHTML = "";
              auditAgeContainer.innerHTML = "";
              labelCountContainer.innerHTML = "";

              // Create all three maps
              const userCountMap = this.createMap(userCountContainer, regionData, 'user-count');
              const auditAgeMap = this.createMap(auditAgeContainer, regionData, 'audit-age');
              const labelCountMap = this.createMap(labelCountContainer, regionData, 'label-count');

              // Display streets on all three maps
              this.displayUserCountMap(userCountMap, streets, regionData);
              this.displayAuditAgeMap(auditAgeMap, streets, regionData);
              this.displayLabelCountMap(labelCountMap, streets, regionData);

              return Promise.resolve();
            });
        })
        .catch(error => {
          const errorMessage = `<div class="message message-error">Failed to load streets: ${error.message}</div>`;
          userCountContainer.innerHTML = errorMessage;
          auditAgeContainer.innerHTML = errorMessage;
          labelCountContainer.innerHTML = errorMessage;
          console.error("Streets preview error:", error);
          return Promise.reject(error);
        });
    },

    /**
     * Creates the structure for all three visualization sections with headings, descriptions, and containers
     * @param {HTMLElement} mainContainer - The main container element to append visualization sections to
     */
    createVisualizationStructure: function(mainContainer) {
      // Clear existing content
      mainContainer.innerHTML = '';

      // Create User Count visualization section
      const userCountSection = document.createElement('div');
      userCountSection.className = 'visualization-section';

      const userCountHeading = document.createElement('h3');
      userCountHeading.textContent = 'User Count Visualization';

      // Add description for User Count visualization
      const userCountDescription = document.createElement('div');
      userCountDescription.className = 'visualization-description';
      userCountDescription.textContent = 'Visualizes user counts per street segment. More specifically, streets are color-coded by the number of users who added at least one label to the segments. You can hover and click on streets to view more information.';

      const userCountContainer = document.createElement('div');
      userCountContainer.id = 'streets-user-count-preview';
      userCountContainer.className = 'streets-map-section';

      userCountSection.appendChild(userCountHeading);
      userCountSection.appendChild(userCountDescription);
      userCountSection.appendChild(userCountContainer);

      // Create Audit Age visualization section
      const auditAgeSection = document.createElement('div');
      auditAgeSection.className = 'visualization-section';

      const auditAgeHeading = document.createElement('h3');
      auditAgeHeading.textContent = 'Audit Age Visualization';

      // Add description for Audit Age visualization
      const auditAgeDescription = document.createElement('div');
      auditAgeDescription.className = 'visualization-description';
      auditAgeDescription.textContent = 'Displays the age of audits for each street segment. Streets are color-coded based on how recently they were audited, helping identify areas that may need fresh accessibility assessments. You can hover and click on streets to view more information.';

      const auditAgeContainer = document.createElement('div');
      auditAgeContainer.id = 'streets-audit-age-preview';
      auditAgeContainer.className = 'streets-map-section';

      auditAgeSection.appendChild(auditAgeHeading);
      auditAgeSection.appendChild(auditAgeDescription);
      auditAgeSection.appendChild(auditAgeContainer);

      // Create Label Count visualization section
      const labelCountSection = document.createElement('div');
      labelCountSection.className = 'visualization-section';

      const labelCountHeading = document.createElement('h3');
      labelCountHeading.textContent = 'Label Count Visualization';

      // Add description for Label Count visualization
      const labelCountDescription = document.createElement('div');
      labelCountDescription.className = 'visualization-description';
      labelCountDescription.textContent = 'Shows the total number of accessibility labels placed on each street segment. Streets are color-coded by label density, indicating areas with more or fewer accessibility annotations. You can hover and click on streets to view more information.';

      const labelCountContainer = document.createElement('div');
      labelCountContainer.id = 'streets-label-count-preview';
      labelCountContainer.className = 'streets-map-section';

      labelCountSection.appendChild(labelCountHeading);
      labelCountSection.appendChild(labelCountDescription);
      labelCountSection.appendChild(labelCountContainer);

      // Add all sections to main container
      mainContainer.appendChild(userCountSection);
      mainContainer.appendChild(auditAgeSection);
      mainContainer.appendChild(labelCountSection);
    },

    /**
     * Fetch region with the most labels
     * @returns {Promise} A promise that resolves with the region data
     */
    fetchRegionWithMostLabels: function() {
      return fetch(`${config.apiBaseUrl}${config.regionWithMostLabelsEndpoint}`)
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        })
        .catch(error => {
          console.error("Error fetching region with most labels:", error);
          throw new Error("Failed to fetch region with most labels");
        });
    },

    /**
     * Calculate center of a region from its geometry
     * @param {Object} region - Region data with geometry
     * @returns {Array} [lat, lon] center coordinates
     */
    getCenterFromRegion: function(region) {
      if (!region || !region.geometry) {
        throw new Error("Invalid region data");
      }

      let allCoords = [];

      if (region.geometry.type === "MultiPolygon") {
        region.geometry.coordinates.forEach(polygon => {
          polygon.forEach(ring => {
            allCoords = allCoords.concat(ring);
          });
        });
      } else if (region.geometry.type === "Polygon") {
        region.geometry.coordinates.forEach(ring => {
          allCoords = allCoords.concat(ring);
        });
      }

      const lons = allCoords.map(coord => coord[0]);
      const lats = allCoords.map(coord => coord[1]);

      const minLon = Math.min(...lons);
      const minLat = Math.min(...lats);
      const maxLon = Math.max(...lons);
      const maxLat = Math.max(...lats);

      const centerLon = (minLon + maxLon) / 2;
      const centerLat = (minLat + maxLat) / 2;
      return [centerLat, centerLon];
    },

    /**
     * Fetch streets by region ID
     * @param {number} regionId - ID of the region
     * @returns {Promise} A promise that resolves with the streets data
     */
    fetchStreetsByRegionId: function(regionId) {
      const url = `${config.apiBaseUrl}${config.streetsEndpoint}?regionId=${regionId}`;
      return fetch(url)
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        });
    },

    /**
     * Create a Leaflet map with darkened background
     * @param {HTMLElement} container - Container element for the map
     * @param {Object} regionData - Data about the region to display
     * @param {string} mapType - Type identifier for the map
     * @returns {Object} The Leaflet map object
     */
    createMap: function(container, regionData, mapType) {
      const mapElement = document.createElement('div');
      mapElement.id = `streets-${mapType}-map`;
      mapElement.className = 'map-container';
      container.appendChild(mapElement);

      const center = this.getCenterFromRegion(regionData);
      const map = L.map(`streets-${mapType}-map`).setView(center, 16);

      // Add CartoDB Dark Matter tile layer for better line visibility
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(map);

      // Add region outline
      if (regionData.geometry) {
        const regionLayer = L.geoJSON(regionData.geometry, {
          style: {
            color: '#ffffff',
            weight: 1,
            opacity: 0.6,
            fillOpacity: 0.05,
            fillColor: '#ffffff'
          }
        }).addTo(map);

        map.fitBounds(regionLayer.getBounds(), { padding: [10, 10] });
      }

      // Add region title
      const regionTitle = L.control({position: 'topright'});
      regionTitle.onAdd = function() {
        const div = L.DomUtil.create('div', 'region-title');
        div.innerHTML = `<strong>Region:</strong> ${regionData.name || 'Sample Region'}`;
        return div;
      };
      regionTitle.addTo(map);

      return map;
    },

    /**
     * Function to interpolate between two colors (instance method)
     * @param {string} color1 - First color in hex format
     * @param {string} color2 - Second color in hex format
     * @param {number} factor - Interpolation factor (0-1)
     * @returns {string} Interpolated color in hex format
     */
    interpolateColor: interpolateColor,

    /**
     * Get color for street based on user count with truly continuous scaling
     * @param {number} userCount - Number of users who labeled the street
     * @param {number} maxUserCount - Maximum user count in the dataset
     * @returns {string} Hex color code
     */
    getUserCountColor: function(userCount, maxUserCount) {
      if (userCount === 0) {
        return userCountColorEndpoints.unaudited; // Special color for unaudited
      }

      if (maxUserCount <= 1) {
        return userCountColorEndpoints.minUsers;
      }

      // Continuous interpolation from minUsers to maxUsers based on actual data range
      const scaledValue = (userCount - 1) / (maxUserCount - 1);
      return this.interpolateColor(
        userCountColorEndpoints.minUsers,
        userCountColorEndpoints.maxUsers,
        scaledValue
      );
    },

    /**
     * Get color for street based on label count with truly continuous scaling
     * @param {number} labelCount - Number of labels on the street
     * @param {number} maxLabelCount - Maximum label count in the dataset
     * @returns {string} Hex color code
     */
    getLabelCountColor: function(labelCount, maxLabelCount) {
      if (labelCount === 0) {
        return labelCountColorEndpoints.noLabels; // Special color for no labels
      }

      if (maxLabelCount <= 1) {
        return labelCountColorEndpoints.minLabels;
      }

      // Continuous interpolation from minLabels to maxLabels based on actual data range
      const scaledValue = (labelCount - 1) / (maxLabelCount - 1);
      return this.interpolateColor(
        labelCountColorEndpoints.minLabels,
        labelCountColorEndpoints.maxLabels,
        scaledValue
      );
    },

    /**
     * Get color for street based on audit age with truly continuous scaling
     * @param {string|null} lastLabelDate - ISO date string of last label
     * @param {number} minDays - Minimum days in the dataset (excluding null)
     * @param {number} maxDays - Maximum days in the dataset
     * @returns {string} Hex color code
     */
    getAuditAgeColor: function(lastLabelDate, minDays, maxDays) {
      if (!lastLabelDate) {
        return auditAgeColorEndpoints.neverAudited; // Special color for never audited
      }

      const now = new Date();
      const labelDate = new Date(lastLabelDate);
      const daysDiff = (now - labelDate) / (1000 * 60 * 60 * 24);

      if (maxDays <= minDays) {
        // All audited streets have similar age - use middle color
        return this.interpolateColor(
          auditAgeColorEndpoints.newest,
          auditAgeColorEndpoints.oldest,
          0.5
        );
      }

      // Continuous interpolation from newest to oldest based on actual data range
      const scaledValue = (daysDiff - minDays) / (maxDays - minDays);
      return this.interpolateColor(
        auditAgeColorEndpoints.newest,
        auditAgeColorEndpoints.oldest,
        scaledValue
      );
    },

    /**
     * Format age for display with proper singular/plural handling
     * @param {string|null} lastLabelDate - ISO date string of last label
     * @returns {string} Human readable age string
     * @example
     * formatAuditAge('2024-05-18T10:00:00Z') // "1 day ago"
     * formatAuditAge('2024-05-12T10:00:00Z') // "1 week ago"
     * formatAuditAge('2023-05-19T10:00:00Z') // "1 year ago"
     * formatAuditAge(null) // "Never audited"
     */
    formatAuditAge: function(lastLabelDate) {
      if (!lastLabelDate) {
        return 'Never audited';
      }

      const now = new Date();
      const labelDate = new Date(lastLabelDate);
      const daysDiff = (now - labelDate) / (1000 * 60 * 60 * 24);

      if (daysDiff < 1) {
        return 'Today';
      } else if (daysDiff < 7) {
        const days = Math.floor(daysDiff);
        return `${days} ${days === 1 ? 'day' : 'days'} ago`;
      } else if (daysDiff < 30) {
        const weeks = Math.floor(daysDiff / 7);
        return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
      } else if (daysDiff < 365) {
        const months = Math.floor(daysDiff / 30);
        return `${months} ${months === 1 ? 'month' : 'months'} ago`;
      } else {
        const years = Math.floor(daysDiff / 365);
        return `${years} ${years === 1 ? 'year' : 'years'} ago`;
      }
    },

    /**
     * Create OSM link for street ID
     * @param {number|null} osmStreetId - OpenStreetMap way ID
     * @returns {string} HTML link or plain text
     */
    createOsmLink: function(osmStreetId) {
      if (!osmStreetId) {
        return 'N/A';
      }
      return `<a href="https://www.openstreetmap.org/way/${osmStreetId}" target="_blank" style="color: #0066cc;">${osmStreetId}</a>`;
    },

    /**
     * Display streets on the user count map
     * @param {Object} map - The Leaflet map object
     * @param {Object} streets - GeoJSON data containing the street segments
     * @param {Object} regionData - Data about the region being displayed
     */
    displayUserCountMap: function(map, streets, regionData) {
      if (!streets.features || streets.features.length === 0) {
        this.addNoStreetsMessage(map);
        return;
      }

      // Add street count indicator
      const countDiv = document.createElement('div');
      countDiv.className = 'counter-badge';
      countDiv.textContent = `${streets.features.length} streets`;
      map.getContainer().appendChild(countDiv);

      // Track statistics and calculate data range
      const stats = { unaudited: 0, audited: 0, totalLabels: 0, wayTypes: new Set() };
      const userCounts = streets.features.map(f => f.properties.user_count || 0);
      const maxUserCount = Math.max(...userCounts);
      const minUserCount = Math.min(...userCounts.filter(c => c > 0)) || 1;
      stats.maxUserCount = maxUserCount;
      stats.minUserCount = minUserCount;

      // Add streets to map
      const streetLayer = L.geoJSON(streets, {
        style: (feature) => {
          const props = feature.properties;
          const userCount = props.user_count || 0;
          const labelCount = props.label_count || 0;
          const wayType = props.way_type;

          // Update statistics
          stats.wayTypes.add(wayType);
          stats.totalLabels += labelCount;

          if (userCount === 0) {
            stats.unaudited++;
          } else {
            stats.audited++;
          }

          // Style based on user count with adaptive scaling
          const color = this.getUserCountColor(userCount, maxUserCount);
          const weight = Math.max(2, Math.min(6, 2 + userCount));

          return {
            color: color,
            weight: weight,
            opacity: 0.8,
            fillOpacity: 0
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          const userCount = props.user_count || 0;
          const labelCount = props.label_count || 0;
          const wayType = props.way_type || 'Unknown';
          const firstLabelDate = props.first_label_date ?
            new Date(props.first_label_date).toLocaleDateString() : 'No labels';
          const lastLabelDate = props.last_label_date ?
            new Date(props.last_label_date).toLocaleDateString() : 'No labels';
          const auditAge = this.formatAuditAge(props.last_label_date);
          const osmLink = this.createOsmLink(props.osm_street_id);

          const auditStatus = userCount === 0 ? 'Unaudited' :
                             `Labeled by ${userCount} user${userCount > 1 ? 's' : ''}`;

          layer.bindPopup(`
            <div class="street-popup">
              <h4>Street Segment ${props.street_edge_id}</h4>
              <p><strong>Type:</strong> ${wayType}</p>
              <p><strong>Status:</strong> ${auditStatus}</p>
              <p><strong>Labels:</strong> ${labelCount}</p>
              <p><strong>First Label:</strong> ${firstLabelDate}</p>
              <p><strong>Last Label:</strong> ${lastLabelDate}</p>
              <p><strong>Audit Age:</strong> ${auditAge}</p>
              <p><strong>OSM ID:</strong> ${osmLink}</p>
              <p><strong>Project Sidewalk Street ID:</strong> ${props.street_edge_id}</p>
              <a href="/explore?streetEdgeId=${props.street_edge_id}" class="explore-street-btn" target="_blank">
                Explore Street in Project Sidewalk
              </a>
            </div>
          `);

          // Add hover effects
          layer.on('mouseover', function() {
            this.setStyle({
              weight: this.options.weight + 2,
              opacity: 1
            });
          });

          layer.on('mouseout', function() {
            this.setStyle({
              weight: this.options.weight - 2,
              opacity: this.options.opacity
            });
          });
        }
      }).addTo(map);

      // Create continuous legend for user count
      this.createContinuousUserCountLegend(map, minUserCount, maxUserCount);

      // Add summary statistics
      this.addUserCountStats(map, stats);
    },

    /**
     * Display streets on the audit age map
     * @param {Object} map - The Leaflet map object
     * @param {Object} streets - GeoJSON data containing the street segments
     * @param {Object} regionData - Data about the region being displayed
     */
    displayAuditAgeMap: function(map, streets, regionData) {
      if (!streets.features || streets.features.length === 0) {
        this.addNoStreetsMessage(map);
        return;
      }

      // Add street count indicator
      const countDiv = document.createElement('div');
      countDiv.className = 'counter-badge';
      countDiv.textContent = `${streets.features.length} streets`;
      map.getContainer().appendChild(countDiv);

      // Track statistics and calculate age range
      const stats = { unaudited: 0, audited: 0, totalLabels: 0, wayTypes: new Set() };
      let totalDays = 0;
      let auditedCount = 0;

      // Calculate min and max days for audited streets
      const auditedDays = [];
      streets.features.forEach(feature => {
        const props = feature.properties;
        if (props.last_label_date) {
          const daysDiff = (new Date() - new Date(props.last_label_date)) / (1000 * 60 * 60 * 24);
          auditedDays.push(daysDiff);
        }
      });

      //const minDays = auditedDays.length > 0 ? Math.min(...auditedDays) : 0;
      const minDays = 0; // Always start from today
      const maxDays = auditedDays.length > 0 ? Math.max(...auditedDays) : 0;

      // Add streets to map
      const streetLayer = L.geoJSON(streets, {
        style: (feature) => {
          const props = feature.properties;
          const userCount = props.user_count || 0;
          const labelCount = props.label_count || 0;
          const wayType = props.way_type;

          // Update statistics
          stats.wayTypes.add(wayType);
          stats.totalLabels += labelCount;

          if (userCount === 0) {
            stats.unaudited++;
          } else {
            stats.audited++;
          }

          // Calculate age stats
          if (props.last_label_date) {
            const daysDiff = (new Date() - new Date(props.last_label_date)) / (1000 * 60 * 60 * 24);
            totalDays += daysDiff;
            auditedCount++;
          }

          // Style based on audit age with adaptive scaling
          const color = this.getAuditAgeColor(props.last_label_date, minDays, maxDays);
          const weight = props.last_label_date ? 3 : 1;
          const opacity = props.last_label_date ? 0.8 : 0.4;

          return {
            color: color,
            weight: weight,
            opacity: opacity,
            fillOpacity: 0
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          const userCount = props.user_count || 0;
          const labelCount = props.label_count || 0;
          const wayType = props.way_type || 'Unknown';
          const firstLabelDate = props.first_label_date ?
            new Date(props.first_label_date).toLocaleDateString() : 'No labels';
          const lastLabelDate = props.last_label_date ?
            new Date(props.last_label_date).toLocaleDateString() : 'No labels';
          const auditAge = this.formatAuditAge(props.last_label_date);
          const osmLink = this.createOsmLink(props.osm_street_id);

          const auditStatus = userCount === 0 ? 'Unaudited' :
                             `Labeled by ${userCount} user${userCount > 1 ? 's' : ''}`;

          layer.bindPopup(`
            <div class="street-popup">
              <h4>Street Segment ${props.street_edge_id}</h4>
              <p><strong>Type:</strong> ${wayType}</p>
              <p><strong>Status:</strong> ${auditStatus}</p>
              <p><strong>Labels:</strong> ${labelCount}</p>
              <p><strong>First Label:</strong> ${firstLabelDate}</p>
              <p><strong>Last Label:</strong> ${lastLabelDate}</p>
              <p><strong>Audit Age:</strong> ${auditAge}</p>
              <p><strong>OSM ID:</strong> ${osmLink}</p>
              <p><strong>Project Sidewalk Street ID:</strong> ${props.street_edge_id}</p>
              <a href="/explore?streetEdgeId=${props.street_edge_id}" class="explore-street-btn" target="_blank">
                Explore Street in Project Sidewalk
              </a>
            </div>
          `);

          // Add hover effects
          layer.on('mouseover', function() {
            this.setStyle({
              weight: this.options.weight + 2,
              opacity: 1
            });
          });

          layer.on('mouseout', function() {
            this.setStyle({
              weight: this.options.weight - 2,
              opacity: this.options.opacity
            });
          });
        }
      }).addTo(map);

      // Calculate average age
      const avgAge = auditedCount > 0 ? Math.round(totalDays / auditedCount) : null;
      stats.avgAge = avgAge;

      // Create continuous legend for audit age
      this.createContinuousAuditAgeLegend(map, minDays, maxDays);

      // Add summary statistics
      this.addAuditAgeStats(map, stats);
    },

    /**
     * Display streets on the label count map
     * @param {Object} map - The Leaflet map object
     * @param {Object} streets - GeoJSON data containing the street segments
     * @param {Object} regionData - Data about the region being displayed
     */
    displayLabelCountMap: function(map, streets, regionData) {
      if (!streets.features || streets.features.length === 0) {
        this.addNoStreetsMessage(map);
        return;
      }

      // Add street count indicator
      const countDiv = document.createElement('div');
      countDiv.className = 'counter-badge';
      countDiv.textContent = `${streets.features.length} streets`;
      map.getContainer().appendChild(countDiv);

      // Track statistics and calculate data range
      const stats = { unaudited: 0, audited: 0, totalLabels: 0, wayTypes: new Set() };
      const labelCounts = streets.features.map(f => f.properties.label_count || 0);
      const maxLabelCount = Math.max(...labelCounts);
      const minLabelCount = Math.min(...labelCounts.filter(c => c > 0)) || 1;
      stats.maxLabelCount = maxLabelCount;
      stats.minLabelCount = minLabelCount;

      // Add streets to map
      const streetLayer = L.geoJSON(streets, {
        style: (feature) => {
          const props = feature.properties;
          const userCount = props.user_count || 0;
          const labelCount = props.label_count || 0;
          const wayType = props.way_type;

          // Update statistics
          stats.wayTypes.add(wayType);
          stats.totalLabels += labelCount;

          if (userCount === 0) {
            stats.unaudited++;
          } else {
            stats.audited++;
          }

          // Style based on label count with adaptive scaling
          const color = this.getLabelCountColor(labelCount, maxLabelCount);
          const weight = Math.max(1, Math.min(5, 1 + Math.floor(labelCount / 5)));

          return {
            color: color,
            weight: weight,
            opacity: 0.8,
            fillOpacity: 0
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties;
          const userCount = props.user_count || 0;
          const labelCount = props.label_count || 0;
          const wayType = props.way_type || 'Unknown';
          const firstLabelDate = props.first_label_date ?
            new Date(props.first_label_date).toLocaleDateString() : 'No labels';
          const lastLabelDate = props.last_label_date ?
            new Date(props.last_label_date).toLocaleDateString() : 'No labels';
          const auditAge = this.formatAuditAge(props.last_label_date);
          const osmLink = this.createOsmLink(props.osm_street_id);

          const auditStatus = userCount === 0 ? 'Unaudited' :
                             `Labeled by ${userCount} user${userCount > 1 ? 's' : ''}`;

          layer.bindPopup(`
            <div class="street-popup">
              <h4>Street Segment ${props.street_edge_id}</h4>
              <p><strong>Type:</strong> ${wayType}</p>
              <p><strong>Status:</strong> ${auditStatus}</p>
              <p><strong>Labels:</strong> ${labelCount}</p>
              <p><strong>First Label:</strong> ${firstLabelDate}</p>
              <p><strong>Last Label:</strong> ${lastLabelDate}</p>
              <p><strong>Audit Age:</strong> ${auditAge}</p>
              <p><strong>OSM ID:</strong> ${osmLink}</p>
              <p><strong>Project Sidewalk Street ID:</strong> ${props.street_edge_id}</p>
              <a href="/explore?streetEdgeId=${props.street_edge_id}" class="explore-street-btn" target="_blank">
                Explore Street in Project Sidewalk
              </a>
            </div>
          `);

          // Add hover effects
          layer.on('mouseover', function() {
            this.setStyle({
              weight: this.options.weight + 2,
              opacity: 1
            });
          });

          layer.on('mouseout', function() {
            this.setStyle({
              weight: this.options.weight - 2,
              opacity: this.options.opacity
            });
          });
        }
      }).addTo(map);

      // Create continuous legend for label count
      this.createContinuousLabelCountLegend(map, minLabelCount, maxLabelCount);

      // Add summary statistics
      this.addLabelCountStats(map, stats);
    },

    /**
     * Add no streets message to map
     * @param {Object} map - The Leaflet map object
     */
    addNoStreetsMessage: function(map) {
      const noStreetsDiv = document.createElement('div');
      noStreetsDiv.className = 'no-streets-message';
      noStreetsDiv.textContent = `No streets found in this region.`;
      noStreetsDiv.style.position = 'absolute';
      noStreetsDiv.style.top = '10px';
      noStreetsDiv.style.left = '50%';
      noStreetsDiv.style.transform = 'translateX(-50%)';
      noStreetsDiv.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
      noStreetsDiv.style.padding = '5px 10px';
      noStreetsDiv.style.borderRadius = '3px';
      noStreetsDiv.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
      noStreetsDiv.style.zIndex = '1000';
      map.getContainer().appendChild(noStreetsDiv);
    },

    /**
     * Create a horizontal continuous legend for the user count map
     * @param {Object} map - The Leaflet map object
     * @param {number} minUserCount - Minimum user count found in the data (excluding 0)
     * @param {number} maxUserCount - Maximum user count found in the data
     */
    createContinuousUserCountLegend: function(map, minUserCount, maxUserCount) {
      const legend = L.control({position: 'topright'});

      legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'info legend continuous-legend');

        // Create horizontal gradient legend
        div.innerHTML = '<h4>Users per Street</h4>';

        // Create gradient container
        const gradientContainer = L.DomUtil.create('div', 'gradient-container', div);
        gradientContainer.style.cssText = `
          width: 200px;
          height: 20px;
          position: relative;
          border: 1px solid #ccc;
          border-radius: 3px;
          margin: 5px 0;
        `;

        // Create gradient bar with continuous interpolation
        const gradientBar = L.DomUtil.create('div', 'gradient-bar', gradientContainer);

        // Create smooth gradient from zero (special) to min to max
        const gradientStops = [];
        const numStops = 20; // More stops for smoother gradient

        // Add unaudited color at start
        gradientStops.push(`${userCountColorEndpoints.unaudited} 0%`);

        // Create continuous gradient from min to max users
        for (let i = 1; i <= numStops; i++) {
          const factor = (i - 1) / (numStops - 1);
          const color = window.StreetsPreview.interpolateColor(
            userCountColorEndpoints.minUsers,
            userCountColorEndpoints.maxUsers,
            factor
          );
          const position = 10 + (factor * 90); // Start at 10% to leave room for zero
          gradientStops.push(`${color} ${position}%`);
        }

        gradientBar.style.cssText = `
          width: 100%;
          height: 100%;
          background: linear-gradient(to right, ${gradientStops.join(', ')});
          border-radius: 2px;
        `;

        // Add tick marks and labels
        const labelsContainer = L.DomUtil.create('div', 'legend-labels', div);
        labelsContainer.style.cssText = `
          width: 200px;
          height: 20px;
          position: relative;
          font-size: 11px;
          color: #333;
        `;

        // Add special label for 0 users
        const zeroLabel = L.DomUtil.create('div', 'legend-tick', labelsContainer);
        zeroLabel.style.cssText = `
          position: absolute;
          left: 0;
          top: 2px;
          font-size: 10px;
          font-weight: bold;
        `;
        zeroLabel.textContent = '0';

        // Add tick marks for min and max
        if (maxUserCount > minUserCount) {
          const minLabel = L.DomUtil.create('div', 'legend-tick', labelsContainer);
          minLabel.style.cssText = `
            position: absolute;
            left: 10%;
            top: 2px;
            font-size: 10px;
          `;
          minLabel.textContent = minUserCount.toString();

          const maxLabel = L.DomUtil.create('div', 'legend-tick', labelsContainer);
          maxLabel.style.cssText = `
            position: absolute;
            right: 0;
            top: 2px;
            font-size: 10px;
          `;
          maxLabel.textContent = maxUserCount.toString();

          // Add middle tick if range is large enough
          if (maxUserCount - minUserCount > 3) {
            const midUserCount = Math.round((minUserCount + maxUserCount) / 2);
            const midLabel = L.DomUtil.create('div', 'legend-tick', labelsContainer);
            midLabel.style.cssText = `
              position: absolute;
              left: 55%;
              top: 2px;
              font-size: 10px;
            `;
            midLabel.textContent = midUserCount.toString();
          }
        }

        return div;
      };

      legend.addTo(map);
    },

    /**
     * Create a horizontal continuous legend for the label count map
     * @param {Object} map - The Leaflet map object
     * @param {number} minLabelCount - Minimum label count found in the data (excluding 0)
     * @param {number} maxLabelCount - Maximum label count found in the data
     */
    createContinuousLabelCountLegend: function(map, minLabelCount, maxLabelCount) {
      const legend = L.control({position: 'topright'});

      legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'info legend continuous-legend');

        // Create horizontal gradient legend
        div.innerHTML = '<h4>Labels per Street</h4>';

        // Create gradient container
        const gradientContainer = L.DomUtil.create('div', 'gradient-container', div);
        gradientContainer.style.cssText = `
          width: 200px;
          height: 20px;
          position: relative;
          border: 1px solid #ccc;
          border-radius: 3px;
          margin: 5px 0;
        `;

        // Create gradient bar with continuous interpolation
        const gradientBar = L.DomUtil.create('div', 'gradient-bar', gradientContainer);

        // Create smooth gradient from zero (special) to min to max
        const gradientStops = [];
        const numStops = 20; // More stops for smoother gradient

        // Add no labels color at start
        gradientStops.push(`${labelCountColorEndpoints.noLabels} 0%`);

        // Create continuous gradient from min to max labels
        for (let i = 1; i <= numStops; i++) {
          const factor = (i - 1) / (numStops - 1);
          const color = window.StreetsPreview.interpolateColor(
            labelCountColorEndpoints.minLabels,
            labelCountColorEndpoints.maxLabels,
            factor
          );
          const position = 10 + (factor * 90); // Start at 10% to leave room for zero
          gradientStops.push(`${color} ${position}%`);
        }

        gradientBar.style.cssText = `
          width: 100%;
          height: 100%;
          background: linear-gradient(to right, ${gradientStops.join(', ')});
          border-radius: 2px;
        `;

        // Add tick marks and labels
        const labelsContainer = L.DomUtil.create('div', 'legend-labels', div);
        labelsContainer.style.cssText = `
          width: 200px;
          height: 20px;
          position: relative;
          font-size: 11px;
          color: #333;
        `;

        // Add special label for 0 labels
        const zeroLabel = L.DomUtil.create('div', 'legend-tick', labelsContainer);
        zeroLabel.style.cssText = `
          position: absolute;
          left: 0;
          top: 2px;
          font-size: 10px;
          font-weight: bold;
        `;
        zeroLabel.textContent = '0';

        // Add tick marks for min and max
        if (maxLabelCount > minLabelCount) {
          const minLabel = L.DomUtil.create('div', 'legend-tick', labelsContainer);
          minLabel.style.cssText = `
            position: absolute;
            left: 10%;
            top: 2px;
            font-size: 10px;
          `;
          minLabel.textContent = minLabelCount.toString();

          const maxLabel = L.DomUtil.create('div', 'legend-tick', labelsContainer);
          maxLabel.style.cssText = `
            position: absolute;
            right: 0;
            top: 2px;
            font-size: 10px;
          `;
          maxLabel.textContent = maxLabelCount.toString();

          // Add middle tick if range is large enough
          if (maxLabelCount - minLabelCount > 5) {
            const midLabelCount = Math.round((minLabelCount + maxLabelCount) / 2);
            const midLabel = L.DomUtil.create('div', 'legend-tick', labelsContainer);
            midLabel.style.cssText = `
              position: absolute;
              left: 55%;
              top: 2px;
              font-size: 10px;
            `;
            midLabel.textContent = midLabelCount.toString();
          }
        }

        return div;
      };

      legend.addTo(map);
    },

    /**
     * Create a horizontal continuous legend for the audit age map
     * @param {Object} map - The Leaflet map object
     * @param {number} minDays - Minimum days since audit found in the data
     * @param {number} maxDays - Maximum days since audit found in the data
     */
    createContinuousAuditAgeLegend: function(map, minDays, maxDays) {
      const legend = L.control({position: 'topright'});

      legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'info legend continuous-legend');

        // Create horizontal gradient legend
        div.innerHTML = '<h4>Audit Age</h4>';

        // Create gradient container
        const gradientContainer = L.DomUtil.create('div', 'gradient-container', div);
        gradientContainer.style.cssText = `
          width: 200px;
          height: 20px;
          position: relative;
          border: 1px solid #ccc;
          border-radius: 3px;
          margin: 5px 0;
        `;

        // Create gradient bar with continuous interpolation
        const gradientBar = L.DomUtil.create('div', 'gradient-bar', gradientContainer);

        // Create smooth gradient from newest to oldest
        const gradientStops = [];
        const numStops = 20; // More stops for smoother gradient

        for (let i = 0; i <= numStops; i++) {
          const factor = i / numStops;
          const color = window.StreetsPreview.interpolateColor(
            auditAgeColorEndpoints.newest,
            auditAgeColorEndpoints.oldest,
            factor
          );
          const position = factor * 100;
          gradientStops.push(`${color} ${position}%`);
        }

        gradientBar.style.cssText = `
          width: 100%;
          height: 100%;
          background: linear-gradient(to right, ${gradientStops.join(', ')});
          border-radius: 2px;
        `;

        // Add tick marks and labels
        const labelsContainer = L.DomUtil.create('div', 'legend-labels', div);
        labelsContainer.style.cssText = `
          width: 200px;
          height: 20px;
          position: relative;
          font-size: 11px;
          color: #333;
        `;

        // Helper function to format days to human readable
        const formatDaysLabel = (days) => {
          if (days < 30) return `${Math.round(days)}d`;
          if (days < 365) return `${Math.round(days / 30)}m`;
          return `${Math.round(days / 365)}y`;
        };

        // Add labels for newest (left) and oldest (right)
        const newestLabel = L.DomUtil.create('div', 'legend-tick', labelsContainer);
        newestLabel.style.cssText = `
          position: absolute;
          left: 0;
          top: 2px;
          font-size: 10px;
        `;
        newestLabel.textContent = "Today"; //formatDaysLabel(minDays);

        const oldestLabel = L.DomUtil.create('div', 'legend-tick', labelsContainer);
        oldestLabel.style.cssText = `
          position: absolute;
          right: 0;
          top: 2px;
          font-size: 10px;
        `;
        oldestLabel.textContent = formatDaysLabel(maxDays);

        // Add middle tick if range is large enough
        if (maxDays - minDays > 90) {
          const midDays = (minDays + maxDays) / 2;
          const midLabel = L.DomUtil.create('div', 'legend-tick', labelsContainer);
          midLabel.style.cssText = `
            position: absolute;
            left: 50%;
            top: 2px;
            font-size: 10px;
            transform: translateX(-50%);
          `;
          midLabel.textContent = formatDaysLabel(midDays);
        }

        // Add special indicator for never audited
        const specialContainer = L.DomUtil.create('div', 'special-legend-item', div);
        specialContainer.style.cssText = `
          display: flex;
          align-items: center;
          margin-top: 5px;
          font-size: 11px;
        `;

        const neverAuditedColor = L.DomUtil.create('div', 'legend-color', specialContainer);
        neverAuditedColor.style.cssText = `
          width: 15px;
          height: 3px;
          background-color: ${auditAgeColorEndpoints.neverAudited};
          margin-right: 5px;
        `;
        const neverAuditedLabel = L.DomUtil.create('span', '', specialContainer);
        neverAuditedLabel.textContent = 'Never audited';

        return div;
      };

      legend.addTo(map);
    },

    /**
     * Add summary statistics panel for user count map
     * @param {Object} map - The Leaflet map object
     * @param {Object} stats - Statistics about the streets shown
     */
    addUserCountStats: function(map, stats) {
      const statsControl = L.control({position: 'bottomright'});

      statsControl.onAdd = function() {
        const div = L.DomUtil.create('div', 'info stats-summary');

        const totalStreets = stats.unaudited + stats.audited;
        const auditedPercent = totalStreets > 0 ?
          Math.round((stats.audited / totalStreets) * 100) : 0;

        div.innerHTML = `
          <h4>Summary</h4>
          <div><strong>Total Streets:</strong> ${totalStreets}</div>
          <div><strong>Audited:</strong> ${auditedPercent}%</div>
          <div><strong>Total Labels:</strong> ${stats.totalLabels}</div>
          <div><strong>Way Types:</strong> ${stats.wayTypes.size}</div>
        `;

        return div;
      };

      statsControl.addTo(map);
    },

    /**
     * Add summary statistics panel for label count map
     * @param {Object} map - The Leaflet map object
     * @param {Object} stats - Statistics about the streets shown
     */
    addLabelCountStats: function(map, stats) {
      const statsControl = L.control({position: 'bottomright'});

      statsControl.onAdd = function() {
        const div = L.DomUtil.create('div', 'info stats-summary');

        const totalStreets = stats.unaudited + stats.audited;
        const auditedPercent = totalStreets > 0 ?
          Math.round((stats.audited / totalStreets) * 100) : 0;
        const avgLabels = stats.audited > 0 ?
          Math.round(stats.totalLabels / stats.audited) : 0;

        div.innerHTML = `
          <h4>Summary</h4>
          <div><strong>Total Streets:</strong> ${totalStreets}</div>
          <div><strong>Audited:</strong> ${auditedPercent}%</div>
          <div><strong>Total Labels:</strong> ${stats.totalLabels}</div>
          <div><strong>Avg. Labels:</strong> ${avgLabels}</div>
        `;

        return div;
      };

      statsControl.addTo(map);
    },

    /**
     * Add summary statistics panel for audit age map
     * @param {Object} map - The Leaflet map object
     * @param {Object} stats - Statistics about the streets shown
     */
    addAuditAgeStats: function(map, stats) {
      const statsControl = L.control({position: 'bottomright'});

      statsControl.onAdd = function() {
        const div = L.DomUtil.create('div', 'info stats-summary');

        const totalStreets = stats.unaudited + stats.audited;
        const auditedPercent = totalStreets > 0 ?
          Math.round((stats.audited / totalStreets) * 100) : 0;

        const avgAgeText = stats.avgAge !== null ?
          stats.avgAge < 30 ? `${stats.avgAge} days` :
          stats.avgAge < 365 ? `${Math.round(stats.avgAge / 30)} months` :
          `${Math.round(stats.avgAge / 365)} years` : 'N/A';

        div.innerHTML = `
          <h4>Summary</h4>
          <div><strong>Total Streets:</strong> ${totalStreets}</div>
          <div><strong>Audited:</strong> ${auditedPercent}%</div>
          <div><strong>Avg. Age:</strong> ${avgAgeText}</div>
          <div><strong>Way Types:</strong> ${stats.wayTypes.size}</div>
        `;

        return div;
      };

      statsControl.addTo(map);
    }
  };
})();