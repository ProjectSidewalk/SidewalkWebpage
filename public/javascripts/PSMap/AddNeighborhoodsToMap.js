/**
 * Adds neighborhoods to the map and returns a promise.
 *
 * @param {Object} map The Mapbox map object.
 * @param {Object} neighborhoodGeoJSON - GeoJSON object containing neighborhood polygons to draw on the map.
 * @param {Object} completionRates - Completion rates for each neighborhood.
 * @param {Object} labelCounts - Label counts for each neighborhood.
 * @param {Object} params - Properties that can change the process of choropleth creation.
 * @param {string} params.mapName - Name of the HTML ID of the map.
 * @param {string} params.neighborhoodFillMode - One of 'singleColor', 'completionRate', or 'issueCount'.
 * @param {string} [params.neighborhoodTooltip='none'] One of 'none', 'completionRate', or 'issueCounts'.
 * @param {boolean} [params.logClicks=true] - Whether clicks should be logged when it takes you to the explore page.
 * @param {string} [params.neighborhoodFillColor] - Fill color to use if neighborhoodFillMode='singleColor'.
 * @param {number} [params.neighborhoodFillOpacity] - Fill opacity to use if neighborhoodFillMode='singleColor'
 * @returns {Promise} Promise that resolves when the neighborhoods have been added to the map.
 */
function AddNeighborhoodsToMap(map, neighborhoodGeoJSON, completionRates, labelCounts, params) {
    const NEIGHBORHOOD_LAYER_NAME = 'neighborhood-polygons';
    const NEIGHBORHOOD_OUTLINE_LAYER_NAME = 'neighborhood-polygons-outline';

    // Add the completion rates, label counts, and styling info to the neighborhood GeoJSON.
    let measurementSystem = i18next.t('measurement-system');
    for (let neighborhood of neighborhoodGeoJSON.features) {
        let compRate = completionRates.find(function(r) { return r.region_id === neighborhood.properties.region_id; });
        neighborhood.properties.completionRate = Math.min(100, 100.0 * compRate.rate);
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
            counts = counts ? counts.labels : { };
            neighborhood.properties.NoSidewalk = counts.NoSidewalk ? counts.NoSidewalk : 0;
            neighborhood.properties.NoCurbRamp = counts.NoCurbRamp ? counts.NoCurbRamp : 0;
            neighborhood.properties.SurfaceProblem = counts.SurfaceProblem ? counts.SurfaceProblem : 0;
            neighborhood.properties.Obstacle = counts.Obstacle ? counts.Obstacle : 0;
        }

        // Compute fill color/opacity for each neighborhood.
        let neighborhoodStyle;
        if (params.neighborhoodFillMode === 'singleColor') {
            neighborhoodStyle = { fillColor: params.neighborhoodFillColor, fillOpacity: params.neighborhoodFillOpacity };
        } else if (params.neighborhoodFillMode === 'issueCount') {
            neighborhoodStyle = getRegionStyleFromIssueCount(neighborhood.properties)
        } else if (params.neighborhoodFillMode === 'completionRate') {
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
                    ['boolean', ['feature-state', 'hover'], false], '#000', '#888'
                ],
                'line-width': ['case',
                    ['boolean', ['feature-state', 'hover'], false], 3, 1.5
                ],
                'line-opacity': ['case',
                    ['boolean', ['feature-state', 'hover'], false], 1.0, 0.25
                ]
            }
        });
    }

    function addNeighborhoodClickAndHoverEvents(map) {
        let hoveredRegionId = null;
        const neighborhoodTooltip = new mapboxgl.Popup({ maxWidth: '300px', focusAfterOpen: false, closeOnClick: false });
        map.on('mousemove', NEIGHBORHOOD_LAYER_NAME, (event) => {
            const currRegion = event.features[0];
            let addOrUpdatePopup = false;
            if (hoveredRegionId && hoveredRegionId !== currRegion.properties.region_id) {
                map.setFeatureState({ source: NEIGHBORHOOD_LAYER_NAME, id: hoveredRegionId }, { hover: false });
                hoveredRegionId = currRegion.properties.region_id;
                map.setFeatureState({ source: NEIGHBORHOOD_LAYER_NAME, id: hoveredRegionId }, { hover: true });
                addOrUpdatePopup = true;
            } else if (!hoveredRegionId) {
                hoveredRegionId = currRegion.properties.region_id;
                map.setFeatureState({ source: NEIGHBORHOOD_LAYER_NAME, id: hoveredRegionId }, { hover: true });
                addOrUpdatePopup = true;
            }

            // Adds popup text, mouseover and click events, etc. to the neighborhood polygons.
            if (['completionRate', 'issueCounts'].includes(params.neighborhoodTooltip) && addOrUpdatePopup) {
                let popupContent;
                const regionName = currRegion.properties.region_name;
                const url = '/explore/region/' + hoveredRegionId;
                const compRate = currRegion.properties.completionRate;
                const compRateRounded = Math.floor(compRate);
                const distanceLeftRounded = Math.round(currRegion.properties.dist_remaining_converted);
                if (currRegion.properties.user_completed) {
                    popupContent = '<strong>' + regionName + '</strong>: ' +
                        i18next.t('common:map.100-percent-complete') + '<br>' +
                        i18next.t('common:map.thanks');
                } else if (compRate === 100) {
                    popupContent = '<strong>' + regionName + '</strong>: ' +
                        i18next.t('common:map.100-percent-complete') + '<br>' +
                        i18next.t('common:map.click-to-help', { url: url, regionId: hoveredRegionId });
                } else if (distanceLeftRounded === 0) {
                    popupContent = '<strong>' + regionName + '</strong>: ' +
                        i18next.t('common:map.percent-complete', { percent: compRateRounded }) + '<br>' +
                        i18next.t('common:map.less-than-one-unit-left') + '<br>' +
                        i18next.t('common:map.click-to-help', { url: url, regionId: hoveredRegionId });
                } else if (distanceLeftRounded === 1) {
                    popupContent = '<strong>' + regionName + '</strong>: ' +
                        i18next.t('common:map.percent-complete', { percent: compRateRounded }) + '<br>' +
                        i18next.t('common:map.distance-left-one-unit') + '<br>' +
                        i18next.t('common:map.click-to-help', { url: url, regionId: hoveredRegionId });
                } else {
                    popupContent = '<strong>' + regionName + '</strong>: ' +
                        i18next.t('common:map.percent-complete', { percent: compRateRounded }) + '<br>' +
                        i18next.t('common:map.distance-left', { n: distanceLeftRounded }) + '<br>' +
                        i18next.t('common:map.click-to-help', { url: url, regionId: hoveredRegionId });
                }
                if (params.neighborhoodTooltip === 'issueCounts') {
                    popupContent += getIssueCountPopupContent(currRegion.properties);
                }

                // Set tooltip to center of neighborhood.
                neighborhoodTooltip.setHTML(popupContent);
                const regionCenter = turf.centerOfMass(currRegion).geometry.coordinates;
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
            const pageLostFocus = !e.originalEvent || !e.originalEvent.toElement;
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
                const regionId = parseInt($(this).attr('regionId'));
                const region = neighborhoodGeoJSON.features.find(function(x) { return regionId === x.properties.region_id; });
                const distanceLeftRounded = Math.round(region.properties.dist_remaining_converted);
                let distanceLeftStr;
                if (region.properties.completionRate === 100) distanceLeftStr = '0';
                else if (distanceLeftRounded === 0) distanceLeftStr = '<1';
                else if (distanceLeftRounded === 1) distanceLeftStr = '1';
                else distanceLeftStr = '>1';
                const activity = `Click_module=${params.mapName}_regionId=${regionId}_distanceLeft=${distanceLeftStr}_target=audit`;
                choropleth.logWebpageActivity(activity);
            });
        }
    }

    // Returns the color for a neighborhood based on a gradient.
    function getColorFromGradient(num, gradient) {
        for (let step in gradient) {
            if (num <= step) return gradient[step];
        }
    }

    /**
     * Finds the color for a neighborhood based on issue counts and completion rate (used for Results map).
     */
    function getRegionStyleFromIssueCount(polygonData) {
        const totalIssues = polygonData.NoSidewalk + polygonData.NoCurbRamp + polygonData.SurfaceProblem + polygonData.Obstacle;
        const severityVal = Math.min(100, 1000.0 * totalIssues / polygonData.completed_distance_m);
        const significantData = isNaN(severityVal) ? false : polygonData.completionRate >= 30;
        const neighborhoodColorGradient = {
            10: '#ff99a0',
            20: '#ff8088',
            30: '#ff6670',
            40: '#ff4d58',
            50: '#ff3341',
            60: '#ff1a29',
            70: '#e6000f',
            80: '#cc000e',
            90: '#b3000c',
            100: '#99000a'
        }

        return {
            fillColor: significantData ? getColorFromGradient(severityVal, neighborhoodColorGradient) : '#888',
            fillOpacity: significantData ? 0.4 + (totalIssues / polygonData.completed_distance_m) : .25
        }
    }

    /**
     * Finds the color for a neighborhood based on completion rate (used for landing page map).
     */
    function getRegionStyleFromCompletionRate(polygonData) {
        const neighborhoodColorGradient = {
            10: '#c6dbef',
            20: '#b3d3e8',
            30: '#9ecae1',
            40: '#82badb',
            50: '#6baed6',
            60: '#4292c6',
            70: '#2171b5',
            80: '#08719c',
            90: '#08519c',
            100: '#08306b'
        }
        const compRate = polygonData.completionRate;
        const complete = Math.abs(compRate - 100) < Number.EPSILON;
        return {
            fillColor: complete ? '#03152f' : getColorFromGradient(compRate, neighborhoodColorGradient),
            fillOpacity: 0.35 + (0.4 * compRate / 100)
        }
    }

    /**
     * Gets issue count HTML to add to popups on the results page.
     * @param {*} labelCounts Object from which information about label counts is retrieved.
     */
    function getIssueCountPopupContent(labelCounts) {
        return '<div class="results-images"><table><tbody>'+
            '<tr><td>' + i18next.t('missing-sidewalks') + '<br/></td>'+
            '<td>' + i18next.t('missing-ramps') + '<br/></td>'+
            '<td>' + i18next.t('surface-problems') + '<br/>'+
            '<td>' + i18next.t('sidewalk-obstacles') + '<br/></td></td></tr>' +
            '<tr><td><img src="/assets/images/icons/label_type_icons/NoSidewalk_small.png"></td>'+
            '<td><img src="/assets/images/icons/label_type_icons/NoCurbRamp_small.png"></td>'+
            '<td><img src="/assets/images/icons/label_type_icons/SurfaceProblem_small.png"></td>'+
            '<td><img src="/assets/images/icons/label_type_icons/Obstacle_small.png"></td>'+
            '<tr><td>'+ labelCounts.NoSidewalk +'</td><td>'+ labelCounts.NoCurbRamp +'</td>' +
            '<td>'+ labelCounts.SurfaceProblem +'</td><td>'+ labelCounts.Obstacle +'</td></tr></tbody></table></div>';
    }
}