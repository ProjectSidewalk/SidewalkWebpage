/**
 * Adds cities to the map as circles and returns a promise.
 *
 * @param map Map on which the streets are rendered.
 * @param {Object} map The Mapbox map object.
 * @param {Object} citiesData - GeoJSON object containing cities to draw on the map.
 * @param {Object} params - Properties that can change the process of choropleth creation.
 * @param {string} params.mapName - Name of the HTML ID of the map.
 * @returns {Promise} Promise that resolves when the streets have been added to the map.
*/
function AddCitiesToMap(map, citiesData, params) {
    const CITIES_LAYER_NAME = 'cities';

    // Colors from: https://github.com/ProjectSidewalk/Design
    const CIRCLE_CONFIG = {
        fillColor: '#78B9AB', // Project Sidewalk green
        fillOpacity: 0.7,
        strokeColor: '#548177',
        strokeWidth: 1,
        radius: 6,
        hoverFillColor: '#FBD78B', // Project Sidewalk yellow
        hoverStrokeColor: '#b8a06b',
        privateFillColor: '#EB734D', // Project Sidewalk orange
        privateStrokeColor: '#C85B3A'  // Darker orange for stroke
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
                ['==', ['get', 'visibility'], 'private'],
                CIRCLE_CONFIG.privateFillColor,
                CIRCLE_CONFIG.fillColor
            ],
            'circle-opacity': CIRCLE_CONFIG.fillOpacity,
            'circle-stroke-width': CIRCLE_CONFIG.strokeWidth,
            'circle-stroke-color': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                CIRCLE_CONFIG.hoverStrokeColor,
                ['==', ['get', 'visibility'], 'private'],
                CIRCLE_CONFIG.privateStrokeColor,
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
        let hoveredCityId = null;

        map.on('mousemove', CITIES_LAYER_NAME, function (e) {
            map.getCanvas().style.cursor = 'pointer';
            let currCity = e.features[0];

            if (hoveredCityId !== null && hoveredCityId !== currCity.id) {
                map.setFeatureState({ source: CITIES_LAYER_NAME, id: hoveredCityId }, { hover: false });
                hoveredCityId = currCity.id;
                map.setFeatureState({ source: CITIES_LAYER_NAME, id: hoveredCityId }, { hover: true });
            } else if (hoveredCityId === null) {
                hoveredCityId = currCity.id;
                map.setFeatureState({ source: CITIES_LAYER_NAME, id: hoveredCityId }, { hover: true });
            }
        });

        map.on('mouseleave', CITIES_LAYER_NAME, (e) => {
            if (hoveredCityId !== null) {
                map.setFeatureState({ source: CITIES_LAYER_NAME, id: hoveredCityId }, { hover: false });
                hoveredCityId = null;
                map.getCanvas().style.cursor = '';
            }
        });
    }

    /**
     * Adds click event handlers to the map for displaying city statistics in a popup.
     * When a city feature is clicked, fetches overall stats from the API, clones and populates
     * a popup template, and displays it at the clicked location. Handles both public and private
     * deployments, showing an appropriate message or link. Also logs click activity if enabled.
     *
     * @function
     * @param {Object} params - Configuration parameters.
     * @param {string} params.mapName - The name/id of the map element.
     * @param {boolean} params.logClicks - Whether to log click activity.
     * @returns {void}
     */
    function addClickHandlers() {
        const cityPopup = new mapboxgl.Popup({
            focusAfterOpen: false,
            closeButton: true,
            closeOnClick: true,
            className: 'deployment-popup'
        });

        map.on('click', CITIES_LAYER_NAME, async (e) => {
            const feature = e.features[0];

            const properties = feature.properties;
            let coordinates = feature.geometry.coordinates.slice();
            const statsUrl = `v3/api/overallStats`;

            // Immediately show a simple loading message.
            cityPopup.setLngLat(coordinates).setHTML('<div class="popup-loading">Loading stats...</div>').addTo(map);

            try {
                // Fetch stats for the selected city.
                const response = await fetch(statsUrl);
                if (!response.ok) throw new Error('Network response was not ok');
                const stats = await response.json();

                // 1. Clone the template from the HTML document.
                const template = document.getElementById('city-popup-template');
                const popupContent = template.content.cloneNode(true);

                // 2. Populate the cloned template with data.
                popupContent.querySelector('.popup-title').textContent = properties.cityNameFormatted;
                popupContent.querySelector('[data-stat="distance"]').textContent = formatDistance(stats.km_explored || 0);
                popupContent.querySelector('[data-stat="labels"]').textContent = formatNumber(stats.labels.label_count || 0);
                popupContent.querySelector('[data-stat="validations"]').textContent = formatNumber(stats.validations.total_validations || 0);

                const exploreLink = popupContent.querySelector('.popup-link');
                if (properties.visibility === 'private') {
                    // Create a new div for the "Private Deployment" message.
                    const privateMessage = document.createElement('div');
                    privateMessage.className = 'popup-private-message';
                    privateMessage.textContent = 'Private Deployment';

                    // Replace the link with the new message.
                    exploreLink.replaceWith(privateMessage);
                } else {
                    // Otherwise, populate the link as normal for public cities.
                    exploreLink.href = `${properties.url}/explore`;
                    exploreLink.setAttribute('cityId', properties.cityId);
                    exploreLink.textContent = i18next.t('common:deployment-map.explore', { cityName: properties.cityNameShort });
                }

                // 3. Update the popup with the populated HTML node.
                cityPopup.setDOMContent(popupContent);

            } catch (error) {
                console.error('Failed to fetch city stats:', error);
                cityPopup.setHTML('<div class="popup-error">Could not load stats.</div>');
            }
        });

        // Logging functionality
        if (params.logClicks) {
            $(`#${params.mapName}`).on('click', '.city-selection-trigger', function () {
                const activity = `Click_module=${params.mapName}_cityId=${$(this).attr('cityId')}`;
                window.logWebpageActivity(activity);
            });
        }
    }

    /**
     * Formats a number with commas.
     * @param {number} num
     * @returns {string}
     */
    function formatNumber(num) {
        return i18next.t('common:format-number', { val: num });
    }

    /**
     * Formats distance as either kilometers or miles based on the user's measurement system.
     * @param {number} km
     * @returns {string}
     */
    function formatDistance(km) {
        const distUnit = i18next.t('common:unit-distance-abbreviation');
        const dist = i18next.t('common:measurement-system') === 'metric' ? km : util.math.kmsToMiles(km);
        return i18next.t('common:format-number', { val: Math.round(dist) }) + ' ' + distUnit;
    }

    /**
     * Fit the map view to show all cities. Calculates bounds and adjusts map viewport.
     */
    function fitMapToCities() {
        map.setMinZoom(null);
        map.setMaxZoom(10);
        map.setProjection('mercator');
        map.setMaxBounds(null);
        if (citiesData.features.length === 0) return;
        const bounds = new mapboxgl.LngLatBounds();
        citiesData.features.forEach(city => {
            bounds.extend(city.geometry.coordinates);
        });
        map.fitBounds(bounds, { padding: 50 });
    }

    function handleResize() {
        if (map) {
            fitMapToCities();
        }
    }
    window.addEventListener('resize', handleResize);

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
