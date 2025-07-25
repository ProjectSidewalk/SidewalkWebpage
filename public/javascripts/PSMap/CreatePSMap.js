/**
 * Central function that handles the creation of choropleths and maps.
 *
 * @param {Object} $ - Allows the use of jQuery.
 * @param {Object} params - Properties that can change the process of choropleth creation.
 * @param {string} params.mapName - Name of the HTML ID of the map.
 * @param {string} params.mapStyle - URL of a Mapbox style.
 * @param {string} [params.mapboxApiKey] - Mapbox API key to use for the map.
 * @param {string} [params.neighborhoodFillMode] - One of 'singleColor' or 'completionRate'.
 * @param {string} [params.neighborhoodsURL] - URL of the endpoint containing neighborhood boundaries.
 * @param {string} params.completionRatesURL - URL of the endpoint containing neighborhood completion rates.
 * @param {boolean} [params.loadCities] - Whether to load deployment cities on the map.
 * @param {string} [params.streetsURL] - URL of the endpoint containing streets.
 * @param {string} [params.labelsURL] - URL of the endpoint containing labels.
 * @param {number} [params.zoomCorrection=0] - Amount to increase default zoom to account for different map dimensions.
 * @param {boolean} [params.scrollWheelZoom=true] - Whether to allow zooming with the scroll wheel.
 * @param {string} [params.mapboxLogoLocation=bottom-left] - 'top-left', 'top-right', 'bottom-left', or 'bottom-right'.
 * @param {string} [params.neighborhoodTooltip='none'] One of 'none' or 'completionRate'.
 * @param {boolean} [params.logClicks=true] - Whether clicks should be logged when it takes you to the explore page.
 * @param {string} [params.neighborhoodFillColor] - Fill color to use if neighborhoodFillMode='singleColor'.
 * @param {number} [params.neighborhoodFillOpacity] - Fill opacity to use if neighborhoodFillMode='singleColor'
 * @param {boolean} [params.differentiateUnauditedStreets=false] - Whether to color unaudited streets differently.
 * @param {boolean} [params.interactiveStreets=false] - Whether to include hover/click interactions on the streets.
 * @param {boolean} [params.includeLabelCounts=false] - Whether to include label counts for each type in the legend.
 * @param {boolean} [params.differentiateExpiredLabels=false] - Whether to color expired labels differently.
 * @param {Object} [params.popupLabelViewer] - Shows a validation popup on labels on the map.
 * @return {Promise} - Promise that resolves all components of map have loaded.
 */
function CreatePSMap($, params) {
    // Set default parameters.
    params.logClicks = params.logClicks === undefined ? true : params.logClicks;
    params.scrollWheelZoom = params.scrollWheelZoom === undefined ? true : params.scrollWheelZoom;
    params.neighborhoodTooltip = params.neighborhoodTooltip === undefined ? 'none' : params.neighborhoodTooltip;
    params.differentiateUnauditedStreets = params.differentiateUnauditedStreets === undefined ? false : params.differentiateUnauditedStreets;

    // Create the map.
    let map;
    let loadMapParams = $.getJSON('/cityMapParams');
    let mapLoaded = Promise.all([loadMapParams]).then(function(data) {
        return createMap(data[0]);
    }).then(newMap => {
        map = newMap; // Assign the returned map to the map variable.
        return map;
    });

    // Render the neighborhoods on the map if applicable.
    let renderNeighborhoods;
    let loadNeighborhoods = $.getJSON(params.neighborhoodsURL);
    let loadCompletionRates = $.getJSON(params.completionRatesURL);
    if (params.neighborhoodsURL && params.completionRatesURL) {
        renderNeighborhoods = Promise.all([mapLoaded, loadNeighborhoods, loadCompletionRates]).then(function(data) {
            AddNeighborhoodsToMap(map, data[1], data[2], params);
        });
    }

    // Render deployment cities on the map if applicable.
    let renderCities;
    if (params.loadCities) {
        let loadCities = $.getJSON('/v3/api/cities?filetype=geojson');
        renderCities = Promise.all([mapLoaded, loadCities]).then(function (data) {
            AddCitiesToMap(map, data[1], params);
        });
    }

    // Render the streets on the map if applicable.
    let renderStreets;
    if (params.streetsURL) {
        let loadStreets = $.getJSON(params.streetsURL);
        renderStreets = Promise.all([mapLoaded, renderNeighborhoods, loadStreets]).then(function(data) {
            AddStreetsToMap(map, data[2], params);
        });
    }

    // Render the labels on the map if applicable.
    let renderLabels;
    if (params.labelsURL) {
        let loadLabels = $.getJSON(params.labelsURL);
        renderLabels = Promise.all([mapLoaded, renderStreets, loadLabels]).then(function(data) {
            return AddLabelsToMap(map, data[2], params);
        });
    }

    // Return a promise that resolves once everything on the map has loaded.
    let allLoaded = Promise.all([mapLoaded, renderNeighborhoods, renderCities, renderStreets, renderLabels]);
    allLoaded.then(function(data) {
        // Resize the map when the window is resized.
        $(window).resize(function() {
            if (window.citiesMap) {
                window.citiesMap.resize();
            }
        });

        // Hide the loading spinner.
        $('#page-loading').hide();
    });
    return allLoaded;

    /**
     * Create the Mapbox map object and attach a custom logging function to it.
     * @param {Object} mapParamData - Map configuration parameters from the /cityMapParams endpoint.
     * @returns {Promise} - Promise that resolves with the Mapbox map once it has loaded.
     */
    function createMap(mapParamData) {
        params.zoomCorrection = params.zoomCorrection ? params.zoomCorrection : 0;
        mapParamData.default_zoom = mapParamData.default_zoom + params.zoomCorrection;

        mapboxgl.accessToken = params.mapboxApiKey;
        const map = new mapboxgl.Map({
            container: params.mapName, // HTML container ID
            style: params.mapStyle,
            center: [mapParamData.city_center.lng, mapParamData.city_center.lat],
            zoom: mapParamData.default_zoom,
            minZoom: 8.25,
            maxZoom: 19,
            maxBounds: [
                [mapParamData.southwest_boundary.lng, mapParamData.southwest_boundary.lat],
                [mapParamData.northeast_boundary.lng, mapParamData.northeast_boundary.lat]
            ],
            scrollZoom: params.scrollWheelZoom,
        });
        map.addControl(new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') }));
        map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-left');

        // Move the Mapbox logo if necessary.
        if (['top-left', 'top-right', 'bottom-right'].includes(params.mapboxLogoLocation)) {
            const mapboxLogoElem = document.querySelector(`#${params.mapName} .mapboxgl-ctrl-logo`).parentElement;
            const newParentElement = document.querySelector(`#${params.mapName} .mapboxgl-ctrl-${params.mapboxLogoLocation}`);
            const attributionElem = newParentElement.querySelector(`#${params.mapName} .mapboxgl-ctrl-attrib`);
            // Add above the other attribution if they are in the same corner, o/w just add it to that corner.
            if (attributionElem) {
                newParentElement.insertBefore(mapboxLogoElem, attributionElem);
            } else {
                newParentElement.appendChild(mapboxLogoElem);
            }
        }

        // Create a promise that resolves when the map has loaded.
        return new Promise((resolve, reject) => {
            if (map.loaded()) {
                resolve(map);
            } else {
                map.on('load', function (e) {
                    resolve(map);
                });
            }
        });
    }
}
