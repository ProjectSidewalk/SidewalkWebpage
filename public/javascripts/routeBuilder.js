$(document).ready(function () {
    let currRoute = [];
    let currRegionId = null;

    mapboxgl.accessToken = 'pk.eyJ1IjoibWlzYXVnc3RhZCIsImEiOiJjajN2dTV2Mm0wMDFsMndvMXJiZWcydDRvIn0.IXE8rQNF--HikYDjccA7Ug';
    var map = new mapboxgl.Map({
        container: 'route-builder-map',
        style: 'mapbox://styles/mapbox/streets-v11',
        minZoom: 9,
        maxZoom: 19
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-left');

    $.getJSON('/contribution/streets/all?filterLowQuality=true', function(data) {
        console.log(data);
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
                        // ['all', currRegionId !== null, ['!=', currRegionId, ['get', 'region_id']]], '#bbb', // try with currRegionId === null.
                        // ['boolean', ['!=', ['get', 'region_id'], ['coalesce', null, null]], false], '#bbb',
                        ['boolean', ['feature-state', 'hover'], false], '#da1',
                        '#777'
                    ],
                    // Line width scales based on zoom level.
                    'line-width': [
                        'interpolate', ['linear'], ['zoom'],
                        12, 1,
                        15, 5
                    ],
                    'line-opacity': 0.75
                }
            });

            let streetId = null;
            const popup = new mapboxgl.Popup({
                offset: [0, -15],
                closeButton: false,
                closeOnClick: false
            }).setHTML(`A route can only have streets from one region in it.`);

            // Mark when a street is being hovered over.
            map.on('mousemove', (event) => {
                const street = map.queryRenderedFeatures(event.point, { layers: ['streets'] });
                if (!street.length) return;

                // If we moved directly from hovering over one street to another, set the previous as hover: false.
                if (streetId) map.setFeatureState({ source: 'streets', id: streetId }, { hover: false });
                streetId = street[0].properties.street_edge_id;

                map.setFeatureState({ source: 'streets', id: streetId }, { hover: true });
                map.getCanvas().style.cursor = 'pointer';

                // Show a tooltip informing user that they can't have multiple regions in the same route.
                if (currRegionId && currRegionId !== street[0].properties.region_id) {
                    popup.setLngLat(street[0].geometry.coordinates[0])
                        .addTo(map);
                }

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
                popup.remove();
            });

            // When a street is clicked, toggle it as being chosen for the route or not.
            map.on('click', (event) => {
                const street = map.queryRenderedFeatures(event.point, { layers: ['streets'] });
                if (!street.length || (currRegionId && currRegionId !== street[0].properties.region_id)) {
                    return;
                }

                streetId = street[0].properties.street_edge_id;
                let currState = map.getFeatureState({ source: 'streets', id: streetId });
                map.setFeatureState({ source: 'streets', id: streetId }, { chosen: !currState.chosen });

                if (currState.chosen) {
                    // If the street was in the route, remove it from the route.
                    currRoute = currRoute.filter(s => s !== streetId);

                    // If there are no longer any streets in the route, any street can now be selected. Update styles.
                    if (currRoute.length === 0) {
                        currRegionId = null;
                        map.setPaintProperty(
                            'streets',
                            'line-color',
                            ['case',
                                ['boolean', ['feature-state', 'chosen'], false], '#4a6',
                                ['boolean', ['feature-state', 'hover'], false], '#da1',
                                '#777'
                            ]
                        );
                    }
                }
                else {
                    // Add the new street to the route.
                    currRoute.push(streetId);

                    // If this was the first street added, change style to show that streets in other regions can't be chosen.
                    if (currRoute.length === 1) {
                        currRegionId = street[0].properties.region_id;
                        map.setPaintProperty(
                            'streets',
                            'line-color',
                            ['case',
                                ['boolean', ['!=', ['get', 'region_id'], currRegionId]], '#bbb',
                                ['boolean', ['feature-state', 'chosen'], false], '#4a6',
                                ['boolean', ['feature-state', 'hover'], false], '#da1',
                                '#777'
                            ]
                        );
                    }
                }
            });
            console.log(map);
        });
    });


    // Get city-specific parameters for the map.
    $.getJSON('/cityMapParams', function(data) {
        map.setZoom(data.default_zoom - 1);
        map.setCenter([data.city_center.lng, data.city_center.lat]);
        map.setMaxBounds([
            [data.southwest_boundary.lng, data.southwest_boundary.lat],
            [data.northeast_boundary.lng, data.northeast_boundary.lat]
        ]);
    });

    window.saveRoute = function() {
        console.log(currRoute);
        fetch('/saveRoute', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(currRoute)
        })
            .then(response => console.log(JSON.stringify(response.json())));
    };
});
