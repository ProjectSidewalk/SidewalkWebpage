/**
 * Adds cities to the map as circles and returns a promise.
 *
 * @param map Map on which the streets are rendered.
 * @param {Object} map The Mapbox map object.
 * @param {Object} citiesData - GeoJSON object containing cities to draw on the map.
 * @param {Object} params - Properties that can change the process of choropleth creation.
 * @param {string} params.mapName - Name of the HTML ID of the map.
 * @param {boolean} params.logClicks - Whether to log click activity.
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
        strokeOpacity: 1,
        radius: 6,
        hoverFillColor: '#FBD78B', // Project Sidewalk yellow
        hoverStrokeColor: '#b8a06b',
        privateFillColor: '#EB734D', // Project Sidewalk orange
        privateFillOpacity: 0.4,
        privateStrokeColor: '#C85B3A',  // Darker orange for stroke
        privateStrokeOpacity: 0.5,
        privateRadius: 5
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
            'circle-radius': [
                'case',
                ['==', ['get', 'visibility'], 'private'],
                CIRCLE_CONFIG.privateRadius,
                CIRCLE_CONFIG.radius
            ],
            'circle-color': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                CIRCLE_CONFIG.hoverFillColor,
                ['==', ['get', 'visibility'], 'private'],
                CIRCLE_CONFIG.privateFillColor,
                CIRCLE_CONFIG.fillColor
            ],
            'circle-opacity': [
                'case',
                ['==', ['get', 'visibility'], 'private'],
                CIRCLE_CONFIG.privateFillOpacity,
                CIRCLE_CONFIG.fillOpacity
            ],
            'circle-stroke-width': CIRCLE_CONFIG.strokeWidth,
            'circle-stroke-opacity': [
                'case',
                ['==', ['get', 'visibility'], 'private'],
                CIRCLE_CONFIG.privateStrokeOpacity,
                CIRCLE_CONFIG.strokeOpacity
            ],
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
    addClickHandlers(params);
    fitMapToCities();

    /**
     * Adds hover effects to city circles. Changes circle appearance on mouse enter/leave.
     */
    function addHoverEffects() {
        let hoveredCityId = null;

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
     * Adds click event handlers to the map for displaying city statistics in a popup.
     *
     * When a city feature is clicked, fetches overall stats from the API, clones and populates a popup template, and
     * displays it at the clicked location. Handles both public and private deployments, showing an appropriate message
     * or link. Also logs click activity if enabled.
     *
     * @function
     * @param {Object} params - Configuration parameters.
     * @param {string} params.mapName - The name/id of the map element.
     * @param {boolean} params.logClicks - Whether to log click activity.
     * @returns {void}
     */
    function addClickHandlers(params) {
        const cityPopup = new mapboxgl.Popup({
            focusAfterOpen: false,
            closeButton: true,
            closeOnClick: true,
            className: 'deployment-popup'
        });

        map.on('click', CITIES_LAYER_NAME, async (e) => {
            const feature = e.features[0];
            const properties = feature.properties;
            const coordinates = feature.geometry.coordinates.slice();

            // On localhost, for testing, I've just been using the following (otherwise we run into CORS issues):
            // const statsUrl = `v3/api/overallStats`;
            const statsUrl = `${properties.url}/v3/api/overallStats`;

            // Immediately show a simple loading message.
            const loadingMessage = i18next.t('common:cities-map.loading-stats');
            cityPopup.setLngLat(coordinates).setHTML(`<div class="popup-loading">${loadingMessage}</div>`).addTo(map);

            const template = document.getElementById('city-popup-template');
            const popupContent = template.content.cloneNode(true);

            // Populate the parts of the template that do not depend on the stats API.
            popupContent.querySelector('.popup-title').textContent = properties.cityNameFormatted;
            const exploreLink = popupContent.querySelector('.popup-link');
            if (properties.visibility === 'private') {
                const privateMessage = document.createElement('div');
                privateMessage.className = 'popup-private-message';
                privateMessage.textContent = i18next.t('common:cities-map.private-deployment');
                exploreLink.replaceWith(privateMessage);
            } else {
                exploreLink.href = `${properties.url}/explore`;
                exploreLink.setAttribute('cityId', properties.cityId);
                exploreLink.textContent = i18next.t('common:cities-map.explore', { cityName: properties.cityNameShort });
            }

            try {
                // We only TRY to fetch and populate the stats.
                const response = await fetch(statsUrl);
                if (!response.ok) throw new Error('Network response was not ok');
                const stats = await response.json();

                // If successful, fill in the stat values.
                popupContent.querySelector('[data-stat="distance"]').textContent = formatDistance(stats.km_explored || 0);
                popupContent.querySelector('[data-stat="labels"]').textContent = formatNumber(stats.labels.label_count || 0);
                popupContent.querySelector('[data-stat="validations"]').textContent = formatNumber(stats.validations.total_validations || 0);
            } catch (error) {
                // If the fetch fails, just log the error. The popup will still be shown,
                // but the stats will be the default placeholder values from the template.
                console.error('Failed to fetch city stats:', error);
            }

            // Finally, update the popup with the content, which will have stats if they loaded.
            cityPopup.setDOMContent(popupContent);
        });

        // Logging functionality.
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
        // Set different zoom restrictions and projection than our other maps, since we're zooming out so far.
        map.setMinZoom(null);
        map.setMaxZoom(10);
        map.setProjection('mercator');
        map.setMaxBounds(null);

        // Extend bounds to include all cities.
        if (citiesData.features.length === 0) return;
        const bounds = new mapboxgl.LngLatBounds();
        citiesData.features.forEach(city => {
            bounds.extend(city.geometry.coordinates);
        });
        map.fitBounds(bounds, { padding: 50 });
    }

    /**
     * Handle window resize events. Ensures map resizes properly with the browser window.
     */
    function handleResize() {
        if (map) {
            fitMapToCities();
        }
    }
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
