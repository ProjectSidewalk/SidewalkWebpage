/**
 * Central function that handles the creation of choropleths and maps.
 * @param {Object} $ - Allows the use of jQuery.
 * @param {Object} params - Properties that can change the process of choropleth creation.
 * @param {string} params.mapName - Name of the HTML ID of the map.
 * @param {string} params.mapStyle - URL of a Mapbox style.
 * @param {string} params.polygonFillMode - One of 'singleColor', 'completionRate', or 'issueCount'.
 * @param {string} params.neighborhoodsURL - URL of the endpoint containing neighborhood boundaries.
 * @param {string} params.completionRatesURL - URL of the endpoint containing neighborhood completion rates.
 * @param {string} [params.streetsURL] - URL of the endpoint containing streets.
 * @param {string} [params.labelsURL] - URL of the endpoint containing labels.
 * @param {Object} [params.popupLabelViewer] - Shows a validation popup on labels on the map.
 * @param {boolean} [params.differentiateExpiredLabels=false] - Whether to color expired labels differently.
 * @param {boolean} [params.includeLabelCounts=false] - whether to include label counts for each type in the legend.
 * @param params.regionColors list of colors to use along a gradient to fill a neighborhood.
 * @param params.neighborhoodPolygonStyle a default style for the neighborhood polygons.
 * @param params.mouseoverStyle style changes to make when mousing over a neighborhood.
 * @param params.mouseoutStyle style changes to make when mousing out of a neighborhood.
 * @param {number} [params.zoomCorrection=0] - Amount to increase default zoom to account for different map dimensions.
 * @param {boolean} [params.logClicks=true] - Whether clicks should be logged when it takes you to the explore page.
 * @param {boolean} [params.scrollWheelZoom=true] - Whether to allow zooming with the scroll wheel.
 * @param {string} params.popupType one of 'none', 'completionRate', or 'issueCounts'.
 * @param {boolean} params.resetButton - whether to include a 'reset view' button.
 * @param {boolean} params.zoomControl whether to allow zoom control.
 * @param {string} [params.mapboxLogoLocation=bottom-left] - One of 'top-left', 'top-right', 'bottom-left', or 'bottom-right'.
 */
function CreatePSMap($, params) {
    // Set default parameters.
    params.logClicks = params.logClicks === undefined ? true : params.logClicks;
    params.scrollWheelZoom = params.scrollWheelZoom === undefined ? true : params.scrollWheelZoom;

    let choropleth;
    let loadMapParams = $.getJSON('/cityMapParams');
    let mapLoaded = Promise.all([loadMapParams]).then(function(data) {
        return createMap(data[0]);
    });

    let loadNeighborhoods = $.getJSON(params.neighborhoodsURL);
    let loadCompletionRates = $.getJSON(params.completionRatesURL);
    let loadLabelCounts = params.popupType === 'issueCounts' ? $.getJSON('/adminapi/choroplethCounts') : null;
    let renderNeighborhoods = Promise.all([mapLoaded, loadNeighborhoods, loadCompletionRates, loadLabelCounts]).then(function(data) {
        choropleth = data[0];
        AddNeighborhoods(choropleth, params, data[1], data[2], data[3]);
    });

    let renderStreets;
    if (params.streetsURL) {
        // Get subset of parameters for InitializeStreets.
        // const { userRole, differentiateUnauditedStreets, interactiveStreets, mapName, logClicks } = params;
        // const streetParams = { userRole, differentiateUnauditedStreets, interactiveStreets, mapName, logClicks };
        let loadStreets = $.getJSON(params.streetsURL);
        renderStreets = Promise.all([renderNeighborhoods, loadStreets]).then(function(data) {
            InitializeStreets(choropleth, params, data[1]);
        });
    }

    let renderLabels;
    let externalMapData;
    if (params.labelsURL) {
        let loadLabels = $.getJSON(params.labelsURL);
        renderLabels = Promise.all([renderStreets, loadLabels]).then(function(data) {
            externalMapData = InitializeMapLayerContainer();
            return InitializeSubmittedLabels(choropleth, params, 'null', externalMapData, data[1]);
        });
    }

    let allLoaded = Promise.all([mapLoaded, renderNeighborhoods, renderStreets, renderLabels])
    allLoaded.then(function(data) {
        $('#page-loading').hide();
    });

    return allLoaded;

    function createMap(mapParamData) {
        params.zoomCorrection = params.zoomCorrection ? params.zoomCorrection : 0;
        mapParamData.default_zoom = mapParamData.default_zoom + params.zoomCorrection;

        mapboxgl.accessToken = mapParamData.mapbox_api_key;
        const choropleth = new mapboxgl.Map({
            container: params.mapName, // HTML container ID
            style: params.mapStyle,
            center: [mapParamData.city_center.lng, mapParamData.city_center.lat],
            zoom: mapParamData.default_zoom,
            minZoom: 9,
            maxZoom: 19,
            maxBounds: [
                [mapParamData.southwest_boundary.lng, mapParamData.southwest_boundary.lat],
                [mapParamData.northeast_boundary.lng, mapParamData.northeast_boundary.lat]
            ],
            scrollZoom: params.scrollWheelZoom,
        });
        choropleth.addControl(new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') }));
        choropleth.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-left');

        // Add a Reset View button if necessary.
        if (params.resetButton) {
            $('#reset-button').click(reset);
            function reset() {
                choropleth.setCenter([mapParamData.city_center.lng, mapParamData.city_center.lat]);
                choropleth.setZoom(mapParamData.default_zoom - 1);
            }
        }

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

        // Makes POST request that logs `activity` in WebpageActivityTable.
        choropleth.logWebpageActivity = function(activity) {
            console.log(activity);
            $.ajax({
                async: false,
                contentType: 'application/json; charset=utf-8',
                url: '/userapi/logWebpageActivity',
                type: 'post',
                data: JSON.stringify(activity),
                dataType: 'json',
                success: function(result){},
                error: function (result) {
                    console.error(result);
                }
            });
        }

        // Create a promise that resolves when the map has loaded.
        return new Promise((resolve, reject) => {
            if (choropleth.loaded()) {
                resolve(choropleth);
            } else {
                choropleth.on('load', function (e) {
                    resolve(choropleth);
                });
            }
        });
    }
}
