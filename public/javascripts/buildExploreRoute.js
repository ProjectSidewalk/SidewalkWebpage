$(document).ready(function () {
    mapboxgl.accessToken = 'pk.eyJ1IjoibWlzYXVnc3RhZCIsImEiOiJjajN2dTV2Mm0wMDFsMndvMXJiZWcydDRvIn0.IXE8rQNF--HikYDjccA7Ug';
    var map = new mapboxgl.Map({
        container: 'route-builder-map',
        style: 'mapbox://styles/mapbox/streets-v11',
        minZoom: 9,
        maxZoom: 19
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
                    'line-width': 5
                }
            });

            // Testing out showing tooltip when hovering over a street.
            map.on('mousemove', (event) => {
                const street = map.queryRenderedFeatures(event.point, {
                    layers: ['streets']
                });
                if (!street.length) return;

                const popup = new mapboxgl.Popup({ offset: [0, -15] })
                    .setLngLat(street[0].geometry.coordinates[0])
                    .setHTML(`<h3>${street[0].properties.street_edge_id}</h3><p>${street[0].properties.way_type}</p>`)
                    .addTo(map);
            });
        });
    })


    // Get city-specific parameters for the map.
    $.getJSON('/cityMapParams', function(data) {
        map.setZoom(data.default_zoom - 1);
        map.setCenter([data.city_center.lng, data.city_center.lat]);
        map.setMaxBounds([
            [data.southwest_boundary.lng, data.southwest_boundary.lat],
            [data.northeast_boundary.lng, data.northeast_boundary.lat]
        ]);
    });
});
