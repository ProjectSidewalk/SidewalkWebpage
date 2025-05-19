/**
 * Streets Map Preview Generator
 * 
 * This script generates a live map preview of Project Sidewalk street segments
 * by fetching data directly from the Streets API.
 * 
 * @requires DOM element with id 'streets-preview'
 * @requires Leaflet.js library
 */

(function() {
  // Configuration options - can be overridden by calling setup()
  let config = {
    apiBaseUrl: "/v3/api",
    containerId: "streets-preview",
    mapHeight: 500,
    streetsEndpoint: "/streets",
    regionWithMostLabelsEndpoint: "/regionWithMostLabels"
  };

  // Color scheme for different audit levels
  const auditColorScheme = {
    none: '#cccccc',      // Gray for unaudited streets
    low: '#ffeda0',       // Light yellow for 1-2 audits
    medium: '#fd8d3c',    // Orange for 3-5 audits  
    high: '#bd0026'       // Red for 6+ audits
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
     * Initialize the streets preview map
     * @returns {Promise} A promise that resolves when the preview is rendered
     */
    init: function() {
      const container = document.getElementById(config.containerId);
      
      if (!container) {
        console.error(`Container element with id '${config.containerId}' not found.`);
        return Promise.reject(new Error("Container element not found"));
      }

      // Set height for the map container
      container.style.height = `${config.mapHeight}px`;
      container.style.width = "100%";
      container.style.margin = "20px 0";
      
      // Initialize with loading message
      const loadingMessage = document.createElement('div');
      loadingMessage.className = 'loading-message';
      loadingMessage.textContent = "Loading streets data...";
      container.appendChild(loadingMessage);
      
      // First get region with most labels, then load streets
      return this.fetchRegionWithMostLabels()
        .then(regionData => {
          // Create and initialize the map
          container.innerHTML = "";
          const map = this.createMap(container, regionData);
          
          // Fetch and display streets using region_id instead of bounding box
          return this.fetchStreetsByRegionId(regionData.region_id)
            .then(streets => this.displayStreetsOnMap(map, streets, regionData));
        })
        .catch(error => {
          container.innerHTML = `<div class="message message-error">Failed to load streets: ${error.message}</div>`;
          console.error("Streets preview error:", error);
          return Promise.reject(error);
        });
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
     * Extract a bounding box from region geometry
     * @param {Object} region - Region data with geometry
     * @returns {string} Bounding box string (minLon,minLat,maxLon,maxLat)
     */
    getBoundingBoxFromRegion: function(region) {
      if (!region || !region.geometry) {
        throw new Error("Invalid region data");
      }
      
      // Extract coordinates from the geometry
      let allCoords = [];
      
      if (region.geometry.type === "MultiPolygon") {
        // MultiPolygon: extract all points from all polygons
        region.geometry.coordinates.forEach(polygon => {
          polygon.forEach(ring => {
            allCoords = allCoords.concat(ring);
          });
        });
      } else if (region.geometry.type === "Polygon") {
        // Polygon: extract all points from all rings
        region.geometry.coordinates.forEach(ring => {
          allCoords = allCoords.concat(ring);
        });
      }
      
      // Calculate min/max values
      const lons = allCoords.map(coord => coord[0]);
      const lats = allCoords.map(coord => coord[1]);
      
      const minLon = Math.min(...lons);
      const minLat = Math.min(...lats);
      const maxLon = Math.max(...lons);
      const maxLat = Math.max(...lats);
      
      // Return as a comma-separated string
      return `${minLon},${minLat},${maxLon},${maxLat}`;
    },

    /**
     * Calculate center of a region from its geometry
     * @param {Object} region - Region data with geometry
     * @returns {Array} [lat, lon] center coordinates
     */
    getCenterFromRegion: function(region) {
      const bbox = this.getBoundingBoxFromRegion(region).split(',').map(Number);
      const centerLon = (bbox[0] + bbox[2]) / 2;
      const centerLat = (bbox[1] + bbox[3]) / 2;
      return [centerLat, centerLon]; // Leaflet uses [lat, lon] format
    },

    /**
     * Fetch streets by region ID instead of bounding box
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
     * Create the Leaflet map
     * @param {HTMLElement} container - Container element for the map
     * @param {Object} regionData - Data about the region to display
     * @returns {Object} The Leaflet map object
     */
    createMap: function(container, regionData) {
      // Create a map element
      const mapElement = document.createElement('div');
      mapElement.id = "streets-map";
      mapElement.className = 'map-container';
      container.appendChild(mapElement);
      
      // Calculate center and zoom
      const center = this.getCenterFromRegion(regionData);
      
      // Create the map
      const map = L.map('streets-map').setView(center, 16); // Start with zoom level 16
      
      // Add the OpenStreetMap tile layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);
      
      // Add region outline
      if (regionData.geometry) {
        const regionLayer = L.geoJSON(regionData.geometry, {
          style: {
            color: '#0077cc',
            weight: 2,
            opacity: 0.7,
            fillOpacity: 0.1,
            fillColor: '#0077cc'
          }
        }).addTo(map);
        
        // Fit map to region bounds with some padding
        map.fitBounds(regionLayer.getBounds(), { padding: [10, 10] });
      }
      
      // Add region title
      const regionTitle = L.control({position: 'topright'});
      regionTitle.onAdd = function() {
        const div = L.DomUtil.create('div', 'region-title');
        div.innerHTML = `<strong>Region:</strong> ${regionData.name || 'Sample Region'}`;
        div.style.backgroundColor = 'white';
        div.style.padding = '5px 10px';
        div.style.borderRadius = '4px';
        div.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)';
        return div;
      };
      regionTitle.addTo(map);
      
      return map;
    },

    /**
     * Determine the color and weight for a street based on its audit count
     * @param {number} auditCount - Number of audits for the street
     * @param {number} labelCount - Number of labels on the street
     * @returns {Object} Style object with color and weight
     */
    getStreetStyle: function(auditCount, labelCount) {
      let color = auditColorScheme.none;
      let weight = 2;
      let opacity = 0.6;
      
      if (auditCount === 0) {
        color = auditColorScheme.none;
        weight = 1;
        opacity = 0.4;
      } else if (auditCount >= 1 && auditCount <= 2) {
        color = auditColorScheme.low;
        weight = 2;
        opacity = 0.6;
      } else if (auditCount >= 3 && auditCount <= 5) {
        color = auditColorScheme.medium;
        weight = 3;
        opacity = 0.7;
      } else if (auditCount >= 6) {
        color = auditColorScheme.high;
        weight = 4;
        opacity = 0.8;
      }
      
      // Increase weight slightly if street has many labels
      if (labelCount > 10) {
        weight += 1;
      }
      
      return { color: color, weight: weight, opacity: opacity };
    },

    /**
     * Display streets on the map
     * @param {Object} map - The Leaflet map object
     * @param {Object} streets - GeoJSON data containing the street segments
     * @param {Object} regionData - Data about the region being displayed
     */
    displayStreetsOnMap: function(map, streets, regionData) {
      if (!streets.features || streets.features.length === 0) {
        // Add a message to the map if no streets found
        const noStreetsDiv = document.createElement('div');
        noStreetsDiv.className = 'no-streets-message';
        noStreetsDiv.textContent = `No streets found in this region.`;
        noStreetsDiv.style.position = 'absolute';
        noStreetsDiv.style.top = '10px';
        noStreetsDiv.style.left = '50%';
        noStreetsDiv.style.transform = 'translateX(-50%)';
        noStreetsDiv.style.backgroundColor = 'white';
        noStreetsDiv.style.padding = '5px 10px';
        noStreetsDiv.style.borderRadius = '3px';
        noStreetsDiv.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)';
        noStreetsDiv.style.zIndex = '1000';
        map.getContainer().appendChild(noStreetsDiv);
        return;
      }
      
      // Add a counter of streets shown
      const countDiv = document.createElement('div');
      countDiv.className = 'street-count';
      countDiv.textContent = `Showing ${streets.features.length} street segments`;
      countDiv.className = 'counter-badge';
      map.getContainer().appendChild(countDiv);
      
      // Create a legend for the audit levels
      this.createLegend(map);
      
      // Track statistics for summary display
      const stats = {
        unaudited: 0,
        audited: 0,
        multipleAudits: 0,
        totalLabels: 0,
        wayTypes: new Set()
      };
      
      // Add the streets to the map
      L.geoJSON(streets, {
        style: (feature) => {
          const auditCount = feature.properties.audit_count || 0;
          const labelCount = feature.properties.label_count || 0;
          const wayType = feature.properties.way_type;
          
          // Update statistics
          stats.wayTypes.add(wayType);
          stats.totalLabels += labelCount;
          
          if (auditCount === 0) {
            stats.unaudited++;
          } else if (auditCount === 1) {
            stats.audited++;
          } else {
            stats.multipleAudits++;
          }
          
          // Get style based on audit count
          const streetStyle = this.getStreetStyle(auditCount, labelCount);
          
          return {
            color: streetStyle.color,
            weight: streetStyle.weight,
            opacity: streetStyle.opacity,
            fillOpacity: 0
          };
        },
        onEachFeature: (feature, layer) => {
          // Create popup content
          const props = feature.properties;
          const auditCount = props.audit_count || 0;
          const labelCount = props.label_count || 0;
          const userCount = props.user_count || 0;
          const wayType = props.way_type || 'Unknown';
          const firstLabelDate = props.first_label_date ? 
            new Date(props.first_label_date).toLocaleDateString() : 'No labels';
          const lastLabelDate = props.last_label_date ? 
            new Date(props.last_label_date).toLocaleDateString() : 'No labels';
          
          const auditStatus = auditCount === 0 ? 'Unaudited' : 
                             auditCount === 1 ? 'Audited once' : 
                             `Audited ${auditCount} times`;
          
          layer.bindPopup(`
            <div class="street-popup">
              <h4>Street Segment ${props.street_edge_id}</h4>
              <p><strong>Type:</strong> ${wayType}</p>
              <p><strong>Status:</strong> ${auditStatus}</p>
              <p><strong>Labels:</strong> ${labelCount} (from ${userCount} users)</p>
              <p><strong>First Label:</strong> ${firstLabelDate}</p>
              <p><strong>Last Label:</strong> ${lastLabelDate}</p>
              <p><strong>OSM ID:</strong> ${props.osm_street_id || 'N/A'}</p>
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
      
      // Add summary statistics
      this.addStatsSummary(map, stats);
    },
    
    /**
     * Create a legend for the map
     * @param {Object} map - The Leaflet map object
     */
    createLegend: function(map) {
      const legend = L.control({position: 'bottomleft'});
      
      legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'info legend');
        div.id = 'streets-legend';
        div.style.backgroundColor = 'white';
        div.style.padding = '6px 8px';
        div.style.borderRadius = '4px';
        div.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)';
        div.style.lineHeight = '18px';
        div.style.color = '#555';
        
        const grades = [
          { label: 'Unaudited', color: auditColorScheme.none, weight: 1 },
          { label: '1-2 audits', color: auditColorScheme.low, weight: 2 },
          { label: '3-5 audits', color: auditColorScheme.medium, weight: 3 },
          { label: '6+ audits', color: auditColorScheme.high, weight: 4 }
        ];
        
        div.innerHTML = '<h4 style="margin: 0 0 5px; font-size: 14px;">Audit Levels</h4>';
        
        grades.forEach(grade => {
          div.innerHTML += `
            <div style="margin: 3px 0; display: flex; align-items: center;">
              <div style="width: 20px; height: ${grade.weight}px; background-color: ${grade.color}; margin-right: 8px; border: 1px solid #ccc;"></div>
              <span style="font-size: 12px;">${grade.label}</span>
            </div>
          `;
        });
        
        return div;
      };
      
      legend.addTo(map);
    },
    
    /**
     * Add a summary statistics panel to the map
     * @param {Object} map - The Leaflet map object
     * @param {Object} stats - Statistics about the streets shown
     */
    addStatsSummary: function(map, stats) {
      const statsControl = L.control({position: 'bottomright'});
      
      statsControl.onAdd = function() {
        const div = L.DomUtil.create('div', 'info stats-summary');
        div.style.backgroundColor = 'white';
        div.style.padding = '6px 8px';
        div.style.borderRadius = '4px';
        div.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)';
        div.style.lineHeight = '16px';
        div.style.color = '#555';
        div.style.fontSize = '12px';
        
        const totalStreets = stats.unaudited + stats.audited + stats.multipleAudits;
        const auditedPercent = totalStreets > 0 ? 
          Math.round(((stats.audited + stats.multipleAudits) / totalStreets) * 100) : 0;
        
        div.innerHTML = `
          <h4 style="margin: 0 0 5px; font-size: 14px;">Summary</h4>
          <div><strong>Total Streets:</strong> ${totalStreets}</div>
          <div><strong>Audited:</strong> ${auditedPercent}%</div>
          <div><strong>Total Labels:</strong> ${stats.totalLabels}</div>
          <div><strong>Way Types:</strong> ${stats.wayTypes.size}</div>
        `;
        
        return div;
      };
      
      statsControl.addTo(map);
    }
  };
})();