function Progress (_, $, c3, L, role, difficultRegionIds) {
    var self = {};
    var completedInitializingOverlayPolygon = false;
    var completedInitializingNeighborhoodPolygons = false;
    var completedInitializingAuditedStreets = false;
    var completedInitializingSubmittedLabels = false;
    var completedInitializingAuditCountChart = false;
    var completedInitializingAuditedTasks = false;

    var neighborhoodPolygonStyle = {
            color: '#888',
            weight: 1,
            opacity: 0.25,
            fillColor: "#ccc",
            fillOpacity: 0.1
        },
        layers = [],
        currentLayer;

    var _data = {
        neighborhoodPolygons: null,
        streets: null,
        labels: null,
        tasks: null,
        interactions: null
    };

    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';

    // Construct a bounding box for this map that the user cannot move out of
    // https://www.mapbox.com/mapbox.js/example/v1.0.0/maxbounds/
    var southWest = L.latLng(38.761, -77.262),
        northEast = L.latLng(39.060, -76.830),
        bounds = L.latLngBounds(southWest, northEast),

    // var tileUrl = "https://a.tiles.mapbox.com/v4/kotarohara.mmoldjeh/page.html?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA#13/38.8998/-77.0638";
        tileUrl = "https:\/\/a.tiles.mapbox.com\/v4\/kotarohara.8e0c6890\/{z}\/{x}\/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA",
        mapboxTiles = L.tileLayer(tileUrl, {
            attribution: '<a href="http://www.mapbox.com/about/maps/" target="_blank">Terms &amp; Feedback</a>'
        }),
        map = L.mapbox.map('map', "kotarohara.8e0c6890", {
            // set that bounding box as maxBounds to restrict moving the map
            // see full maxBounds documentation:
            // http://leafletjs.com/reference.html#map-maxbounds
            maxBounds: bounds,
            maxZoom: 19,
            minZoom: 9
        })
        // .addLayer(mapboxTiles)
            .fitBounds(bounds)
            .setView([38.892, -77.038], 12);

    var popup = L.popup().setContent('<p>Hello!</p>');

    function handleInitializationComplete (map) {
        if (completedInitializingOverlayPolygon &&
            completedInitializingNeighborhoodPolygons &&
            completedInitializingAuditedStreets &&
            completedInitializingSubmittedLabels &&
            completedInitializingAuditCountChart &&
            completedInitializingAuditedTasks
        ) {

            // Search for a region id in the query string. If you find one, focus on that region.
            var regionId = util.getURLParameter("regionId"),
                i,
                len;
            if (regionId && layers) {
                len = layers.length;
                for (i = 0; i < len; i++) {
                    if ("feature" in layers[i] && "properties" in layers[i].feature && regionId == layers[i].feature.properties.region_id) {
                        var center = turf.center(layers[i].feature),
                            coordinates = center.geometry.coordinates,
                            latlng = L.latLng(coordinates[1], coordinates[0]),
                            zoom = map.getZoom();
                        zoom = zoom > 14 ? zoom : 14;

                        map.setView(latlng, zoom, {animate: true});
                        layers[i].setStyle({color: "red", fillColor: "red"});
                        currentLayer = layers[i];
                        break;
                    }
                }
            }
        }
    }

    /**
     * This function adds a semi-transparent white polygon on top of a map
     */
    function initializeOverlayPolygon (map) {
        var overlayPolygon = {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "geometry": {
                "type": "Polygon", "coordinates": [
                    [[-75, 36], [-75, 40], [-80, 40], [-80, 36],[-75, 36]]
                ]}}]};
        L.geoJson(overlayPolygon).addTo(map);
        completedInitializingOverlayPolygon = true;
        handleInitializationComplete(map);
    }

    /**
     * render points
     */
    function initializeNeighborhoodPolygons(map, rates) {
        function onEachNeighborhoodFeature(feature, layer) {

            var regionId = feature.properties.region_id,
                regionName = feature.properties.region_name,
                url = "/audit/region/" + regionId,
                // default popup content if we don't find neighborhood in list of neighborhoods from query
                popupContent = "Do you want to find accessibility problems in " + regionName + "? " +
                    "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Sure!</a>",
                compRate = 0,
                milesLeft = 0;
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
                    break;
                }
            }
            layer.bindPopup(popupContent);
            layers.push(layer);

            layer.on('mouseover', function (e) {
                this.setStyle({color: "red", fillColor: "red"});

            });
            layer.on('mouseout', function (e) {
                for (var i = layers.length - 1; i >= 0; i--) {
                    if (currentLayer !== layers[i])
                        layers[i].setStyle(neighborhoodPolygonStyle);
                }
                //this.setStyle(neighborhoodPolygonStyle);
            });
            layer.on('click', function (e) {
                currentLayer = this;


                // Log when a user clicks on a region on the user map
                // Logs are of the form "Click_module=UserMap_regionId=<regionId>_distanceLeft=<"0", "<1", "1" or ">1">_target=inspect"
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
                var url = "/userapi/logWebpageActivity";
                var async = true;
                var data = "Click_module=UserMap_regionId="+regionId+"_distanceLeft="+distanceLeft+"_target=inspect";
                $.ajax({
                    async: async,
                    contentType: 'application/json; charset=utf-8',
                    url: url,
                    type: 'post',
                    data: JSON.stringify(data),
                    dataType: 'json',
                    success: function (result) {
                    },
                    error: function (result) {
                        console.error(result);
                    }
                });
            });

        }

        $.getJSON("/neighborhoods", function (data) {
            _data.neighborhoodPolygons = data;

            L.geoJson(data, {
                style: function (feature) {
                    return $.extend(true, {}, neighborhoodPolygonStyle);
                },
                onEachFeature: onEachNeighborhoodFeature
            })
                .addTo(map);
            completedInitializingNeighborhoodPolygons = true;
            handleInitializationComplete(map);
        });


        // Logs when a region is selected from the user map and 'Click here' is clicked
        // Logs are of the form "Click_module=UserMap_regionId=<regionId>_distanceLeft=<"0", "<1", "1" or ">1">_target=audit"
        // Log is stored in WebpageActivityTable
        $("#map").on('click', '.region-selection-trigger', function () {
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
            var url = "/userapi/logWebpageActivity";
            var async = true;
            var data = "Click_UserMap_regionId="+regionId+"_distanceLeft="+distanceLeft+"_target=audit";
            $.ajax({
                async: async,
                contentType: 'application/json; charset=utf-8',
                url: url,
                type: 'post',
                data: JSON.stringify(data),
                dataType: 'json',
                success: function (result) {
                },
                error: function (result) {
                    console.error(result);
                }
            });
        });
    }

    /**
     * This function queries the streets that the user audited and visualize them as segments on the map.
     */
    function initializeAuditedStreets(map) {
        var distanceAudited = 0,  // Distance audited in km
            streetLinestringStyle = {
                color: "black",
                weight: 3,
                opacity: 0.75
            };

        function onEachStreetFeature(feature, layer) {
            if (feature.properties && feature.properties.type) {
                layer.bindPopup(feature.properties.type);
            }
        }

        $.getJSON("/contribution/streets", function (data) {
            _data.streets = data;

            // Render audited street segments
            L.geoJson(data, {
                pointToLayer: L.mapbox.marker.style,
                style: function(feature) {
                    var style = $.extend(true, {}, streetLinestringStyle);
                    style.color = "rgba(128, 128, 128, 1.0)";
                    style["stroke-width"] = 3;
                    style.opacity = 0.75;
                    style.weight = 3;

                    return style;
                },
                onEachFeature: onEachStreetFeature
            })
                .addTo(map);

            // Calculate total distance audited in (km)
            for (var i = data.features.length - 1; i >= 0; i--) {
                distanceAudited += turf.lineDistance(data.features[i], "miles");
            }
            document.getElementById("td-total-distance-audited").innerHTML = distanceAudited.toPrecision(2) + " mi";

            // Get total reward if a turker
            if (role === 'Turker') {
                $.ajax({
                    async: true,
                    url: '/rewardEarned',
                    type: 'get',
                    success: function(rewardData) {
                        document.getElementById("td-total-reward-earned").innerHTML = "$" + rewardData.reward_earned.toFixed(2);
                    },
                    error: function (xhr, ajaxOptions, thrownError) {
                        console.log(thrownError);
                    }
                })
            }

            completedInitializingAuditedStreets = true;
            handleInitializationComplete(map);
        });
    }

    function initializeSubmittedLabels(map) {
        var colorMapping = util.misc.getLabelColors(),
            geojsonMarkerOptions = {
                radius: 5,
                fillColor: "#ff7800",
                color: "#ffffff",
                weight: 1,
                opacity: 0.5,
                fillOpacity: 0.5,
                "stroke-width": 1
            };

        function onEachLabelFeature(feature, layer) {
            if (feature.properties && feature.properties.type) {
                layer.bindPopup(feature.properties.type);
            }
        }

        $.getJSON("/userapi/labels", function (data) {
            _data.labels = data;
            // Count a number of each label type
            var labelCounter = {
                "CurbRamp": 0,
                "NoCurbRamp": 0,
                "Obstacle": 0,
                "SurfaceProblem": 0,
                "NoSidewalk": 0
            };

            for (var i = data.features.length - 1; i >= 0; i--) {
                labelCounter[data.features[i].properties.label_type] += 1;
            }
            document.getElementById("td-number-of-curb-ramps").innerHTML = labelCounter["CurbRamp"];
            document.getElementById("td-number-of-missing-curb-ramps").innerHTML = labelCounter["NoCurbRamp"];
            document.getElementById("td-number-of-obstacles").innerHTML = labelCounter["Obstacle"];
            document.getElementById("td-number-of-surface-problems").innerHTML = labelCounter["SurfaceProblem"];
            document.getElementById("td-number-of-no-sidewalks").innerHTML = labelCounter["NoSidewalk"];

            document.getElementById("map-legend-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['CurbRamp'].fillStyle + "'></svg>";
            document.getElementById("map-legend-no-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoCurbRamp'].fillStyle + "'></svg>";
            document.getElementById("map-legend-obstacle").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Obstacle'].fillStyle + "'></svg>";
            document.getElementById("map-legend-surface-problem").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['SurfaceProblem'].fillStyle + "'></svg>";
            document.getElementById("map-legend-no-sidewalk").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoSidewalk'].fillStyle + "'></svg>";
            document.getElementById("map-legend-audited-street").innerHTML = "<svg width='20' height='20'><path stroke='rgba(128, 128, 128, 1.0)' stroke-width='3' d='M 2 10 L 18 10 z'></svg>";

            // Render submitted labels
            L.geoJson(data, {
                pointToLayer: function (feature, latlng) {
                    var style = $.extend(true, {}, geojsonMarkerOptions);
                    style.fillColor = colorMapping[feature.properties.label_type].fillStyle;
                    return L.circleMarker(latlng, style);
                },
                onEachFeature: onEachLabelFeature
            })
                .addTo(map);

            completedInitializingSubmittedLabels = true;
            handleInitializationComplete(map);
        });
    }

    function initializeAuditCountChart (c3, map) {
        $.getJSON("/contribution/auditCounts", function (data) {
            var dates = ['Date'].concat(data[0].map(function (x) { return x.date; })),
                counts = ['Audit Count'].concat(data[0].map(function (x) { return x.count; }));
            var chart = c3.generate({
                bindto: "#audit-count-chart",
                data: {
                    x: 'Date',
                    columns: [ dates, counts ],
                    types: { 'Audit Count': 'line' }
                },
                axis: {
                    x: {
                        type: 'timeseries',
                        tick: { format: '%Y-%m-%d' }
                    },
                    y: {
                        label: "Street Audit Count",
                        min: 0,
                        padding: { top: 50, bottom: 10 }
                    }
                },
                legend: {
                    show: false
                }
            });
            completedInitializingAuditCountChart = true;
            handleInitializationComplete(map);
        });
    }

    function initializeSubmittedTasks(map) {
        $.getJSON("/contribution/missions", function (data) {
            _data.tasks = data;
            completedInitializingAuditedTasks = true;

            // http://stackoverflow.com/questions/3552461/how-to-format-a-javascript-date
            var monthNames = [
                "January", "February", "March",
                "April", "May", "June", "July",
                "August", "September", "October",
                "November", "December"
            ];



            var grouped = _.groupBy(_data.tasks, function (o) { return o.mission_id });
            console.log(grouped);
            var missionId;
            var missionTaskIds = Object.keys(grouped);
            var missionNumber = 0;
            var tableRows = "";
            var labelCounter;
            var i;
            var missionTaskIdsLength = missionTaskIds.length;
            var j;
            var labelsLength;
            var labelType;
            missionTaskIds.sort(function (id1, id2) {
                var timestamp1 = grouped[id1][0].mission_end;
                var timestamp2 = grouped[id2][0].mission_end;
                if (timestamp1 < timestamp2) { return -1; }
                else if (timestamp1 > timestamp2) { return 1; }
                else { return 0; }
            });

            for (i = missionTaskIdsLength - 1; i >= 0; i--) {
                labelCounter = { "CurbRamp": 0, "NoCurbRamp": 0, "Obstacle": 0, "SurfaceProblem": 0, "NoSidewalk": 0, "Other": 0 };
                missionId = missionTaskIds[i];
                labelsLength = grouped[missionId].length;
                for (j = 0; j < labelsLength; j++) {
                    labelType = grouped[missionId][j]["label_type"];
                    if (!(labelType in labelCounter)) {
                        labelType = "Other";
                    }
                    labelCounter[labelType] += 1;
                }

                var date = new Date(grouped[missionId][0]["mission_end"]);
                var day = date.getDate();
                var monthIndex = date.getMonth();
                var year = date.getFullYear();
                missionNumber++;
                var dateString;
                if (grouped[missionId][0]["completed"]) {
                    (day + ' ' + monthNames[monthIndex] + ' ' + year)
                } else {
                    dateString = "In Progress";
                }

                tableRows += "<tr>" +
                    "<td class='col-xs-1'>" + missionNumber + "</td>" +
                    "<td class='col-xs-1'>" + dateString + "</td>" +
                    "<td class='col-xs-1'>" + labelCounter["CurbRamp"] + "</td>" +
                    "<td class='col-xs-1'>" + labelCounter["NoCurbRamp"] + "</td>" +
                    "<td class='col-xs-1'>" + labelCounter["Obstacle"] + "</td>" +
                    "<td class='col-xs-1'>" + labelCounter["SurfaceProblem"] + "</td>" +
                    "<td class='col-xs-1'>" + labelCounter["NoSidewalk"] + "</td>" +
                    "<td class='col-xs-1'>" + labelCounter["Other"] + "</td>" +
                    "</tr>";
            }

            $("#task-contribution-table").append(tableRows);

            handleInitializationComplete(map);
        });
    }


    $.getJSON('/adminapi/neighborhoodCompletionRate', function (neighborhoodCompletionData) {
        initializeOverlayPolygon(map);
        initializeNeighborhoodPolygons(map, neighborhoodCompletionData);
        initializeAuditedStreets(map);
        initializeSubmittedLabels(map);
        initializeAuditCountChart(c3, map);
        initializeSubmittedTasks(map);
    });

    self.data = _data;
    return self;
}
