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
                data: data,
                promoteId: 'street_edge_id'
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
                    'line-color': ['case',
                        ['boolean', ['feature-state', 'chosen'], false], '#4a6',
                        ['boolean', ['feature-state', 'hover'], false], '#da1',
                        '#888'
                    ],
                    'line-width': 5,
                    'line-opacity': 0.75
                }
            });

            let streetId = null;

            // Mark when a street is being hovered over.
            map.on('mousemove', (event) => {
                const street = map.queryRenderedFeatures(event.point, { layers: ['streets'] });
                if (!street.length) return;

                // If we moved directly from hovering over one street to another, set the previous as hover: false.
                if (streetId) map.setFeatureState({ source: 'streets', id: streetId }, { hover: false });
                streetId = street[0].properties.street_edge_id;

                map.getCanvas().style.cursor = 'pointer';
                map.setFeatureState({ source: 'streets', id: streetId }, { hover: true });

                // const popup = new mapboxgl.Popup({ offset: [0, -15] })
                //     .setLngLat(street[0].geometry.coordinates[0])
                //     .setHTML(`<h3>${street[0].properties.street_edge_id}</h3><p>${street[0].properties.way_type}</p>`)
                //     .addTo(map);
            });

            // When not hovering over any streets, set prev street to hover: false and reset cursor.
            map.on('mouseleave', 'streets', () => {
                if (streetId) map.setFeatureState({ source: 'streets', id: streetId }, { hover: false });
                streetId = null;
                map.getCanvas().style.cursor = '';
            });

            // When a street is clicked, toggle it as being chosen for the route or not.
            map.on('click', (event) => {
                const street = map.queryRenderedFeatures(event.point, { layers: ['streets'] });
                if (!street.length) return;

                streetId = street[0].properties.street_edge_id;
                let currState = map.getFeatureState({ source: 'streets', id: streetId });
                map.setFeatureState({ source: 'streets', id: streetId }, { chosen: !currState.chosen });
            })
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
