function LabelMap(_, $) {

    var self = {};
    var completedInitializingNeighborhoodPolygons = false;
    var completedRetrievingLabels = false;

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

    // Set the city-specific default zoom and location.
    $.getJSON('/cityMapParams', function(data) {
        map.setView([data.city_center.lat, data.city_center.lng]);
        var southWest = L.latLng(data.southwest_boundary.lat, data.southwest_boundary.lng);
        var northEast = L.latLng(data.northeast_boundary.lat, data.northeast_boundary.lng);
        map.setMaxBounds(L.latLngBounds(southWest, northEast));
        map.setZoom(data.default_zoom);
        initializeOverlayPolygon(map, data.city_center.lat, data.city_center.lng);
    });


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
     * If we drew the neighborhood polygons and receieved the labels, then draw the labels on top.
     * @param map
     */
    function handleInitializationComplete(map) {
        if (completedInitializingNeighborhoodPolygons && completedRetrievingLabels) {
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
    }


    /**
     * render points
     */
    function initializeNeighborhoodPolygons(map) {
        var neighborhoodPolygonStyle = {
                color: '#888',
                weight: 2,
                opacity: 0.80,
                fillColor: "#808080",
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
            completedInitializingNeighborhoodPolygons = true;
            handleInitializationComplete(map);
        });
    }



    /**
     * This function queries the streets that the user audited and visualize them as segments on the map.
     */
    function initializeAuditedStreets(map) {
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
        });
    }


    function initializeSubmittedLabels(map) {

        $.getJSON("/labels/all", function (data) {
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

            document.getElementById("map-legend-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['CurbRamp'].fillStyle + "'></svg>";
            document.getElementById("map-legend-no-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoCurbRamp'].fillStyle + "'></svg>";
            document.getElementById("map-legend-obstacle").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Obstacle'].fillStyle + "'></svg>";
            document.getElementById("map-legend-surface-problem").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['SurfaceProblem'].fillStyle + "'></svg>";
            document.getElementById("map-legend-nosidewalk").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoSidewalk'].fillStyle + "' stroke='" + colorMapping['NoSidewalk'].strokeStyle + "'></svg>";
            document.getElementById("map-legend-other").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle + "' stroke='" + colorMapping['Other'].strokeStyle + "'></svg>";
            document.getElementById("map-legend-occlusion").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Other'].fillStyle + "' stroke='" + colorMapping['Occlusion'].strokeStyle + "'></svg>";

            document.getElementById("map-legend-audited-street").innerHTML = "<svg width='20' height='20'><path stroke='black' stroke-width='3' d='M 2 10 L 18 10 z'></svg>";

            // Create layers for each of the 42 different label-severity combinations
            for (var i = 0; i < data.features.length; i++) {
                var labelType = data.features[i].properties.label_type;

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
            completedRetrievingLabels = true;
            handleInitializationComplete(map);
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

    var colorMapping = util.misc.getLabelColors();
    var geojsonMarkerOptions = {
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


    initializeNeighborhoodPolygons(map);
    initializeAuditedStreets(map);
    initializeSubmittedLabels(map);
    initializeAdminGSVLabelView();
    setTimeout(function () {
        map.invalidateSize(false);
    }, 1);

    function initializeAdminGSVLabelView() {
        self.adminGSVLabelView = AdminGSVLabelView(false);
    }

    // Functionality for the legend's minimize button.
    $('#map-legend-minimize-button').click(function() {
        $("#legend-table").slideToggle(0);
        $(this).text(function(_, value) { return value === '-' ? '+' : '-'});
    });


    self.clearMap = clearMap;
    self.redrawLabels = redrawLabels;
    self.clearAuditedStreetLayer = clearAuditedStreetLayer;
    self.redrawAuditedStreetLayer = redrawAuditedStreetLayer;
    self.toggleLayers = toggleLayers;
    self.toggleAuditedStreetLayer = toggleAuditedStreetLayer;

    return self;
}
