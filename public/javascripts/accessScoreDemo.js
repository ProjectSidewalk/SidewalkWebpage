var neighborhoodPolygonLayer;

$(document).ready(function () {
    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';

    // Construct a bounding box for this map that the user cannot move out of
    // https://www.mapbox.com/mapbox.js/example/v1.0.0/maxbounds/
    var southWest = L.latLng(38.761, -77.262),
        northEast = L.latLng(39.060, -76.830),
        bounds = L.latLngBounds(southWest, northEast),
        tileUrl = "https:\/\/a.tiles.mapbox.com\/v4\/kotarohara.8e0c6890\/{z}\/{x}\/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA",
        map = L.mapbox.map('map', "kotarohara.8e0c6890", {
                maxBounds: bounds,
                maxZoom: 19,
                minZoom: 9
        }).fitBounds(bounds).setView([38.892, -77.038], 12),
        popup = L.popup().setContent('');

    initializeNeighborhoodPolygons(map);
    initializeSubmittedLabels(map);

    // Add legends
    var colorMapping = svl.misc.getLabelColors();
    document.getElementById("map-legend-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='4' cx='10' cy='10' fill='" + colorMapping['CurbRamp'].fillStyle + "'></svg>";
    document.getElementById("map-legend-no-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='4' cx='10' cy='10' fill='" + colorMapping['NoCurbRamp'].fillStyle + "'></svg>";
    document.getElementById("map-legend-obstacle").innerHTML = "<svg width='20' height='20'><circle r='4' cx='10' cy='10' fill='" + colorMapping['Obstacle'].fillStyle + "'></svg>";
    document.getElementById("map-legend-surface-problem").innerHTML = "<svg width='20' height='20'><circle r='4' cx='10' cy='10' fill='" + colorMapping['SurfaceProblem'].fillStyle + "'></svg>";
    document.getElementById("map-legend-access-score-scale").innerHTML = "<svg width='48' height='20'>" +
        "<rect width='10' height='10' x='1' y='10' style='fill:#d01c8b;' />" +
        "<rect width='10' height='10' x='12' y='10' style='fill:#f1b6da;' />" +
        "<rect width='10' height='10' x='24' y='10' style='fill:#b8e186;' />" +
        "<rect width='10' height='10' x='36' y='10' style='fill:#4dac26;' /></svg>";

    // '#4dac26' :
    // d > 0.5 ? '#b8e186' :
    //     d > 0.25 ? '#f1b6da' :
    //         '#d01c8b';

    // Add an overlay polygon
    L.geoJson({ "type": "FeatureCollection",
        "features": [ {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [ [ [-75, 36], [-75, 40], [-80, 40], [-80, 36],[-75, 36] ] ]
            }
        } ]
    }).addTo(map);


    // Attach events to range sliders
    $(".access-score-range-slider").on("change", function (e) {
        var significance = {};
        $(".access-score-range-slider").each(function (i, d) {
            var name = $(d).attr("name");
            var value = $(d).val();
            significance[name] = parseFloat(value) / 100;
        });
        updateAccessScore(significance);
    });
});

// Access score color
function getColor(d) {
    return d > 0.75 ? '#4dac26' :
        d > 0.5 ? '#b8e186' :
            d > 0.25 ? '#f1b6da' :
                '#d01c8b';
}

/**
 * Update the access score visualization
 * @param significance
 */
function updateAccessScore (significance) {
    if (neighborhoodPolygonLayer) {
        var neighborhoodLayers = neighborhoodPolygonLayer.getLayers(),
            i = 0,
            len = neighborhoodLayers.length;

        for (; i < len; i++) {
            var properties = neighborhoodLayers[i].feature.properties,
                featureVector = properties.feature;
            if (featureVector) {
                // Compute the Access Score by computing the sigmoid of the inner product of the feature vector and significance vector.
                var keys = Object.keys(featureVector),
                    innerProduct = 0;
                for (var keyIdx in keys) {
                    var key = keys[keyIdx];
                    var k = key == "CurbRamp" ? 1 : -1;
                    innerProduct += k * featureVector[key] * significance[key];
                }
                var score = 1 / ( 1 + Math.exp( -innerProduct ) );
                console.log(properties);

                properties.significance = significance;

                var neighborhoodPolygonStyle = {
                    color: getColor(score),
                    weight: 1,
                    opacity: 0.5,
                    fillColor: getColor(score),
                    fillOpacity: 0.5
                };

                neighborhoodLayers[i].setStyle(neighborhoodPolygonStyle);

                // Set popup content
                var popupContent = properties.region_name ? "<span class='bold'>" + properties.region_name + "</span><br/>" : "";
                popupContent += properties.score ? ("Access Score: " + score.toFixed(1)) : "Access Score not available";
                neighborhoodLayers[i]._popup.setContent(popupContent);
                neighborhoodLayers[i]._popup.update()
            }
        }
    }
}

/**
 * Render accessibiltiy feature points
 */
function initializeNeighborhoodPolygons(map) {
    var layers = [],
        currentLayer;

    function onEachNeighborhoodFeature(feature, layer) {
        var properties = feature.properties,
            popupContent = "";
        var neighborhoodPolygonStyle = {
            color: '#888',
            weight: 1,
            opacity: 0.5,
            fillColor: "#ccc",
            fillOpacity: 0.5
        };

        if (properties.score && typeof properties.score == 'number') {
            neighborhoodPolygonStyle.color = getColor(properties.score);
            neighborhoodPolygonStyle.fillColor = getColor(properties.score);
        }

        layer.setStyle(neighborhoodPolygonStyle);

        popupContent += properties.region_name ? "<span class='bold'>" + properties.region_name + "</span><br/>" : "";
        popupContent += properties.score ? ("Access Score: " + properties.score.toFixed(1)) : "Access Score not available";

        // Add event listeners to each neighborhood polygon layer
        layer.bindPopup(popupContent);
        layer.on('mouseover', function (e) {
            this.setStyle({ weight: 5 });
        });
        layer.on('mouseout', function (e) {
            this.setStyle({ weight: 1 });
        });
        layer.on('click', function (e) {
            var center = turf.center(this.feature),
                coordinates = center.geometry.coordinates,
                latlng = L.latLng(coordinates[1], coordinates[0]),
                zoom = map.getZoom();
            zoom = zoom > 15 ? zoom : 15;

            map.setView(latlng, zoom, {animate: true});
            currentLayer = this;
        });
        layers.push(layer);
    }

    $.getJSON("/v1/access/score/neighborhoods?lat1=38.761&lng1=-77.262&lat2=39.060&lng2=-76.830", function (data) {
        var neighborhoodPolygonStyle = {
            color: '#888',
            weight: 1,
            opacity: 0.5,
            fillColor: "#ccc",
            fillOpacity: 0.3
        };
        neighborhoodPolygonLayer = L.geoJson(data, {
            style: function (feature) {
                return neighborhoodPolygonStyle;
            },
            onEachFeature: onEachNeighborhoodFeature
        }).addTo(map);

        // Attache zoom events. Show the neighborhood polygon layer only when the view is zoomed out ( zoom <= 14)
        map.on('zoomend ', function(e) {
            if ( map.getZoom() > 15 ) {
                map.removeLayer( neighborhoodPolygonLayer );
            } else if (
                map.getZoom() <= 15 ){ map.addLayer( neighborhoodPolygonLayer );
            }
        });
    });
}

function initializeSubmittedLabels(map) {
    var colorMapping = svl.misc.getLabelColors(),
        geojsonMarkerOptions = {
            radius: 5,
            fillColor: "#ff7800",
            color: "#ffffff",
            weight: 1,
            opacity: 0.5,
            fillOpacity: 0.5,
            "stroke-width": 1
        };

    $.getJSON("/v1/access/features?lat1=38.761&lng1=-77.262&lat2=39.060&lng2=-76.830", function (data) {
        // Render submitted labels
        var featureLayer = L.geoJson(data, {
            pointToLayer: function (feature, latlng) {
                var style = $.extend(true, {}, geojsonMarkerOptions);
                style.fillColor = colorMapping[feature.properties.label_type].fillStyle;
                return L.circleMarker(latlng, style);
            }
        });

        // Attache zoom events. Show the neighborhood polygon layer only when the view is zoomed out ( zoom <= 14)
        map.on('zoomend', function(e) {
            if ( map.getZoom() < 15 ) {
                map.removeLayer( featureLayer );
            } else if (map.getZoom() >= 15 ){
                map.addLayer( featureLayer );
            }
        });
    });
}
