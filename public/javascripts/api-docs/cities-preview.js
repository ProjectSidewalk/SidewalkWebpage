/**
 * Project Sidewalk Cities Map Preview Generator.
 *
 * This script generates a live map preview of PS deployment cities by fetching data directly from the Cities API.
 *
 * @requires DOM element with id 'cities-preview'
 * @requires Leaflet.js library
 */

(function() {
    // Configuration options - can be overridden by calling setup().
    let config = {
        apiBaseUrl: "/v3/api",
        containerId: "cities-preview",
        mapHeight: 500,
        citiesEndpoint: "/cities"
    };

    // Single style for all cities.
    const cityStyle = {
        color: "#3388ff",
        fillColor: "#3388ff"
    };

    // Public API.
    window.CitiesPreview = {
        /**
         * Configure the cities preview.
         * @param {Object} options - Configuration options
         * @returns {Object} The CitiesPreview object for chaining
         */
        setup: function(options) {
            config = Object.assign(config, options);
            return this;
        },

        /**
         * Initialize the cities preview map.
         * @returns {Promise} A promise that resolves when the preview is rendered
         */
        init: function() {
            const container = document.getElementById(config.containerId);

            if (!container) {
                console.error(`Container element with id '${config.containerId}' not found.`);
                return Promise.reject(new Error("Container element not found"));
            }

            // Set height for the map container.
            container.style.height = `${config.mapHeight}px`;
            container.style.width = "100%";

            // Initialize with loading message.
            const loadingMessage = document.createElement('div');
            loadingMessage.className = 'loading-message';
            loadingMessage.textContent = "Loading cities data...";
            container.appendChild(loadingMessage);

            // Fetch cities data and create the map.
            return this.fetchCities()
                .then(citiesData => {
                    // Create and initialize the map.
                    container.innerHTML = "";
                    const map = this.createMap(container);

                    // Display cities on the map.
                    this.displayCitiesOnMap(map, citiesData);

                    return map;
                })
                .catch(error => {
                    container.innerHTML = `<div class="message message-error">Failed to load cities data: ${error.message}</div>`;
                    console.error("Cities preview error:", error);
                    return Promise.reject(error);
                });
        },

        /**
         * Fetch cities data from the API.
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
         * Create the Leaflet map.
         * @param {HTMLElement} container - Container element for the map
         * @returns {Object} The Leaflet map object
         */
        createMap: function(container) {
            // Create a map element.
            const mapElement = document.createElement('div');
            mapElement.id = "cities-map";
            mapElement.className = 'map-container';
            container.appendChild(mapElement);

            // Create the map, centered on the world.
            const map = L.map('cities-map').setView([20, 0], 2);

            // Add the OpenStreetMap tile layer.
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(map);

            return map;
        },

        /**
         * Display cities on the map.
         * @param {Object} map - The Leaflet map object
         * @param {Object} citiesData - Data about the cities from the API
         */
        displayCitiesOnMap: function(map, citiesData) {
            if (!citiesData || !citiesData.cities || citiesData.cities.length === 0) {
                // Add a message to the map if no cities found.
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

            // Filter cities with geographic information.
            const citiesWithGeo = citiesData.cities.filter(city =>
                city.centerLat !== undefined && city.centerLng !== undefined
            );

            // Add a counter of displayed cities.
            const countDiv = document.createElement('div');
            countDiv.className = 'counter-badge';
            countDiv.textContent = `Showing ${citiesWithGeo.length} of ${citiesData.cities.length} cities`;

            map.getContainer().appendChild(countDiv);

            // Create custom icon.
            const cityIcon = L.icon({
                iconUrl: '/assets/images/logos/ProjectSidewalkLogo_NoText_WheelchairCircleCentered_50x50.png',
                iconSize: [30, 30], // Size of the icon.
                iconAnchor: [15, 15], // Point of the icon which corresponds to marker's location.
                popupAnchor: [0, -15] // Point from which the popup should open relative to the iconAnchor.
            });

            // Create markers for cities with geographic information.
            const cityMarkers = [];

            citiesWithGeo.forEach(city => {
                // Create a marker with the custom icon.
                const marker = L.marker([city.centerLat, city.centerLng], {
                    icon: cityIcon,
                    opacity: city.visibility === "public" ? 1.0 : 0.6 // More transparent for private cities.
                });

                // Add popup with city information.
                marker.bindPopup(`
          <div class="city-popup">
            <h3>${city.cityNameFormatted}</h3>
            <p><a href="${city.url}" target="_blank" class="city-link">Open Project Sidewalk in ${city.cityNameFormatted}</a></p>
          </div>
        `);

                // Add tooltip with city name for hover effect.
                marker.bindTooltip(city.cityNameFormatted, {
                    permanent: false,
                    direction: 'top',
                    offset: [0, -15]
                });

                // Add marker to map.
                marker.addTo(map);
                cityMarkers.push(marker);
            });

            // If we have city markers, fit map bounds to show all cities.
            if (cityMarkers.length > 0) {
                const group = L.featureGroup(cityMarkers);
                map.fitBounds(group.getBounds(), {
                    padding: [30, 30]
                });
            }
        },
    };
})();
