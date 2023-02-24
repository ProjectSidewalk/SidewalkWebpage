function RouteBuilder ($, mapParamData) {
    let self = {};
    self.status = {
        mapLoaded: false,
        neighborhoodsLoaded: false,
        streetsLoaded: false
    };
    let neighborhoodData = null;
    let streetData = null;

    let currRoute = [];
    let currRegionId = null;

    let streetDistanceElem = $('#street-distance');
    let saveButton = $('#route-builder-save-button');
    let exploreButton = $('#route-builder-explore-button');
    let shareButton = $('#route-builder-share-button');

    // Initialize the map.
    mapboxgl.accessToken = 'pk.eyJ1IjoibWlzYXVnc3RhZCIsImEiOiJjajN2dTV2Mm0wMDFsMndvMXJiZWcydDRvIn0.IXE8rQNF--HikYDjccA7Ug';
    var map = new mapboxgl.Map({
        container: 'route-builder-map',
        style: 'mapbox://styles/mapbox/streets-v11',
        minZoom: 9,
        maxZoom: 19
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-left');
    map.on('load', () => {
        self.status.mapLoaded = true;
        if (self.status.neighborhoodsLoaded) {
            renderNeighborhoodsHelper();
        }
        if (self.status.streetsLoaded) {
            renderStreetsHelper();
        }
    });

    // Set the location of the map to focus on the current city.
    map.setZoom(mapParamData.default_zoom - 1);
    map.setCenter([mapParamData.city_center.lng, mapParamData.city_center.lat]);
    map.setMaxBounds([
        [mapParamData.southwest_boundary.lng, mapParamData.southwest_boundary.lat],
        [mapParamData.northeast_boundary.lng, mapParamData.northeast_boundary.lat]
    ]);


    // Create the tooltip for the share button that says it's copied to the clipboard.
    shareButton.tooltip({
        trigger: 'manual'
    });
    function setTooltip(btn, message) {
        $(btn).tooltip('hide')
            .attr('data-original-title', message)
            .tooltip('show');
        hideTooltip(btn);
    }
    function hideTooltip(btn) {
        setTimeout(function() {
            $(btn).tooltip('hide');
        }, 1000);
    }

    let saveRoute = function() {
        console.log(currRoute);
        fetch('/saveRoute', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ region_id: currRegionId, street_ids: currRoute.map(s => s.properties.street_edge_id) })
        })
            .then((response) => response.json())
            .then((data) => {
                console.log(data);
                let exploreURL = `/audit?routeId=${data.route_id}`;
                exploreButton.click(function () {
                    window.location.replace(exploreURL);
                });
                exploreButton.prop('disabled', false);

                // Add the 'copied to clipboard' tooltip.
                shareButton.click(function (e) {
                    console.log(e);
                    navigator.clipboard.writeText(`${window.location.origin}${exploreURL}`);
                    setTooltip(e.currentTarget, 'Copied to clipboard!');
                });
                shareButton.prop('disabled', false);
            });
    };
    saveButton.click(saveRoute);


    function renderNeighborhoodsHelper() {
        // TODO and render it below the streets using the beforeId param in addLayer().
        console.log(neighborhoodData);
        map.addSource('neighborhoods', {
            type: 'geojson',
            data: neighborhoodData,
            promoteId: 'region_id'
        });
        map.addLayer({
            id: 'neighborhoods',
            type: 'fill',
            source: 'neighborhoods',
            paint: {
                'fill-opacity': 0.1,
                'fill-color': ['case',
                    ['boolean', ['feature-state', 'current'], false], '#4a6',
                    '#222'
                ]
            }
        });
        // Make sure that the polygons are visually below the streets.
        if (map.getLayer('streets')) {
            map.moveLayer('neighborhoods', 'streets');
        }
    }
    function renderNeighborhoods(neighborhoodDataIn) {
        neighborhoodData = neighborhoodDataIn;
        self.status.neighborhoodsLoaded = true;
        if (self.status.mapLoaded) {
            renderNeighborhoodsHelper(neighborhoodData);
        }
    }

    function renderStreetsHelper() {
        console.log(streetData);
        map.addSource('streets', {
            type: 'geojson',
            data: streetData,
            promoteId: 'street_edge_id'
        });
        map.addLayer({
            id: 'streets',
            type: 'line',
            source: 'streets',
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
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
        }).setHTML(`A route can only have streets from one region in it at this time.`);

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
                currRoute = currRoute.filter(s => s.properties.street_edge_id !== streetId);

                // If there are no longer any streets in the route, any street can now be selected. Update styles.
                if (currRoute.length === 0) {
                    map.setFeatureState({ source: 'neighborhoods', id: currRegionId }, { current: false });

                    currRegionId = null;
                    saveButton.prop('disabled', true);
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
                currRoute.push(street[0]);

                // If this was first street added, change style to show you can't choose streets in other regions.
                if (currRoute.length === 1) {
                    currRegionId = street[0].properties.region_id;
                    saveButton.prop('disabled', false);
                    map.setFeatureState({ source: 'neighborhoods', id: currRegionId }, { current: true });
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
            streetDistanceElem.text(`Route length: ${currRoute.reduce((sum, street) => sum + turf.length(street, { units: 'kilometers' }), 0)}`);
        });
        console.log(map);
    }
    function renderStreets(streetDataIn) {
        streetData = streetDataIn;
        self.status.streetsLoaded = true;
        if (self.status.mapLoaded) {
            renderStreetsHelper(streetData);
        }
    }

    self.map = map;
    self.renderNeighborhoods = renderNeighborhoods;
    self.renderStreets = renderStreets;
    return self;
}
