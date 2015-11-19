$(document).ready(function () {

    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';

    // Construct a bounding box for this map that the user cannot move out of
    // https://www.mapbox.com/mapbox.js/example/v1.0.0/maxbounds/
    var southWest = L.latLng(38.761, -77.262),
        northEast = L.latLng(39.060, -76.830),
        bounds = L.latLngBounds(southWest, northEast);

    // var tileUrl = "https://a.tiles.mapbox.com/v4/kotarohara.mmoldjeh/page.html?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA#13/38.8998/-77.0638";
    var tileUrl = "https:\/\/a.tiles.mapbox.com\/v4\/kotarohara.8e0c6890\/{z}\/{x}\/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA";
    var mapboxTiles = L.tileLayer(tileUrl, {
        attribution: '<a href="http://www.mapbox.com/about/maps/" target="_blank">Terms &amp; Feedback</a>'
    });

    var map = L.mapbox.map('map', "kotarohara.8e0c6890", {
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

    initializeAuditedStreetVisualization(map)
});

/**
 * This function queries the streets that the user audited and visualize them as segmetns on the map.
 */
function initializeAuditedStreetVisualization (map) {
    var linestringStyle = {
          color: "black",
          weight: 2,
          opacity: 0.75
        };

    function onEachFeature(feature, layer) {
          // does this feature have a property named popupContent?
            if (feature.properties && feature.properties.type) {
              // http://gis.stackexchange.com/questions/31951/how-to-show-a-popup-on-mouse-over-not-on-click
                layer.bindPopup(feature.properties.type);
                // layer.on('mouseover', function (e) {
                //   this.openPopup();
                // });
                // layer.on('mouseout', function (e) {
                //   this.closePopup();
                // });
            }
        }

    var overlayPolygon = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [[-75, 36], [-75, 40], [-80, 40], [-80, 36],[-75, 36]]
                    ]
                }
            }
        ]
    };

    var overlayPolygonLayer = L.geoJson(overlayPolygon, {
        style: {
            "fill": "#fff",
            "fill-opacity": 0.3,
            "stroke": "none",
            "stroke-width": "2px",
            "stroke-opacity": 1
        }
    }).addTo(map);

    $.getJSON("/completed", function (data) {
        console.log(data)
        L.geoJson(data, {
              pointToLayer: L.mapbox.marker.style,
              style: function(feature) {
                console.log(feature);
                var style = $.extend(true, {}, linestringStyle);
                var randomInt = Math.floor(Math.random() * 5);
                style.stroke = "black";
                style["stroke-width"] = 3;
                style.opacity = 0.75;
                style.weight = 3;

                return style;
              },
                onEachFeature: onEachFeature
            })
            .addTo(map);
    });
}