/**
 * Central function that handles the creation of choropleths and maps.
 * @param _ Allows the use of Underscore.js
 * @param $ Allows the use of jQuery.
 * @param params Object that includes properties that can change the process of choropleth creation.
 * @param params.mapName {string} name of the HTML ID of the map.
 * @param params.mapStyle {string} URL of a Mapbox style.
 * @param params.regionColors list of colors to use along a gradient to fill a neighborhood
 * @param params.neighborhoodPolygonStyle a default style for the neighborhood polygons.
 * @param params.mouseoverStyle style changes to make when mousing over a neighborhood.
 * @param params.mouseoutStyle style changes to make when mousing out of a neighborhood.
 * @param params.polygonFillMode one of 'singleColor', 'completionRate', or 'issueCount'.
 * @param params.webpageActivity string showing how to represent the choropleth in logging.
 * @param params.defaultZoomIncrease {number} amount to increase default zoom, increments of 0.5.
 * @param params.clickData {boolean} whether clicks should be logged when it takes you to the explore page.
 * @param params.scrollWheelZoom {boolean} whether to allow zooming with the scroll wheel.
 * @param params.popupType {string} one of 'none', 'completionRate', or 'issueCounts'.
 * @param params.resetButton {boolean} whether to include a 'reset view' button.
 * @param params.zoomControl {boolean} whether to allow zoom control.
 * @param params.mapboxLogoLocation {string} one of 'top-left', 'top-right', 'bottom-left', or 'bottom-right'.
 * @param polygonData Data concerning which neighborhood polygons are to be rendered.
 * @param polygonRateData Rate data of each neighborhood polygon.
 * @param mapParamData Data used to initialize the choropleth properties.
 */
function Choropleth(_, $, params, polygonData, polygonRateData, mapParamData) {
    const labelText = {
        'NoSidewalk': 'Missing Sidewalks',
        'NoCurbRamp': 'Missing Curb Ramps',
        'SurfaceProblem': 'Surface Problems',
        'Obstacle': 'Obstacles',
    };

    params.defaultZoomIncrease = params.defaultZoomIncrease ? params.defaultZoomIncrease : 0;
    mapParamData.default_zoom = mapParamData.default_zoom + params.defaultZoomIncrease - 1;

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

    // Move the Mapbox logo if necessary.
    if (['top-left', 'top-right', 'bottom-right'].includes(params.mapboxLogoLocation)) {
        const mapboxLogoElem = document.querySelector('.mapboxgl-ctrl-logo').parentElement;
        const newParentElement = document.querySelector(`.mapboxgl-ctrl-${params.mapboxLogoLocation}`);
        const attributionElem = newParentElement.querySelector('.mapboxgl-ctrl-attrib');
        // Add above the other attribution if they are in the same corner, o/w just add it to that corner.
        if (attributionElem) {
            newParentElement.insertBefore(mapboxLogoElem, document.querySelector('.mapboxgl-ctrl-attrib'));
        } else {
            newParentElement.appendChild(mapboxLogoElem);
        }
    }

    // Add a Reset View button if necessary.
    if (params.resetButton) {
        $('#reset-button').click(reset);
        function reset() {
            choropleth.setCenter([mapParamData.city_center.lng, mapParamData.city_center.lat]);
            choropleth.setZoom(mapParamData.default_zoom - 1);
        }
    }

    // Once map and data have loaded, start adding layers.
    if (params.popupType === 'issueCounts') {
        $.getJSON('/adminapi/choroplethCounts', function (labelCounts) {
            // Append label counts to region data with map/reduce.
            let labelData = _.map(polygonRateData, function(region) {
                let regionLabel = _.find(labelCounts, function(x) { return x.region_id === region.region_id });
                return regionLabel ? regionLabel : { regionId: region.region_id, labels: {} };
            });
            choropleth.on('load', () => { initializeChoropleth(polygonRateData, labelData); });
        });
    } else {
        choropleth.on('load', () => { initializeChoropleth(polygonRateData, 'NA'); });
    }

    // Renders the neighborhood polygons, colored by completion percentage.
    function initializeChoroplethNeighborhoodPolygons(map, rates, labelData) {
        // Default region color, used to check if any regions are missing data.
        let neighborhoodStyle = params.neighborhoodPolygonStyle;

        // Compute fill color/opacity for each neighborhood.
        for (let neighborhood of polygonData.features) {
            let idx = rates.findIndex(function(r) { return r.region_id === neighborhood.properties.region_id; });
            if (idx > -1) {
                if (params.polygonFillMode === 'singleColor') {
                    neighborhoodStyle = params.neighborhoodPolygonStyle;
                } else if (params.polygonFillMode === 'issueCount') {
                    neighborhoodStyle = getRegionStyleFromIssueCount(rates[idx], labelData[idx].labels)
                } else {
                    neighborhoodStyle = getRegionStyleFromCompletionRate(rates[idx]);
                }
            }
            neighborhood.properties.fillColor = neighborhoodStyle.fillColor;
            neighborhood.properties.fillOpacity = neighborhoodStyle.fillOpacity;
        }

        let hoveredRegionId = null;
        const neighborhoodTooltip = new mapboxgl.Popup({ maxWidth: '300px', focusAfterOpen: false });
        choropleth.on('mousemove', 'neighborhood-polygons', (event) => {
            let currRegion = event.features[0];
            let makePopup = false;
            if (hoveredRegionId && hoveredRegionId !== currRegion.properties.region_id) {
                map.setFeatureState({ source: 'neighborhood-polygons', id: hoveredRegionId }, { hover: false });
                hoveredRegionId = currRegion.properties.region_id;
                map.setFeatureState({ source: 'neighborhood-polygons', id: hoveredRegionId }, { hover: true });
                makePopup = true;
            } else if (!hoveredRegionId) {
                hoveredRegionId = currRegion.properties.region_id;
                map.setFeatureState({ source: 'neighborhood-polygons', id: hoveredRegionId }, { hover: true });
                makePopup = true;
            }

            // Adds popup text, mouseover and click events, etc. to the neighborhood polygons.
            if (params.popupType !== 'none' && makePopup) {
                let popupContent = '???';
                let ratesIndex = rates.findIndex(function(r) { return r.region_id === hoveredRegionId; });
                if (ratesIndex > -1) {
                    let regionName = currRegion.properties.region_name;
                    let userCompleted = currRegion.properties.user_completed;
                    let url = '/explore/region/' + hoveredRegionId;
                    let compRate = 100.0 * rates[ratesIndex].rate;
                    let compRateRounded = Math.floor(100.0 * rates[ratesIndex].rate);
                    let distanceLeft = rates[ratesIndex].total_distance_m - rates[ratesIndex].completed_distance_m;
                    // If using metric system, convert from meters to km. If using IS system, convert to miles.
                    let measurementSystem = i18next.t('measurement-system');
                    if (measurementSystem === 'metric') distanceLeft *= 0.001;
                    else distanceLeft *= 0.000621371;
                    distanceLeft = Math.round(distanceLeft);
                    if (userCompleted) {
                        popupContent = '<strong>' + regionName + '</strong>: ' +
                            i18next.t('common:map.100-percent-complete') + '<br>' +
                            i18next.t('common:map.thanks');
                    } else if (compRate === 100) {
                        popupContent = '<strong>' + regionName + '</strong>: ' +
                            i18next.t('common:map.100-percent-complete') + '<br>' +
                            i18next.t('common:map.click-to-help', {url: url, regionId: hoveredRegionId});
                    } else if (distanceLeft === 0) {
                        popupContent = '<strong>' + regionName + '</strong>: ' +
                            i18next.t('common:map.percent-complete', {percent: compRateRounded}) + '<br>' +
                            i18next.t('common:map.less-than-one-unit-left') + '<br>' +
                            i18next.t('common:map.click-to-help', {url: url, regionId: hoveredRegionId});
                    } else if (distanceLeft === 1) {
                        popupContent = '<strong>' + regionName + '</strong>: ' +
                            i18next.t('common:map.percent-complete', {percent: compRateRounded}) + '<br>' +
                            i18next.t('common:map.distance-left-one-unit') + '<br>' +
                            i18next.t('common:map.click-to-help', {url: url, regionId: hoveredRegionId});
                    } else {
                        popupContent = '<strong>' + regionName + '</strong>: ' +
                            i18next.t('common:map.percent-complete', {percent: compRateRounded}) + '<br>' +
                            i18next.t('common:map.distance-left', {n: distanceLeft}) + '<br>' +
                            i18next.t('common:map.click-to-help', {url: url, regionId: hoveredRegionId});
                    }
                    if (params.popupType === 'issueCounts')
                        popupContent += getIssueCountPopupContent(labelData[ratesIndex].labels)
                }

                // Set tooltip to center of neighborhood.
                neighborhoodTooltip.setHTML(popupContent);
                let regionCenter = turf.centerOfMass(turf.polygon(currRegion.geometry.coordinates)).geometry.coordinates;
                neighborhoodTooltip.setLngLat({ lng: regionCenter[0], lat: regionCenter[1] }).addTo(choropleth);

                // Add listeners to popup so the popup closes when the mouse leaves the popup area.
                neighborhoodTooltip._content.onmouseout = function (e) {
                    if (e.toElement.classList.contains('mapboxgl-canvas')) {
                        map.setFeatureState({ source: 'neighborhood-polygons', id: hoveredRegionId }, { hover: false });
                        neighborhoodTooltip.remove();
                        hoveredRegionId = null;
                    }
                };
                neighborhoodTooltip._content.querySelector('.mapboxgl-popup-close-button').onmouseout = function(e) {
                    map.setFeatureState({ source: 'neighborhood-polygons', id: hoveredRegionId }, { hover: false });
                    neighborhoodTooltip.remove();
                    hoveredRegionId = null;
                };
                // Make sure the region outline is removed when the popup close button is clicked.
                neighborhoodTooltip._content.querySelector('.mapboxgl-popup-close-button').onclick = function(e) {
                    map.setFeatureState({ source: 'neighborhood-polygons', id: hoveredRegionId }, { hover: false });
                    neighborhoodTooltip.remove();
                    hoveredRegionId = null;
                };
            }
        });

        choropleth.on('mouseleave', 'neighborhood-polygons', (event) => {
            if (hoveredRegionId !== null && event.originalEvent.toElement.classList.contains('mapboxgl-canvas')) {
                map.setFeatureState({ source: 'neighborhood-polygons', id: hoveredRegionId }, { hover: false });
                neighborhoodTooltip.remove();
                hoveredRegionId = null;
            }
        });

        // Add the neighborhood polygons to the map.
        choropleth.addSource('neighborhood-polygons', {
            type: 'geojson',
            data: polygonData,
            promoteId: 'region_id'
        });
        choropleth.addLayer({
            id: 'neighborhood-polygons',
            type: 'fill',
            source: 'neighborhood-polygons',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-outline-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'fillOpacity']
            }
        });
        // Need a line layer for the region outlines bc WebGL doesn't render outlines wider than width of 1.
        // https://github.com/mapbox/mapbox-gl-js/issues/3018#issuecomment-240381965
        choropleth.addLayer({
            id: 'neighborhood-polygons-outline',
            type: 'line',
            source: 'neighborhood-polygons',
            paint: {
                'line-color': ['case',
                    ['boolean', ['feature-state', 'hover'], false], params.mouseoverStyle.color, params.mouseoutStyle.color
                ],
                'line-width': ['case',
                    ['boolean', ['feature-state', 'hover'], false], params.mouseoverStyle.weight, params.mouseoutStyle.weight
                ],
                'line-opacity': ['case',
                    ['boolean', ['feature-state', 'hover'], false], params.mouseoverStyle.opacity, params.mouseoutStyle.opacity
                ]
            }
        });

        if (params.clickData) {
            // Logs when a region is selected from the choropleth and 'Click here' is clicked
            // Logs are of the form 'Click_module=Choropleth_regionId=<regionId>_distanceLeft=<'0', '<1', '1' or '>1'>_target=audit'.
            // Log is stored in WebpageActivityTable
            $('.choropleth').on('click', '.region-selection-trigger', function () {
                let regionId = parseInt($(this).attr('regionId'));
                let ratesEl = rates.find(function(x) { return regionId === x.region_id; });
                let compRate = Math.round(100.0 * ratesEl.rate);
                let milesLeft = Math.round(0.000621371 * (ratesEl.total_distance_m - ratesEl.completed_distance_m));
                let distanceLeft = '';
                if (compRate === 100) distanceLeft = '0';
                else if (milesLeft === 0) distanceLeft = '<1';
                else if (milesLeft === 1) distanceLeft = '1';
                else distanceLeft = '>1';
                let activity = params.webpageActivity + regionId + '_distanceLeft=' + distanceLeft + '_target=audit';
                logWebpageActivity(activity);
            });
        }
        return polygonData;
    }

    /**
     * Takes a completion percentage, bins it, and returns the appropriate color for a choropleth.
     *
     * @param p {float} represents a completion percentage, between 0 and 100
     * @returns {string} color in hex
     */
    function getColor(p) {
        //since this is a float, we cannot directly compare. Using epsilon to avoid floating point errors
        return Math.abs(p - 100) < Number.EPSILON ? '#03152f':
                 p > 90 ? params.regionColors[0] :
                    p > 80 ? params.regionColors[1] :
                        p > 70 ? params.regionColors[2] :
                            p > 60 ? params.regionColors[3] :
                                p > 50 ? params.regionColors[4] :
                                    p > 40 ? params.regionColors[5] :
                                        p > 30 ? params.regionColors[6] :
                                            p > 20 ? params.regionColors[7] :
                                                p > 10 ? params.regionColors[8] :
                                                    params.regionColors[9];
    }

    /**
     * This function finds the color for a specific region of the accessibility choropleth.
     *
     * @param polygonData Object from which information about labels is retrieved.
     * @param labels Data about issue counts in a region.
     */
    function getRegionStyleFromIssueCount(polygonData, labels) {
        let totalIssues = 0;
        for (let issue in labels) {
            if (labels.hasOwnProperty(issue)) {
                totalIssues += labels[issue];
            }
        }
        let significantData = polygonData.rate >= .3;
        return {
            fillColor: significantData ? getColor(1000.0 * totalIssues / polygonData.completed_distance_m) : '#888',
            fillOpacity: significantData ? 0.4 + (totalIssues / polygonData.completed_distance_m) : .25
        }
    }

    /**
     * This function finds the color for a specific region of the choropleth.
     *
     * @param {*} polygonData Object from which information about labels is retrieved.
     */
    function getRegionStyleFromCompletionRate(polygonData) {
        return {
            fillColor: getColor(100.0 * polygonData.rate),
            fillOpacity: 0.35 + (0.4 * polygonData.rate)
        }
    }

    /**
     * Gets issue count HTML to add to popups on the results page.
     *
     * @param {*} labels Object from which information about labels is retrieved.
     */
    function getIssueCountPopupContent(labels) {
        let counts = {};
        for (let j in labelText) {
            if (typeof labels[j] != 'undefined')
                counts[j] = labels[j];
            else
                counts[j] = 0;
        }
        return '<div class="results-images"><table><tbody>'+
               '<tr><td>' + i18next.t('missing-sidewalks') + '<br/></td>'+
               '<td>' + i18next.t('missing-ramps') + '<br/></td>'+
               '<td>' + i18next.t('surface-problems') + '<br/>'+
               '<td>' + i18next.t('sidewalk-obstacles') + '<br/></td></td></tr>' +
               '<tr><td><img src="/assets/javascripts/SVLabel/img/icons/NoSidewalk_small.png"></td>'+
               '<td><img src="/assets/javascripts/SVLabel/img/icons/NoCurbRamp_small.png"></td>'+
               '<td><img src="/assets/javascripts/SVLabel/img/icons/SurfaceProblem_small.png"></td>'+
               '<td><img src="/assets/javascripts/SVLabel/img/icons/Obstacle_small.png"></td>'+
               '<tr><td>'+ counts['NoSidewalk'] +'</td><td>'+ counts['NoCurbRamp'] +'</td><td>'+ counts['SurfaceProblem'] +'</td><td>'+ counts['Obstacle'] +'</td></tr></tbody></table></div>';
    }

    /**
     * Takes data and initializes the choropleth with it.
     *
     * @param data The data to initialize the regions of the choropleth with.
     * @param labelData Data concerning issue counts for different regions.
     */
    function initializeChoropleth(data, labelData) {
        if (params.popupType === 'issueCounts' && labelData === undefined) {
            console.log('Error: no issue count data for results choropleth.')
        } else {
            // Make a choropleth of neighborhood completion percentages.
            initializeChoroplethNeighborhoodPolygons(choropleth, data, labelData);
        }
        $('#page-loading').hide();
        $('#results-legend').show();
    }

    // Makes POST request that logs `activity` in WebpageActivityTable.
    function logWebpageActivity(activity) {
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
    return choropleth;
}
