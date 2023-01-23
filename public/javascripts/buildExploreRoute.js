$(document).ready(function () {
    mapboxgl.accessToken = 'pk.eyJ1IjoibWlzYXVnc3RhZCIsImEiOiJjajN2dTV2Mm0wMDFsMndvMXJiZWcydDRvIn0.IXE8rQNF--HikYDjccA7Ug';
    var map = new mapboxgl.Map({
        container: 'route-builder-map',
        style: 'mapbox://styles/mapbox/streets-v11'
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-left');

    $.getJSON('/contribution/streets/all?filterLowQuality=true', function(data) {
        map.on('load', () => {
            map.addSource('streets', {
                type: 'geojson',
                data: data
            });
            map.addLayer({
                'id': 'streets',
                'type': 'line',
                'source': 'streets',
                'layout': {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                'paint': {
                    'line-color': '#888',
                    'line-width': 8
                }
            });
        });
    })


    // Get city-specific parameters for the maps.
    $.getJSON('/cityMapParams', function(data) {
        // Set view center and max bounds for each map.
        // mapAccessAttributes.setView([data.attribute.center_lat, data.attribute.center_lng], data.attribute.zoom);
        // mapAccessScoreStreets.setView([data.street.center_lat, data.street.center_lng], data.street.zoom);
        // mapAccessScoreNeighborhoods.setView([data.region.center_lat, data.region.center_lng], data.region.zoom);
        //
        // var southWest = L.latLng(data.southwest_boundary.lat, data.southwest_boundary.lng);
        // var northEast = L.latLng(data.northeast_boundary.lat, data.northeast_boundary.lng);
        // mapAccessAttributes.setMaxBounds(L.latLngBounds(southWest, northEast));
        // mapAccessScoreStreets.setMaxBounds(L.latLngBounds(southWest, northEast));
        // mapAccessScoreNeighborhoods.setMaxBounds(L.latLngBounds(southWest, northEast));
    });
});
