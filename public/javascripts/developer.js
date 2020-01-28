$(document).ready(function () {
    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';

    // Construct a bounding box for this map that the user cannot move out of
    // https://www.mapbox.com/mapbox.js/example/v1.0.0/maxbounds/
    var southWest = L.latLng(45.265, -123.010),
        northEast = L.latLng(45.345, -122.900),
        bounds = L.latLngBounds(southWest, northEast),

    // var tileUrl = "https://a.tiles.mapbox.com/v4/kotarohara.mmoldjeh/page.html?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA#13/38.8998/-77.0638";
        tileUrl = "https:\/\/a.tiles.mapbox.com\/v4\/kotarohara.8e0c6890\/{z}\/{x}\/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA",
        mapboxTiles = L.tileLayer(tileUrl, {
            attribution: '<a href="http://www.mapbox.com/about/maps/" target="_blank">Terms &amp; Feedback</a>'
        });

    // Maps
    var mapAccessAttributes = L.mapbox.map('developer-access-attribute-map', "kotarohara.8e0c6890", {
        maxBounds: bounds,
        maxZoom: 19,
        minZoom: 9,
        zoomSnap: 0.5
    })
        .fitBounds(bounds)
        .setView([45.319, -122.975], 16);
    var mapAccessScoreStreets = L.mapbox.map('developer-access-score-streets-map', "kotarohara.8e0c6890", {
        maxBounds: bounds,
        maxZoom: 19,
        minZoom: 9,
        zoomSnap: 0.5
    })
        .fitBounds(bounds)
        .setView([45.319, -122.975], 14);
    var mapAccesScoreNeighborhoods = L.mapbox.map('developer-access-score-neighborhoods-map', "kotarohara.8e0c6890", {
            maxBounds: bounds,
            maxZoom: 19,
            minZoom: 9
        })
        .fitBounds(bounds)
        .setView([45.319, -122.975], 13);

    // Create 3 white overlay polygons. Add an overlay to each map.
    var overlay = L.geoJson({ "type": "FeatureCollection",
        "features": [ {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[ -76.989, 38.909], [ -76.989, 38.912], [-76.982, 38.912], [-76.982, 38.909], [ -76.989, 38.909]]]
                // "coordinates": [ [ [-75, 36], [-75, 40], [-80, 40], [-80, 36],[-75, 36] ] ]
            }
        } ]
    }, {
        style: {
            fillColor: "#fff",
            fillOpacity: 0.75,
            color: "#fff",
            weight: 0
        }
    });
    var overlays = [0, 1].map(function (i) { return L.geoJson({ "type": "FeatureCollection",
        "features": [ {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[ -77.028, 38.910], [ -77.028, 38.929], [-77.009, 38.929], [-77.009, 38.910], [ -77.028, 38.910]]]
                // "coordinates": [ [ [-75, 36], [-75, 40], [-80, 40], [-80, 36],[-75, 36] ] ]
                // lat1=38.899&lng1=-77.008&lat2=38.920&lng2=-76.971
            }
        } ]
    }, {
        style: {
            fillColor: "#fff",
            fillOpacity: 0.6,
            color: "#fff",
            weight: 0
        }
    }); });
    overlay.addTo(mapAccessAttributes);
    overlays[0].addTo(mapAccesScoreNeighborhoods);
    overlays[1].addTo(mapAccessScoreStreets);

    var colorMapping = util.misc.getLabelColors();

    // A map for Access Attribute
    $.getJSON("https://sidewalk-newberg.cs.washington.edu/v2/access/attributes?lat1=45.297&lat1=45.305&lng1=-123.000&lat2=45.327&lng2=-122.960", function (data) {
        function style(feature) {
            return {
                weight: 1,
                opacity:0.7,
                color: "#fff"
            }
        }

        L.geoJson(data, {
            style: style,
            pointToLayer: function (feature, latlng) {
                var labelType = feature.properties.label_type,
                    fillColor = labelType in colorMapping ? colorMapping[labelType].fillStyle : "#ccc";
                return L.circleMarker(latlng, {
                    radius: 5,
                    fillColor: fillColor,
                    color: "#fff",
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.75
                });
            }
        }).addTo(mapAccessAttributes);
    });

    // A map for Access Score: Streets
    $.getJSON("https://sidewalk-newberg.cs.washington.edu/v2/access/score/streets?lat1=45.310&lng1=-123.000&lat2=45.327&lng2=-122.960", function (data) {
        function style(feature) {
            return {
                weight: 5,
                opacity:0.7,
                color: getColor(feature.properties.score),
                dashArray: '3'
            }
        }



        L.geoJson(data, { style: style }).addTo(mapAccessScoreStreets);
    });

    // A map for Access Score: Neighborhoods
    // Reference: http://leafletjs.com/examples/choropleth.html
    $.getJSON("https://sidewalk-newberg.cs.washington.edu/v2/access/score/neighborhoods?lat1=45.305&lng1=-123.010&lat2=45.345&lng2=-122.950", function (data) {
        function style(feature) {
            return {
                fillColor: getColor(feature.properties.score),
                weight: 3,
                opacity: 1,
                color: 'white',
                dashArray: '3',
                fillOpacity: 0.7
            }
        }

        L.geoJson(data, {
            style: style
        }).addTo(mapAccesScoreNeighborhoods);
    });

    function getColor(d) {
        return d > 0.75 ? '#4dac26' :
            d > 0.5 ? '#b8e186' :
                d > 0.25 ? '#f1b6da' :
                    '#d01c8b';
    }
});
