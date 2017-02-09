function Admin (_, $, c3, turf) {
    var self = {};
    self.markerLayer = null;
    self.graphsLoaded = false;
    self.auditedStreetLayer = null;
    self.visibleMarkers = ["CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "Occlusion", "NoSidewalk", "Other"];

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
        map = L.mapbox.map('admin-map', "kotarohara.8e0c6890", {
            // set that bounding box as maxBounds to restrict moving the map
            // see full maxBounds documentation:
            // http://leafletjs.com/reference.html#map-maxbounds
            maxBounds: bounds,
            maxZoom: 19,
            minZoom: 9
        })
        // .addLayer(mapboxTiles)
            .fitBounds(bounds)
            .setView([38.892, -77.038], 12),
        popup = L.popup().setContent('<p>Hello world!<br />This is a nice popup.</p>');

    // Initialize the map
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
        var layer = L.geoJson(overlayPolygon);
        layer.setStyle({color: "#ccc", fillColor: "#ccc"});
        layer.addTo(map);
    }

    /**
     * render points
     */
    function initializeNeighborhoodPolygons(map) {
        var neighborhoodPolygonStyle = {
                color: '#888',
                weight: 1,
                opacity: 0.25,
                fillColor: "#ccc",
                fillOpacity: 0.1
            },
            layers = [],
            currentLayer;

        function onEachNeighborhoodFeature(feature, layer) {

            var regionId = feature.properties.region_id,
                url = "/audit/region/" + regionId,
                popupContent = "Do you want to explore this area to find accessibility issues? " +
                    "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Sure!</a>";
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
                var center = turf.center(this.feature),
                    coordinates = center.geometry.coordinates,
                    latlng = L.latLng(coordinates[1], coordinates[0]),
                    zoom = map.getZoom();
                zoom = zoom > 14 ? zoom : 14;

                map.setView(latlng, zoom, {animate: true});
                currentLayer = this;
            });
        }

        $.getJSON("/neighborhoods", function (data) {
            L.geoJson(data, {
                style: function (feature) {
                    return $.extend(true, {}, neighborhoodPolygonStyle);
                },
                onEachFeature: onEachNeighborhoodFeature
            })
                .addTo(map);
        });
    }

    /**
     * This function queries the streets that the user audited and visualize them as segmetns on the map.
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

        $.getJSON("/contribution/streets/all", function (data) {

            // Render audited street segments
            self.auditedStreetLayer = L.geoJson(data, {
                pointToLayer: L.mapbox.marker.style,
                style: function(feature) {
                    var style = $.extend(true, {}, streetLinestringStyle);
                    var randomInt = Math.floor(Math.random() * 5);
                    style.color = "#000";
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
                distanceAudited += turf.lineDistance(data.features[i]);
            }
            // document.getElementById("td-total-distance-audited").innerHTML = distanceAudited.toPrecision(2) + " km";
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
            layer.on('click', function(){
                self.adminGSVLabelView.showLabel(feature.properties.label_id);
            });
            layer.on({
                'mouseover': function() {
                    layer.setRadius(15);
                },
                'mouseout': function() {
                    layer.setRadius(5);
                }
            })
        }

        $.getJSON("/adminapi/labels/all", function (data) {
            // Count a number of each label type
            var labelCounter = {
                "CurbRamp": 0,
                "NoCurbRamp": 0,
                "Obstacle": 0,
                "SurfaceProblem": 0
            };

            for (var i = data.features.length - 1; i >= 0; i--) {
                labelCounter[data.features[i].properties.label_type] += 1;
            }
            //document.getElementById("td-number-of-curb-ramps").innerHTML = labelCounter["CurbRamp"];
            //document.getElementById("td-number-of-missing-curb-ramps").innerHTML = labelCounter["NoCurbRamp"];
            //document.getElementById("td-number-of-obstacles").innerHTML = labelCounter["Obstacle"];
            //document.getElementById("td-number-of-surface-problems").innerHTML = labelCounter["SurfaceProblem"];

            document.getElementById("map-legend-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['CurbRamp'].fillStyle + "'></svg>";
            document.getElementById("map-legend-no-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoCurbRamp'].fillStyle + "'></svg>";
            document.getElementById("map-legend-obstacle").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Obstacle'].fillStyle + "'></svg>";
            document.getElementById("map-legend-surface-problem").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['SurfaceProblem'].fillStyle + "'></svg>";
            document.getElementById("map-legend-other").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle + "' stroke='" + colorMapping['Other'].strokeStyle + "'></svg>";
            document.getElementById("map-legend-occlusion").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle + "' stroke='" + colorMapping['Occlusion'].strokeStyle + "'></svg>";
            document.getElementById("map-legend-nosidewalk").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle + "' stroke='" + colorMapping['NoSidewalk'].strokeStyle + "'></svg>";

            document.getElementById("map-legend-audited-street").innerHTML = "<svg width='20' height='20'><path stroke='black' stroke-width='3' d='M 2 10 L 18 10 z'></svg>";

            // Render submitted labels
            self.markerLayer = L.geoJson(data, {
                pointToLayer: function (feature, latlng) {
                    var style = $.extend(true, {}, geojsonMarkerOptions);
                    style.fillColor = colorMapping[feature.properties.label_type].fillStyle;
                    style.color = colorMapping[feature.properties.label_type].strokeStyle;
                    return L.circleMarker(latlng, style);
                },
                filter: function (feature, layer) {
                    return ($.inArray(feature.properties.label_type, self.visibleMarkers) > -1);

                },
                onEachFeature: onEachLabelFeature
            })
                .addTo(map);
        });
    }

    function clearMap(){
        map.removeLayer(self.markerLayer);
    }
    function clearAuditedStreetLayer(){
        map.removeLayer(self.auditedStreetLayer);
    }
    function redrawAuditedStreetLayer(){
        initializeAuditedStreets(map);
    }
    function redrawLabels(){
        initializeSubmittedLabels(map);
    }

    function updateVisibleMarkers() {
        self.visibleMarkers = []
        if (document.getElementById("curbramp").checked) {
            self.visibleMarkers.push("CurbRamp");
        }
        if (document.getElementById("missingcurbramp").checked) {
            self.visibleMarkers.push("NoCurbRamp");
        }
        if (document.getElementById("obstacle").checked) {
            self.visibleMarkers.push("Obstacle");
        }
        if (document.getElementById("surfaceprob").checked) {
            self.visibleMarkers.push("SurfaceProblem");
        }
        if (document.getElementById("occlusion").checked) {
            self.visibleMarkers.push("Occlusion");
        }
        if (document.getElementById("nosidewalk").checked) {
            self.visibleMarkers.push("NoSidewalk");
        }
        if (document.getElementById("other").checked) {
            self.visibleMarkers.push("Other");
        }


        admin.clearMap();
        admin.clearAuditedStreetLayer();
        admin.redrawLabels();

        if (document.getElementById("auditedstreet").checked) {
            admin.redrawAuditedStreetLayer();
        }

    }


    // A helper method to make an histogram of an array.
    function makeAHistogramArray(arrayOfNumbers, numberOfBins) {
        arrayOfNumbers.sort(function (a, b) { return a - b; });
        var stepSize = arrayOfNumbers[arrayOfNumbers.length - 1] / numberOfBins;
        var dividedArray = arrayOfNumbers.map(function (x) { return x / stepSize; });
        var histogram = Array.apply(null, Array(numberOfBins)).map(Number.prototype.valueOf,0);
        for (var i = 0; i < dividedArray.length; i++) {
            var binIndex = Math.floor(dividedArray[i] - 0.0000001);
            histogram[binIndex] += 1;
        }
        return {
            histogram: histogram,
            stepSize: stepSize,
            numberOfBins: numberOfBins
        };
    }

    function initializeAdminGSVLabelView() {
        self.adminGSVLabelView = AdminGSVLabel();
    }

    function initializeLabelTable() {
        $('.labelView').click(function (e) {
            e.preventDefault();
            self.adminGSVLabelView.showLabel($(this).data('labelId'));
        });
    }

    $('.nav-pills').on('click', function(e){
      if (e.target.id == "analytics" && self.graphsLoaded == false) {
            // Draw an onboarding interaction chart
            $.getJSON("/adminapi/onboardingInteractions", function (data) {
                function cmp (a, b) {
                    return a.timestamp - b.timestamp;
                }

                // Group the audit task interaction records by audit_task_id, then go through each group and compute
                // the duration between the first time stamp and the last time stamp.
                var grouped = _.groupBy(data, function (x) { return x.audit_task_id; });
                var completionDurationArray = [];
                var record1;
                var record2;
                var duration;
                for (var auditTaskId in grouped) {
                    grouped[auditTaskId].sort(cmp);
                    record1 = grouped[auditTaskId][0];
                    record2 = grouped[auditTaskId][grouped[auditTaskId].length - 1];
                    duration = (record2.timestamp - record1.timestamp) / 1000;  // Duration in seconds
                    completionDurationArray.push(duration);
                }
                completionDurationArray.sort(function (a, b) { return a - b; });

                // Bounce rate
                var zeros = _.countBy(completionDurationArray, function (x) { return x == 0; });
                var bounceRate = zeros['true'] / (zeros['true'] + zeros['false']);

                // Histogram of duration
                completionDurationArray = completionDurationArray.filter(function (x) { return x != 0; });  // Remove zeros
                var numberOfBins = 10;
                var histogram = makeAHistogramArray(completionDurationArray, numberOfBins);
                // console.log(histogram);
                var counts = histogram.histogram;
                counts.unshift("Count");
                var bins = histogram.histogram.map(function (x, i) { return (i * histogram.stepSize).toFixed(1) + " - " + ((i + 1) * histogram.stepSize).toFixed(1); });

                $("#onboarding-bounce-rate").html((bounceRate * 100).toFixed(1) + "%");

                var chart = c3.generate({
                    bindto: '#onboarding-completion-duration-histogram',
                    data: {
                        columns: [
                            counts
                        ],
                        type: 'bar'
                    },
                    axis: {
                        x: {
                            label: "Onboarding Completion Time (s)",
                            type: 'category',
                            categories: bins
                        },
                        y: {
                            label: "Count",
                            min: 0,
                            padding: { top: 50, bottom: 10 }
                        }
                    },
                    legend: {
                        show: false
                    }
                });
            });
            $.getJSON('/adminapi/missionsCompletedByUsers', function (data) {
                var i,
                    len = data.length;

                // Todo. This code double counts the missions completed for different region. So it should be fixed in the future.
                var missions = {};
                var printedMissionName;
                for (i = 0; i < len; i++) {
                    // Set the printed mission name
                    if (data[i].label == "initial-mission") {
                        printedMissionName = "Initial Mission (1000 ft)";
                    } else if (data[i].label == "distance-mission") {
                        if (data[i].level <= 2) {
                            printedMissionName = "Distance Mission (" + data[i].distance_ft + " ft)";
                        } else {
                            printedMissionName = "Distance Mission (" + data[i].distance_mi + " mi)";
                        }
                    } else {
                        printedMissionName = "Onboarding";
                    }

                    // Create a counter for the printedMissionName if it does not exist yet.
                    if (!(printedMissionName in missions)) {
                        missions[printedMissionName] = {
                            label: data[i].label,
                            level: data[i].level,
                            printedMissionName: printedMissionName,
                            count: 0
                        };
                    }
                    missions[printedMissionName].count += 1;
                }
                var arrayOfMissions = Object.keys(missions).map(function (key) { return missions[key]; });
                arrayOfMissions.sort(function (a, b) {
                    if (a.count < b.count) { return 1; }
                    else if (a.count > b.count) { return -1; }
                    else { return 0; }
                });

                var missionCountArray = ["Mission Counts"];
                var missionNames = [];
                for (i = 0; i < arrayOfMissions.length; i++) {
                    missionCountArray.push(arrayOfMissions[i].count);
                    missionNames.push(arrayOfMissions[i].printedMissionName);
                }
                var chart = c3.generate({
                    bindto: '#completed-mission-histogram',
                    data: {
                        columns: [
                            missionCountArray
                        ],
                        type: 'bar'
                    },
                    axis: {
                        x: {
                            type: 'category',
                            categories: missionNames
                        },
                        y: {
                            label: "# Users Completed the Mission",
                            min: 0,
                            padding: { top: 50, bottom: 10 }
                        }
                    },
                    legend: {
                        show: false
                    }
                });
            });
            $.getJSON('/adminapi/neighborhoodCompletionRate', function (data) {
                var i,
                    len = data.length,
                    completionRate,
                    row,
                    rows = "";
                var coverageRateColumn = ["Neighborhood Coverage Rate (%)"];
                var coverageDistanceArray = ["Neighborhood Coverage (m)"];
                var neighborhoodNames = [];
                for (i = 0; i < len; i++) {
                    completionRate = data[i].completed_distance_m / data[i].total_distance_m * 100;
                    coverageRateColumn.push(completionRate);
                    coverageDistanceArray.push(data[i].completed_distance_m);

                    neighborhoodNames.push(data[i].name);
                    // row = "<tr><th>" + data[i].region_id + " " + data[i].name + "</th><td>" + completionRate + "%</td>"
                    // rows += row;
                }

                var coverageChart = c3.generate({
                    bindto: '#neighborhood-completion-rate',
                    data: {
                        columns: [
                            coverageRateColumn
                        ],
                        type: 'bar'
                    },
                    axis: {
                        x: {
                            type: 'category',
                            categories: neighborhoodNames
                        },
                        y: {
                            label: "Neighborhood Coverage Rate (%)",
                            min: 0,
                            max: 100,
                            padding: { top: 50, bottom: 10 }
                        }
                    },
                    legend: {
                        show: false
                    }
                });

                var coverageDistanceChart = c3.generate({
                    bindto: '#neighborhood-completed-distance',
                    data: {
                        columns: [
                            coverageDistanceArray
                        ],
                        type: 'bar'
                    },
                    axis: {
                        x: {
                            type: 'category',
                            categories: neighborhoodNames
                        },
                        y: {
                            label: "Coverage Distance (m)",
                            min: 0,
                            padding: { top: 50, bottom: 10 }
                        }
                    },
                    legend: {
                        show: false
                    }
                });

            });
            $.getJSON("/contribution/auditCounts/all", function (data) {
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
            });

            $.getJSON("/userapi/labelCounts/all", function (data) {
                var dates = ['Date'].concat(data[0].map(function (x) { return x.date; })),
                    counts = ['Label Count'].concat(data[0].map(function (x) { return x.count; }));
                var chart = c3.generate({
                    bindto: "#label-count-chart",
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
                            label: "Label Count",
                            min: 0,
                            padding: { top: 50, bottom: 10 }
                        }
                    },
                    legend: {
                        show: false
                    }
                });
            });
            self.graphsLoaded = true;
       }
    });

    initializeOverlayPolygon(map);
    initializeNeighborhoodPolygons(map);
    initializeAuditedStreets(map);
    initializeSubmittedLabels(map);
    initializeAdminGSVLabelView();
    initializeLabelTable();

    self.clearMap = clearMap;
    self.redrawLabels = redrawLabels;
    self.clearAuditedStreetLayer = clearAuditedStreetLayer;
    self.redrawAuditedStreetLayer = redrawAuditedStreetLayer;
    self.updateVisibleMarkers = updateVisibleMarkers;
    return self;
}