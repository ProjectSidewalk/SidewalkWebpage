function Admin(_, $, c3, turf, difficultRegionIds) {
    var self = {};
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

    for (var i = 0; i < 6; i++) {
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

    // var tileUrl = "https://a.tiles.mapbox.com/v4/kotarohara.mmoldjeh/page.html?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA#13/38.8998/-77.0638";
    var tileUrl = "https:\/\/a.tiles.mapbox.com\/v4\/kotarohara.8e0c6890\/{z}\/{x}\/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA";
    var mapboxTiles = L.tileLayer(tileUrl, {
        attribution: '<a href="http://www.mapbox.com/about/maps/" target="_blank">Terms &amp; Feedback</a>'
    });
    var map = L.mapbox.map('admin-map', "mapbox.streets", {
        maxZoom: 19,
        minZoom: 9,
        zoomSnap: 0.5
    });

    // a grayscale tileLayer for the choropleth
    L.mapbox.accessToken = 'pk.eyJ1IjoibWlzYXVnc3RhZCIsImEiOiJjajN2dTV2Mm0wMDFsMndvMXJiZWcydDRvIn0.IXE8rQNF--HikYDjccA7Ug';
    var choropleth = L.mapbox.map('admin-choropleth', "mapbox.light", {
        maxZoom: 19,
        minZoom: 9,
        legendControl: {
            position: 'bottomleft'
        },
        zoomSnap: 0.5
    });
    choropleth.scrollWheelZoom.disable();

    // Set the city-specific default zoom and location.
    $.getJSON('/cityMapParams', function(data) {
        map.setView([data.city_center.lat, data.city_center.lng]);
        map.setZoom(data.default_zoom);
        choropleth.setView([data.city_center.lat, data.city_center.lng]);
        choropleth.setZoom(data.default_zoom);
        initializeOverlayPolygon(map, data.city_center.lat, data.city_center.lng);
    });

    // Initialize the map
    /**
     * This function adds a semi-transparent white polygon on top of a map.
     */
    function initializeOverlayPolygon(map, lat, lng) {
        var overlayPolygon = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature", "geometry": {
                    "type": "Polygon", "coordinates": [
                        [
                            [lng + 2, lat - 2],
                            [lng + 2, lat + 2],
                            [lng - 2, lat + 2],
                            [lng - 2, lat - 2],
                            [lng + 2, lat - 2]
                        ]
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

            var regionId = feature.properties.region_id;
            var userCompleted = feature.properties.user_completed;
            var url = "/audit/region/" + regionId;
            var popupContent = "???";

            if (userCompleted) {
                popupContent = "You already audited this entire neighborhood!";
            } else {
                popupContent = "Do you want to explore this area to find accessibility issues? " +
                    "<a href='" + url + "' class='region-selection-trigger' regionId='" + regionId + "'>Sure!</a>";
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
        //since this is a float, we cannot directly compare. Using epsilon to avoid floating point errors
        return Math.abs(p - 100) < Number.EPSILON ? '#03152f':
            p > 90 ? '#08306b' :
                p > 80 ? '#08519c' :
                    p > 70 ? '#08719c' :
                        p > 60 ? '#2171b5' :
                            p > 50 ? '#4292c6' :
                                p > 40 ? '#6baed6' :
                                    p > 30 ? '#82badb' :
                                        p > 20 ? '#9ecae1' :
                                            p > 10 ? '#b3d3e8' :
                                                '#c6dbef';
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
                        fillColor: getColor(rates[i].rate),
                        fillOpacity: 0.35 + (0.4 * rates[i].rate / 100.0)
                    }
                }
            }
            return neighborhoodPolygonStyle; // default case (shouldn't happen, will be bright red)
        }

        function onEachNeighborhoodFeature(feature, layer) {

            var regionId = feature.properties.region_id;
            var regionName = feature.properties.region_name;
            var userCompleted = feature.properties.user_completed;
            var compRate = -1.0;
            var milesLeft = -1.0;
            var url = "/audit/region/" + regionId;
            var popupContent = "???";
            for (var i=0; i < rates.length; i++) {
                if (rates[i].region_id === feature.properties.region_id) {
                    compRate = Math.round(rates[i].rate);
                    milesLeft = Math.round(0.000621371 * (rates[i].total_distance_m - rates[i].completed_distance_m));

                    var advancedMessage = '';
                    if(difficultRegionIds.includes(feature.properties.region_id)) {
                           advancedMessage = '<br><b>Careful!</b> This neighborhood is not recommended for new users.<br><br>';
                    }

                    if (userCompleted) {
                        popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("map.100-percent-complete") + "<br>" +
                            i18next.t("map.thanks");
                    } else if (compRate === 100) {
                        popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("map.100-percent-complete") + "<br>" + advancedMessage +
                            i18next.t("map.click-to-help", { url: url, regionId: regionId });
                    } else if (milesLeft === 0) {
                        popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("map.percent-complete", { percent: compRate }) + "<br>" +
                            i18next.t("map.less-than-mile-left") + "<br>" + advancedMessage +
                            i18next.t("map.click-to-help", { url: url, regionId: regionId });
                    } else if (milesLeft === 1) {
                        var popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("map.percent-complete", { percent: compRate }) + "<br>" +
                            i18next.t("map.miles-left", { n: milesLeft }) + "<br>" + advancedMessage +
                            i18next.t("map.click-to-help", { url: url, regionId: regionId });
                    } else {
                        var popupContent = "<strong>" + regionName + "</strong>: " +
                            i18next.t("map.percent-complete", { percent: compRate }) + "<br>" +
                            i18next.t("map.miles-left", { n: milesLeft }) + "<br>" + advancedMessage +
                            i18next.t("map.click-to-help", { url: url, regionId: regionId });
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
                distanceAudited += turf.length(data.features[i]);
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
                "SurfaceProblem": 0,
                "NoSidewalk": 0
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
            document.getElementById("map-legend-nosidewalk").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoSidewalk'].fillStyle + "' stroke='" + colorMapping['NoSidewalk'].strokeStyle + "'></svg>";
            document.getElementById("map-legend-other").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle + "' stroke='" + colorMapping['Other'].strokeStyle + "'></svg>";
            document.getElementById("map-legend-occlusion").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle + "' stroke='" + colorMapping['Occlusion'].strokeStyle + "'></svg>";

            document.getElementById("map-legend-audited-street").innerHTML = "<svg width='20' height='20'><path stroke='black' stroke-width='3' d='M 2 10 L 18 10 z'></svg>";

            // Create layers for each of the 42 different label-severity combinations
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
        for (var i = 0; i < data.features.length; i++) {
            var labelType = data.features[i].properties.label_type;
            if (labelType === "Occlusion") {
                // console.log(data.features[i]);
            }

            if (data.features[i].properties.severity === 1) {
                self.allLayers[labelType][1].push(data.features[i]);
            } else if (data.features[i].properties.severity === 2) {
                self.allLayers[labelType][2].push(data.features[i]);
            } else if (data.features[i].properties.severity === 3) {
                self.allLayers[labelType][3].push(data.features[i]);
            } else if (data.features[i].properties.severity === 4) {
                self.allLayers[labelType][4].push(data.features[i]);
            } else if (data.features[i].properties.severity === 5) {
                self.allLayers[labelType][5].push(data.features[i]);
            } else { // No severity level
                self.allLayers[labelType][0].push(data.features[i]);
            }
        }

        Object.keys(self.allLayers).forEach(function (key) {
            for (var i = 0; i < self.allLayers[key].length; i++) {
                self.allLayers[key][i] = createLayer({
                    "type": "FeatureCollection",
                    "features": self.allLayers[key][i]
                });
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
            if(checkboxId == "occlusion"){
                for (var i = 0; i < self.allLayers[label].length; i++) {
                    if (!map.hasLayer(self.allLayers[label][i])) {
                        map.addLayer(self.allLayers[label][i]);
                    }
                }
            }
            else {
                for (var i = 0; i < self.allLayers[label].length; i++) {
                    if (!map.hasLayer(self.allLayers[label][i])
                        && ($(sliderId).slider("option", "values")[0] <= i &&
                        $(sliderId).slider("option", "values")[1] >= i )) {
                        map.addLayer(self.allLayers[label][i]);
                    } else if ($(sliderId).slider("option", "values")[0] > i
                        || $(sliderId).slider("option", "values")[1] < i) {
                        map.removeLayer(self.allLayers[label][i]);
                    }
                }
            }
        } else {
            for (var i = 0; i < self.allLayers[label].length; i++) {
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
        self.adminGSVLabelView = AdminGSVLabelView(true);
    }

    function initializeAdminLabelSearch() {
        self.adminLabelSearch = AdminLabelSearch();
    }

    function initializeLabelTable() {
        $('.labelView').click(function (e) {
            e.preventDefault();
            self.adminGSVLabelView.showLabel($(this).data('labelId'));
        });
    }

    function isResearcherRole(roleName) {
        return ['Researcher', 'Administrator', 'Owner'].indexOf(roleName) > 0;
    }

    // Takes an array of objects and the name of a property of the objects, returns summary stats for that property
    function getSummaryStats(data, col, options) {
        options = options || {};
        var excludeResearchers = options.excludeResearchers || false;

        var sum = 0;
        var filteredData = [];
        for (var j = 0; j < data.length; j++) {
            if (!excludeResearchers || !isResearcherRole(data[j].role)) {
                sum += data[j][col];
                filteredData.push(data[j])
            }
        }
        var mean = sum / filteredData.length;
        var i = filteredData.length / 2;
        filteredData.sort(function(a, b) {return (a[col] > b[col]) ? 1 : ((b[col] > a[col]) ? -1 : 0);} );

        var median = 0;
        var max = 0;
        var min = 0;

        if (filteredData.length > 0) { // Prevent errors in development where there may be no data
            median = (filteredData.length / 2) % 1 == 0 ? (filteredData[i - 1][col] + filteredData[i][col]) / 2 : filteredData[Math.floor(i)][col];
            min = filteredData[0][col];
            max = filteredData[filteredData.length-1][col];
        }

        var std = 0;
        for(var k = 0; k < filteredData.length; k++) {
            std += Math.pow(filteredData[k][col] - mean, 2);
        }
        std /= filteredData.length;
        std = Math.sqrt(std);

        return {mean:mean, median:median, std:std, min:min, max};
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

        // var transformList = excludeResearchers ? [{"filter": "!datum.is_researcher"}] : [];
        var nonResearcherRoles = ['Registered', 'Anonymous', 'Turker'];
        var transformList = excludeResearchers ? [{"filter": {"field": "role", "oneOf": nonResearcherRoles}}] : [];

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
            initializeNeighborhoodPolygons(map);
            initializeAuditedStreets(map);
            // Adding a 1 second wait to ensure that labels are the top layer and are thus clickable.
            setTimeout(function(){
                initializeSubmittedLabels(map);
            }, 1000);
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
                    "data": {"values": data[0], "format": {"type": "json"}},
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    },
                    "vconcat": [
                        {
                            "height":300,
                            "width": 875,
                            "mark": "area",
                            "encoding": {
                                "x": {
                                    "field": "date",
                                    "type": "temporal",
                                    "scale": {"domain": {"selection": "brush", "field": "date"}},
                                    "axis": {"title": "Date", "labelAngle": 0}
                                },
                                "y": {
                                    "field": "completion", 
                                    "type": "quantitative", "scale": {
                                        "domain": [0,100]
                                    },
                                    "axis": {"title": "City Coverage (%)"}
                                }
                            }
                        },
                        {
                        "height": 60,
                        "width": 875,
                        "mark": "area",
                        "selection": {"brush": {"type": "interval", "encodings": ["x"]}},
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
                                    "title": "City Coverage (%)",
                                    "tickCount": 3, "grid": true}
                            }
                        }
                        }
                    ]
                };
                vega.embed("#completion-progress-chart", chart, opt, function(error, results) {});
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
                var noSidewalks = data.features.filter(function(label) {return label.properties.label_type === "NoSidewalk"});

                var subPlotHeight = 150;
                var subPlotWidth = 149;
                var chart = {
                    "hconcat": [
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": curbRamps},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "Curb Ramp Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": "# of labels"}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": noCurbRamps},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "Missing Curb Ramp Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": surfaceProblems},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "Surface Problem Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": obstacles},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "Obstacle Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        },
                        {
                            "height": subPlotHeight,
                            "width": subPlotWidth,
                            "data": {"values": noSidewalks},
                            "mark": "bar",
                            "encoding": {
                                "x": {"field": "severity", "type": "ordinal",
                                    "axis": {"title": "No Sidewalk Severity", "labelAngle": 0}},
                                "y": {"aggregate": "count", "type": "quantitative", "axis": {"title": ""}}
                            }
                        }
                    ],
                    "config": {
                        "axis": {
                            "titleFontSize": 14
                        }
                    }
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
                for (var j = 0; j < data.length; j++) {
                    data[j].rate *= 100.0; // change from proportion to percent
                }
                var stats = getSummaryStats(data, "rate");
                $("#neighborhood-std").html((stats.std).toFixed(2) + "%");

                var coverageRateChartSortedByCompletion = {
                    "width": 810,
                    "height": 1200,
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
                        "axis": {"titleFontSize": 16, "labelFontSize": 8}
                    }
                };

                var coverageRateChartSortedAlphabetically = {
                    "width": 810,
                    "height": 1200,
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
                        "axis": {"titleFontSize": 16, "labelFontSize": 8}
                    }
                };
                vega.embed("#neighborhood-completion-rate", coverageRateChartSortedByCompletion, opt, function(error, results) {});

                document.getElementById("neighborhood-completion-sort-button").addEventListener("click", function() {
                    vega.embed("#neighborhood-completion-rate", coverageRateChartSortedByCompletion, opt, function(error, results) {});
                });
                document.getElementById("neighborhood-alphabetical-sort-button").addEventListener("click", function() {
                    vega.embed("#neighborhood-completion-rate", coverageRateChartSortedAlphabetically, opt, function(error, results) {});
                });

                var histOpts = {col: "rate", xAxisTitle:"Neighborhood Completion (%)", xDomain:[0, 100],
                                width:400, height:250, binStep:10};
                var coverageRateHist = getVegaLiteHistogram(data, stats.mean, stats.median, histOpts);

                vega.embed("#neighborhood-completed-distance", coverageRateHist, opt, function(error, results) {});

            });
            $.getJSON('/adminapi/validationCounts', function (data) {
                var filteredData = data[0].map(function(x) {
                    return {
                        role: x.role,
                        total: x.count,
                        agreed: x.agreed,
                    }
                });

                var pcts = filteredData.filter(function(x) { // Must have 10+ labels validated
                    return x.total >= 10;
                }).map(function (x) { // Convert to percentages
                    return {
                        count: (x.agreed / x.total) * 100,
                        role: x.role
                    };
                });

                var stats = getSummaryStats(pcts, "count");
                $("#validation-agreed-std").html((stats.std).toFixed(2) + " %");

                var histOpts = {xAxisTitle:"Validations Placed Agreed With (%)", xDomain:[0, 100], binStep:5};
                var coverageRateHist = getVegaLiteHistogram(pcts, stats.mean, stats.median, histOpts);
                vega.embed("#validation-agreed", coverageRateHist, opt, function(error, results) {});

            });
            $.getJSON("/contribution/auditCounts/all", function (data) {
                var stats = getSummaryStats(data[0], "count");

                $("#audit-std").html((stats.std).toFixed(2) + " Street Audits");

                var histOpts = {xAxisTitle:"# Street Audits per Day", xDomain:[0, stats.max], width:250, binStep:50, legendOffset:-80};
                var hist = getVegaLiteHistogram(data[0], stats.mean, stats.median, histOpts);

                var chart = {
                    "data": {"values": data[0]},
                    "hconcat": [
                        {
                            "height": 300,
                            "width": 550,
                            "layer": [
                                {
                                    "mark": "bar",
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
                                        {"stat": "mean", "value": stats.mean}, {"stat": "median", "value": stats.median}]
                                    },
                                    "mark": "rule",
                                    "encoding": {
                                        "y": {
                                            "field": "value", "type": "quantitative",
                                            "axis": {"labels": false, "ticks": false, "title": ""},
                                            "scale": {"domain": [0, stats.max]}
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
                        hist
                    ],
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    }
                };
                vega.embed("#audit-count-chart", chart, opt, function(error, results) {});
            });
            $.getJSON("/userapi/labelCounts/all", function (data) {
                var stats = getSummaryStats(data[0], "count");
                $("#label-std").html((stats.std).toFixed(2) + " Labels");

                var histOpts = {xAxisTitle:"# Labels per Day", xDomain:[0, stats.max], width:250, binStep:200, legendOffset:-80};
                var hist = getVegaLiteHistogram(data[0], stats.mean, stats.median, histOpts);

                var chart = {
                    "data": {"values": data[0]},
                    "hconcat": [
                        {
                            "height": 300,
                            "width": 550,
                            "layer": [
                                {
                                    "mark": "bar",
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
                                            {"stat": "mean", "value": stats.mean}, {"stat": "median", "value": stats.median}]
                                    },
                                    "mark": "rule",
                                    "encoding": {
                                        "y": {
                                            "field": "value", "type": "quantitative",
                                            "axis": {"labels": false, "ticks": false, "title": ""},
                                            "scale": {"domain": [0, stats.max]}
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
                        hist
                    ],
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    }
                };
                vega.embed("#label-count-chart", chart, opt, function(error, results) {});
            });
            $.getJSON("/userapi/validationCounts/all", function (data) {
                var stats = getSummaryStats(data[0], "count");
                $("#validation-std").html((stats.std).toFixed(2) + " Validations");

                var histOpts = {xAxisTitle:"# Validations per Day", xDomain:[0, stats.max], width:250, binStep:200, legendOffset:-80};
                var hist = getVegaLiteHistogram(data[0], stats.mean, stats.median, histOpts);

                var chart = {
                    "data": {"values": data[0]},
                    "hconcat": [
                        {
                            "height": 300,
                            "width": 550,
                            "layer": [
                                {
                                    "mark": "bar",
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
                                                "title": "# Validations per Day"
                                            }
                                        }
                                    }
                                },
                                { // creates lines marking summary statistics
                                    "data": {"values": [
                                            {"stat": "mean", "value": stats.mean}, {"stat": "median", "value": stats.median}]
                                    },
                                    "mark": "rule",
                                    "encoding": {
                                        "y": {
                                            "field": "value", "type": "quantitative",
                                            "axis": {"labels": false, "ticks": false, "title": ""},
                                            "scale": {"domain": [0, stats.max]}
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
                        hist
                    ],
                    "config": {
                        "axis": {
                            "titleFontSize": 16
                        }
                    }
                };
                vega.embed("#validation-count-chart", chart, opt, function(error, results) {});
            });
            $.getJSON("/adminapi/userMissionCounts", function (data) {
                var allData = data[0];
                var regData = allData.filter(user => user.role === 'Registered' || isResearcherRole(user.role));
                var anonData = allData.filter(user => user.role === 'Anonymous');
                var turkerData = allData.filter(user => user.role === 'Turker');

                var allStats = getSummaryStats(allData, "count");
                var allFilteredStats = getSummaryStats(allData, "count", {excludeResearchers: true});
                var regStats = getSummaryStats(regData, "count");
                var regFilteredStats = getSummaryStats(regData, "count", {excludeResearchers: true});
                var turkerStats = getSummaryStats(turkerData, "count");
                var anonStats = getSummaryStats(anonData, "count");

                var allHistOpts = {
                    xAxisTitle: "# Missions per User (all)", xDomain: [0, allStats.max], width: 187,
                    binStep: 15, legendOffset: -80
                };
                var allFilteredHistOpts = {
                    xAxisTitle: "# Missions per User (all)", xDomain: [0, allFilteredStats.max],
                    width: 187, binStep: 15, legendOffset: -80, excludeResearchers: true
                };
                var regHistOpts = {
                    xAxisTitle: "# Missions per Registered User", xDomain: [0, regStats.max], width: 187,
                    binStep: 10, legendOffset: -80
                };
                var regFilteredHistOpts = {
                    xAxisTitle: "# Missions per Registered User", width: 187, legendOffset: -80,
                    xDomain: [0, regFilteredStats.max], excludeResearchers: true, binStep: 10
                };
                var turkerHistOpts = {
                    xAxisTitle: "# Missions per Turker User", xDomain: [0, turkerStats.max], width: 187,
                    binStep: 15, legendOffset: -80
                };
                var anonHistOpts = {
                    xAxisTitle: "# Missions per Anon User", xDomain: [0, anonStats.max], width: 187,
                    binStep: 1, legendOffset: -80
                };

                var allChart = getVegaLiteHistogram(allData, allStats.mean, allStats.median, allHistOpts);
                var allFilteredChart = getVegaLiteHistogram(allData, allFilteredStats.mean, allFilteredStats.median, allFilteredHistOpts);
                var regChart = getVegaLiteHistogram(regData, regStats.mean, regStats.median, regHistOpts);
                var regFilteredChart = getVegaLiteHistogram(regData, regFilteredStats.mean, regFilteredStats.median, regFilteredHistOpts);
                var turkerChart = getVegaLiteHistogram(turkerData, turkerStats.mean, turkerStats.median, turkerHistOpts);
                var anonChart = getVegaLiteHistogram(anonData, anonStats.mean, anonStats.median, anonHistOpts);

                $("#missions-std").html((allFilteredStats.std).toFixed(2) + " Missions");
                $("#reg-missions-std").html((regFilteredStats.std).toFixed(2) + " Missions");
                $("#turker-missions-std").html((turkerStats.std).toFixed(2) + " Missions");
                $("#anon-missions-std").html((anonStats.std).toFixed(2) + " Missions");

                var combinedChart = {"hconcat": [allChart, turkerChart, regChart, anonChart]};
                var combinedChartFiltered = {"hconcat": [allFilteredChart, turkerChart, regFilteredChart, anonChart]};

                vega.embed("#mission-count-chart", combinedChartFiltered, opt, function (error, results) {
                });

                var checkbox = document.getElementById("mission-count-include-researchers-checkbox").addEventListener("click", function (cb) {
                    if (cb.srcElement.checked) {
                        $("#missions-std").html((allStats.std).toFixed(2) + " Missions");
                        $("#reg-missions-std").html((regStats.std).toFixed(2) + " Missions");
                        vega.embed("#mission-count-chart", combinedChart, opt, function (error, results) {
                        });
                    } else {
                        $("#missions-std").html((allFilteredStats.std).toFixed(2) + " Missions");
                        $("#reg-missions-std").html((regFilteredStats.std).toFixed(2) + " Missions");
                        vega.embed("#mission-count-chart", combinedChartFiltered, opt, function (error, results) {
                        });
                    }
                });
            });
            $.getJSON("/adminapi/labelCounts", function (data) {
                var allData = data[0];
                var regData = allData.filter(user => user.role === 'Registered' || isResearcherRole(user.role));
                var turkerData = allData.filter(user => user.role === 'Turker');
                var anonData = allData.filter(user => user.role === 'Anonymous');

                var allStats = getSummaryStats(allData, "count");
                var allFilteredStats = getSummaryStats(allData, "count", {excludeResearchers: true});
                var regStats = getSummaryStats(regData, "count");
                var regFilteredStats = getSummaryStats(regData, "count", {excludeResearchers: true});
                var turkerStats = getSummaryStats(turkerData, "count");
                var anonStats = getSummaryStats(anonData, "count");

                var allHistOpts = {
                    xAxisTitle: "# Labels per User (all)", xDomain: [0, allStats.max], width: 187,
                    binStep: 500, legendOffset: -80
                };
                var allFilteredHistOpts = {
                    xAxisTitle: "# Labels per User (all)", xDomain: [0, allFilteredStats.max],
                    width: 187, binStep: 500, legendOffset: -80, excludeResearchers: true
                };
                var regHistOpts = {
                    xAxisTitle: "# Labels per Registered User", xDomain: [0, regStats.max], width: 187,
                    binStep: 500, legendOffset: -80
                };
                var regFilteredHistOpts = {
                    xAxisTitle: "# Labels per Registered User", width: 187, legendOffset: -80,
                    xDomain: [0, regFilteredStats.max], excludeResearchers: true, binStep: 500
                };
                var turkerHistOpts = {
                    xAxisTitle: "# Labels per Turker User", xDomain: [0, turkerStats.max], width: 187,
                    binStep: 500, legendOffset: -80
                };
                var anonHistOpts = {
                    xAxisTitle: "# Labels per Anon User", xDomain: [0, anonStats.max],
                    width: 187, legendOffset: -80, binStep: 2
                };

                var allChart = getVegaLiteHistogram(allData, allStats.mean, allStats.median, allHistOpts);
                var allFilteredChart = getVegaLiteHistogram(allData, allFilteredStats.mean, allFilteredStats.median, allFilteredHistOpts);
                var regChart = getVegaLiteHistogram(regData, regStats.mean, regStats.median, regHistOpts);
                var regFilteredChart = getVegaLiteHistogram(regData, regFilteredStats.mean, regFilteredStats.median, regFilteredHistOpts);
                var turkerChart = getVegaLiteHistogram(turkerData, turkerStats.mean, turkerStats.median, turkerHistOpts);
                var anonChart = getVegaLiteHistogram(anonData, anonStats.mean, anonStats.median, anonHistOpts);

                $("#all-labels-std").html((allFilteredStats.std).toFixed(2) + " Labels");
                $("#reg-labels-std").html((regFilteredStats.std).toFixed(2) + " Labels");
                $("#turker-labels-std").html((turkerStats.std).toFixed(2) + " Labels");
                $("#anon-labels-std").html((anonStats.std).toFixed(2) + " Labels");

                var combinedChart = {"hconcat": [allChart, turkerChart, regChart, anonChart]};
                var combinedChartFiltered = {"hconcat": [allFilteredChart, turkerChart, regFilteredChart, anonChart]};

                vega.embed("#label-count-hist", combinedChartFiltered, opt, function (error, results) {
                });

                var checkbox = document.getElementById("label-count-include-researchers-checkbox").addEventListener("click", function (cb) {
                    if (cb.srcElement.checked) {
                        $("#all-labels-std").html((allStats.std).toFixed(2) + " Labels");
                        $("#reg-labels-std").html((regStats.std).toFixed(2) + " Labels");
                        vega.embed("#label-count-hist", combinedChart, opt, function (error, results) {
                        });
                    } else {
                        $("#all-labels-std").html((allFilteredStats.std).toFixed(2) + " Labels");
                        $("#reg-labels-std").html((regFilteredStats.std).toFixed(2) + " Labels");
                        vega.embed("#label-count-hist", combinedChartFiltered, opt, function (error, results) {
                        });
                    }
                });
            });
            $.getJSON("/adminapi/validationCounts", function (data) {
                var allData = data[0];
                var regData = allData.filter(user => user.role === 'Registered' || isResearcherRole(user.role));
                var turkerData = allData.filter(user => user.role === 'Turker');
                var anonData = allData.filter(user => user.role === 'Anonymous');

                var allStats = getSummaryStats(allData, "count");
                var allFilteredStats = getSummaryStats(allData, "count", {excludeResearchers: true});
                var regStats = getSummaryStats(regData, "count");
                var regFilteredStats = getSummaryStats(regData, "count", {excludeResearchers: true});
                var turkerStats = getSummaryStats(turkerData, "count");
                var anonStats = getSummaryStats(anonData, "count");

                var allHistOpts = {
                    xAxisTitle: "# Validations per User (all)", xDomain: [0, allStats.max], width: 187,
                    binStep: 50, legendOffset: -80
                };
                var allFilteredHistOpts = {
                    xAxisTitle: "# Validations per User (all)", xDomain: [0, allFilteredStats.max],
                    width: 187, binStep: 50, legendOffset: -80, excludeResearchers: true
                };
                var regHistOpts = {
                    xAxisTitle: "# Validations per Registered User", xDomain: [0, regStats.max], width: 187,
                    binStep: 50, legendOffset: -80
                };
                var regFilteredHistOpts = {
                    xAxisTitle: "# Validations per Registered User", width: 187, legendOffset: -80,
                    xDomain: [0, regFilteredStats.max], excludeResearchers: true, binStep: 50
                };
                var turkerHistOpts = {
                    xAxisTitle: "# Validations per Turker User", xDomain: [0, turkerStats.max], width: 187,
                    binStep: 50, legendOffset: -80
                };
                var anonHistOpts = {
                    xAxisTitle: "# Validations per Anon User", xDomain: [0, anonStats.max],
                    width: 187, legendOffset: -80, binStep: 2
                };

                var allChart = getVegaLiteHistogram(allData, allStats.mean, allStats.median, allHistOpts);
                var allFilteredChart = getVegaLiteHistogram(allData, allFilteredStats.mean, allFilteredStats.median, allFilteredHistOpts);
                var regChart = getVegaLiteHistogram(regData, regStats.mean, regStats.median, regHistOpts);
                var regFilteredChart = getVegaLiteHistogram(regData, regFilteredStats.mean, regFilteredStats.median, regFilteredHistOpts);
                var turkerChart = getVegaLiteHistogram(turkerData, turkerStats.mean, turkerStats.median, turkerHistOpts);
                var anonChart = getVegaLiteHistogram(anonData, anonStats.mean, anonStats.median, anonHistOpts);

                $("#all-validation-std").html((allFilteredStats.std).toFixed(2) + " Validations");
                $("#reg-validation-std").html((regFilteredStats.std).toFixed(2) + " Validations");
                $("#turker-validation-std").html((turkerStats.std).toFixed(2) + " Validations");
                $("#anon-validation-std").html((anonStats.std).toFixed(2) + " Validations");

                var combinedChart = {"hconcat": [allChart, turkerChart, regChart, anonChart]};
                var combinedChartFiltered = {"hconcat": [allFilteredChart, turkerChart, regFilteredChart, anonChart]};

                vega.embed("#validation-count-hist", combinedChartFiltered, opt, function (error, results) {
                });

                var checkbox = document.getElementById("validation-count-include-researchers-checkbox").addEventListener("click", function (cb) {
                    if (cb.srcElement.checked) {
                        $("#all-validation-std").html((allStats.std).toFixed(2) + " Validations");
                        $("#reg-validation-std").html((regStats.std).toFixed(2) + " Validations");
                        vega.embed("#validation-count-hist", combinedChart, opt, function (error, results) {
                        });
                    } else {
                        $("#all-validation-std").html((allFilteredStats.std).toFixed(2) + " Validations");
                        $("#reg-validation-std").html((regFilteredStats.std).toFixed(2) + " Validations");
                        vega.embed("#validation-count-hist", combinedChartFiltered, opt, function (error, results) {
                        });
                    }
                });
            });
            $.getJSON("/adminapi/allSignInCounts", function (data) {
                var stats = getSummaryStats(data[0], "count");
                var filteredStats = getSummaryStats(data[0], "count", {excludeResearchers:true});
                var histOpts = {xAxisTitle:"# Logins per Registered User", binStep:5, xDomain:[0, stats.max]};
                var histFilteredOpts = {xAxisTitle:"# Logins per Registered User", xDomain:[0, filteredStats.max],
                                        excludeResearchers:true};

                var chart = getVegaLiteHistogram(data[0], stats.mean, stats.median, histOpts);
                var filteredChart = getVegaLiteHistogram(data[0], filteredStats.mean, filteredStats.median, histFilteredOpts);

                $("#login-count-std").html((filteredStats.std).toFixed(2) + " Logins");
                vega.embed("#login-count-chart", filteredChart, opt, function(error, results) {});

                var checkbox = document.getElementById("login-count-include-researchers-checkbox").addEventListener("click", function(cb) {
                    if (cb.srcElement.checked) {
                        $("#login-count-std").html((stats.std).toFixed(2) + " Logins");
                        vega.embed("#login-count-chart", chart, opt, function (error, results) {});
                    } else {
                        $("#login-count-std").html((filteredStats.std).toFixed(2) + " Logins");
                        vega.embed("#login-count-chart", filteredChart, opt, function(error, results) {});
                    }
                });
            });

            // Creates chart showing how many audit page visits there are, how many people click via choropleth, how
            // many click "start exploring" on navbar, and how many click "start exploring" on the landing page itself.
            $.getJSON("/adminapi/webpageActivity/Visit_Audit", function(visitAuditEvents){
            $.getJSON("/adminapi/webpageActivity/Click/module=StartExploring/location=Index", function(clickStartExploringMainIndexEvents){
            $.getJSON("/adminapi/webpageActivity/Click/module=Choropleth/target=audit", function(choroplethClickEvents){
            $.getJSON("/adminapi/webpageActivity/Referrer=mturk", function(turkerRedirectEvents){
            // YES, we encode twice. This solves an issue with routing on the test/production server. AdminController.scala decodes twice.
            $.getJSON("/adminapi/webpageActivity/Click/module=StartExploring/location=Navbar/"+encodeURIComponent(encodeURIComponent("route=/")), function(clickStartExploringNavIndexEvents){
            $.getJSON("/adminapi/webpageActivity/Click/module=StartMapping/location=Navbar/"+encodeURIComponent(encodeURIComponent("route=/")), function(clickStartMappingNavIndexEvents){
                // Only consider events that take place after all logging was merged (timestamp equivalent to July 20, 2017 17:02:00)
                // TODO switch this to make use of versioning on the backend once it is implemented...
                // See: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/653
                var numVisitAudit = visitAuditEvents[0].filter(function(event){
                    return event.timestamp > 1500584520000;
                }).length;
                var numClickStartMappingMainIndex = clickStartExploringMainIndexEvents[0].filter(function(event){
                    return event.timestamp > 1500584520000;
                }).length;
                var numChoroplethClicks = choroplethClickEvents[0].filter(function(event){
                    return event.timestamp > 1500584520000;
                }).length;
                var numTurkerRedirects = turkerRedirectEvents[0].filter(function(event){
                    return event.timestamp > 1500584520000;
                }).length;
                var numClickStartMappingNavIndex = clickStartMappingNavIndexEvents[0].concat(clickStartExploringNavIndexEvents[0]).filter(function(event){
                    return event.timestamp > 1500584520000;
                }).length;

                // Fill in values in "How users access Audit Page from Landing Page:" table
                $("#audit-access-table-start-main").append(
                    '<td style="text-align: right;">'+
                        numClickStartMappingMainIndex+
                    '</td>'+
                    '<td style="text-align: right;">'+
                        (parseInt(numClickStartMappingMainIndex)/parseInt(numVisitAudit)*100).toFixed(1)+'%'+
                    '</td>'
                );
                $("#audit-access-table-start-nav").append(
                    '<td style="text-align: right;">'+
                        numClickStartMappingNavIndex+
                    '</td>'+
                    '<td style="text-align: right;">'+
                        (parseInt(numClickStartMappingNavIndex)/parseInt(numVisitAudit)*100).toFixed(1)+'%'+
                    '</td>'
                );
                $("#audit-access-table-choro").append(
                    '<td style="text-align: right;">'+
                    numChoroplethClicks+
                    '</td>'+
                    '<td style="text-align: right;">'+
                    (parseInt(numChoroplethClicks)/parseInt(numVisitAudit)*100).toFixed(1)+'%'+
                    '</td>'
                );
                $("#audit-access-table-turker").append(
                    '<td style="text-align: right;">'+
                    numTurkerRedirects+
                    '</td>'+
                    '<td style="text-align: right;">'+
                    (parseInt(numTurkerRedirects)/parseInt(numVisitAudit)*100).toFixed(1)+'%'+
                    '</td>'
                );
                $("#audit-access-table-total").append(
                    '<td style="text-align: right;">'+
                        numVisitAudit+
                    '</td>'+
                    '<td style="text-align: right;">'+
                        '100.0%'+
                    '</td>'
                );
            });
            });
            });
            });
            });
            });
            self.graphsLoaded = true;
        }
    });

    function changeRole(e){
        var userId = $(this).parent() // <li>
            .parent() // <ul>
            .siblings('button')
            .attr('id')
            .substring("userRoleDropdown".length); // userId is stored in id of dropdown
        var newRole = this.innerText;
        
        data = {
            'user_id': userId,
            'role_id': newRole
        };
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: '/adminapi/setRole',
            type: 'put',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                // Change dropdown button to reflect new role
                var button = $('#userRoleDropdown' + result.user_id);
                var buttonContents = button.html();
                var newRole = result.role;
                button.html(buttonContents.replace(/Registered|Turker|Researcher|Administrator|Anonymous/g, newRole));
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    initializeLabelTable();
    initializeAdminGSVLabelView();
    initializeAdminLabelSearch();

    self.clearMap = clearMap;
    self.redrawLabels = redrawLabels;
    self.clearAuditedStreetLayer = clearAuditedStreetLayer;
    self.redrawAuditedStreetLayer = redrawAuditedStreetLayer;
    self.toggleLayers = toggleLayers;
    self.toggleAuditedStreetLayer = toggleAuditedStreetLayer;

    $('.change-role').on('click', changeRole);

    // Functionality for the legend's minimize button.
    $('#map-legend-minimize-button').click(function() {
        $("#legend-table").slideToggle(0);
        $(this).text(function(_, value) { return value === '-' ? '+' : '-'});
    });

    return self;
}
