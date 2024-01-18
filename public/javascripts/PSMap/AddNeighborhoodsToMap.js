/**
 * Adds neighborhoods to the map and returns a promise.
 * @constructor
 * @param {Object} map The Mapbox map object.
 * @param params
 * @param params.mapName {string} name of the HTML ID of the map.
 * @param params.streetParams Params object to pass on to street rendering.
 * @param params.labelParams Params object to pass on to label rendering.
 * @param params.polygonFillMode one of 'singleColor', 'completionRate', or 'issueCount'.
 * @param params.neighborhoodPolygonStyle a default style for the neighborhood polygons.
 * @param params.regionColors list of colors to use along a gradient to fill a neighborhood.
 * @param params.mouseoverStyle style changes to make when mousing over a neighborhood.
 * @param params.mouseoutStyle style changes to make when mousing out of a neighborhood.
 * @param params.popupType {string} one of 'none', 'completionRate', or 'issueCounts'.
 * @param params.logClicks {boolean} whether clicks should be logged when it takes you to the explore page.
 * @param neighborhoodGeoJSON
 * @param completionRates
 * @param labelCounts
 * @returns {Promise} Promise that resolves when the neighborhoods have been added to the map.
 */
function AddNeighborhoods(map, params, neighborhoodGeoJSON, completionRates, labelCounts) {
    const NEIGHBORHOOD_LAYER_NAME = 'neighborhood-polygons';
    const NEIGHBORHOOD_OUTLINE_LAYER_NAME = 'neighborhood-polygons-outline';

    // Add the completion rates, label counts, and styling info to the neighborhood GeoJSON.
    let measurementSystem = i18next.t('measurement-system');
    for (let neighborhood of neighborhoodGeoJSON.features) {
        let compRate = completionRates.find(function(r) { return r.region_id === neighborhood.properties.region_id; });
        neighborhood.properties.completionRate = 100.0 * compRate.rate;
        neighborhood.properties.completed_distance_m = compRate.completed_distance_m;
        neighborhood.properties.total_distance_m = compRate.total_distance_m;
        neighborhood.dist_remaining_m = compRate.total_distance_m - compRate.completed_distance_m;
        if (measurementSystem === 'metric') {
            neighborhood.properties.dist_remaining_converted = neighborhood.dist_remaining_m * 0.001; // Kilometers.
        } else {
            neighborhood.properties.dist_remaining_converted = neighborhood.dist_remaining_m * 0.000621371; // Miles.
        }

        // Add label counts if that's used in the neighborhood tooltip (e.g., Results map).
        if (labelCounts) {
            let counts = labelCounts.find(function(r) { return r.region_id === neighborhood.properties.region_id; });
            neighborhood.properties.NoSidewalk = counts ? counts.labels.NoSidewalk : 0;
            neighborhood.properties.NoCurbRamp = counts ? counts.labels.NoCurbRamp : 0;
            neighborhood.properties.SurfaceProblem = counts ? counts.labels.SurfaceProblem : 0;
            neighborhood.properties.Obstacle = counts ? counts.labels.Obstacle : 0;
        }

        // Compute fill color/opacity for each neighborhood.
        let neighborhoodStyle;
        if (params.polygonFillMode === 'singleColor') {
            neighborhoodStyle = params.neighborhoodPolygonStyle;
        } else if (params.polygonFillMode === 'issueCount') {
            neighborhoodStyle = getRegionStyleFromIssueCount(neighborhood.properties)
        } else if (params.polygonFillMode === 'completionRate') {
            neighborhoodStyle = getRegionStyleFromCompletionRate(neighborhood.properties);
        }
        neighborhood.properties.fillColor = neighborhoodStyle.fillColor;
        neighborhood.properties.fillOpacity = neighborhoodStyle.fillOpacity;
    }

    initializeMapNeighborhoodPolygons(map, neighborhoodGeoJSON);
    addNeighborhoodClickAndHoverEvents(map);

    // Return promise that is resolved once all the layers have been added to the map.
    return new Promise((resolve, reject) => {
        if (map.getLayer(NEIGHBORHOOD_LAYER_NAME) && map.getLayer(NEIGHBORHOOD_OUTLINE_LAYER_NAME)) {
            resolve();
        } else {
            map.on('sourcedataloading', function(e) {
                if (map.getLayer(NEIGHBORHOOD_LAYER_NAME) && map.getLayer(NEIGHBORHOOD_OUTLINE_LAYER_NAME)) {
                    resolve();
                }
            });
        }
    });

    // Renders the neighborhood polygons, colored by completion percentage.
    function initializeMapNeighborhoodPolygons(map, neighborhoodGeoJSON) {

        // Add the neighborhood polygons to the map.
        map.addSource(NEIGHBORHOOD_LAYER_NAME, {
            type: 'geojson',
            data: neighborhoodGeoJSON,
            promoteId: 'region_id'
        });
        map.addLayer({
            id: NEIGHBORHOOD_LAYER_NAME,
            type: 'fill',
            source: NEIGHBORHOOD_LAYER_NAME,
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-outline-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'fillOpacity']
            }
        });
        // Need an extra line layer for the region outlines bc WebGL doesn't render outlines wider than width of 1.
        // https://github.com/mapbox/mapbox-gl-js/issues/3018#issuecomment-240381965
        map.addLayer({
            id: NEIGHBORHOOD_OUTLINE_LAYER_NAME,
            type: 'line',
            source: NEIGHBORHOOD_LAYER_NAME,
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
    }

    function addNeighborhoodClickAndHoverEvents(map) {
        let hoveredRegionId = null;
        const neighborhoodTooltip = new mapboxgl.Popup({ maxWidth: '300px', focusAfterOpen: false, closeOnClick: false });
        map.on('mousemove', NEIGHBORHOOD_LAYER_NAME, (event) => {
            let currRegion = event.features[0];
            let makePopup = false; // TODO figure out something better than this.
            if (hoveredRegionId && hoveredRegionId !== currRegion.properties.region_id) {
                map.setFeatureState({ source: NEIGHBORHOOD_LAYER_NAME, id: hoveredRegionId }, { hover: false });
                hoveredRegionId = currRegion.properties.region_id;
                map.setFeatureState({ source: NEIGHBORHOOD_LAYER_NAME, id: hoveredRegionId }, { hover: true });
                makePopup = true;
            } else if (!hoveredRegionId) {
                hoveredRegionId = currRegion.properties.region_id;
                map.setFeatureState({ source: NEIGHBORHOOD_LAYER_NAME, id: hoveredRegionId }, { hover: true });
                makePopup = true;
            }

            // Adds popup text, mouseover and click events, etc. to the neighborhood polygons.
            if (params.popupType !== 'none' && makePopup) {
                let popupContent;
                let regionName = currRegion.properties.region_name;
                let url = '/explore/region/' + hoveredRegionId;
                let compRate = currRegion.properties.completionRate;
                let compRateRounded = Math.floor(compRate);
                let distanceLeftRounded = Math.round(currRegion.properties.dist_remaining_converted);
                if (currRegion.properties.user_completed) {
                    popupContent = '<strong>' + regionName + '</strong>: ' +
                        i18next.t('common:map.100-percent-complete') + '<br>' +
                        i18next.t('common:map.thanks');
                } else if (compRate === 100) {
                    popupContent = '<strong>' + regionName + '</strong>: ' +
                        i18next.t('common:map.100-percent-complete') + '<br>' +
                        i18next.t('common:map.click-to-help', {url: url, regionId: hoveredRegionId});
                } else if (distanceLeftRounded === 0) {
                    popupContent = '<strong>' + regionName + '</strong>: ' +
                        i18next.t('common:map.percent-complete', {percent: compRateRounded}) + '<br>' +
                        i18next.t('common:map.less-than-one-unit-left') + '<br>' +
                        i18next.t('common:map.click-to-help', {url: url, regionId: hoveredRegionId});
                } else if (distanceLeftRounded === 1) {
                    popupContent = '<strong>' + regionName + '</strong>: ' +
                        i18next.t('common:map.percent-complete', {percent: compRateRounded}) + '<br>' +
                        i18next.t('common:map.distance-left-one-unit') + '<br>' +
                        i18next.t('common:map.click-to-help', {url: url, regionId: hoveredRegionId});
                } else {
                    popupContent = '<strong>' + regionName + '</strong>: ' +
                        i18next.t('common:map.percent-complete', {percent: compRateRounded}) + '<br>' +
                        i18next.t('common:map.distance-left', {n: distanceLeftRounded}) + '<br>' +
                        i18next.t('common:map.click-to-help', {url: url, regionId: hoveredRegionId});
                }
                if (params.popupType === 'issueCounts') {
                    popupContent += getIssueCountPopupContent(currRegion.properties);
                }

                // Set tooltip to center of neighborhood.
                neighborhoodTooltip.setHTML(popupContent);
                let regionCenter = turf.centerOfMass(turf.polygon(currRegion.geometry.coordinates)).geometry.coordinates;
                neighborhoodTooltip.setLngLat({ lng: regionCenter[0], lat: regionCenter[1] }).addTo(map);

                // Add listeners to popup so the popup closes when the mouse leaves the popup area.
                neighborhoodTooltip._content.onmouseout = function (e) {
                    if (!e.toElement || !e.toElement.closest('.mapboxgl-popup')) {
                        map.setFeatureState({ source: NEIGHBORHOOD_LAYER_NAME, id: hoveredRegionId }, { hover: false });
                        neighborhoodTooltip.remove();
                        hoveredRegionId = null;
                    }
                };
                // Make sure the region outline is removed when the popup close button is clicked.
                neighborhoodTooltip._content.querySelector('.mapboxgl-popup-close-button').onclick = function(e) {
                    map.setFeatureState({ source: NEIGHBORHOOD_LAYER_NAME, id: hoveredRegionId }, { hover: false });
                    neighborhoodTooltip.remove();
                    hoveredRegionId = null;
                };
            }
        });

        // Remove neighborhood polygon outline when mouse no longer on any neighborhood.
        map.on('mouseleave', NEIGHBORHOOD_LAYER_NAME, (e) => {
            let pageLostFocus = !e.originalEvent || !e.originalEvent.toElement;
            // Only remove the outline if the mouse is not over the popup.
            if (hoveredRegionId !== null && (pageLostFocus || !e.originalEvent.toElement.closest('.mapboxgl-popup'))) {
                map.setFeatureState({ source: NEIGHBORHOOD_LAYER_NAME, id: hoveredRegionId }, { hover: false });
                neighborhoodTooltip.remove();
                hoveredRegionId = null;
            }
        });

        if (params.logClicks) {
            // Logs to the webpage_activity table when a region is selected from the map and 'Click here' is clicked.
            // Logs are of the form 'Click_module=<mapName>_regionId=<regionId>_distanceLeft=<'0', '<1', '1' or '>1'>_target=audit'.
            $(`#${params.mapName}`).on('click', '.region-selection-trigger', function () {
                let regionId = parseInt($(this).attr('regionId'));
                let region = neighborhoodGeoJSON.features.find(function(x) { return regionId === x.properties.region_id; });
                let distanceLeftRounded = Math.round(region.properties.dist_remaining_converted);
                let distanceLeftStr;
                if (region.properties.completionRate === 100) distanceLeftStr = '0';
                else if (distanceLeftRounded === 0) distanceLeftStr = '<1';
                else if (distanceLeftRounded === 1) distanceLeftStr = '1';
                else distanceLeftStr = '>1';
                let activity = `Click_module=${params.mapName}_regionId=${regionId}_distanceLeft=${distanceLeftStr}_target=audit`;
                choropleth.logWebpageActivity(activity);
            });
        }
    }

    /**
     * Takes a completion percentage, bins it, and returns the appropriate color for a choropleth.
     *
     * @param p {number} represents a completion percentage, between 0 and 100
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
     * Finds the color for a neighborhood based on issue counts and completion rate (used for Results map).
     */
    function getRegionStyleFromIssueCount(polygonData) {
        let totalIssues = polygonData.NoSidewalk + polygonData.NoCurbRamp + polygonData.SurfaceProblem + polygonData.Obstacle;
        let significantData = polygonData.completionRate >= 30;
        return {
            fillColor: significantData ? getColor(1000.0 * totalIssues / polygonData.completed_distance_m) : '#888',
            fillOpacity: significantData ? 0.4 + (totalIssues / polygonData.completed_distance_m) : .25
        }
    }

    /**
     * Finds the color for a neighborhood based on completion rate (used for landing page map).
     */
    function getRegionStyleFromCompletionRate(polygonData) {
        return {
            fillColor: getColor(polygonData.completionRate),
            fillOpacity: 0.35 + (0.4 * polygonData.completionRate / 100)
        }
    }

    /**
     * Gets issue count HTML to add to popups on the results page.
     *
     * @param {*} labelCounts Object from which information about label counts is retrieved.
     */
    function getIssueCountPopupContent(labelCounts) {
        return '<div class="results-images"><table><tbody>'+
            '<tr><td>' + i18next.t('missing-sidewalks') + '<br/></td>'+
            '<td>' + i18next.t('missing-ramps') + '<br/></td>'+
            '<td>' + i18next.t('surface-problems') + '<br/>'+
            '<td>' + i18next.t('sidewalk-obstacles') + '<br/></td></td></tr>' +
            '<tr><td><img src="/assets/javascripts/SVLabel/img/icons/NoSidewalk_small.png"></td>'+
            '<td><img src="/assets/javascripts/SVLabel/img/icons/NoCurbRamp_small.png"></td>'+
            '<td><img src="/assets/javascripts/SVLabel/img/icons/SurfaceProblem_small.png"></td>'+
            '<td><img src="/assets/javascripts/SVLabel/img/icons/Obstacle_small.png"></td>'+
            '<tr><td>'+ labelCounts.NoSidewalk +'</td><td>'+ labelCounts.NoCurbRamp +'</td>' +
            '<td>'+ labelCounts.SurfaceProblem +'</td><td>'+ labelCounts.Obstacle +'</td></tr></tbody></table></div>';
    }
}