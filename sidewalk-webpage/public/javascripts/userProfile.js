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

    initializeOverlayPolygon(map);
    initializeNeighborhoodPolygons(map);
    initializeAuditedStreets(map);
    initializeSubmittedLabels(map);
});

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
    };

    function onEachNeighborhoodFeature(feature, layer) {
        layer.on('mouseover', function (e) {
            this.setStyle({color: "red", fillColor: "red"});
        });
        layer.on('mouseout', function (e) {
            this.setStyle(neighborhoodPolygonStyle);
        });
        layer.on('click', function (e) {
            var center = turf.center(this.feature),
                coordinates = center.geometry.coordinates,
                latlng = L.latLng(coordinates[1], coordinates[0]),
                zoom = map.getZoom();
            zoom = zoom > 14 ? zoom : 14;

            console.log(coordinates);
            console.log(latlng);
            map.setView(latlng, zoom, {animate: true});
        });
    }

    $.getJSON("/geometry/neighborhoods", function (data) {
        L.geoJson(data, {
            style: function (feature) {
              var style = $.extend(true, {}, neighborhoodPolygonStyle)
              return style;
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

    $.getJSON("/contribution/streets", function (data) {

        // Render audited street segments
        L.geoJson(data, {
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
        document.getElementById("td-total-distance-audited").innerHTML = distanceAudited.toPrecision(2) + " km";
    });
}

function initializeSubmittedLabels(map) {
    var distanceAudited = 0,  // Distance audited in km
        labelPointStyle = {
          color: "black",
          weight: 3,
          opacity: 0.75
        };

    function onEachLabelFeature(feature, layer) {
        if (feature.properties && feature.properties.type) {
            layer.bindPopup(feature.properties.type);
        }
    }

    var geojsonMarkerOptions = {
        radius: 5,
        fillColor: "#ff7800",
        color: "#ffffff",
        weight: 1,
        opacity: 0.5,
        fillOpacity: 0.8,
        "stroke-width": 1,
    };

    $.getJSON("/contribution/labels", function (data) {

        // Render audited street segments
        L.geoJson(data, {
          pointToLayer: function (feature, latlng) {
            return L.circleMarker(latlng, geojsonMarkerOptions);
          },
            onEachFeature: onEachLabelFeature
        })
        .addTo(map);

        // Calculate total distance audited in (km)
//        for (var i = data.features.length - 1; i >= 0; i--) {
//            distanceAudited += turf.lineDistance(data.features[i]);
//        }
//        document.getElementById("td-total-distance-audited").innerHTML = distanceAudited.toPrecision(2) + " km";
    });
}
