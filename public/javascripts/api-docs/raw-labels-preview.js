/**
 * Raw Labels Map Preview Generator
 * 
 * This script generates a live map preview of Project Sidewalk raw labels
 * by fetching data directly from the Raw Labels API.
 * 
 * @requires DOM element with id 'raw-labels-preview'
 * @requires Leaflet.js library
 */

(function() {
  // Configuration options - can be overridden by calling setup()
  let config = {
    // Update this to the production API URL when deploying
    apiBaseUrl: "http://localhost:9000/v3",
    // apiBaseUrl: "https://api.projectsidewalk.org/v3",
    containerId: "raw-labels-preview",
    mapHeight: 500,
    rawLabelsEndpoint: "/rawLabels",
    labelTypesEndpoint: "/labelTypes",
    regionWithMostLabelsEndpoint: "/regionWithMostLabels"
  };

  // Store label type information for coloring labels
  let labelTypeInfo = {};

  // Public API
  window.RawLabelsPreview = {
    /**
     * Configure the raw labels preview
     * @param {Object} options - Configuration options
     * @returns {Object} The RawLabelsPreview object for chaining
     */
    setup: function(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Initialize the raw labels preview map
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
      loadingMessage.textContent = "Loading raw labels data...";
      container.appendChild(loadingMessage);
      
      // First load label types, then get region with most labels, then load labels
      return this.fetchLabelTypes()
        .then(data => {
          // Store label type info for later use
          labelTypeInfo = data.labelTypes.reduce((acc, type) => {
            acc[type.name] = {
              color: type.color,
              description: type.description
            };
            return acc;
          }, {});

          return this.fetchRegionWithMostLabels();
        })
        .then(regionData => {
          // Create and initialize the map
          container.innerHTML = "";
          const map = this.createMap(container, regionData);
          
          // Fetch and display labels using region_id instead of bounding box
          return this.fetchLabelsByRegionId(regionData.region_id)
            .then(labels => this.displayLabelsOnMap(map, labels, regionData));
        })
        .catch(error => {
          container.innerHTML = `<div class="error-message">Failed to load raw labels: ${error.message}</div>`;
          console.error("Raw labels preview error:", error);
          return Promise.reject(error);
        });
    },

    /**
     * Fetch label types from the API
     * @returns {Promise} A promise that resolves with the label types data
     */
    fetchLabelTypes: function() {
      return fetch(`${config.apiBaseUrl}${config.labelTypesEndpoint}`)
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
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
     * Fetch labels by region ID instead of bounding box
     * @param {number} regionId - ID of the region
     * @returns {Promise} A promise that resolves with the labels data
     */
    fetchLabelsByRegionId: function(regionId) {
      const url = `${config.apiBaseUrl}${config.rawLabelsEndpoint}?region_id=${regionId}`;
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
      mapElement.id = "raw-labels-map";
      mapElement.style.height = "100%";
      container.appendChild(mapElement);
      
      // Calculate center and zoom
      const center = this.getCenterFromRegion(regionData);
      
      // Create the map
      const map = L.map('raw-labels-map').setView(center, 16); // Start with zoom level 16
      
      // Add the OpenStreetMap tile layer with darkened overlay
      // Add a darker map tile layer (CartoDB Dark Matter)
      // L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      //   attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      //   subdomains: 'abcd',
      //   maxZoom: 19
      // }).addTo(map);
      
      // Alternative approach - add a dark overlay on top of regular OSM tiles
      // Comment out the above and uncomment these lines if you prefer this approach
      
      // Base map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);
      
      // Dark overlay
      L.rectangle(
        [[-90, -180], [90, 180]], 
        {
          color: 'black',
          weight: 0,
          fillOpacity: 0.5,
          fillColor: 'black',
          interactive: false
        }
      ).addTo(map);
      
      
      // Add region outline
      if (regionData.geometry) {
        const regionLayer = L.geoJSON(regionData.geometry, {
          style: {
            color: '#0077cc',
            weight: 2,
            opacity: 0.7,
            fillOpacity: 0.1
          }
        }).addTo(map);
        
        // Fit map to region bounds
        map.fitBounds(regionLayer.getBounds());
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
     * Display labels on the map
     * @param {Object} map - The Leaflet map object
     * @param {Object} labels - GeoJSON data containing the labels
     * @param {Object} regionData - Data about the region being displayed
     */
    displayLabelsOnMap: function(map, labels, regionData) {
      if (!labels.features || labels.features.length === 0) {
        // Add a message to the map if no labels found
        const noLabelsDiv = document.createElement('div');
        noLabelsDiv.className = 'no-labels-message';
        noLabelsDiv.textContent = `No labels found in this region.`;
        noLabelsDiv.style.position = 'absolute';
        noLabelsDiv.style.top = '10px';
        noLabelsDiv.style.left = '50%';
        noLabelsDiv.style.transform = 'translateX(-50%)';
        noLabelsDiv.style.backgroundColor = 'white';
        noLabelsDiv.style.padding = '5px 10px';
        noLabelsDiv.style.borderRadius = '3px';
        noLabelsDiv.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)';
        noLabelsDiv.style.zIndex = '1000';
        map.getContainer().appendChild(noLabelsDiv);
        return;
      }
      
      // Add a counter of labels shown
      const countDiv = document.createElement('div');
      countDiv.className = 'label-count';
      countDiv.textContent = `Showing ${labels.features.length} labels`;
      countDiv.style.position = 'absolute';
      countDiv.style.bottom = '10px';
      countDiv.style.right = '10px';
      countDiv.style.backgroundColor = 'white';
      countDiv.style.padding = '5px 10px';
      countDiv.style.borderRadius = '3px';
      countDiv.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)';
      countDiv.style.zIndex = '1000';
      map.getContainer().appendChild(countDiv);
      
      // Create a legend for the label types
      this.createLegend(map);
      
      // Track unique label types found in this dataset
      const typesInData = new Set();
      
      // Add the labels to the map
      L.geoJSON(labels, {
        pointToLayer: (feature, latlng) => {
          const labelType = feature.properties.label_type;
          typesInData.add(labelType);
          
          const color = labelTypeInfo[labelType]?.color || '#999999';
          
          // Use fixed radius instead of scaling by severity
          const radius = 4; // Fixed radius for all markers
          
          return L.circleMarker(latlng, {
            radius: radius,
            fillColor: color,
            color: '#000',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.75
          });
        },
        onEachFeature: (feature, layer) => {
          // Create popup content
          const props = feature.properties;
          const severity = props.severity ? `Severity: ${props.severity}/5` : 'No severity rating';
          const tags = props.tags && props.tags.length ? `Tags: ${props.tags.join(', ')}` : 'No tags';
          const timeCreated = props.time_created ? new Date(props.time_created).toLocaleDateString() : 'Unknown date';
          
          let validationStatus = 'Not validated';
          if (props.correct === true) {
            validationStatus = `Validated (${props.agree_count} agree, ${props.disagree_count} disagree)`;
          } else if (props.correct === false) {
            validationStatus = `Invalidated (${props.agree_count} agree, ${props.disagree_count} disagree)`;
          }
          
          layer.bindPopup(`
            <div class="label-popup">
              <h4>${props.label_type}</h4>
              <p>${labelTypeInfo[props.label_type]?.description || ''}</p>
              <p>${severity}</p>
              <p>${tags}</p>
              <p>Created: ${timeCreated}</p>
              <p>${validationStatus}</p>
              <p>Label ID: ${props.label_id}</p>
            </div>
          `);
        }
      }).addTo(map);
      
      // Update legend to show only label types that are in the data
      this.updateLegend(map, Array.from(typesInData));
    },
    
    /**
     * Create a legend for the map
     * @param {Object} map - The Leaflet map object
     */
    createLegend: function(map) {
      const legend = L.control({position: 'bottomleft'});
      
      legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'info legend');
        div.id = 'raw-labels-legend';
        div.style.backgroundColor = 'white';
        div.style.padding = '6px 8px';
        div.style.borderRadius = '4px';
        div.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)';
        div.style.maxHeight = '300px';
        div.style.overflowY = 'auto';
        
        div.innerHTML = '<h4 style="margin: 0 0 5px; font-size: 14px;">Label Types</h4>';
        
        return div;
      };
      
      legend.addTo(map);
    },
    
    /**
     * Update the legend to show only label types present in the data
     * @param {Object} map - The Leaflet map object
     * @param {Array} typesInData - Array of label type names found in the data
     */
    updateLegend: function(map, typesInData) {
      const legendDiv = document.getElementById('raw-labels-legend');
      if (!legendDiv) return;
      
      // Keep the header
      legendDiv.innerHTML = '<h4 style="margin: 0 0 5px; font-size: 14px;">Label Types</h4>';
      
      // First add the types present in the data
      typesInData.forEach(name => {
        if (labelTypeInfo[name]) {
          legendDiv.innerHTML += `
            <div style="margin: 3px 0;">
              <i style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: ${labelTypeInfo[name].color}; margin-right: 5px;"></i>
              ${name}
            </div>
          `;
        }
      });
      
      // If no types were found, show a message
      if (typesInData.length === 0) {
        legendDiv.innerHTML += '<div>No labels in this region</div>';
      }
    }
  };
})();