var completedInitializingOverlayPolygon = false,
    completedInitializingNeighborhoodPolygons = false,
    completedInitializingAuditedStreets = false,
    completedInitializingSubmittedLabels = false,
    completedInitializingAuditCountChart = false;
var neighborhoodPolygonStyle = {
        color: '#888',
        weight: 1,
        opacity: 0.25,
        fillColor: "#ccc",
        fillOpacity: 0.1
    },
    layers = [],
    currentLayer;

$(document).ready(function () {

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

    popup = L.popup().setContent('<p>Hello world!<br />This is a nice popup.</p>');

    initializeOverlayPolygon(map);
    initializeNeighborhoodPolygons(map);
    initializeAuditedStreets(map);
    initializeSubmittedLabels(map);
    initializeAuditCountChart(c3);
});



function handleInitializationComplete (map) {
    if (completedInitializingOverlayPolygon &&
        completedInitializingNeighborhoodPolygons &&
        completedInitializingAuditedStreets &&
        completedInitializingSubmittedLabels &&
        completedInitializingAuditCountChart) {

        // Search for a region id in the query string. If you find one, focus on that region.
        var regionId = svl.util.getURLParameter("regionId"),
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

                    console.log("hey");
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
function initializeNeighborhoodPolygons(map) {


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

            map.setView(latlng, zoom, { animate: true });
            currentLayer = this;
        });
    }

    $.getJSON("/geometry/neighborhoods", function (data) {
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

    // Catch click even in popups
    // https://www.mapbox.com/mapbox.js/example/v1.0.0/clicks-in-popups/
//    $("#map").on('click', '.region-selection-trigger', function () {
//        var regionId = $(this).attr('regionid');
//        console.log(regionId)
//    });
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

    $.getJSON("/contribution/streets", function (data) {

        // Render audited street segments
        L.geoJson(data, {
          pointToLayer: L.mapbox.marker.style,
          style: function(feature) {
            var style = $.extend(true, {}, streetLinestringStyle);
            var randomInt = Math.floor(Math.random() * 5);
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
            distanceAudited += turf.lineDistance(data.features[i]);
        }
        document.getElementById("td-total-distance-audited").innerHTML = distanceAudited.toPrecision(2) + " km";

        completedInitializingAuditedStreets = true;
        handleInitializationComplete(map);
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

    function onEachLabelFeature(feature, layer) {
        if (feature.properties && feature.properties.type) {
            layer.bindPopup(feature.properties.type);
        }
    }



    $.getJSON("/contribution/labels", function (data) {
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
        document.getElementById("td-number-of-curb-ramps").innerHTML = labelCounter["CurbRamp"];
        document.getElementById("td-number-of-missing-curb-ramps").innerHTML = labelCounter["NoCurbRamp"];
        document.getElementById("td-number-of-obstacles").innerHTML = labelCounter["Obstacle"];
        document.getElementById("td-number-of-surface-problems").innerHTML = labelCounter["SurfaceProblem"];

        document.getElementById("map-legend-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['CurbRamp'].fillStyle + "'></svg>";
        document.getElementById("map-legend-no-curb-ramp").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['NoCurbRamp'].fillStyle + "'></svg>";
        document.getElementById("map-legend-obstacle").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['Obstacle'].fillStyle + "'></svg>";
        document.getElementById("map-legend-surface-problem").innerHTML = "<svg width='20' height='20'><circle r='6' cx='10' cy='10' fill='" + colorMapping['SurfaceProblem'].fillStyle + "'></svg>";
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

function initializeAuditCountChart (c3) {
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