function RouteBuilder ($, mapParams) {
    let self = {};
    self.status = {
        mapLoaded: false,
        neighborhoodsLoaded: false,
        streetsLoaded: false
    };

    // Declaring variables used throughout the code.
    const endpointColors = ['#80c32a', '#ffc300', '#ff9700', '#ff6a00'];
    const units = i18next.t('common:unit-distance');

    let neighborhoodData = null;
    let currRegionId = null;
    let streetData = null;
    let chosenStreets = null;
    let savedRoute = null;
    let currentMarkers = [];

    let introUI = document.getElementById('routebuilder-intro');
    let streetDistOveraly = document.getElementById('routebuilder-overlay');
    let routeSavedModal = document.getElementById('route-saved-modal-overlay');
    let streetDistanceEl = document.getElementById('route-length-value');
    let saveButton = document.getElementById('save-button');
    let exploreButton = $('#explore-button');
    let linkTextEl = document.getElementById('share-route-link');
    let copyLinkButton = $('#copy-link-button');

    // Add the click event for the clear route buttons.
    document.getElementById('build-new-route-button').addEventListener('click', clearRoute);
    document.getElementById('cancel-button').addEventListener('click', clearRoute);

    // Initialize the map.
    mapboxgl.accessToken = mapParams.mapbox_api_key;
    var map = new mapboxgl.Map({
        container: 'route-builder-map',
        style: 'mapbox://styles/projectsidewalk/cloov4big002801rc0qw75w5g',
        center: [mapParams.city_center.lng, mapParams.city_center.lat],
        zoom: mapParams.default_zoom - 1,
        minZoom: 9,
        maxZoom: 19,
        maxBounds: [
            [mapParams.southwest_boundary.lng, mapParams.southwest_boundary.lat],
            [mapParams.northeast_boundary.lng, mapParams.northeast_boundary.lat]
        ],
        doubleClickZoom: false
    });
    // const mapboxLang = new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') });
    map.addControl(new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') }));
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-left');
    map.on('load', () => {
        // If the streets and/or neighborhoods loaded before the map, render them now that the map has loaded.
        self.status.mapLoaded = true;
        if (self.status.neighborhoodsLoaded) {
            renderNeighborhoodsHelper();
        }
        if (self.status.streetsLoaded) {
            renderStreetsHelper();
        }
    });

    /*
     * Function definitions.
     */

    // These functions will temporarily show a tooltip. Used when the user clicks the 'Copy Link' button.
    function setTemporaryTooltip(btn, message) {
        $(btn).attr('data-original-title', message).tooltip('enable').tooltip('show');
        hideTooltip(btn);
    }
    function hideTooltip(btn) {
        setTimeout(function() {
            $(btn).tooltip('hide').tooltip('disable');
        }, 1000);
    }

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
        // TODO we shouldn't require that all those layers are available. Though is 'streets' is, the others should be.
        if (map.getLayer('streets') && map.getLayer('streets-chosen') && map.getLayer('streets-chosen-hovered')) {
            map.moveLayer('neighborhoods', 'streets');
            map.moveLayer('streets', 'streets-chosen');
            map.moveLayer('chosen-hover-flip', 'streets-chosen');
            map.moveLayer('chosen-hover-remove', 'streets-chosen');
        }
    }
    function renderNeighborhoods(neighborhoodDataIn) {
        neighborhoodData = neighborhoodDataIn;
        // If the map already loaded, it's safe to render neighborhoods now. O/w they will load after the map does.
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
        // Add another source for the streets that have been added to the route, and another for added streets on hover.
        chosenStreets = { type: 'FeatureCollection', features: [] };
        map.addSource('streets-chosen', {
            type: 'geojson',
            data: chosenStreets,
            promoteId: 'street_edge_id'
        });
        map.addSource('chosen-hover-flip', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            promoteId: 'street_edge_id'
        });
        map.addSource('chosen-hover-remove', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            promoteId: 'street_edge_id'
        });

        map.addLayer({
            'id': 'streets-chosen',
            'type': 'line',
            'source': 'streets-chosen',
            'paint': {
                'line-pattern': 'street-arrow1',
                // Line width scales based on zoom level.
                'line-width': [
                    'interpolate', ['linear'], ['zoom'],
                    12, 2,
                    15, 7
                ],
                'line-opacity': ['case',
                    ['boolean', ['feature-state', 'hover'], false], 0.0,
                    0.75
                ]
            }
        });
        map.addLayer({
            'id': 'chosen-hover-flip',
            'type': 'line',
            'source': 'chosen-hover-flip',
            'paint': {
                'line-pattern': 'street-arrow1-reversed',
                // Line width scales based on zoom level.
                'line-width': [
                    'interpolate', ['linear'], ['zoom'],
                    12, 2,
                    15, 7
                ],
                'line-opacity': 0.75
            }
        });
        map.addLayer({
            'id': 'chosen-hover-remove',
            'type': 'line',
            'source': 'chosen-hover-remove',
            'paint': {
                'line-pattern': 'street-arrow2',
                // Line width scales based on zoom level.
                'line-width': [
                    'interpolate', ['linear'], ['zoom'],
                    12, 2,
                    15, 7
                ],
                'line-opacity': 0.75
            }
        });
        map.addLayer({
            id: 'streets',
            type: 'line',
            source: 'streets',
            paint: {
                'line-color': ['case',
                    ['boolean', ['feature-state', 'hover'], false], '#236ee0',
                    '#ddefff'
                ],
                // Line width scales based on zoom level.
                'line-width': [
                    'interpolate', ['linear'], ['zoom'],
                    12, 2,
                    15, 7
                ],
                'line-opacity': ['case',
                    ['==', ['string', ['feature-state', 'chosen'], 'not chosen'], 'not chosen'], 0.75,
                    0.0
                ]
            }
        });

        let streetId = null;
        let clickedStreetId = null;
        const popup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false
        }).setHTML(i18next.t('one-neighborhood-warning'));

        // Mark when a street is being hovered over.
        map.on('mousemove', (event) => {
            const streetQuery = map.queryRenderedFeatures(event.point, { layers: ['streets', 'streets-chosen'] });
            const street = streetQuery.filter(s => s.layer.id === 'streets')[0];
            // Don't show hover effects if the street was just clicked on.
            if (!street || street.properties.street_edge_id === clickedStreetId) return;
            const chosenStreet = streetQuery.filter(s => s.layer.id === 'streets-chosen')[0];

            // If we moved directly from hovering over one street to another, set the previous as hover: false.
            if (streetId) map.setFeatureState({ source: 'streets', id: streetId }, { hover: false });
            if (streetId) map.setFeatureState({ source: 'streets-chosen', id: streetId }, { hover: false });
            streetId = street.properties.street_edge_id;

            map.setFeatureState({ source: 'streets', id: streetId }, { hover: true });
            if (chosenStreet && clickedStreetId !== chosenStreet.properties.street_edge_id) {
                map.setFeatureState({ source: 'streets-chosen', id: streetId }, { hover: true });
            }
            map.getCanvas().style.cursor = 'pointer';

            // Show a tooltip informing user that they can't have multiple regions in the same route.
            if (currRegionId && currRegionId !== street.properties.region_id) {
                popup.setLngLat(street.geometry.coordinates[0])
                    .addTo(map);
            }

            if (chosenStreet && street.state.chosen === 'chosen') {
                map.getSource('chosen-hover-flip').setData({ type: 'FeatureCollection', features: [chosenStreet] });
                map.getSource('chosen-hover-remove').setData({ type: 'FeatureCollection', features: [] });
            } else if (chosenStreet && street.state.chosen === 'chosen reversed') {
                map.getSource('chosen-hover-flip').setData({ type: 'FeatureCollection', features: [] });
                map.getSource('chosen-hover-remove').setData({ type: 'FeatureCollection', features: [chosenStreet] });
            } else {
                map.getSource('chosen-hover-flip').setData({ type: 'FeatureCollection', features: [] });
                map.getSource('chosen-hover-remove').setData({ type: 'FeatureCollection', features: [] });
            }
        });

        // When not hovering over any streets, set prev street to hover: false and reset cursor.
        map.on('mouseleave', 'streets', () => {
            if (streetId) {
                map.setFeatureState({ source: 'streets', id: streetId }, { hover: false });
                map.setFeatureState({ source: 'streets-chosen', id: streetId }, { hover: false });
                map.getSource('chosen-hover-flip').setData({ type: 'FeatureCollection', features: [] });
                map.getSource('chosen-hover-remove').setData({ type: 'FeatureCollection', features: [] });
            }
            streetId = null;
            clickedStreetId = null; // This helps avoid showing hover effects directly after clicking a street.
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
            clickedStreetId = streetId;
            let prevState = street[0].state;

            if (prevState.chosen === 'chosen') {
                map.setFeatureState({ source: 'streets', id: streetId }, { chosen: 'chosen reversed' });
                // If the street was in the route, reverse it on this click.
                chosenStreets.features.find(s => s.properties.street_edge_id === streetId).geometry.coordinates.reverse();
                map.getSource('streets-chosen').setData(chosenStreets);
            } else if (prevState.chosen === 'chosen reversed') {
                map.setFeatureState({ source: 'streets', id: streetId }, { chosen: 'not chosen' });

                // If the street was in the route, remove it from the route.
                chosenStreets.features = chosenStreets.features.filter(s => s.properties.street_edge_id !== streetId);
                map.getSource('streets-chosen').setData(chosenStreets);

                // If there are no longer any streets in the route, any street can now be selected. Update styles.
                if (chosenStreets.features.length === 0) {
                    map.setFeatureState({ source: 'neighborhoods', id: currRegionId }, { current: false });

                    currRegionId = null;
                    introUI.style.visibility = 'visible';
                    streetDistOveraly.style.visibility = 'hidden';
                }
            } else {
                map.setFeatureState({ source: 'streets', id: streetId }, { chosen: 'chosen' });
                // Check if we should reverse the street direction to minimize number of contiguous sections.
                // TODO record street reversal separate from the reversing on clicks once we know what UI looks like.
                if (shouldReverseStreet(street[0])) {
                    console.log('reverse!');
                    street[0].geometry.coordinates.reverse();
                }

                // Add the new street to the route.
                chosenStreets.features.push(street[0]);
                map.getSource('streets-chosen').setData(chosenStreets);

                // If this was first street added, make additional UI changes.
                if (chosenStreets.features.length === 1) {
                    // Remove the intro instructions and show the route length UI on the right.
                    introUI.style.visibility = 'hidden';
                    streetDistOveraly.style.visibility = 'visible';

                    // Change style to show you can't choose streets in other regions.
                    currRegionId = street[0].properties.region_id;
                    map.setFeatureState({ source: 'neighborhoods', id: currRegionId }, { current: true });
                }
            }
            updateMarkers();
            setRouteDistanceText();
        });
    }
    function renderStreets(streetDataIn) {
        streetData = streetDataIn;
        // If the map already loaded, it's safe to render streets now. O/w they will load after the map does.
        self.status.streetsLoaded = true;
        if (self.status.mapLoaded) {
            renderStreetsHelper(streetData);
        }
    }

    /**
     * Updates the route distance text shown in the upper-right corner of the map.
     */
    function setRouteDistanceText() {
        let routeDist = chosenStreets.features.reduce((sum, street) => sum + turf.length(street, { units: units }), 0);
        streetDistanceEl.innerText = i18next.t('route-length', { dist: routeDist.toFixed(2) });
    }

    /**
     * Delete old markers and draw new ones.
     */
    function updateMarkers() {
        currentMarkers.forEach(m => m.remove());
        currentMarkers = [];
        drawContiguousEndpointMarkers();
    }

    /**
     * Draws the endpoints for the contiguous sections of the route on the map.
     */
    function drawContiguousEndpointMarkers() {
        let contigSections = computeContiguousRoutes();
        if (contigSections.length === 0) return;

        // Add start point.
        const startPointEl = document.createElement('div');
        startPointEl.className = 'marker marker-start';
        let startPoint = contigSections[0][0].geometry.coordinates[0];
        let rotation = turf.bearing(startPoint, contigSections[0][0].geometry.coordinates[1]);
        let startMarker = new mapboxgl.Marker(startPointEl).setLngLat(startPoint).setRotation(rotation).addTo(map);
        currentMarkers.push(startMarker);

        // Add colors for the midpoints.
        for (let i = 0; i < contigSections.length - 1; i++) {
            let midpointEl1 = document.createElement('div');
            let midpointEl2 = document.createElement('div');
            midpointEl1.className = midpointEl2.className = 'marker marker-number';
            midpointEl1.innerHTML = midpointEl2.innerHTML = (i + 1).toString();
            midpointEl1.style.background = midpointEl2.style.background = endpointColors[i % endpointColors.length];
            let midPoint1 = contigSections[i].slice(-1)[0].geometry.coordinates.slice(-1)[0];
            let midPoint2 = contigSections[i + 1][0].geometry.coordinates[0];
            let p1Marker = new mapboxgl.Marker(midpointEl1).setLngLat(midPoint1).addTo(map);
            let p2Marker = new mapboxgl.Marker(midpointEl2).setLngLat(midPoint2).addTo(map);
            currentMarkers.push(p1Marker);
            currentMarkers.push(p2Marker);
        }

        // Add endpoint.
        const endPointEl = document.createElement('div');
        endPointEl.className = 'marker marker-end';
        let endPoint = contigSections.slice(-1)[0].slice(-1)[0].geometry.coordinates.slice(-1)[0];
        let endMarker = new mapboxgl.Marker(endPointEl).setLngLat(endPoint).addTo(map);
        currentMarkers.push(endMarker);
    }

    // Find the contiguous sections of the route as a list of lists of features. We do this by looping through the
    // streets in the order that they were added to the route, and checking the remaining streets in the route (also in
    // the order they were chosen) to see if any of their start points are connected to the end point of the current
    // street. When there are no connected streets, that contiguous section is done and we start a new one.
    // TODO do something to preserve ordering, I'm not sure if mapbox guarantees that ordering is preserved.
    //      Could either add a property with the ordering, or keep track in a separate list.
    function computeContiguousRoutes() {
        let contiguousSections = [];
        let currContiguousSection = [];
        let streetsInRoute = Array.from(chosenStreets.features); // shallow copy
        while (streetsInRoute.length > 0) {
            if (currContiguousSection.length === 0) {
                currContiguousSection.push(streetsInRoute.shift());
            } else {
                // Search for least recently chosen street with endpoint within 10 m of the current street.
                let currStreet = currContiguousSection.slice(-1)[0];
                let p1 = turf.point(currStreet.geometry.coordinates.slice(-1)[0]);
                let connectedStreetFound = false;
                for (let i = 0; i < streetsInRoute.length; i++) {
                    let p2 = turf.point(streetsInRoute[i].geometry.coordinates[0]);
                    if (turf.distance(p1, p2, { units: 'kilometers' }) < 0.01) {
                        currContiguousSection.push(streetsInRoute.splice(i, 1)[0]);
                        connectedStreetFound = true;
                        break;
                    }
                }
                // If no connected street was found, this contiguous section is done.
                if (!connectedStreetFound) {
                    contiguousSections.push(currContiguousSection);
                    currContiguousSection = [];
                }
            }
        }
        if (currContiguousSection.length > 0) {
            contiguousSections.push(currContiguousSection);
        }

        return contiguousSections;
    }

    /**
     * Checks if the given street should be reversed to minimize the number of contiguous sections in the route.
     * @param street
     * @returns {boolean}
     */
    function shouldReverseStreet(street) {
        let shouldReverse = false;
        let contiguousSegments = computeContiguousRoutes();

        // Look through last street in each segment (in reverse order) to see if any of them are connected to the
        // current street. If so, check if the new street would add on to the contiguous route normally or reversed.
        let currStreetStart = turf.point(street.geometry.coordinates[0]);
        let currStreetEnd = turf.point(street.geometry.coordinates.slice(-1)[0]);
        for (let i = contiguousSegments.length - 1; i >= 0; i--) {
            let lastStreetEnd = turf.point(contiguousSegments[i].slice(-1)[0].geometry.coordinates.slice(-1)[0]);
            if (turf.distance(lastStreetEnd, currStreetStart, { units: 'kilometers' }) < 0.01) {
                break; // Street would already be part of contiguous route, no need to reverse.
            } else if (turf.distance(lastStreetEnd, currStreetEnd, { units: 'kilometers' }) < 0.01) {
                shouldReverse = true;
                break; // Street would be part of contiguous route if reversed.
            }
        }
        return shouldReverse;
    }

    /**
     * Clear the current route and reset the map.
     */
    function clearRoute() {
        // Remove all the streets from the route.
        chosenStreets.features.forEach(s => {
            map.setFeatureState({ source: 'streets', id: s.properties.street_edge_id }, { chosen: 'not chosen' });
        });
        chosenStreets.features = [];
        map.getSource('streets-chosen').setData(chosenStreets);

        // Reset the map.
        map.setFeatureState({ source: 'neighborhoods', id: currRegionId }, { current: false });
        currRegionId = null;
        setRouteDistanceText();

        // Reset the UI.
        routeSavedModal.style.visibility = 'hidden';
        streetDistOveraly.style.visibility = 'hidden';
        introUI.style.visibility = 'visible';
        updateMarkers();
    }

    /**
     * Saves the route to the database, shows the Route Saved modal, and updates the links/buttons in that modal.
     */
    let saveRoute = function() {
        // Get list of street IDs in the correct order.
        let streetIds =  computeContiguousRoutes().flat().map(s => s.properties.street_edge_id);
        console.log(streetIds);
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
                routeSavedModal.style.visibility = 'visible';
                let exploreRelURL = `/explore?routeId=${data.route_id}`;
                let exploreURL = `${window.location.origin}${exploreRelURL}`

                // Update link and tooltip for Explore route button.
                exploreButton.off('click');
                exploreButton.click(function () {
                    logActivity(`RouteBuilder_Click=Explore_RouteId=${data.route_id}`);
                    window.location.replace(exploreRelURL);
                });

                // Add the 'copied to clipboard' tooltip on click.
                linkTextEl.textContent = exploreURL;
                copyLinkButton.off('click');
                copyLinkButton.click(function (e) {
                    navigator.clipboard.writeText(exploreURL);
                    setTemporaryTooltip(e.currentTarget, i18next.t('copied-to-clipboard'));
                    logActivity(`RouteBuilder_Click=Copy_RouteId=${data.route_id}`);
                });

                logActivity(`RouteBuilder_Click=SaveSuccess_RouteId=${data.route_id}`);
            })
            .catch((error) => {
                console.error('Error:', error);
                logActivity(`RouteBuilder_Click=SaveError`);
            });
    };
    saveButton.addEventListener('click', saveRoute);

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
