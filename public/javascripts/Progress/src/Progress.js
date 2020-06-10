function Progress (_, $, c3, L, role, difficultRegionIds) {
    var self = {};
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

    // var tileUrl = "https://a.tiles.mapbox.com/v4/kotarohara.mmoldjeh/page.html?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA#13/38.8998/-77.0638";
    var tileUrl = "https:\/\/a.tiles.mapbox.com\/v4\/kotarohara.8e0c6890\/{z}\/{x}\/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA";
    var mapboxTiles = L.tileLayer(tileUrl, {
        attribution: '<a href="http://www.mapbox.com/about/maps/" target="_blank">Terms &amp; Feedback</a>'
    });
    var map = L.mapbox.map('map', "mapbox.streets", {
        maxZoom: 19,
        minZoom: 9,
        zoomSnap: 0.5
    });

    // Set the city-specific default zoom, location, and max bounding box to prevent the user from panning away.
    $.getJSON('/cityMapParams', function(data) {
        map.setView([data.city_center.lat, data.city_center.lng]);
        var southWest = L.latLng(data.southwest_boundary.lat, data.southwest_boundary.lng);
        var northEast = L.latLng(data.northeast_boundary.lat, data.northeast_boundary.lng);
        map.setMaxBounds(L.latLngBounds(southWest, northEast));
        map.setZoom(data.default_zoom);
        initializeOverlayPolygon(map, data.city_center.lat, data.city_center.lng);
    });

    var popup = L.popup().setContent('<p>Hello!</p>');

    function handleInitializationComplete (map) {
        if (completedInitializingNeighborhoodPolygons &&
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
     * This function adds a semi-transparent white polygon on top of a map.
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

    /**
     * render points
     */
    function initializeNeighborhoodPolygons(map, rates) {
        function onEachNeighborhoodFeature(feature, layer) {

            var regionId = feature.properties.region_id;
            var regionName = feature.properties.region_name;
            var userCompleted = feature.properties.user_completed;
            var url = "/audit/region/" + regionId;
            // default popup content if we don't find neighborhood in list of neighborhoods from query
            var popupContent = "Do you want to find accessibility problems in " + regionName + "? " +
                    "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Sure!</a>";
            var compRate = 0;
            var milesLeft = 0;
            for (var i = 0; i < rates.length; i++) {
                if (rates[i].region_id === feature.properties.region_id) {
                    var measurementSystem = i18next.t('common:measurement-system');
                    compRate = Math.round(100.0 * rates[i].rate);
                    distanceLeft = 0.000621371 * (rates[i].total_distance_m - rates[i].completed_distance_m);
                    // distance in metric
                    if(measurementSystem === "metric") distanceLeft *= 1.60934;
                    distanceLeft = Math.round(distanceLeft);
                    var advancedMessage = '';
                    if(difficultRegionIds.includes(feature.properties.region_id)) {
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
                            i18next.t("common:map.distance-left-one-unit", { n: distanceLeft }) + "<br>" + advancedMessage +
                            i18next.t("common:map.click-to-help", { url: url, regionId: regionId });
                    } else {
                        var popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("common:map.percent-complete", { percent: compRate }) + "<br>" +
                            i18next.t("common:map.distance-left", { n: distanceLeft }) + "<br>" + advancedMessage +
                            i18next.t("common:map.click-to-help", { url: url, regionId: regionId });
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
                distanceAudited += turf.length(data.features[i], {units: 'miles'});
            }
            var measurementSystem = i18next.t("common:measurement-system");
            var unitAbbreviation = " mi";
            // user is in a country that uses metric, not IS
            if(measurementSystem === "metric") distanceAudited *= 1.60934, unitAbbreviation = " km";
            document.getElementById("td-total-distance-audited").innerHTML = distanceAudited.toPrecision(2) + unitAbbreviation;

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
            var dates = ['Date'].concat(data[0].map(function (x) { return x.date; }));
            var counts = [i18next.t("audit-count")].concat(data[0].map(function (x) { return x.count; }));
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
                        tick: {
                            format: function(x) {
                                return moment(x).format('L');
                            }
                        }
                    },
                    y: {
                        label: i18next.t("street-audit-count"),
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

    /**
     * This method appends all the missions a user has to the task
     * contribution table in the user dashboard
     *
     * @param map
     */
    function initializeSubmittedMissions(map) {
        $.getJSON("/getMissions", function (data) {
            _data.tasks = data;
            completedInitializingAuditedTasks = true;


            // sorts all labels the user has completed by mission
            var grouped = _.groupBy(_data.tasks, function (o) { return o.mission_id });
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
            // sorts missions by putting completed missions first then
            // uncompleted missions, each in chronological order
            missionTaskIds.sort(function (id1, id2) {
                var timestamp1 = grouped[id1][0].mission_end;
                var timestamp2 = grouped[id2][0].mission_end;
                var firstCompleted = grouped[id1][0].completed;
                var secondCompleted = grouped[id2][0].completed;
                if (firstCompleted && secondCompleted) {
                    if (timestamp1 < timestamp2) { return 1; }
                    else if (timestamp1 > timestamp2) { return -1; }
                    else { return 0; }
                } else if (firstCompleted && !secondCompleted) {
                    return 1;
                } else if (!firstCompleted && secondCompleted) {
                    return -1;
                } else {
                    var startstamp1 = grouped[id1][0].mission_start;
                    var startstamp2 = grouped[id2][0].mission_start;
                    if (startstamp1 < startstamp2) { return 1; }
                    else if (startstamp1 > startstamp2) { return -1; }
                    else { return 0; }
                }
            });

            // counts the type of label for each mission to display the
            // numbers in the missions table
            for (i = missionTaskIdsLength - 1; i >= 0; i--) {
                labelCounter = { "CurbRamp": 0, "NoCurbRamp": 0, "Obstacle": 0, "SurfaceProblem": 0, "NoSidewalk": 0, "Other": 0 };
                missionId = missionTaskIds[i];
                labelsLength = grouped[missionId].length;
                for (j = 0; j < labelsLength; j++) {
                    labelType = grouped[missionId][j]["label_type"];
                    // missions with no labels have an undefined labelType
                    if (labelType === undefined) {
                        break;
                    } else {
                        if (!(labelType in labelCounter)) {
                            labelType = "Other";
                        }
                        labelCounter[labelType] += 1;
                    }
                }
                
                // no need to load locale, correct locale loaded for footer
                var localDate = moment(new Date(grouped[missionId][0]["mission_end"]));

                var neighborhood;
                // neighborhood name is tutorial if there is no neighborhood
                // assigned for that mission
                if (grouped[missionId][0]["neighborhood"]) {
                    neighborhood = grouped[missionId][0]["neighborhood"];
                } else {
                    neighborhood = "Tutorial";
                }

                var dateString;
                // Date is "In Progress" if the mission has not yet been completed
                if (grouped[missionId][0]["completed"]) {
                    dateString = localDate.format('D MMMM YYYY');
                } else {
                    dateString = i18next.t("in-progress");
                }

                missionNumber++;

                // adds all the mission information to a row in the table
                tableRows += "<tr>" +
                    "<td class='col-xxs-1'>" + missionNumber + "</td>" +
                    "<td class='col-date'>" + dateString + "</td>" +
                    "<td class='col-neighborhood'>" + neighborhood + "</td>" +
                    "<td class='col-xxs-1'>" + labelCounter["CurbRamp"] + "</td>" +
                    "<td class='col-xxs-1'>" + labelCounter["NoCurbRamp"] + "</td>" +
                    "<td class='col-xxs-1'>" + labelCounter["Obstacle"] + "</td>" +
                    "<td class='col-xxs-1'>" + labelCounter["SurfaceProblem"] + "</td>" +
                    "<td class='col-xxs-1'>" + labelCounter["NoSidewalk"] + "</td>" +
                    "<td class='col-xxs-1'>" + labelCounter["Other"] + "</td>" +
                    "</tr>";
            }

            $("#task-contribution-table").append(tableRows);

            handleInitializationComplete(map);
        });
    }


    $.getJSON('/adminapi/neighborhoodCompletionRate', function (neighborhoodCompletionData) {
        initializeNeighborhoodPolygons(map, neighborhoodCompletionData);
        initializeAuditedStreets(map);
        initializeSubmittedLabels(map);
        initializeAuditCountChart(c3, map);
        initializeSubmittedMissions(map);
    });

    self.data = _data;
    return self;
}
