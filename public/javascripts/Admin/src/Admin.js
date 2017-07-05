function Admin(_, $, c3, turf) {
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
    L.mapbox.accessToken = 'pk.eyJ1IjoibWlzYXVnc3RhZCIsImEiOiJjajN2dTV2Mm0wMDFsMndvMXJiZWcydDRvIn0.IXE8rQNF--HikYDjccA7Ug';
    var choropleth = L.mapbox.map('admin-choropleth', "kotarohara.8e0c6890", {
            // set that bounding box as maxBounds to restrict moving the map
            // see full maxBounds documentation:
            // http://leafletjs.com/reference.html#map-maxbounds
            maxBounds: bounds,
            maxZoom: 19,
            minZoom: 9,
            legendControl: {
                position: 'bottomleft'
            }
        })
            .fitBounds(bounds)
            .setView([38.892, -77.038], 12);
    choropleth.scrollWheelZoom.disable();

    L.mapbox.styleLayer('mapbox://styles/mapbox/light-v9').addTo(choropleth);

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
    function getColor(p) {
        return p > 80 ? '#08519c' :
            p > 60 ? '#3182bd' :
                p > 40 ? '#6baed6' :
                    p > 20 ? '#bdd7e7' :
                        '#eff3ff';
    }
    function getColor2(p) {
        return p > 90 ? '#08306b' :
            p > 80 ? '#08519c' :
                p > 70 ? '#08719c' :
                    p > 60 ? '#2171b5' :
                        p > 50 ? '#4292c6' :
                            p > 40 ? '#6baed6' :
                                p > 30 ? '#9ecae1' :
                                    p > 20 ? '#c6dbef' :
                                        p > 10 ? '#deebf7' :
                                            '#f7fbff';
    }
    function getColor3(p) {
        return p > 90 ? '#023858' :
            p > 80 ? '#045a8d' :
                p > 70 ? '#0570b0' :
                    p > 60 ? '#3690c0' :
                        p > 50 ? '#74a9cf' :
                            p > 40 ? '#a6bddb' :
                                p > 30 ? '#d0d1e6' :
                                    p > 20 ? '#ece7f2' :
                                        p > 10 ? '#fff7fb' :
                                            '#ffffff';
    }
    function getColor4(p) {
        return p > 80 ? '#045a8d' :
            p > 60 ? '#2b8cbe' :
                p > 40 ? '#74a9cf' :
                    p > 20 ? '#bdc9e1' :
                        '#f1eef6';
    }
    function getOpacity(p) {
        return p > 90 ? 1.0 :
            p > 80 ? 0.9 :
                p > 70 ? 0.8 :
                    p > 60 ? 0.7 :
                        p > 50 ? 0.6 :
                            p > 40 ? 0.5 :
                                p > 30 ? 0.4 :
                                    p > 20 ? 0.3 :
                                        p > 10 ? 0.2 :
                                            0.1;
    }

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

        // finds the matching neighborhood's completion percentage, and uses it to determine the fill color
        function style(feature) {
            for (var i=0; i < rates.length; i++) {
                if (rates[i].region_id === feature.properties.region_id) {
                    return {
                        color: '#888',
                        weight: 1,
                        opacity: 0.25,
                        fillColor: getColor2(rates[i].rate),
                        fillOpacity: 0.25 + (0.5 * rates[i].rate / 100.0)
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
                popupContent = "???";
            for (var i=0; i < rates.length; i++) {
                if (rates[i].region_id === feature.properties.region_id) {
                    compRate = Math.round(rates[i].rate);
                    milesLeft = Math.round(0.000621371 * (rates[i].total_distance_m - rates[i].completed_distance_m));
                    if (compRate === 100) {
                        popupContent = "<strong>" + regionName + "</strong>: " + compRate + "\% Complete!<br>" +
                            "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Click here</a>" +
                            " to find accessibility issues in this neighborhood yourself!";
                    }
                    else if (milesLeft === 0) {
                        popupContent = "<strong>" + regionName + "</strong>: " + compRate +
                            "\% Complete<br>Less than a mile left!<br>" +
                            "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Click here</a>" +
                            " to help finish this neighborhood!";
                    }
                    else if (milesLeft === 1) {
                        var popupContent = "<strong>" + regionName + "</strong>: " + compRate + "\% Complete<br>Only " +
                            milesLeft + " mile left!<br>" +
                            "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Click here</a>" +
                            " to help finish this neighborhood!";
                    }
                    else {
                        var popupContent = "<strong>" + regionName + "</strong>: " + compRate + "\% Complete<br>Only " +
                            milesLeft + " miles left!<br>" +
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
        initializeAuditedStreets(map);
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

    $('.nav-pills').on('click', function (e) {
        if (e.target.id == "visualization" && self.mapLoaded == false) {
            initializeOverlayPolygon(map);
            initializeNeighborhoodPolygons(map);
            initializeAuditedStreets(map);
            initializeSubmittedLabels(map);
            initializeAdminGSVLabelView();
            setTimeout(function () {
                map.invalidateSize(false);
            }, 1);
            self.mapLoaded = true;
        }
        else if (e.target.id == "analytics" && self.graphsLoaded == false) {


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
                    // this is the slightly different code for the interactive version
                    // "vconcat": [
                    //     {
                    //         "width": 800,
                    //         "height": 150,
                    //         "mark": "area",
                    //         "selection": {
                    //             "brush": {
                    //                 "type": "interval", "encodings": ["x"]
                    //             }
                    //         },
                    //         "encoding": {
                    //             "x": {
                    //                 "field": "date",
                    //                 "type": "temporal",
                    //                 "axis": {"title": "Date", "labelAngle": 0}
                    //             },
                    //             "y": {
                    //                 "field": "completion",
                    //                 "type": "quantitative", "scale": {
                    //                     "domain": [0,100]
                    //                 },
                    //                 "axis": {
                    //                     "title": "DC Coverage (%)"
                    //                 }
                    //             }
                    //         }
                    //     },
                    //     {
                    //         "width": 800,
                    //         "height": 400,
                    //         "mark": "area",
                    //         "encoding": {
                    //             "x": {
                    //                 "field": "date",
                    //                 "type": "temporal",
                    //                 "scale": {
                    //                     "domain": {
                    //                         "selection": "brush", "encoding": "x"
                    //                     }
                    //                 },
                    //                 "axis": {
                    //                     "title": "", "labelAngle": 0
                    //                 }
                    //             },
                    //             "y": {
                    //                 "field": "completion","type": "quantitative", "scale": {
                    //                     "domain": [0,100]
                    //                 },
                    //                 "axis": {
                    //                     "title": "DC Coverage (%)"
                    //                 }
                    //             }
                    //         }
                    //     }
                    // ],
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    }
                };
                var opt = {
                    "mode": "vega-lite",
                    "actions": false
                };
                vega.embed("#completion-progress-chart", chart, opt, function(error, results) {});
            });
            // Draw an onboarding interaction chart
            $.getJSON("/adminapi/onboardingInteractions", function (data) {
                function cmp(a, b) {
                    return a.timestamp - b.timestamp;
                }

                // Group the audit task interaction records by audit_task_id, then go through each group and compute
                // the duration between the first time stamp and the last time stamp.
                var grouped = _.groupBy(data, function (x) {
                    return x.audit_task_id;
                });
                var onboardingTimes = [];
                var record1;
                var record2;
                var duration;
                var bounceCount = 0;
                var sum = 0;
                for (var auditTaskId in grouped) {
                    grouped[auditTaskId].sort(cmp);
                    record1 = grouped[auditTaskId][0];
                    record2 = grouped[auditTaskId][grouped[auditTaskId].length - 1];
                    if(record2.note === "from:outro" || record2.note === "onboardingTransition:outro"){
                        duration = (record2.timestamp - record1.timestamp) / 60000;  // Duration in minutes
                        onboardingTimes.push({duration: duration, binned: Math.min(10.0, duration)});
                        sum += duration;
                    }
                    else bounceCount++;
                }
                var bounceRate = bounceCount / (bounceCount + onboardingTimes.length);
                $("#onboarding-bounce-rate").html((bounceRate * 100).toFixed(1) + "%");

                var mean = sum / onboardingTimes.length;
                onboardingTimes.sort(function(a, b) {return (a.duration > b.duration) ? 1 : ((b.duration > a.duration) ? -1 : 0);} );
                var i = onboardingTimes.length / 2;
                var median = i % 1 == 0 ? (onboardingTimes[i - 1].duration + onboardingTimes[i].duration) / 2 : onboardingTimes[Math.floor(i)].duration;

                var std = 0;
                for(var j = 0; j < onboardingTimes.length; j++) {
                    std += Math.pow(onboardingTimes[j].duration - mean, 2);
                }
                std /= onboardingTimes.length;
                std = Math.sqrt(std);
                $("#onboarding-std").html((std).toFixed(1) + " minutes");

                var chart = {
                    "width": 400,
                    "height": 250,
                    "layer": [
                        {
                            "data": {"values": onboardingTimes},
                            "mark": "bar",
                            "encoding": {
                                "x": {
                                    "bin": {"maxbins": 10},
                                    "field": "binned", "type": "quantitative",
                                    "axis": {
                                        "title": "Onboarding Completion Time (minutes)", "labelAngle": 0,
                                        "scale": {"domain": [0,10]}
                                    }
                                },
                                "y": {
                                    "aggregate": "count", "field": "*", "type": "quantitative",
                                    "axis": {
                                        "title": "Counts"
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
                                    "axis": {"labels": false, "ticks": false, "title": ""},
                                    "scale": {"domain": [0,10]}
                                },
                                "color": {
                                    "field": "stat", "type": "nominal", "scale": {"range": ["pink", "orange"]},
                                    "legend": {
                                        "title": "Summary Stats"
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
                var opt = {
                    "mode": "vega-lite",
                    "actions": false
                };
                vega.embed("#onboarding-completion-duration-histogram", chart, opt, function(error, results) {});
            });
            $.getJSON('/adminapi/labels/all', function (data) {
                for (var i = 0; i < data.features.length; i++) {
                    data.features[i].label_type = data.features[i].properties.label_type;
                    data.features[i].severity = data.features[i].properties.severity;
                }
                var curbRamps = data.features.filter(function(label) {return label.properties.label_type === "CurbRamp"});
                var noCurbRamps = data.features.filter(function(label) {return label.properties.label_type === "NoCurbRamp"});
                var surfaceProblems = data.features.filter(function(label) {return label.properties.label_type === "SurfaceProblem"});
                var obstacles = data.features.filter(function(label) {return label.properties.label_type === "Obstacle"});

                var subPlotHeight = 200;
                var subPlotWidth = 199;
                var chart = {
                    "hconcat": [
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": curbRamps},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal", "axis": {"title": "Curb Ramp Severity"}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": "# of labels"}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": noCurbRamps},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal", "axis": {"title": "Missing Curb Ramp Severity"}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": surfaceProblems},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal", "axis": {"title": "Surface Problem Severity"}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": obstacles},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal", "axis": {"title": "Obstacle Severity"}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        }
                    ]
                };
                var opt = {
                    "mode": "vega-lite",
                    "actions": false
                };
                vega.embed("#severity-histograms", chart, opt, function(error, results) {});
            });
            $.getJSON('/adminapi/neighborhoodCompletionRate', function (data) {

                // make a choropleth of neighborhood completion percentages
                initializeChoroplethNeighborhoodPolygons(choropleth, data);
                choropleth.legendControl.addLegend(document.getElementById('legend').innerHTML);
                setTimeout(function () {
                    choropleth.invalidateSize(false);
                }, 1);

                // make charts showing neighborhood completion rate
                data.sort(function(a, b) {return (a.rate > b.rate) ? 1 : ((b.rate > a.rate) ? -1 : 0);} );
                var sum = 0;
                for (var j = 0; j < data.length; j++) {
                    data[j].rate *= 100.0;
                    sum += data[j].rate;
                }
                var mean = sum / data.length;
                var i = data.length / 2;
                var median = (data.length / 2) % 1 == 0 ? (data[i - 1].rate + data[i].rate) / 2 : data[Math.floor(i)].rate;

                var std = 0;
                for(var k = 0; k < data.length; k++) {
                    std += Math.pow(data[k].rate - mean, 2);
                }
                std /= data.length;
                std = Math.sqrt(std);
                $("#neighborhood-std").html((std).toFixed(0) + "%");

                var coverageRateChartSortedByCompletion = {
                    "width": 810,
                    "height": 800,
                    "data": {
                        "values": data, "format": {
                            "type": "json"
                        }
                    },
                    "mark": "bar",
                    "encoding": {
                        "x": {
                            "field": "rate", "type": "quantitative",
                            "axis": {"title": "Neighborhood Completion (%)"}
                        },
                        "y": {
                            "field": "name", "type": "nominal",
                            "axis": {"title": "Neighborhood"},
                            "sort": {"field": "rate", "op": "max", "order": "ascending"}
                        }
                    },
                    "config": {
                        "axis": {"titleFontSize": 16, "labelFontSize": 8},
                        "bar": {"binSpacing": 2}
                    }
                };

                var coverageRateChartSortedAlphabetically = {
                    "width": 810,
                    "height": 800,
                    "data": {
                        "values": data, "format": {
                            "type": "json"
                        }
                    },
                    "mark": "bar",
                    "encoding": {
                        "x": {
                            "field": "rate", "type": "quantitative",
                            "axis": {"title": "Neighborhood Completion (%)"}
                        },
                        "y": {
                            "field": "name", "type": "nominal",
                            "axis": {"title": "Neighborhood"},
                            "sort": {"field": "name", "op": "max", "order": "descending"}
                        }
                    },
                    "config": {
                        "axis": {"titleFontSize": 16, "labelFontSize": 8},
                        "bar": {"binSpacing": 2}
                    }
                };
                var opt = {
                    "mode": "vega-lite",
                    "actions": false
                };
                vega.embed("#neighborhood-completion-rate", coverageRateChartSortedByCompletion, opt, function(error, results) {});

                document.getElementById("neighborhood-completion-sort-button").addEventListener("click", function() {
                    vega.embed("#neighborhood-completion-rate", coverageRateChartSortedByCompletion, opt, function(error, results) {});
                });
                document.getElementById("neighborhood-alphabetical-sort-button").addEventListener("click", function() {
                    vega.embed("#neighborhood-completion-rate", coverageRateChartSortedAlphabetically, opt, function(error, results) {});
                });

                var coverageRateHist = {
                    "width": 400,
                    "height": 250,
                    "layer": [
                        {
                            "data": {"values": data},
                            "mark": "bar",
                            "encoding": {
                                "x": {
                                    "bin": {
                                        "maxbins": 10
                                    },
                                    "field": "rate", "type": "quantitative",
                                    "axis": {
                                        "title": "Neighborhood Completion (%)", "labelAngle": 0
                                    }
                                },
                                "y": {
                                    "aggregate": "count", "field": "*", "type": "quantitative",
                                    "axis": {
                                        "title": "Counts"
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
                                    "axis": {"labels": false, "ticks": false, "title": ""},
                                    "scale": {"domain": [0,100]}
                                },
                                "color": {
                                    "field": "stat", "type": "nominal", "scale": {"range": ["pink", "orange"]},
                                    "legend": {
                                        "title": "Summary Stats"
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
                vega.embed("#neighborhood-completed-distance", coverageRateHist, opt, function(error, results) {});

            });
            $.getJSON("/contribution/auditCounts/all", function (data) {
                data[0].sort(function(a, b) {return (a.count > b.count) ? 1 : ((b.count > a.count) ? -1 : 0);} );
                var sum = 0;
                for (var j = 0; j < data[0].length; j++) {
                    sum += data[0][j].count;
                }
                var mean = sum / data[0].length;
                var i = data[0].length / 2;
                var median = (data[0].length / 2) % 1 == 0 ? (data[0][i - 1].count + data[0][i].count) / 2 : data[0][Math.floor(i)].count;

                var std = 0;
                for(var k = 0; k < data[0].length; k++) {
                    std += Math.pow(data[0][k].count - mean, 2);
                }
                std /= data[0].length;
                std = Math.sqrt(std);
                $("#audit-std").html((std).toFixed(1) + " Street Audits");

                var chart = {
                    "data": {"values": data[0]},
                    "hconcat": [
                        {
                            "height": 300,
                            "width": 550,
                            "layer": [
                                {
                                    "mark": "area",
                                    "encoding": {
                                        "x": {
                                            "field": "date",
                                            "type": "temporal",
                                            "axis": {"title": "Date", "labelAngle": 0}
                                        },
                                        "y": {
                                            "field": "count",
                                            "type": "quantitative",
                                            "axis": {
                                                "title": "# Street Audits per Day"
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
                                        "y": {
                                            "field": "value", "type": "quantitative",
                                            "axis": {"labels": false, "ticks": false, "title": ""},
                                            "scale": {"domain": [0, data[0][data[0].length-1].count]}
                                        },
                                        "color": {
                                            "field": "stat", "type": "nominal", "scale": {"range": ["pink", "orange"]},
                                            "legend": false
                                        },
                                        "size": {
                                            "value": 1
                                        }
                                    }
                                }
                            ],
                            "resolve": {"y": {"scale": "independent"}}
                        },
                        {
                            "height": 300,
                            "width": 250,
                            "layer": [
                                {
                                    "mark": "bar",
                                    "encoding": {
                                        "x": {
                                            "field": "count",
                                            "type": "quantitative",
                                            "axis": {"title": "# Street Audits per Day", "labelAngle": 0},
                                            "bin": {"maxbins": 20}
                                        },
                                        "y": {
                                            "aggregate": "count",
                                            "field": "*",
                                            "type": "quantitative",
                                            "axis": {
                                                "title": "Counts"
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
                                            "axis": {"labels": false, "ticks": false, "title": ""},
                                            "scale": {"domain": [0, data[0][data[0].length-1].count]}
                                        },
                                        "color": {
                                            "field": "stat", "type": "nominal", "scale": {"range": ["pink", "orange"]},
                                            "legend": {
                                                "title": "Summary Stats"
                                            }
                                        },
                                        "size": {
                                            "value": 1
                                        }
                                    }
                                }
                                ],
                            "resolve": {"x": {"scale": "independent"}}
                        }
                    ],
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    }
                };
                var opt = {
                    "mode": "vega-lite",
                    "actions": false
                };
                vega.embed("#audit-count-chart", chart, opt, function(error, results) {});
            });
            $.getJSON("/userapi/labelCounts/all", function (data) {
                data[0].sort(function(a, b) {return (a.count > b.count) ? 1 : ((b.count > a.count) ? -1 : 0);} );
                var sum = 0;
                for (var j = 0; j < data[0].length; j++) {
                    sum += data[0][j].count;
                }
                var mean = sum / data[0].length;
                var i = data[0].length / 2;
                var median = (data[0].length / 2) % 1 == 0 ? (data[0][i - 1].count + data[0][i].count) / 2 : data[0][Math.floor(i)].count;

                var std = 0;
                for(var k = 0; k < data[0].length; k++) {
                    std += Math.pow(data[0][k].count - mean, 2);
                }
                std /= data[0].length;
                std = Math.sqrt(std);
                $("#label-std").html((std).toFixed(0) + " Labels");

                var chart = {
                    "data": {"values": data[0]},
                    "hconcat": [
                        {
                            "height": 300,
                            "width": 550,
                            "layer": [
                                {
                                    "mark": "area",
                                    "encoding": {
                                        "x": {
                                            "field": "date",
                                            "type": "temporal",
                                            "axis": {"title": "Date", "labelAngle": 0}
                                        },
                                        "y": {
                                            "field": "count",
                                            "type": "quantitative",
                                            "axis": {
                                                "title": "# Labels per Day"
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
                                        "y": {
                                            "field": "value", "type": "quantitative",
                                            "axis": {"labels": false, "ticks": false, "title": ""},
                                            "scale": {"domain": [0, data[0][data[0].length-1].count]}
                                        },
                                        "color": {
                                            "field": "stat", "type": "nominal", "scale": {"range": ["pink", "orange"]},
                                            "legend": false
                                        },
                                        "size": {
                                            "value": 2
                                        }
                                    }
                                }
                            ],
                            "resolve": {"y": {"scale": "independent"}}
                        },
                        {
                            "height": 300,
                            "width": 250,
                            "layer": [
                                {
                                    "mark": "bar",
                                    "encoding": {
                                        "x": {
                                            "field": "count",
                                            "type": "quantitative",
                                            "axis": {"title": "# Labels per Day", "labelAngle": 0},
                                            "bin": {"maxbins": 20}
                                        },
                                        "y": {
                                            "aggregate": "count",
                                            "field": "*",
                                            "type": "quantitative",
                                            "axis": {
                                                "title": "Counts"
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
                                            "axis": {"labels": false, "ticks": false, "title": ""},
                                            "scale": {"domain": [0, data[0][data[0].length-1].count]}
                                        },
                                        "color": {
                                            "field": "stat", "type": "nominal", "scale": {"range": ["pink", "orange"]},
                                            "legend": {
                                                "title": "Summary Stats"
                                            }
                                        },
                                        "size": {
                                            "value": 2
                                        }
                                    }
                                }
                            ],
                            "resolve": {"x": {"scale": "independent"}}
                        }
                        ],
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    }
                };
                var opt = {
                    "mode": "vega-lite",
                    "actions": false
                };
                vega.embed("#label-count-chart", chart, opt, function(error, results) {});
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