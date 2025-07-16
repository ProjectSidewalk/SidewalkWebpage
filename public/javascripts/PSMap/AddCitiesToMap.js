/**
 * Adds cities to the map as circles and returns a promise.
 *
 * @param map Map on which the streets are rendered.
 * @param {Object} map The Mapbox map object.
 * @param {Object} citiesData - GeoJSON object containing cities to draw on the map.
 * @param {Object} params - Properties that can change the process of choropleth creation.
 * @returns {Promise} Promise that resolves when the streets have been added to the map.
*/
function AddCitiesToMap(map, citiesData, params) {
    const CITIES_LAYER_NAME = 'cities';
    const CIRCLE_CONFIG = {
        fillColor: '#78B9AB', // Project Sidewalk green
        fillOpacity: 0.7,
        strokeColor: '#548177',
        strokeWidth: 2,
        radius: 8,
        hoverFillColor: '#FBD78B', // Project Sidewalk yellow
        hoverStrokeColor: '#b8a06b'
    };

    // Render cities as circles.
    map.addSource(CITIES_LAYER_NAME, {
        type: 'geojson',
        data: citiesData,
        promoteId: 'cityId'  // Use cityId as the feature identifier for state management
    });
    map.addLayer({
        id: CITIES_LAYER_NAME,
        type: 'circle',
        source: CITIES_LAYER_NAME,
        paint: {
            'circle-radius': CIRCLE_CONFIG.radius,
            'circle-color': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                CIRCLE_CONFIG.hoverFillColor,
                CIRCLE_CONFIG.fillColor
            ],
            'circle-opacity': CIRCLE_CONFIG.fillOpacity,
            'circle-stroke-width': CIRCLE_CONFIG.strokeWidth,
            'circle-stroke-color': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                CIRCLE_CONFIG.hoverStrokeColor,
                CIRCLE_CONFIG.strokeColor
            ]
        }
    });

    // Add filter/hover effects and fit the map to our cities.
    addHoverEffects();
    addClickHandlers();
    fitMapToCities();

    /**
     * Adds hover effects to city circles. Changes circle appearance on mouse enter/leave.
     */
    function addHoverEffects() {
        let hoveredCityId = null; // To keep track of the currently hovered city

        // Change cursor on hover and update feature state.
        map.on('mousemove', CITIES_LAYER_NAME, function (e) {
            map.getCanvas().style.cursor = 'pointer';
            let currCity = e.features[0];

            // If a different city was being hovered before, update the state for each.
            if (hoveredCityId !== null && hoveredCityId !== currCity.id) {
                map.setFeatureState({ source: CITIES_LAYER_NAME, id: hoveredCityId }, { hover: false });
                hoveredCityId = currCity.id;
                map.setFeatureState({ source: CITIES_LAYER_NAME, id: hoveredCityId }, { hover: true });
            } else if (hoveredCityId === null) {
                // If no city was being hovered before, just update the current one.
                hoveredCityId = currCity.id;
                map.setFeatureState({ source: CITIES_LAYER_NAME, id: hoveredCityId }, { hover: true });
                document.querySelector('.mapboxgl-canvas').style.cursor = 'pointer';
            }
        });

        // Reset cursor and styling when leaving.
        map.on('mouseleave', CITIES_LAYER_NAME, (e) => {
            if (hoveredCityId !== null) {
                map.setFeatureState({ source: CITIES_LAYER_NAME, id: hoveredCityId }, { hover: false });
                hoveredCityId = null;
                map.getCanvas().style.cursor = '';
            }
        });
    }

    /**
     * Adds click handlers for city circles. Opens popup with explore link when circle is clicked.
     */
    function addClickHandlers() {
        const cityPopup = new mapboxgl.Popup({
            focusAfterOpen: false,
            closeButton: true,
            closeOnClick: true,
            className: 'deployment-popup'
        });
        map.on('click', CITIES_LAYER_NAME, (e) => {
            const feature = e.features[0];
            const properties = feature.properties;
            let coordinates = feature.geometry.coordinates.slice();

            // Create and show popup.
            const popupContent = createPopupContent(properties);
            cityPopup.setLngLat(coordinates).setHTML(popupContent).addTo(map);
        });
    }

    /**
     * Create HTML content for the popup.
     *
     * @param {Object} properties - City properties from GeoJSON feature
     * @returns {string} HTML content for the popup
     */
    function createPopupContent(properties) {
        const exploreUrl = `${properties.url}/explore`;
        return `
    <div class="popup-content">
      <h3 class="popup-title">${properties.cityNameFormatted}</h3>
      <a href="${exploreUrl}"
         class="popup-link"
         target="_blank"
         rel="noopener noreferrer">
        Explore ${properties.cityNameShort}
      </a>
    </div>
  `;
    }

    /**
     * Fit the map view to show all cities. Calculates bounds and adjusts map viewport.
     */
    function fitMapToCities() {
        // Set different zoom restrictions and projection than our other maps, since we're zooming out so far.
        map.setMinZoom(2);
        map.setMaxZoom(10);
        map.setProjection('mercator');
        map.setMaxBounds(null);

        if (citiesData.features.length === 0) return;

        // Extend bounds to include all cities.
        const bounds = new mapboxgl.LngLatBounds();
        citiesData.features.forEach(city => {
            bounds.extend(city.geometry.coordinates);
        });

        // Fit map to bounds with padding.
        map.fitBounds(bounds, { padding: 50 });
    }

    /**
     * Handle window resize events. Ensures map resizes properly with the browser window.
     */
    function handleResize() {
        if (map) {
            map.resize();
        }
    }

    // Handle window resize.
    window.addEventListener('resize', handleResize);

    // Return promise that is resolved once all the layers have been added to the map.
    return new Promise((resolve, reject) => {
        if (map.getLayer(CITIES_LAYER_NAME)) {
            resolve();
        } else {
            map.on('sourcedataloading', function(e) {
                if (map.getLayer(CITIES_LAYER_NAME)) {
                    resolve();
                }
            });
        }
    });
}
