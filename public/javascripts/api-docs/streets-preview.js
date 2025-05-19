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

  // Enhanced color scheme for user counts using viridis palette (dark background optimized)
  const userCountColors = [
    '#3d3d3d', // 0 users (dark gray for visibility on dark background)
    '#472c7a', // 1 user (dark purple)
    '#3b518b', // 2 users (purple-blue)
    '#2c6fbb', // 3 users (blue)
    '#218f8d', // 4 users (teal)
    '#5cb85c', // 5 users (green)
    '#a2d045', // 6 users (lime green)
    '#e3e619', // 7 users (yellow)
    '#fde725', // 8 users (bright yellow)
    '#ffffff'  // 9+ users (white for maximum contrast)
  ];

  // Enhanced color scheme for label counts using plasma palette (dark background optimized)
  const labelCountColors = [
    '#3d3d3d', // 0 labels (dark gray)
    '#440154', // 1-5 labels (dark purple)
    '#5d2a7a', // 6-10 labels (purple)
    '#7e3794', // 11-15 labels (purple-magenta)
    '#a2477d', // 16-20 labels (magenta-red)
    '#c85a5c', // 21-25 labels (red-orange)
    '#e87244', // 26-30 labels (orange)
    '#fd9a44', // 31-35 labels (orange-yellow)
    '#fed439', // 36-40 labels (yellow)
    '#f0f921'  // 41+ labels (bright yellow)
  ];

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

  // Enhanced color scheme for audit age using RdYlGn reversed (dark background optimized)
  const auditAgeColors = {
    veryOld: '#ff4444',    // Bright red for very old (>2 years)
    old: '#ff8844',        // Orange-red for old (1-2 years)
    medium: '#ffdd44',     // Orange for medium (6 months - 1 year)
    recent: '#eeee44',     // Yellow for recent (3-6 months)
    veryRecent: '#88ee88', // Light green for very recent (1-3 months)
    newest: '#44ff44'      // Bright green for newest (<1 month)
  };

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
      const url = `${config.apiBaseUrl}${config.streetsEndpoint}?region_id=${regionId}`;
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
     * Get color for street based on user count
     * @param {number} userCount - Number of users who labeled the street
     * @returns {string} Hex color code
     */
    getUserCountColor: function(userCount) {
      if (userCount >= userCountColors.length - 1) {
        return userCountColors[userCountColors.length - 1];
      }
      return userCountColors[userCount];
    },

    /**
     * Get color for street based on label count
     * @param {number} labelCount - Number of labels on the street
     * @returns {string} Hex color code
     */
    getLabelCountColor: function(labelCount) {
      if (labelCount === 0) {
        return labelCountColors[0];
      }
      
      // Create color bands: 1-5, 6-10, 11-15, etc.
      const bandIndex = Math.min(Math.floor(labelCount / 5), labelCountColors.length - 2) + 1;
      return labelCountColors[bandIndex];
    },

    /**
     * Get color for street based on audit age (continuous scale)
     * @param {string|null} lastLabelDate - ISO date string of last label
     * @returns {string} Hex color code
     */
    getAuditAgeColor: function(lastLabelDate) {
      if (!lastLabelDate) {
        return '#333333'; // Dark gray for never audited
      }
      
      const now = new Date();
      const labelDate = new Date(lastLabelDate);
      const daysDiff = (now - labelDate) / (1000 * 60 * 60 * 24);
      
      if (daysDiff <= 30) {
        return auditAgeColors.newest;
      } else if (daysDiff <= 90) {
        const factor = (daysDiff - 30) / 60;
        return interpolateColor(auditAgeColors.newest, auditAgeColors.veryRecent, factor);
      } else if (daysDiff <= 180) {
        const factor = (daysDiff - 90) / 90;
        return interpolateColor(auditAgeColors.veryRecent, auditAgeColors.recent, factor);
      } else if (daysDiff <= 365) {
        const factor = (daysDiff - 180) / 185;
        return interpolateColor(auditAgeColors.recent, auditAgeColors.medium, factor);
      } else if (daysDiff <= 730) {
        const factor = (daysDiff - 365) / 365;
        return interpolateColor(auditAgeColors.medium, auditAgeColors.old, factor);
      } else {
        const factor = Math.min((daysDiff - 730) / 365, 1);
        return interpolateColor(auditAgeColors.old, auditAgeColors.veryOld, factor);
      }
    },

    /**
     * Format age for display
     * @param {string|null} lastLabelDate - ISO date string of last label
     * @returns {string} Human readable age string
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
        return `${Math.floor(daysDiff)} days ago`;
      } else if (daysDiff < 30) {
        return `${Math.floor(daysDiff / 7)} weeks ago`;
      } else if (daysDiff < 365) {
        return `${Math.floor(daysDiff / 30)} months ago`;
      } else {
        return `${Math.floor(daysDiff / 365)} years ago`;
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
      
      // Track statistics and max user count for legend
      const stats = { unaudited: 0, audited: 0, totalLabels: 0, wayTypes: new Set(), maxUserCount: 0 };
      
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
          stats.maxUserCount = Math.max(stats.maxUserCount, userCount);
          
          if (userCount === 0) {
            stats.unaudited++;
          } else {
            stats.audited++;
          }
          
          // Style based on user count
          const color = this.getUserCountColor(userCount);
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
      
      // Create legend for user count
      this.createUserCountLegend(map, stats.maxUserCount);
      
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
      
      // Track statistics for summary display
      const stats = { unaudited: 0, audited: 0, totalLabels: 0, wayTypes: new Set() };
      let totalDays = 0;
      let auditedCount = 0;
      
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
          
          // Style based on audit age
          const color = this.getAuditAgeColor(props.last_label_date);
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
      
      // Create legend for audit age
      this.createAuditAgeLegend(map);
      
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
      
      // Track statistics and max label count for legend
      const stats = { unaudited: 0, audited: 0, totalLabels: 0, wayTypes: new Set(), maxLabelCount: 0 };
      
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
          stats.maxLabelCount = Math.max(stats.maxLabelCount, labelCount);
          
          if (userCount === 0) {
            stats.unaudited++;
          } else {
            stats.audited++;
          }
          
          // Style based on label count
          const color = this.getLabelCountColor(labelCount);
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
      
      // Create legend for label count
      this.createLabelCountLegend(map, stats.maxLabelCount);
      
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
     * Create a legend for the user count map
     * @param {Object} map - The Leaflet map object
     * @param {number} maxUserCount - Maximum user count found in the data
     */
    createUserCountLegend: function(map, maxUserCount) {
      const legend = L.control({position: 'bottomleft'});
      
      legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'info legend streets-legend');
        
        div.innerHTML = '<h4>Users per Street</h4>';
        
        // Only show legend items up to the max user count found in data
        const maxToShow = Math.min(maxUserCount + 1, userCountColors.length);
        
        for (let i = 0; i < maxToShow; i++) {
          const label = i === userCountColors.length - 1 && maxUserCount >= i ? `${i}+` : i.toString();
          const userLabel = i === 0 ? 'users' : i === 1 ? 'user' : 'users';
          div.innerHTML += `
            <div class="legend-item">
              <div class="legend-line" style="width: 20px; height: 3px; background-color: ${userCountColors[i]};"></div>
              <span>${label} ${userLabel}</span>
            </div>
          `;
        }
        
        return div;
      };
      
      legend.addTo(map);
    },
    
    /**
     * Create a legend for the label count map
     * @param {Object} map - The Leaflet map object
     * @param {number} maxLabelCount - Maximum label count found in the data
     */
    createLabelCountLegend: function(map, maxLabelCount) {
      const legend = L.control({position: 'bottomleft'});
      
      legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'info legend streets-legend');
        
        div.innerHTML = '<h4>Labels per Street</h4>';
        
        // Create ranges based on actual data
        const ranges = [
          { min: 0, max: 0, color: labelCountColors[0], label: '0 labels' },
          { min: 1, max: 5, color: labelCountColors[1], label: '1-5 labels' },
          { min: 6, max: 10, color: labelCountColors[2], label: '6-10 labels' },
          { min: 11, max: 15, color: labelCountColors[3], label: '11-15 labels' },
          { min: 16, max: 20, color: labelCountColors[4], label: '16-20 labels' },
          { min: 21, max: 25, color: labelCountColors[5], label: '21-25 labels' },
          { min: 26, max: 30, color: labelCountColors[6], label: '26-30 labels' },
          { min: 31, max: 35, color: labelCountColors[7], label: '31-35 labels' },
          { min: 36, max: 40, color: labelCountColors[8], label: '36-40 labels' },
          { min: 41, max: Infinity, color: labelCountColors[9], label: '41+ labels' }
        ];
        
        // Only show ranges that are relevant to the data
        ranges.forEach(range => {
          if (range.max === 0 || (range.min <= maxLabelCount)) {
            div.innerHTML += `
              <div class="legend-item">
                <div class="legend-line" style="width: 20px; height: 3px; background-color: ${range.color};"></div>
                <span>${range.label}</span>
              </div>
            `;
          }
        });
        
        return div;
      };
      
      legend.addTo(map);
    },
    
    /**
     * Create a legend for the audit age map
     * @param {Object} map - The Leaflet map object
     */
    createAuditAgeLegend: function(map) {
      const legend = L.control({position: 'bottomleft'});
      
      legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'info legend streets-legend');
        
        div.innerHTML = '<h4>Audit Age</h4>';
        
        const ageRanges = [
          { label: 'Never audited', color: '#333333' },
          { label: '< 1 month', color: auditAgeColors.newest },
          { label: '1-3 months', color: auditAgeColors.veryRecent },
          { label: '3-6 months', color: auditAgeColors.recent },
          { label: '6-12 months', color: auditAgeColors.medium },
          { label: '1-2 years', color: auditAgeColors.old },
          { label: '> 2 years', color: auditAgeColors.veryOld }
        ];
        
        ageRanges.forEach(range => {
          div.innerHTML += `
            <div class="legend-item">
              <div class="legend-line" style="width: 20px; height: 3px; background-color: ${range.color};"></div>
              <span>${range.label}</span>
            </div>
          `;
        });
        
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