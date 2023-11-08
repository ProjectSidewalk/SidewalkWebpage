function RouteBuilder ($, mapParamData) {
    let self = {};
    self.status = {
        mapLoaded: false,
        neighborhoodsLoaded: false,
        streetsLoaded: false
    };
    let neighborhoodData = null;
    let streetData = null;

    let streetDataInRoute = null;
    let currRoute = [];
    let currRegionId = null;
    let savedRoute = null;

    let streetDistanceElem = $('#street-distance');
    let saveButton = $('#route-builder-save-button');
    let exploreButton = $('#route-builder-explore-button');
    let shareButton = $('#route-builder-share-button');

    // Initialize the map.
    mapboxgl.accessToken = mapParamData.mapbox_api_key;
    var map = new mapboxgl.Map({
        container: 'route-builder-map',
        style: 'mapbox://styles/projectsidewalk/cloov4big002801rc0qw75w5g',
        minZoom: 9,
        maxZoom: 19
    });
    const mapboxLang = new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') });
    map.addControl(mapboxLang);
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
    console.log(map);

    // Set up the route length in the top-right of the map.
    let units = i18next.t('common:unit-distance');
    setRouteDistanceText();

    // Create instructional tooltips for the buttons.
    saveButton.tooltip({ title: i18next.t('save-button-tooltip'), container: 'body' });
    exploreButton.tooltip({ title: i18next.t('explore-button-tooltip'), container: 'body' });
    shareButton.tooltip({ title: i18next.t('share-button-tooltip'), container: 'body' });

    // These functions will temporarily show a tooltip. Used when the user clicks the 'copy to clipboard' button.
    function setTemporaryTooltip(btn, message) {
        $(btn).attr('data-original-title', message).tooltip('enable').tooltip('show');
        hideTooltip(btn);
    }
    function hideTooltip(btn) {
        setTimeout(function() {
            $(btn).tooltip('hide').tooltip('disable');
        }, 1000);
    }

    // Saves the route to the database, enables explore/share buttons, updates tooltips for all buttons.
    let saveRoute = function() {
        let streetIds = currRoute.map(s => s.properties.street_edge_id);
        // Don't save if the route is empty or hasn't changed.
        if (streetIds.length === 0) {
            logActivity(`RouteBuilder_Click=SaveEmpty`);
            return;
        } else if (JSON.stringify(streetIds) === JSON.stringify(savedRoute)) {
            logActivity(`RouteBuilder_Click=SaveDuplicate`);
            return;
        }
        fetch('/saveRoute', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ region_id: currRegionId, street_ids: streetIds })
        })
            .then((response) => response.json())
            .then((data) => {
                savedRoute = streetIds;
                setTemporaryTooltip(saveButton, i18next.t('route-saved'));
                logActivity(`RouteBuilder_Click=SaveSuccess_RouteId=${data.route_id}`);

                // Update link and tooltip for Explore route button.
                let exploreURL = `/explore?routeId=${data.route_id}`;
                exploreButton.off('click');
                exploreButton.click(function () {
                    logActivity(`RouteBuilder_Click=Explore_RouteId=${data.route_id}`);
                    window.location.replace(exploreURL);
                });
                exploreButton.attr('aria-disabled', false);
                exploreButton.tooltip('disable');

                // Add the 'copied to clipboard' tooltip on click.
                shareButton.tooltip('disable');
                shareButton.off('click');
                shareButton.click(function (e) {
                    navigator.clipboard.writeText(`${window.location.origin}${exploreURL}`);
                    setTemporaryTooltip(e.currentTarget, i18next.t('copied-to-clipboard'));
                    logActivity(`RouteBuilder_Click=Copy_RouteId=${data.route_id}`);
                });
                shareButton.attr('aria-disabled', false);
            })
            .catch((error) => {
                console.error('Error:', error);
                logActivity(`RouteBuilder_Click=SaveError`);
            });
    };
    saveButton.click(saveRoute);


    function renderNeighborhoodsHelper() {
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
        if (map.getLayer('streets') && map.getLayer('streets-chosen')) {
            map.moveLayer('neighborhoods', 'streets');
            map.moveLayer('streets', 'streets-chosen');
        }
    }
    function renderNeighborhoods(neighborhoodDataIn) {
        neighborhoodData = neighborhoodDataIn;
        self.status.neighborhoodsLoaded = true;
        if (self.status.mapLoaded) {
            renderNeighborhoodsHelper(neighborhoodData);
        }
    }

    /**
     * Renders the streets on the map. Adds the hover/click events for the streets as well.
     */
    function renderStreetsHelper() {
        map.addSource('streets', {
            type: 'geojson',
            data: streetData,
            promoteId: 'street_edge_id'
        });
        // Add another source for the streets that have been added to the route.
        streetDataInRoute = {
            type: 'FeatureCollection',
            features: []
        };
        map.addSource('streets-chosen', {
            type: 'geojson',
            data: streetDataInRoute,
            promoteId: 'street_edge_id'
        });
        map.loadImage(
            '/assets/images/icons/routebuilder-street-vector.png',
            (err, image) => {
                // Add the image to the map style.
                map.addImage('street-arrow', image);

                // Create a new layer and style it using `fill-pattern`.
                map.addLayer({
                    'id': 'streets-chosen',
                    'type': 'line',
                    'source': 'streets-chosen',
                    'layout': {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    'paint': {
                        'line-pattern': 'street-arrow',
                        // Line width scales based on zoom level.
                        'line-width': [
                            'interpolate', ['linear'], ['zoom'],
                            12, 1,
                            15, 5
                        ],
                        'line-opacity': 0.75
                    }
                });
            }
        );
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
                    ['boolean', ['feature-state', 'hover'], false], '#236ee0',
                    '#ddefff'
                ],
                // Line width scales based on zoom level.
                'line-width': [
                    'interpolate', ['linear'], ['zoom'],
                    12, 1,
                    15, 5
                ],
                'line-opacity': ['case',
                    ['==', ['string', ['feature-state', 'chosen'], 'not chosen'], 'not chosen'], 0.75,
                    0.0
                ]
            }
        });

        let streetId = null;
        const popup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false
        }).setHTML(i18next.t('one-neighborhood-warning'));

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
            let newState;
            if (currState.chosen === 'chosen') newState = 'chosen reversed';
            else if (currState.chosen === 'chosen reversed') newState = 'not chosen';
            else newState = 'chosen';
            map.setFeatureState({ source: 'streets', id: streetId }, { chosen: newState });

            if (currState.chosen === 'chosen reversed') {
                // If the street was in the route, remove it from the route.
                currRoute = currRoute.filter(s => s.properties.street_edge_id !== streetId);
                streetDataInRoute.features = streetDataInRoute.features.filter(s => s.properties.street_edge_id !== streetId);

                // If there are no longer any streets in the route, any street can now be selected. Update styles.
                if (currRoute.length === 0) {
                    map.setFeatureState({ source: 'neighborhoods', id: currRegionId }, { current: false });

                    currRegionId = null;
                    saveButton.attr('aria-disabled', true);
                    saveButton.tooltip('disable');
                }
            } else if (currState.chosen === 'chosen') {
                // If the street was in the route, reverse it on this click.
                streetDataInRoute.features.find(s => s.properties.street_edge_id === streetId).geometry.coordinates.reverse();
                map.getSource('streets-chosen').setData(streetDataInRoute);
            } else {
                // Add the new street to the route.
                currRoute.push(street[0]);
                streetDataInRoute.features.push(street[0]);

                // If this was first street added, change style to show you can't choose streets in other regions.
                if (currRoute.length === 1) {
                    currRegionId = street[0].properties.region_id;
                    saveButton.attr('aria-disabled', false);
                    saveButton.tooltip('disable');
                    map.setFeatureState({ source: 'neighborhoods', id: currRegionId }, { current: true });
                }
            }
            console.log(streetDataInRoute);
            map.getSource('streets-chosen').setData(streetDataInRoute);
            setRouteDistanceText();
        });
    }
    function renderStreets(streetDataIn) {
        streetData = streetDataIn;
        self.status.streetsLoaded = true;
        if (self.status.mapLoaded) {
            renderStreetsHelper(streetData);
        }
    }

    /**
     * Updates the route distance text shown in the upper-right corner of the map.
     */
    function setRouteDistanceText() {
        let routeDistance = currRoute.reduce((sum, street) => sum + turf.length(street, { units: units }), 0);
        streetDistanceElem.text(i18next.t('route-length', { dist: routeDistance.toFixed(2) }));
    }

    /**
     * Used to log user activity to the `webpage_activity` table.
     * @param activity
     */
    function logActivity(activity) {
        var url = "/userapi/logWebpageActivity";
        var async = false;
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'post',
            data: JSON.stringify(activity),
            dataType: 'json',
            success: function(result) { },
            error: function (result) {
                console.error(result);
            }
        });
    }

    self.map = map;
    self.renderNeighborhoods = renderNeighborhoods;
    self.renderStreets = renderStreets;
    return self;
}
