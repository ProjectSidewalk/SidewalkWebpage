function RouteViz(_, $, c3, turf, difficultRegionIds) {
    var self = {};
    var severityList = [1, 2, 3, 4, 5];
    self.markerLayer = null;
    self.curbRampLayers = [];
    self.missingCurbRampLayers = [];
    self.obstacleLayers = [];
    self.surfaceProblemLayers = [];
    self.cantSeeSidewalkLayers = [];
    self.noSidewalkLayers = [];
    self.otherLayers = [];
    self.mapLoaded = false;
    self.graphsLoaded = false;

    var neighborhoodPolygonLayer;

    for (i = 0; i < 5; i++) {
        self.curbRampLayers[i] = [];
        self.missingCurbRampLayers[i] = [];
        self.obstacleLayers[i] = [];
        self.surfaceProblemLayers[i] = [];
        self.cantSeeSidewalkLayers[i] = [];
        self.noSidewalkLayers[i] = [];
        self.otherLayers[i] = [];
    }

    self.allLayers = {
        "CurbRamp": self.curbRampLayers, "NoCurbRamp": self.missingCurbRampLayers, "Obstacle": self.obstacleLayers,
        "SurfaceProblem": self.surfaceProblemLayers, "Occlusion": self.cantSeeSidewalkLayers,
        "NoSidewalk": self.noSidewalkLayers, "Other": self.otherLayers
    };

    self.auditedStreetLayer = null;

    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';

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
    var map = L.mapbox.map('admin-map', "kotarohara.8e0c6890", {
        // set that bounding box as maxBounds to restrict moving the map
        // see full maxBounds documentation:
        // http://leafletjs.com/reference.html#map-maxbounds
        maxBounds: bounds,
        maxZoom: 19,
        minZoom: 9
    })
        .fitBounds(bounds)
        .setView([38.892, -77.038], 12);

    // a grayscale tileLayer for the choropleth

    var popup = L.popup().setContent('<p>Hello world!<br />This is a nice popup.</p>');

    // Initialize the map
    /**
     * This function adds a semi-transparent white polygon on top of a map
     */
    function initializeOverlayPolygon(map) {
        var overlayPolygon = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature", "geometry": {
                    "type": "Polygon", "coordinates": [
                        [[-75, 36], [-75, 40], [-80, 40], [-80, 36], [-75, 36]]
                    ]
                }
            }]
        };
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
            neighborhoodPolygonLayer = L.geoJson(data, {
                style: function (feature) {
                    return $.extend(true, {}, neighborhoodPolygonStyle);
                },
                onEachFeature: onEachNeighborhoodFeature
            })
                .addTo(map);
        });
    }

    /**
     * Takes a completion percentage, bins it, and returns the appropriate color for a choropleth.
     *
     * @param p {float} represents a completion percentage, between 0 and 100
     * @returns {string} color in hex
     */

    /**
     * render the neighborhood polygons, colored by completion percentage
     */
    function initializeChoroplethNeighborhoodPolygons(map, rates) {
        var neighborhoodPolygonStyle = { // default bright red, used to check if any regions are missing data
                color: '#888',
                weight: 1,
                opacity: 0.25,
                fillColor: "#f00",
                fillOpacity: 1.0
            },
            layers = [],
            currentLayer;

        function onEachNeighborhoodFeature(feature, layer) {

            var regionId = feature.properties.region_id,
                regionName = feature.properties.region_name,
                compRate = -1.0,
                milesLeft = -1.0,
                url = "/audit/region/" + regionId,
                popupContent = "???";
            for (var i=0; i < rates.length; i++) {
                if (rates[i].region_id === feature.properties.region_id) {
                    compRate = Math.round(rates[i].rate);
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
                this.setStyle({opacity: 1.0, weight: 3, color: "#000"});

            });
            layer.on('mouseout', function (e) {
                for (var i = layers.length - 1; i >= 0; i--) {
                    if (currentLayer !== layers[i])
                        layers[i].setStyle({opacity: 0.25, weight: 1});
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

        // adds the neighborhood polygons to the map
        $.getJSON("/neighborhoods", function (data) {
            neighborhoodPolygonLayer = L.geoJson(data, {
                style: style,
                onEachFeature: onEachNeighborhoodFeature
            })
                .addTo(map);
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
            layer.on({
                'add': function () {
                    layer.bringToBack()
                }
            })
        }

        $.getJSON("/contribution/streets/all", function (data) {

            // Render audited street segments
            self.auditedStreetLayer = L.geoJson(data, {
                pointToLayer: L.mapbox.marker.style,
                style: function (feature) {
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

    function initializeRoutesGenerated(map) {
        var distanceRouted = 0,  // Distance audited in km
            streetLinestringStyle = {
                color: "red",
                weight: 3,
                opacity: 0.75
            };

        function onEachStreetFeature(feature, layer) {
            if (feature.properties && feature.properties.type) {
                layer.bindPopup(feature.properties.type);
            }
            layer.on({
                'add': function () {
                    layer.bringToBack()
                }
            })
        }

        $.getJSON("/routeviz/allRouteStreets", function (data) {

            // Render audited street segments
            self.routeStreetLayer = L.geoJson(data, {
                pointToLayer: L.mapbox.marker.style,
                style: function (feature) {
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
                distanceRouted += turf.lineDistance(data.features[i]);
            }
            // document.getElementById("td-total-distance-audited").innerHTML = distanceAudited.toPrecision(2) + " km";
        });
    }

    function initializeSubmittedLabels(map) {

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

            // Create layers for each of the 35 different label-severity combinations
            initializeAllLayers(data);
        });
    }


    function onEachLabelFeature(feature, layer) {
        layer.on('click', function () {
            self.adminGSVLabelView.showLabel(feature.properties.label_id);
        });
        layer.on({
            'mouseover': function () {
                layer.setRadius(15);
            },
            'mouseout': function () {
                layer.setRadius(5);
            }
        })
    }

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

    function createLayer(data) {
        return L.geoJson(data, {
            pointToLayer: function (feature, latlng) {
                var style = $.extend(true, {}, geojsonMarkerOptions);
                style.fillColor = colorMapping[feature.properties.label_type].fillStyle;
                style.color = colorMapping[feature.properties.label_type].strokeStyle;
                return L.circleMarker(latlng, style);
            },
            onEachFeature: onEachLabelFeature
        })
    }

    function initializeAllLayers(data) {
        for (i = 0; i < data.features.length; i++) {
            var labelType = data.features[i].properties.label_type;
            if(labelType == "Occlusion" || labelType == "NoSidewalk"){
                //console.log(data.features[i]);
            }
            if (data.features[i].properties.severity == 1) {
                self.allLayers[labelType][0].push(data.features[i]);
            } else if (data.features[i].properties.severity == 2) {
                self.allLayers[labelType][1].push(data.features[i]);
            } else if (data.features[i].properties.severity == 3) {
                self.allLayers[labelType][2].push(data.features[i]);
            } else if (data.features[i].properties.severity == 4) {
                self.allLayers[labelType][3].push(data.features[i]);
            } else if (data.features[i].properties.severity == 5) {
                self.allLayers[labelType][4].push(data.features[i]);
            }
        }

        Object.keys(self.allLayers).forEach(function (key) {
            for (i = 0; i < self.allLayers[key].length; i++) {
                self.allLayers[key][i] = createLayer({"type": "FeatureCollection", "features": self.allLayers[key][i]});
                self.allLayers[key][i].addTo(map);
            }
        })
    }

    function clearMap() {
        map.removeLayer(self.markerLayer);
    }

    function clearAuditedStreetLayer() {
        map.removeLayer(self.auditedStreetLayer);
    }

    function redrawAuditedStreetLayer() {
        initializeRoutesGenerated(map);
    }

    function redrawLabels() {
        initializeSubmittedLabels(map);
    }

    function toggleLayers(label, checkboxId, sliderId) {
        if (document.getElementById(checkboxId).checked) {
            if(checkboxId == "occlusion" || checkboxId == "nosidewalk"){
                for (i = 0; i < self.allLayers[label].length; i++) {
                    if (!map.hasLayer(self.allLayers[label][i])) {
                        map.addLayer(self.allLayers[label][i]);
                    }
                }
            }
            else {
                for (i = 0; i < self.allLayers[label].length; i++) {
                    if (!map.hasLayer(self.allLayers[label][i])
                        && ($(sliderId).slider("option", "value") == i ||
                        $(sliderId).slider("option", "value") == 5 )) {
                        map.addLayer(self.allLayers[label][i]);
                    } else if ($(sliderId).slider("option", "value") != 5
                        && $(sliderId).slider("option", "value") != i) {
                        map.removeLayer(self.allLayers[label][i]);
                    }
                }
            }
        } else {
            for (i = 0; i < self.allLayers[label].length; i++) {
                if (map.hasLayer(self.allLayers[label][i])) {
                    map.removeLayer(self.allLayers[label][i]);
                }
            }
        }
    }

    function toggleAuditedStreetLayer() {
        if (document.getElementById('auditedstreet').checked) {
            map.addLayer(self.auditedStreetLayer);
        } else {
            map.removeLayer(self.auditedStreetLayer);
        }
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

    // takes an array of objects and the name of a property of the objects, returns summary stats for that property
    function getSummaryStats(data, col, options) {
        options = options || {};

        var excludeResearchers = options.excludeResearchers || false;

        var sum = 0;
        var filteredData = [];
        for (var j = 0; j < data.length; j++) {
            if (!excludeResearchers || !data[j].is_researcher) {
                sum += data[j][col];
                filteredData.push(data[j])
            }
        }
        var mean = sum / filteredData.length;
        var i = filteredData.length / 2;
        filteredData.sort(function(a, b) {return (a[col] > b[col]) ? 1 : ((b[col] > a[col]) ? -1 : 0);} );
        var median = (filteredData.length / 2) % 1 == 0 ? (filteredData[i - 1][col] + filteredData[i][col]) / 2 : filteredData[Math.floor(i)][col];

        var std = 0;
        for(var k = 0; k < filteredData.length; k++) {
            std += Math.pow(filteredData[k][col] - mean, 2);
        }
        std /= filteredData.length;
        std = Math.sqrt(std);
        return {mean:mean, median:median, std:std, min:filteredData[0][col], max:filteredData[filteredData.length-1][col]};
    }

    // takes in some data, summary stats, and optional arguments, and outputs the spec for a vega-lite chart
    function getVegaLiteHistogram(data, mean, median, options) {
        options = options || {};
        var xAxisTitle = options.xAxisTitle || "TODO, fill in x-axis title";
        var yAxisTitle = options.yAxisTitle || "Counts";
        var height = options.height || 300;
        var width = options.width || 600;
        var col = options.col || "count"; // most graphs we are making are made of up counts
        var xDomain = options.xDomain || [0, data[data.length-1][col]];
        var binStep = options.binStep || 1;
        var legendOffset = options.legendOffset || 0;
        var excludeResearchers = options.excludeResearchers || false;

        var transformList = excludeResearchers ? [{"filter": "!datum.is_researcher"}] : [];

        return {
            "height": height,
            "width": width,
            "data": {"values": data},
            "transform": transformList,
            "layer": [
                {
                    "mark": "bar",
                    "encoding": {
                        "x": {
                            "field": col,
                            "type": "quantitative",
                            "axis": {"title": xAxisTitle, "labelAngle": 0, "tickCount":8},
                            "bin": {"step": binStep}
                        },
                        "y": {
                            "aggregate": "count",
                            "field": "*",
                            "type": "quantitative",
                            "axis": {
                                "title": yAxisTitle
                            }
                        }
                    }
                },
                { // creates lines marking summary statistics
                    "data": {"values": [
                        {"stat": "mean", "value": mean}, {"stat": "median", "value": median}]
                    },
                    "mark": "rule",
                    "encoding": {
                        "x": {
                            "field": "value", "type": "quantitative",
                            "axis": {"labels": false, "ticks": false, "title": "", "grid": false},
                            "scale": {"domain": xDomain}
                        },
                        "color": {
                            "field": "stat", "type": "nominal", "scale": {"range": ["pink", "orange"]},
                            "legend": {
                                "title": "Summary Stats",
                                "values": ["mean: " + mean.toFixed(2), "median: " + median.toFixed(2)],
                                "offset": legendOffset
                            }
                        },
                        "size": {
                            "value": 2
                        }
                    }
                }
            ],
            "resolve": {"x": {"scale": "independent"}},
            "config": {
                "axis": {
                    "titleFontSize": 16
                }
            }
        };
    }

    $('.nav-pills').on('click', function (e) {
        if (e.target.id == "visualization" && self.mapLoaded == false) {
            initializeOverlayPolygon(map);
            initializeNeighborhoodPolygons(map);
            initializeRoutesGenerated(map);
            initializeSubmittedLabels(map);
            initializeAdminGSVLabelView();
            setTimeout(function () {
                map.invalidateSize(false);
            }, 1);
            self.mapLoaded = true;
        }
        else if (e.target.id == "analytics" && self.graphsLoaded == false) {

            var opt = {
                "mode": "vega-lite",
                "actions": false
            };

            $.getJSON("/adminapi/completionRateByDate", function (data) {
                var chart = {
                    // "height": 800,
                    "height": 300,
                    "width": 875,
                    "mark": "area",
                    "data": {"values": data[0], "format": {"type": "json"}},
                    "encoding": {
                        "x": {
                            "field": "date",
                            "type": "temporal",
                            "axis": {"title": "Date", "labelAngle": 0}
                        },
                        "y": {
                            "field": "completion",
                            "type": "quantitative", "scale": {
                                "domain": [0,100]
                            },
                            "axis": {
                                "title": "DC Coverage (%)"
                            }
                        }
                    },
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    }
                };
                vega.embed("#completion-progress-chart", chart, opt, function(error, results) {});
            });

            self.graphsLoaded = true;
        }
    });

    initializeLabelTable();
    initializeAdminGSVLabelView();

    self.clearMap = clearMap;
    self.redrawLabels = redrawLabels;
    self.clearAuditedStreetLayer = clearAuditedStreetLayer;
    self.redrawAuditedStreetLayer = redrawAuditedStreetLayer;
    self.toggleLayers = toggleLayers;
    self.toggleAuditedStreetLayer = toggleAuditedStreetLayer;

    return self;
}
