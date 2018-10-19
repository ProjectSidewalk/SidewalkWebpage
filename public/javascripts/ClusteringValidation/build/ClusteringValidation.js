function ClusteringValidation (_, $, c3, L, difficultRegionIds) {
    var self = {};

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
            // maxZoom: 19,
            minZoom: 9
        })
        // .addLayer(mapboxTiles)
            .fitBounds(bounds)
            .setView([38.892, -77.038], 12);

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
    }

    function initializeSubmittedClusters(map) {
        var colorMapping = util.misc.getLabelColors();

        function onEachLabelFeature(feature, layer) {
            if (feature.properties && feature.properties.type) {
                layer.bindPopup(feature.properties.type);
            }
        }

        $.getJSON("/labelsForClusteringValidation", function (data) {
            _data.labels = data;
            console.log(data);

            // Render submitted labels and clusters
            L.geoJson(data, {
                pointToLayer: function (feature, latlng) {
                    var style;
                    // if there is a worker id, it is from a user, if there is none then it is clustered
                    if (feature.properties.worker_id) {
                        style = $.extend(true, {}, {
                            radius: 5,
                            fillColor: "#ff7800",
                            color: "#ffffff",
                            weight: 1,
                            opacity: 1,
                            fillOpacity: 0.5,
                            "stroke-width": 1
                        });
                    } else {
                        style = $.extend(true, {}, {
                            radius: 8,
                            fillColor: "#ff7800",
                            color: "#ffffff",
                            weight: 1,
                            opacity: 0.5,
                            fillOpacity: 0.5,
                            "stroke-width": 1
                        });
                    }
                    style.fillColor = colorMapping[feature.properties.label_type].fillStyle;

                    // If it is a cluster (not an individual label), then add a popup with number of labels in cluster.
                    if (feature.properties.worker_id) {
                        return L.circleMarker(latlng, style);
                    } else {
                        var n = data.features.filter(pt => pt.properties.cluster_id === feature.properties.cluster_id).length - 1;
                        return L.circleMarker(latlng, style).bindPopup("" + n);
                    }
                },
                onEachFeature: onEachLabelFeature
            })
                .addTo(map);

            // Render lines between labels and their cluster
            var lineGeoJson = [];
            for (var i = 0; i < data.features.length; i++) {
                var lat = data.features[i].geometry.coordinates[0];
                var lng = data.features[i].geometry.coordinates[1];
                var clusterPoint = data.features.find(function(point) {
                    return point.properties.cluster_id === data.features[i].properties.cluster_id && !point.properties.worker_id;
                });
                if (clusterPoint) {
                    lineGeoJson = lineGeoJson.concat([{
                        'type': 'LineString',
                        'coordinates': [[lat, lng], clusterPoint.geometry.coordinates]
                    }]);
                }
            }
            var myStyle = {
                "color": "black",
                "weight": 1,
                "opacity": 0.65
            };

            L.geoJson(lineGeoJson, {
                style: myStyle
            }).addTo(map);
        });
    }

    $.getJSON('/adminapi/neighborhoodCompletionRate', function (neighborhoodCompletionData) {
        initializeOverlayPolygon(map);
        initializeSubmittedClusters(map);
    });

    self.data = _data;
    return self;
}
