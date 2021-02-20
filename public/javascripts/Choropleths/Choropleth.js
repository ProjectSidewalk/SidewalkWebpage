/**
 * Central function that handles the creation of choropleths and maps.
 * @param _ Allows the use of Underscore.js
 * @param $ Allows the use of jQuery.
 * @param difficultRegionIds Used to identify difficult regions.
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
 * @param params.zoomSlider {boolean} whether to include zoom slider.
 * @param params.clickData {boolean} whether clicks should be logged when it takes you to the audit page.
 * @param params.scrollWheelZoom {boolean} whether to allow zooming with the scroll wheel.
 * @param params.popupType {string} one of 'none', 'completionRate', or 'issueCounts'.
 * @param params.resetButton {boolean} whether to include a 'reset view' button.
 * @param params.zoomControl {boolean} whether to allow zoom control.
 * @param layers Object that receives data during execution to pass outside of this function.
 * @param polygonData Data concerning which neighborhood polygons are to be rendered.
 * @param polygonRateData Rate data of each neighborhood polygon.
 * @param mapParamData Data used to initialize the choropleth properties.
 */
function Choropleth(_, $, difficultRegionIds, params, layers, polygonData, polygonRateData, mapParamData) {
    const labelText = {
        'NoSidewalk': 'Missing Sidewalks',
        'NoCurbRamp': 'Missing Curb Ramps',
        'SurfaceProblem': 'Surface Problems',
        'Obstacle': 'Obstacles',
    };

    params.defaultZoomIncrease = params.defaultZoomIncrease ? params.defaultZoomIncrease : 0;
    mapParamData.default_zoom = mapParamData.default_zoom + params.defaultZoomIncrease;
    
    // Create base map.
    L.mapbox.accessToken = 'pk.eyJ1IjoibWlzYXVnc3RhZCIsImEiOiJjajN2dTV2Mm0wMDFsMndvMXJiZWcydDRvIn0.IXE8rQNF--HikYDjccA7Ug';
    let choropleth = L.mapbox.map(params.mapName, null, {
        maxZoom: 19,
        minZoom: 9,
        zoomControl: params.zoomControl,
        scrollWheelZoom: params.scrollWheelZoom,
        zoomSnap: 0.25
    }).addLayer(L.mapbox.styleLayer(params.mapStyle));

    if (params.zoomSlider) L.control.zoomslider().addTo(choropleth);

    // Set the city-specific default zoom, location, and max bounding box to prevent the user from panning away.
    choropleth.setView([mapParamData.city_center.lat, mapParamData.city_center.lng]);
    let southWest = L.latLng(mapParamData.southwest_boundary.lat, mapParamData.southwest_boundary.lng);
    let northEast = L.latLng(mapParamData.northeast_boundary.lat, mapParamData.northeast_boundary.lng);
    choropleth.setMaxBounds(L.latLngBounds(southWest, northEast));
    choropleth.setZoom(mapParamData.default_zoom);
    if (params.resetButton) {
        $('#reset-button').click(reset);
        function reset() {
            choropleth.setView([mapParamData.city_center.lat, mapParamData.city_center.lng], mapParamData.default_zoom);
        }
    }

    if (params.popupType === 'issueCounts') {
        $.getJSON('/adminapi/choroplethCounts', function (labelCounts) {
            // Append label counts to region data with map/reduce.
            let labelData = _.map(polygonRateData, function(region) {
                let regionLabel = _.find(labelCounts, function(x) { return x.region_id === region.region_id });
                return regionLabel ? regionLabel : { regionId: region.region_id, labels: {} };
            });
            initializeChoropleth(polygonRateData, labelData);
        });
    } else {
        initializeChoropleth(polygonRateData, 'NA');
    }

    // Renders the neighborhood polygons, colored by completion percentage.
    function initializeChoroplethNeighborhoodPolygons(map, rates, layers, labelData) {
         // Default region color, used to check if any regions are missing data.
        let neighborhoodPolygonStyle = params.neighborhoodPolygonStyle;

        // Finds the matching neighborhood's completion percentage, and uses it to determine the fill color.
        function style(feature) {
            if (params.polygonFillMode === 'singleColor') {
                return params.neighborhoodPolygonStyle;
            } else {
                let ratesIndex = rates.findIndex(function(r) { return r.region_id === feature.properties.region_id; });
                if (ratesIndex > -1) {
                    if (params.polygonFillMode === 'issueCount') {
                        return getRegionStyleFromIssueCount(rates[ratesIndex], labelData[ratesIndex].labels)
                    } else {
                        return getRegionStyleFromCompletionRate(rates[ratesIndex]);
                    }
                } else {
                    return neighborhoodPolygonStyle;
                }
            }  
        }

        // Adds popup text, mouseover and click events, etc. to the neighborhood polygons.
        function onEachNeighborhoodFeature(feature, layer) {
            if (params.popupType === 'none') {
                layers.push(layer);

                layer.on('mouseover', function (e) {
                    clearChoroplethRegionMouseoverStyle(layers);
                    addChoroplethRegionMouseoverStyle(this);
                });
                layer.on('mouseout', function (e) {
                    clearChoroplethRegionMouseoverStyle(layers);
                });
            } else {
                let popupContent = '???';
                let ratesIndex = rates.findIndex(function(r) { return r.region_id === feature.properties.region_id; });
                if (ratesIndex > -1) {
                    let regionId = feature.properties.region_id;
                    let regionName = feature.properties.region_name;
                    let userCompleted = feature.properties.user_completed;
                    let url = '/audit/region/' + regionId;
                    let compRate = 100.0 * rates[ratesIndex].rate;
                    let compRateRounded = Math.round(100.0 * rates[ratesIndex].rate);
                    let distanceLeft = rates[ratesIndex].total_distance_m - rates[ratesIndex].completed_distance_m;
                    // If using metric system, convert from meters to km. If using IS system, convert to miles.
                    let measurementSystem = i18next.t('measurement-system');
                    if (measurementSystem === 'metric') distanceLeft *= 0.001;
                    else distanceLeft *= 0.000621371;
                    distanceLeft = Math.round(distanceLeft);
                    let advancedMessage = '';
                    if (difficultRegionIds.includes(feature.properties.region_id)) {
                        advancedMessage = '<br><b>Careful!</b> This neighborhood is not recommended for new users.<br><br>';
                    }
                    if (userCompleted) {
                        popupContent = '<strong>' + regionName + '</strong>: ' +
                            i18next.t('common:map.100-percent-complete') + '<br>' +
                            i18next.t('common:map.thanks');
                    } else if (compRate === 100) {
                        popupContent = '<strong>' + regionName + '</strong>: ' +
                            i18next.t('common:map.100-percent-complete') + '<br>' + advancedMessage +
                            i18next.t('common:map.click-to-help', {url: url, regionId: regionId});
                    } else if (distanceLeft === 0) {
                        popupContent = '<strong>' + regionName + '</strong>: ' +
                            i18next.t('common:map.percent-complete', {percent: compRateRounded}) + '<br>' +
                            i18next.t('common:map.less-than-one-unit-left') + '<br>' + advancedMessage +
                            i18next.t('common:map.click-to-help', {url: url, regionId: regionId});
                    } else if (distanceLeft === 1) {
                        popupContent = '<strong>' + regionName + '</strong>: ' +
                            i18next.t('common:map.percent-complete', {percent: compRateRounded}) + '<br>' +
                            i18next.t('common:map.distance-left-one-unit') + '<br>' + advancedMessage +
                            i18next.t('common:map.click-to-help', {url: url, regionId: regionId});
                    } else {
                        popupContent = '<strong>' + regionName + '</strong>: ' +
                            i18next.t('common:map.percent-complete', {percent: compRateRounded}) + '<br>' +
                            i18next.t('common:map.distance-left', {n: distanceLeft}) + '<br>' + advancedMessage +
                            i18next.t('common:map.click-to-help', {url: url, regionId: regionId});
                    }
                    if (params.popupType === 'issueCounts')
                        popupContent += getIssueCountPopupContent(labelData[ratesIndex].labels)
                }
                // Add listeners to popup so the popup closes when the mouse leaves the popup area.
                layer.bindPopup(popupContent).on('popupopen', () => {
                    let popupWrapper = $('.leaflet-popup-content-wrapper');
                    let popupCloseButton = $('.leaflet-popup-close-button');
                    popupWrapper.on('mouseout', e => {
                        if (e.originalEvent.toElement.classList.contains('leaflet-container')) {
                            clearChoroplethRegionMouseoverStyle(layers);
                            layer.closePopup();
                        }
                    });
                    popupCloseButton.on('mouseout', e => {
                        if (e.originalEvent.toElement.classList.contains('leaflet-container')) {
                            clearChoroplethRegionMouseoverStyle(layers);
                            layer.closePopup();
                        }
                    });
                    // Make sure the region outline is removed when the popup close button is clicked.
                    popupCloseButton.on('click', e => {
                        clearChoroplethRegionMouseoverStyle(layers);
                    });
                });
                layers.push(layer);

                // Update the styles when brushing on/off the neighborhood.
                layer.on('mouseover', function (e) {
                    clearChoroplethRegionMouseoverStyle(layers);
                    addChoroplethRegionMouseoverStyle(this);
                    this.openPopup();
                });
                layer.on('mouseout', function (e) {
                    if (e.originalEvent.toElement.classList.contains('leaflet-container')) {
                        clearChoroplethRegionMouseoverStyle(layers);
                        this.closePopup();
                    }
                });
            }
        }
        
        // Add the neighborhood polygons to the map.
        neighborhoodPolygonLayer = L.geoJson(polygonData, {
            style: style,
            onEachFeature: onEachNeighborhoodFeature
        }).addTo(map);

        if (params.clickData) {
            // Logs when a region is selected from the choropleth and 'Click here' is clicked
            // Logs are of the form 'Click_module=Choropleth_regionId=<regionId>_distanceLeft=<'0', '<1', '1' or '>1'>_target=audit'.
            // Log is stored in WebpageActivityTable
            $('#choropleth').on('click', '.region-selection-trigger', function () {
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

    function clearChoroplethRegionMouseoverStyle(layers) {
        for (let i = layers.length - 1; i >= 0; i--) {
            layers[i].setStyle(params.mouseoutStyle);
        }
    }

    function addChoroplethRegionMouseoverStyle(layer) {
        layer.setStyle(params.mouseoverStyle);
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
        let fillColor = significantData ? getColor(1000.0 * totalIssues / polygonData.completed_distance_m) : '#888';
        let fillOpacity = significantData ? 0.4 + (totalIssues / polygonData.completed_distance_m) : .25;
        return {
            color: '#888',
            weight: 1,
            opacity: 0.25,
            fillColor: fillColor,
            fillOpacity: fillOpacity
        }
    }

    /**
     * This function finds the color for a specific region of the choropleth.
     * 
     * @param {*} polygonData Object from which information about labels is retrieved.
     */
    function getRegionStyleFromCompletionRate(polygonData) {
        return {
            color: '#888',
            weight: 1,
            opacity: 0.25,
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
               '<tr><td><img src="/assets/javascripts/SVLabel/img/cursors/Cursor_NoSidewalk.png"></td>'+
               '<td><img src="/assets/javascripts/SVLabel/img/cursors/Cursor_NoCurbRamp.png"></td>'+
               '<td><img src="/assets/javascripts/SVLabel/img/cursors/Cursor_SurfaceProblem.png"></td>'+
               '<td><img src="/assets/javascripts/SVLabel/img/cursors/Cursor_Obstacle.png"></td>'+
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
            initializeChoroplethNeighborhoodPolygons(choropleth, data, layers, labelData);
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
