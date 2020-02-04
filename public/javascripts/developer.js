$(document).ready(function () {
    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';

    // var tileUrl = "https://a.tiles.mapbox.com/v4/kotarohara.mmoldjeh/page.html?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA#13/38.8998/-77.0638";
    var tileUrl = "https:\/\/a.tiles.mapbox.com\/v4\/kotarohara.8e0c6890\/{z}\/{x}\/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA";
    var mapboxTiles = L.tileLayer(tileUrl, {
        attribution: '<a href="http://www.mapbox.com/about/maps/" target="_blank">Terms &amp; Feedback</a>'
    });

    // Maps
    var mapAccessAttributes = L.mapbox.map('developer-access-attribute-map', "kotarohara.8e0c6890", {
        maxZoom: 19,
        minZoom: 9,
        zoomSnap: 0.5
    });
    var mapAccessScoreStreets = L.mapbox.map('developer-access-score-streets-map', "kotarohara.8e0c6890", {
        maxZoom: 19,
        minZoom: 9,
        zoomSnap: 0.5
    });
    var mapAccessScoreNeighborhoods = L.mapbox.map('developer-access-score-neighborhoods-map', "kotarohara.8e0c6890", {
        maxZoom: 19,
        minZoom: 9
    });

    var colorMapping = util.misc.getLabelColors();

    function getColor(d) {
        return d > 0.75 ? '#4dac26' :
            d > 0.5 ? '#b8e186' :
                d > 0.25 ? '#f1b6da' :
                    '#d01c8b';
    }

    // Get city-specific parameters for the maps.
    $.getJSON('/cityAPIDemoParams', function(data) {
        var southWest = L.latLng(data.southwest_boundary.lat, data.southwest_boundary.lng);
        var northEast = L.latLng(data.northeast_boundary.lat, data.northeast_boundary.lng);
        mapAccessAttributes.setMaxBounds(L.latLngBounds(southWest, northEast));
        mapAccessScoreStreets.setMaxBounds(L.latLngBounds(southWest, northEast));
        mapAccessScoreNeighborhoods.setMaxBounds(L.latLngBounds(southWest, northEast));

        mapAccessAttributes.setView([data.attribute.center_lat, data.attribute.center_lng], data.attribute.zoom);
        mapAccessScoreStreets.setView([data.street.center_lat, data.street.center_lng], data.street.zoom);
        mapAccessScoreNeighborhoods.setView([data.region.center_lat, data.region.center_lng], data.region.zoom);

        // A map for Access Attribute
        $.getJSON(`/v2/access/attributes?lat1=${data.attribute.lat1}&lng1=${data.attribute.lng1}&lat2=${data.attribute.lat2}&lng2=${data.attribute.lng2}`, function (data) {
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
        $.getJSON(`/v2/access/score/streets?lat1=${data.street.lat1}&lng1=${data.street.lng1}&lat2=${data.street.lat2}&lng2=${data.street.lng2}`, function (data) {
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
        $.getJSON(`/v2/access/score/neighborhoods?lat1=${data.region.lat1}&lng1=${data.region.lng1}&lat2=${data.region.lat2}&lng2=${data.region.lng2}`, function (data) {
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
            }).addTo(mapAccessScoreNeighborhoods);
        });
    });
});
