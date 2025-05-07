/**
 * Project Sidewalk Cities Map Preview Generator
 * 
 * This script generates a live map preview of Project Sidewalk deployment cities
 * by fetching data directly from the Cities API.
 * 
 * @requires DOM element with id 'cities-preview'
 * @requires Leaflet.js library
 */

(function() {
  // Configuration options - can be overridden by calling setup()
  let config = {
    // Base API URL - will be updated to production URL in production
    apiBaseUrl: "http://localhost:9000/v3/api",
    // apiBaseUrl: "https://api.projectsidewalk.org/v3/api",
    containerId: "cities-preview",
    mapHeight: 500,
    citiesEndpoint: "/cities"
  };

  // Store country-specific styling information
  const countryStyles = {
    usa: { 
      color: "#3388ff", 
      fillColor: "#3388ff" 
    },
    mexico: { 
      color: "#ff8833", 
      fillColor: "#ff8833" 
    },
    canada: { 
      color: "#33ff88", 
      fillColor: "#33ff88" 
    },
    netherlands: { 
      color: "#ff3388", 
      fillColor: "#ff3388" 
    },
    switzerland: { 
      color: "#8833ff", 
      fillColor: "#8833ff" 
    },
    taiwan: { 
      color: "#88ff33", 
      fillColor: "#88ff33" 
    },
    "new-zealand": { 
      color: "#ff3333", 
      fillColor: "#ff3333" 
    },
    ecuador: { 
      color: "#33ffff", 
      fillColor: "#33ffff" 
    },
    // Default style for countries not explicitly defined
    default: { 
      color: "#888888", 
      fillColor: "#888888" 
    }
  };

  // Public API
  window.CitiesPreview = {
    /**
     * Configure the cities preview
     * @param {Object} options - Configuration options
     * @returns {Object} The CitiesPreview object for chaining
     */
    setup: function(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Initialize the cities preview map
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
      loadingMessage.textContent = "Loading cities data...";
      container.appendChild(loadingMessage);
      
      // Fetch cities data and create the map
      return this.fetchCities()
        .then(citiesData => {
          // Create and initialize the map
          container.innerHTML = "";
          const map = this.createMap(container);
          
          // Display cities on the map
          this.displayCitiesOnMap(map, citiesData);
          
          return map;
        })
        .catch(error => {
          container.innerHTML = `<div class="error-message">Failed to load cities data: ${error.message}</div>`;
          console.error("Cities preview error:", error);
          return Promise.reject(error);
        });
    },

    /**
     * Fetch cities data from the API
     * @returns {Promise} A promise that resolves with the cities data
     */
    fetchCities: function() {
      return fetch(`${config.apiBaseUrl}${config.citiesEndpoint}`)
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
     * @returns {Object} The Leaflet map object
     */
    createMap: function(container) {
      // Create a map element
      const mapElement = document.createElement('div');
      mapElement.id = "cities-map";
      mapElement.style.height = "100%";
      container.appendChild(mapElement);
      
      // Create the map, centered on the world
      const map = L.map('cities-map').setView([20, 0], 2);
      
      // Add the OpenStreetMap tile layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);
      
      return map;
    },

    /**
     * Display cities on the map
     * @param {Object} map - The Leaflet map object
     * @param {Object} citiesData - Data about the cities from the API
     */
    displayCitiesOnMap: function(map, citiesData) {
      if (!citiesData || !citiesData.cities || citiesData.cities.length === 0) {
        // Add a message to the map if no cities found
        const noCitiesDiv = document.createElement('div');
        noCitiesDiv.className = 'no-cities-message';
        noCitiesDiv.textContent = "No cities found.";
        noCitiesDiv.style.position = 'absolute';
        noCitiesDiv.style.top = '10px';
        noCitiesDiv.style.left = '50%';
        noCitiesDiv.style.transform = 'translateX(-50%)';
        noCitiesDiv.style.backgroundColor = 'white';
        noCitiesDiv.style.padding = '5px 10px';
        noCitiesDiv.style.borderRadius = '3px';
        noCitiesDiv.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)';
        noCitiesDiv.style.zIndex = '1000';
        map.getContainer().appendChild(noCitiesDiv);
        return;
      }
      
      // Filter cities with geographic information
      const citiesWithGeo = citiesData.cities.filter(city => 
        city.centerLat !== undefined && city.centerLng !== undefined
      );
      
      // Add a counter of displayed cities
      const countDiv = document.createElement('div');
      countDiv.className = 'cities-count';
      countDiv.textContent = `Showing ${citiesWithGeo.length} of ${citiesData.cities.length} cities`;
      countDiv.style.position = 'absolute';
      countDiv.style.bottom = '10px';
      countDiv.style.right = '10px';
      countDiv.style.backgroundColor = 'white';
      countDiv.style.padding = '5px 10px';
      countDiv.style.borderRadius = '3px';
      countDiv.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)';
      countDiv.style.zIndex = '1000';
      map.getContainer().appendChild(countDiv);
      
      // Add country legend
      this.createLegend(map);
      
      // Track which countries are present in the data
      const countriesInData = new Set();
      
      // Create markers for cities with geographic information
      const cityMarkers = [];
      
      citiesWithGeo.forEach(city => {
        // Get style for this city's country
        const countryId = city.countryId || "default";
        countriesInData.add(countryId);
        
        const style = countryStyles[countryId] || countryStyles.default;
        
        // Create a marker for this city
        const marker = L.circleMarker([city.centerLat, city.centerLng], {
          radius: city.visibility === "public" ? 7 : 5, // Slightly smaller for private cities
          fillColor: style.fillColor,
          color: "#000",
          weight: 1,
          opacity: 1,
          fillOpacity: city.visibility === "public" ? 0.8 : 0.5 // More transparent for private cities
        });
        
        // Add popup with city information
        marker.bindPopup(`
          <div class="city-popup">
            <h3>${city.cityNameFormatted}</h3>
            <p><strong>Status:</strong> ${city.visibility === "public" ? "Public" : "Private"}</p>
            <p><a href="${city.url}" target="_blank" class="city-link">Open Project Sidewalk</a></p>
          </div>
        `);
        
        // Add tooltip with city name for hover effect
        marker.bindTooltip(city.cityNameFormatted, {
          permanent: false,
          direction: 'top',
          offset: [0, -10]
        });
        
        // Add marker to map
        marker.addTo(map);
        cityMarkers.push(marker);
      });
      
      // If we have city markers, fit map bounds to show all cities
      if (cityMarkers.length > 0) {
        const group = L.featureGroup(cityMarkers);
        map.fitBounds(group.getBounds(), {
          padding: [30, 30]
        });
      }
      
      // Update legend to show only countries that are in the data
      this.updateLegend(map, Array.from(countriesInData));
    },
    
    /**
     * Create a legend for the map
     * @param {Object} map - The Leaflet map object
     */
    createLegend: function(map) {
      const legend = L.control({position: 'bottomleft'});
      
      legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'info legend');
        div.id = 'cities-legend';
        div.style.backgroundColor = 'white';
        div.style.padding = '6px 8px';
        div.style.borderRadius = '4px';
        div.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)';
        div.style.maxHeight = '300px';
        div.style.overflowY = 'auto';
        
        div.innerHTML = '<h4 style="margin: 0 0 5px; font-size: 14px;">Countries</h4>';
        
        return div;
      };
      
      legend.addTo(map);
    },
    
    /**
     * Update the legend to show only countries present in the data
     * @param {Object} map - The Leaflet map object
     * @param {Array} countriesInData - Array of country IDs found in the data
     */
    updateLegend: function(map, countriesInData) {
      const legendDiv = document.getElementById('cities-legend');
      if (!legendDiv) return;
      
      // Keep the header
      legendDiv.innerHTML = '<h4 style="margin: 0 0 5px; font-size: 14px;">Countries</h4>';
      
      // Create a mapping of country IDs to human-readable names
      const countryNames = {
        'usa': 'United States',
        'mexico': 'Mexico',
        'canada': 'Canada',
        'netherlands': 'Netherlands',
        'switzerland': 'Switzerland',
        'taiwan': 'Taiwan',
        'new-zealand': 'New Zealand',
        'ecuador': 'Ecuador'
      };
      
      // Add the countries present in the data
      countriesInData.forEach(countryId => {
        const style = countryStyles[countryId] || countryStyles.default;
        const countryName = countryNames[countryId] || countryId.charAt(0).toUpperCase() + countryId.slice(1);
        
        legendDiv.innerHTML += `
          <div style="margin: 3px 0;">
            <i style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: ${style.fillColor}; margin-right: 5px;"></i>
            ${countryName}
          </div>
        `;
      });
      
      // If no countries were found, show a message
      if (countriesInData.length === 0) {
        legendDiv.innerHTML += '<div>No countries with geographic data</div>';
      }
      
      // Add legend entries for public vs private cities
      legendDiv.innerHTML += `
        <h4 style="margin: 10px 0 5px; font-size: 14px;">Visibility</h4>
        <div style="margin: 3px 0;">
          <i style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; opacity: 0.8; background-color: #888; margin-right: 5px;"></i>
          Public
        </div>
        <div style="margin: 3px 0;">
          <i style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; opacity: 0.5; background-color: #888; margin-right: 5px;"></i>
          Private
        </div>
      `;
    }
  };
})();