/**
 * Central function that handles the creation of choropleths and maps.
 * @param _ Allows the use of Underscore.js
 * @param $ Allows the use of jQuery.
 * @param difficultRegionIds Used to identify difficult regions.
 * @param params Object that includes properties that can change the process of choropleth creation.
 * @param layers Object that receives data during execution to pass outside of this function.
 * @param polygonData Data concerning which neighborhood polygons are to be rendered.
 * @param polygonRateData Rate data of each neighborhood polygon.
 * @param mapParamData Data used to initialize the choropleth properties.
 */
function Choropleth(_, $, difficultRegionIds, params, layers, polygonData, polygonRateData, mapParamData) {
    var labelText = {
        "NoSidewalk": "Missing Sidewalks",
        "NoCurbRamp": "Missing Curb Ramps",
        "SurfaceProblem": "Surface Problems",
        "Obstacle": "Obstacles",
    };
    
    // Create base map.
    L.mapbox.accessToken = params.accessToken;
    var choropleth = L.mapbox.map(params.mapName, params.mapStyle, {
        maxZoom: 19,
        minZoom: 9,
        zoomControl: params.zoomControl,
        zoomSnap: 0.5
    });

    if (params.disableScrollWheel) choropleth.scrollWheelZoom.disable();
    if (params.zoomSlider) L.control.zoomslider().addTo(choropleth);

    // Set the city-specific default zoom, location, and max bounding box to prevent the user from panning away.
    choropleth.setView([mapParamData.city_center.lat, mapParamData.city_center.lng]);
    var southWest = L.latLng(mapParamData.southwest_boundary.lat, mapParamData.southwest_boundary.lng);
    var northEast = L.latLng(mapParamData.northeast_boundary.lat, mapParamData.northeast_boundary.lng);
    choropleth.setMaxBounds(L.latLngBounds(southWest, northEast));
    choropleth.setZoom(mapParamData.default_zoom);
    if (params.resetButton) {
        $("#reset-button").click(reset);
        function reset() {
            choropleth.setView([mapParamData.city_center.lat, mapParamData.city_center.lng], mapParamData.default_zoom);
        }
    }
    if (params.overlayPolygon) initializeOverlayPolygon(choropleth, mapParamData.city_center.lat, mapParamData.city_center.lng);

    /**
     * Adds a semi-transparent white polygon on top of a map.
     */
    function initializeOverlayPolygon(map, lat, lng) {
        var overlayPolygon = {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "geometry": {
                "type": "Polygon", "coordinates": [
                        [
                            [lng + 2, lat - 2],
                            [lng + 2, lat + 2],
                            [lng - 2, lat + 2],
                            [lng - 2, lat - 2],
                            [lng + 2, lat - 2]
                        ]
                ]}}]};
        var layer = L.geoJson(overlayPolygon);
        layer.setStyle({color: "#ccc", fillColor: "#ccc"});
        layer.addTo(map);
    }

    // Renders the neighborhood polygons, colored by completion percentage.
    function initializeChoroplethNeighborhoodPolygons(map, rates, layers) {
        var regionData;
         // Default region color, used to check if any regions are missing data.
        var neighborhoodPolygonStyle = params.neighborhoodPolygonStyle
        var currentLayer;

        // Finds the matching neighborhood's completion percentage, and uses it to determine the fill color.
        function style(feature) {
            if (params.singleRegionColor) {
                return params.neighborhoodPolygonStyle;
            } else {
                for (var i = 0; i < rates.length; i++) {
                    if (rates[i].region_id === feature.properties.region_id) {
                        if (params.choroplethType === 'results') {
                            return getRegionStyleFromIssueCount(rates[i])
                        } else {
                            return getRegionStyleFromCompletionRate(rates[i]);
                        }
                    }
                }
                return neighborhoodPolygonStyle; // default case (shouldn't happen, will be bright red)
            }  
        }

        function onEachNeighborhoodFeature(feature, layer) {
            var regionId = feature.properties.region_id;
            var regionName = feature.properties.region_name;
            var userCompleted = feature.properties.user_completed;
            var compRate = -1.0;
            var url = "/audit/region/" + regionId;
            var popupContent = "???";
            for (var i = 0; i < rates.length; i++) {
                if (rates[i].region_id === feature.properties.region_id) {
                    var measurementSystem = i18next.t('measurement-system');
                    compRate = Math.round(100.0 * rates[i].rate);
                    distanceLeft = rates[i].total_distance_m - rates[i].completed_distance_m;
                    // If using metric system, convert from meters to km. If using IS system, convert to miles.
                    if (measurementSystem === "metric") distanceLeft *= 0.001;
                    else distanceLeft *= 0.000621371;
                    distanceLeft = Math.round(distanceLeft);
                    var advancedMessage = '';
                    if (difficultRegionIds.includes(feature.properties.region_id)) {
                        advancedMessage = '<br><b>Careful!</b> This neighborhood is not recommended for new users.<br><br>';
                    }
                    if (userCompleted) {
                        popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("common:map.100-percent-complete") + "<br>" +
                            i18next.t("common:map.thanks");
                    } else if (compRate === 100) {
                        popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("common:map.100-percent-complete") + "<br>" + advancedMessage +
                            i18next.t("common:map.click-to-help", { url: url, regionId: regionId });
                    } else if (distanceLeft === 0) {
                        popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("common:map.percent-complete", { percent: compRate }) + "<br>" +
                            i18next.t("common:map.less-than-one-unit-left") + "<br>" + advancedMessage +
                            i18next.t("common:map.click-to-help", { url: url, regionId: regionId });
                    } else if (distanceLeft === 1) {
                        var popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("common:map.percent-complete", { percent: compRate }) + "<br>" +
                            i18next.t("common:map.distance-left-one-unit") + "<br>" + advancedMessage +
                            i18next.t("common:map.click-to-help", { url: url, regionId: regionId });
                    } else {
                        var popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("common:map.percent-complete", { percent: compRate }) + "<br>" +
                            i18next.t("common:map.distance-left", { n: distanceLeft }) + "<br>" + advancedMessage +
                            i18next.t("common:map.click-to-help", { url: url, regionId: regionId });
                    }
                    if (params.choroplethType === 'results') popupContent += setAccessibilityChoroplethPopupContent(rates[i])
                    break;
                }
            }
            layer.bindPopup(popupContent);
            layers.push(layer);
            
            layer.on('mouseover', function (e) {
                this.setStyle(params.mouseoverStyle);
                this.openPopup()
            });
            layer.on('mouseout', function (e) {
                for (var i = layers.length - 1; i >= 0; i--) {
                    if (currentLayer !== layers[i])
                        layers[i].setStyle(params.mouseoutStyle);
                }
            });

            if (params.clickData) {
                layer.on('click', function (e) {
                    currentLayer = this;

                    // Log when a user clicks on a region on the choropleth. Stored in WebpageActivityTable.
                    // Logs are of the form "Click_module=Choropleth_regionId=<regionId>_distanceLeft=<"0", "<1", "1" or ">1">_target=inspect"
                    var regionId = e.target.feature.properties.region_id;
                    var ratesEl = rates.find(function(x) {
                        return regionId === x.region_id;
                    });
                    var compRate = Math.round(100.0 * ratesEl.rate);
                    var milesLeft = Math.round(0.000621371 * (ratesEl.total_distance_m - ratesEl.completed_distance_m));
                    var distanceLeft = "";
                    if (compRate === 100) {
                        distanceLeft = "0";
                    }
                    else if (milesLeft === 0) {
                        distanceLeft = "<1";
                    }
                    else if (milesLeft === 1) {
                        distanceLeft = "1";
                    }
                    else {
                        distanceLeft = ">1";
                    }
                    var activity = params.webpageActivity+regionId+"_distanceLeft="+distanceLeft+"_target=inspect";
                    postToWebpageActivity(activity);
                });
            }
        }
        
        // Add the neighborhood polygons to the map.
        regionData = polygonData;
        neighborhoodPolygonLayer = L.geoJson(polygonData, {
            style: style,
            onEachFeature: onEachNeighborhoodFeature
        })
        .addTo(map);

        if (params.clickData) {
            // Logs when a region is selected from the choropleth and 'Click here' is clicked
            // Logs are of the form "Click_module=Choropleth_regionId=<regionId>_distanceLeft=<"0", "<1", "1" or ">1">_target=audit"
            // Log is stored in WebpageActivityTable
            $("#choropleth").on('click', '.region-selection-trigger', function () {
                var regionId = $(this).attr('regionId');
                var ratesEl = rates.find(function(x){
                    return regionId === x.region_id;
                });
                var compRate = Math.round(100.0 * ratesEl.rate);
                var milesLeft = Math.round(0.000621371 * (ratesEl.total_distance_m - ratesEl.completed_distance_m));
                var distanceLeft = "";
                if (compRate === 100){
                    distanceLeft = "0";
                }
                else if (milesLeft === 0){
                    distanceLeft = "<1";
                }
                else if (milesLeft === 1){
                    distanceLeft = "1";
                }
                else{
                    distanceLeft = ">1";
                }
                var activity = params.webpageActivity+regionId+"_distanceLeft="+distanceLeft+"_target=audit";
                postToWebpageActivity(activity);   
            });
        }
        return regionData;
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
     * @param {*} polygonData Object from which information about labels is retrieved.
     */
    function getRegionStyleFromIssueCount(polygonData) {
        var totalIssues = 0;
        for (var issue in polygonData.labels) {
            if (polygonData.labels.hasOwnProperty(issue)) {
                totalIssues += polygonData.labels[issue];
            }
        }
        var significantData = polygonData.rate >= .3;
        var fillColor = significantData ? getColor(1000.0 * totalIssues / polygonData.completed_distance_m) : '#888';
        var fillOpacity = significantData ? 0.4 + (totalIssues / polygonData.completed_distance_m) : .25;
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
     * This function sets the specific popup content of each region of the accessibility choropleth.
     * 
     * @param {*} rate Object from which information about labels is retrieved.
     */
    function setAccessibilityChoroplethPopupContent(rate) {
        var labels = rate.labels;
        var counts = {};
        for (var j in labelText) {
            if (typeof labels[j] != 'undefined')
                counts[j] = labels[j];
            else
                counts[j] = 0;
        }
        return '<div class="resultsImages"><table><tbody>'+
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

    if (params.choroplethType === 'results') {
        $.getJSON('/adminapi/choroplethCounts', function (labelCounts) {
            //append label counts to region data with map/reduce
            var regionData = _.map(polygonRateData, function(region) {
                var regionLabel = _.find(labelCounts, function(x){ return x.region_id == region.region_id });
                region.labels = regionLabel ? regionLabel.labels : {};
                return region;
            });
            initializeChoropleth(regionData);
        });
    } else {
        initializeChoropleth(polygonRateData);
    }   

    /**
     * This function takes data and initializes the choropleth with it.
     * 
     * @param {*} data The data to initialize the regions of the choropleth with.
     */
    function initializeChoropleth(data) {
        // make a choropleth of neighborhood completion percentages
        initializeChoroplethNeighborhoodPolygons(choropleth, data, layers);
        $('#loadingChoropleth').hide();
    }
    
    // Makes POST request that logs `activity` in WebpageActivityTable
    function postToWebpageActivity(activity) {
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: "/userapi/logWebpageActivity",
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
