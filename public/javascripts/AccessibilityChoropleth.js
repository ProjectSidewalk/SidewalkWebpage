function AccessibilityChoropleth(_, $, turf, difficultRegionIds) {
    var neighborhoodPolygonLayer;

// Construct a bounding box for these maps that the user cannot move out of
// https://www.mapbox.com/mapbox.js/example/v1.0.0/maxbounds/
    var southWest = L.latLng(38.761, -77.262);
    var northEast = L.latLng(39.060, -76.830);
    var bounds = L.latLngBounds(southWest, northEast);

// var tileUrl = "https://a.tiles.mapbox.com/v4/kotarohara.mmoldjeh/page.html?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA#13/38.8998/-77.0638";
    var tileUrl = "https:\/\/a.tiles.mapbox.com\/v4\/kotarohara.8e0c6890\/{z}\/{x}\/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA";
    var mapboxTiles = L.tileLayer(tileUrl, {
        attribution: '<a href="http://www.mapbox.com/about/maps/" target="_blank">Terms &amp; Feedback</a>'
    });

    var labelText = {
        "NoSidewalk":"Missing Sidewalks",
        "NoCurbRamp": "Missing Curb Ramps",
        "SurfaceProblem": "Surface Problems",
        "Obstacle": "Obstacles",
    };

// a grayscale tileLayer for the choropleth
    L.mapbox.accessToken = 'pk.eyJ1IjoibWlzYXVnc3RhZCIsImEiOiJjajN2dTV2Mm0wMDFsMndvMXJiZWcydDRvIn0.IXE8rQNF--HikYDjccA7Ug';
    var choropleth = L.mapbox.map('choropleth', "kotarohara.8e0c6890", {
        // set that bounding box as maxBounds to restrict moving the map
        // see full maxBounds documentation:
        // http://leafletjs.com/reference.html#map-maxbounds
        maxBounds: bounds,
        maxZoom: 19,
        minZoom: 9,
        zoomControl: false,
        legendControl: {
            position: 'topright'
        }
    })
        .fitBounds(bounds)
        .setView([38.892, -77.038], 12);
    choropleth.scrollWheelZoom.disable();

    L.mapbox.styleLayer('mapbox://styles/mapbox/light-v9').addTo(choropleth);

    L.control.zoomslider().addTo(choropleth);


    /**
     * Takes number of labels per km, and returns the appropriate color for a choropleth.
     *
     * @param p {float} represents number of labels per km
     * @returns {string} color in hex
     */

    function getColor(p) {
        return p > 90 ? '#99000a' :
            p > 80 ? '#b3000c' :
                p > 70 ? '#cc000e' :
                    p > 60 ? '#e6000f' :
                        p > 50 ? '#ff1a29' :
                            p > 40 ? '#ff3341' :
                                p > 30 ? '#ff4d58' :
                                    p > 20 ? '#ff6670' :
                                        p > 10 ? '#ff8088' :
                                            '#ff99a0';
    }

    /**
     * render the neighborhood polygons, colored by num of labels per km
     */
    function initializeChoroplethNeighborhoodPolygons(map, rates) {
        var neighborhoodPolygonStyle = { // default black, used to check if any regions are missing data
                color: '#000',
                weight: 1,
                opacity: 0.25,
                fillColor: "#f00",
                fillOpacity: 1.0
            },
            layers = [],
            currentLayer;

        // finds matching neighborhood's completion percentage and num labels/km, uses it to determine the fill color
        function style(feature) {
            for (var i = 0; i < rates.length; i++) {
                if (rates[i].region_id === feature.properties.region_id) {
                    var totalIssues = 0;
                    for(var issue in rates[i].labels){
                        totalIssues += rates[i].labels[issue];
                    }

                    var significantData = rates[i].rate >= .3;
                    var fillColor = significantData ? getColor(1000.0 * totalIssues/rates[i].completed_distance_m) : '#888';
                    var fillOpacity = significantData ? 0.4 + (totalIssues/rates[i].completed_distance_m) : .25;
                    return {
                        color: '#888',
                        weight: 1,
                        opacity: 0.25,
                        fillColor: fillColor,
                        fillOpacity: fillOpacity
                    }
                }
            }
            return neighborhoodPolygonStyle; // default case (shouldn't happen, will be bright red)
        }

        function onEachNeighborhoodFeature(feature, layer) {

            var regionId = feature.properties.region_id,
                regionName = feature.properties.region_name,
                compRate = -1.0,
                milesLeft = -1.0,
                url = "/audit/region/" + regionId,
                popupContent = "";
            for (var i = 0; i < rates.length; i++) {
                if (rates[i].region_id === feature.properties.region_id) {
                    compRate = Math.round(100.0 * rates[i].rate);
                    milesLeft = Math.round(0.000621371 * (rates[i].total_distance_m - rates[i].completed_distance_m));

                    var advancedMessage = '';
                    if(difficultRegionIds.includes(feature.properties.region_id)) {
                           advancedMessage = '<br><b>Careful!</b> This neighborhood is not recommended for new users.<br><br>';
                    }

                    if (compRate === 100) {
                        popupContent = "<strong>" + regionName + "</strong>: " + compRate + "\% Complete!<br>" + advancedMessage +
                            "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Click here</a>" +
                            " to find accessibility issues in this neighborhood yourself!";
                    }
                    else if (milesLeft === 0) {
                        popupContent = "<strong>" + regionName + "</strong>: " + compRate +
                            "\% Complete<br>Less than a mile left!<br>" + advancedMessage +
                            "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Click here</a>" +
                            " to help finish this neighborhood!";
                    }
                    else if (milesLeft === 1) {
                        var popupContent = "<strong>" + regionName + "</strong>: " + compRate + "\% Complete<br>Only " +
                            milesLeft + " mile left!<br>" + advancedMessage +
                            "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Click here</a>" +
                            " to help finish this neighborhood!";
                    }
                    else {
                        var popupContent = "<strong>" + regionName + "</strong>: " + compRate + "\% Complete<br>Only " +
                            milesLeft + " miles left!<br>" + advancedMessage +
                            "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Click here</a>" +
                            " to help finish this neighborhood!";
                    }

                    var labels = rates[i].labels;
                    var counts = {};
                    for(var j in labelText){
                        if(typeof labels[j] != 'undefined')
                            counts[j] = labels[j];
                        else
                            counts[j] = 0;
                    }

                    popupContent += '<div class="resultsImages"><table><tbody>'+
                                    '<tr><td>Missing Sidewalks<br/>'+
                                    '</td><td>Missing Ramps<br/>'+
                                    '</td><td>Surface Problems<br/>'+
                                    '</td><td>Sidewalk Obstacles<br/>'+
                                    '</td></tr>'+
                                    '<tr><td><img src="/assets/javascripts/SVLabel/img/cursors/Cursor_Other.png"></td>'+
                                    '<td><img src="/assets/javascripts/SVLabel/img/cursors/Cursor_NoCurbRamp.png"></td>'+
                                    '<td><img src="/assets/javascripts/SVLabel/img/cursors/Cursor_SurfaceProblem.png"></td>'+
                                    '<td><img src="/assets/javascripts/SVLabel/img/cursors/Cursor_Obstacle.png"></td>'+
                                    '<tr><td>'+ counts['NoSidewalk'] +'</td><td>'+ counts['NoCurbRamp'] +'</td><td>'+ counts['SurfaceProblem'] +'</td><td>'+ counts['Obstacle'] +'</td></tr></tbody></table></div>'

                    break;
                }
            }
            layer.bindPopup(popupContent);
            layers.push(layer);

            layer.on('mouseover', function (e) {
                this.setStyle({opacity: 1.0, weight: 3, color: "#000"});

            });
            layer.on('mouseout', function (e) {
                for (var i = layers.length - 1; i >= 0; i--) {
                    if (currentLayer !== layers[i])
                        layers[i].setStyle({opacity: 0.25, weight: 1});
                }
            });
            layer.on('click', function (e) {
                var center = turf.center(this.feature),
                    coordinates = center.geometry.coordinates,
                    latlng = L.latLng(coordinates[1], coordinates[0]),
                    zoom = map.getZoom();
                zoom = zoom > 14 ? zoom : 14;

                map.setView(latlng, zoom, {animate: true});
                currentLayer = this;


                // Log when a user clicks on a region on the choropleth
                // Logs are of the form "Click_module=Choropleth_regionId=<regionId>_distanceLeft=<"0", "<1", "1" or ">1">_target=inspect"
                // Log is stored in WebpageActivityTable
                var regionId = e.target.feature.properties.region_id;
                var ratesEl = rates.find(function(x){
                    return regionId == x.region_id;
                });
                var compRate = Math.round(100.0 * ratesEl.rate);
                var milesLeft = Math.round(0.000621371 * (ratesEl.total_distance_m - ratesEl.completed_distance_m));
                var distanceLeft = "";
                if(compRate === 100){
                    distanceLeft = "0";
                }
                else if(milesLeft === 0){
                    distanceLeft = "<1";
                }
                else if(milesLeft === 1){
                    distanceLeft = "1";
                }
                else{
                    distanceLeft = ">1";
                }
                var activity = "Click_module=ResultsChoropleth_regionId="+regionId+"_distanceLeft="+distanceLeft+"_target=inspect";
                postToWebpageActivity(activity);
            });
        }

        // adds the neighborhood polygons to the map
        $.getJSON("/neighborhoods", function (data) {
            neighborhoodPolygonLayer = L.geoJson(data, {
                style: style,
                onEachFeature: onEachNeighborhoodFeature
            })
                .addTo(map);
        });


        // Logs when a region is selected from the choropleth and 'Click here' is clicked
        // Logs are of the form "Click_module=Choropleth_regionId=<regionId>_distanceLeft=<"0", "<1", "1" or ">1">_target=audit"
        // Log is stored in WebpageActivityTable
        $("#choropleth").on('click', '.region-selection-trigger', function () {
            var regionId = $(this).attr('regionId');
            var ratesEl = rates.find(function(x){
                return regionId == x.region_id;
            });
            var compRate = Math.round(100.0 * ratesEl.rate);
            var milesLeft = Math.round(0.000621371 * (ratesEl.total_distance_m - ratesEl.completed_distance_m));
            var distanceLeft = "";
            if(compRate === 100){
                distanceLeft = "0";
            }
            else if(milesLeft === 0){
                distanceLeft = "<1";
            }
            else if(milesLeft === 1){
                distanceLeft = "1";
            }
            else{
                distanceLeft = ">1";
            }

            var data = "Click_module=ResultsChoropleth_regionId="+regionId+"_distanceLeft="+distanceLeft+"_target=audit";
            postToWebpageActivity(data);
        });
    }


    $.getJSON('/adminapi/neighborhoodCompletionRate', function (data) {
        //console.log(data);

        $.getJSON('/adminapi/choroplethCounts', function (labelCounts) {

            //append label counts to region data with map/reduce
            var regionData = _.map(data, function(region){
                var regionLabel = _.find(labelCounts, function(x){ return x.region_id == region.region_id });
                region.labels = regionLabel ? regionLabel.labels : {};
                return region;
            })

            // make a choropleth of neighborhood completion percentages
            initializeChoroplethNeighborhoodPolygons(choropleth, regionData);
            choropleth.legendControl.addLegend(document.getElementById('legend').innerHTML);
            setTimeout(function () {
                choropleth.invalidateSize(false);
            }, 1);
            $('#loadingChoropleth').hide();
        });
    });

    // Makes POST request that logs `activity` in WebpageActivityTable
    function postToWebpageActivity(activity){
        var url = "/userapi/logWebpageActivity";
        var async = true;
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'post',
            data: JSON.stringify(activity),
            dataType: 'json',
            success: function(result){},
            error: function (result) {
                console.error(result);
            }
        });
    }
}
