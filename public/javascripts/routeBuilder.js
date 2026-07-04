/**
 * RouteBuilder — the /routeBuilder page. Lets a user click streets on a Mapbox map to assemble a custom route,
 * then save/share it.
 */
class RouteBuilder {
  #status = {
    mapLoaded: false,
    neighborhoodsLoaded: false,
    streetsLoaded: false,
  };

  // Constants used throughout the code.
  #endpointColors = ['#80c32a', '#ffc300', '#ff9700', '#ff6a00'];
  #units;

  #mapboxApiKey;
  #mapParams;
  #map;

  // Variables used throughout the code.
  #neighborhoodData = null;
  #currRegionId = null;
  #streetData = null;
  #streetsInRoute = null;
  #currentMarkers = [];
  #searchBox;

  // DOM elements.
  #introUI;
  #streetDistOverlay;
  #deleteRouteModal;
  #routeSavedModal;
  #streetDistanceEl;
  #saveButton;
  #exploreButton;
  #linkTextEl;
  #copyLinkButton;
  #viewInLabelmapButton;

  /**
     * @param {Function} $ - jQuery.
     * @param {string} mapboxApiKey
     * @param {Object} mapParams - City center/boundaries/zoom for initializing the map.
     */
  constructor($, mapboxApiKey, mapParams) {
    this.#mapboxApiKey = mapboxApiKey;
    this.#mapParams = mapParams;
    this.#units = i18next.t('common:unit-distance');

    // Get the DOM elements.
    this.#introUI = document.getElementById('routebuilder-intro');
    this.#streetDistOverlay = document.getElementById('creating-route-overlay');
    this.#deleteRouteModal = document.getElementById('delete-route-modal-backdrop');
    this.#routeSavedModal = document.getElementById('route-saved-modal-backdrop');
    this.#streetDistanceEl = document.getElementById('route-length-val');
    this.#saveButton = document.getElementById('save-button');
    this.#exploreButton = $('#explore-button');
    this.#linkTextEl = document.getElementById('share-route-link');
    this.#copyLinkButton = $('#copy-link-button');
    this.#viewInLabelmapButton = $('#view-in-labelmap-button');

    // Add the click event for the clear route buttons.
    document.getElementById('cancel-button').addEventListener('click', () => this.#clickCancelRoute());
    document.getElementById('delete-route-button').addEventListener('click', (e) => this.#clearRoute(e));
    document.getElementById('cancel-delete-route-button').addEventListener('click', () => this.#clickResumeRoute());
    document.getElementById('build-new-route-button').addEventListener('click', (e) => this.#clearRoute(e));

    // Initialize the map.
    mapboxgl.accessToken = mapboxApiKey;
    this.#map = new mapboxgl.Map({
      container: 'routebuilder-map',
      style: 'mapbox://styles/projectsidewalk/cloov4big002801rc0qw75w5g',
      center: [mapParams.city_center.lng, mapParams.city_center.lat],
      zoom: mapParams.default_zoom,
      minZoom: 8.25,
      maxZoom: 19,
      maxBounds: [
        [mapParams.southwest_boundary.lng, mapParams.southwest_boundary.lat],
        [mapParams.northeast_boundary.lng, mapParams.northeast_boundary.lat],
      ],
      doubleClickZoom: false,
    });
    this.#map.addControl(new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') }));
    this.#map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-left');
    this.#map.on('load', () => {
      // If the streets and/or neighborhoods loaded before the map, render them now that the map has loaded.
      this.#status.mapLoaded = true;
      if (this.#status.neighborhoodsLoaded) {
        this.#renderNeighborhoodsHelper();
      }
      if (this.#status.streetsLoaded) {
        this.#renderStreetsHelper();
      }
    });

    // Once all the layers have loaded, put them in the correct order.
    this.#map.on('sourcedataloading', this.#moveLayers);

    this.#saveButton.addEventListener('click', () => this.#saveRoute());
  }

  // Arrow field so the reference stays stable for the map on/off pair.
  #moveLayers = () => {
    const map = this.#map;
    if (map.getLayer('streets') && map.getLayer('streets-chosen') && map.getLayer('chosen-hover-flip')
      && map.getLayer('chosen-hover-remove') && map.getLayer('neighborhoods')) {
      map.moveLayer('streets', 'streets-chosen');
      map.moveLayer('chosen-hover-flip', 'streets-chosen');
      map.moveLayer('chosen-hover-remove', 'streets-chosen');
      map.moveLayer('streets', 'neighborhoods');
      map.off('sourcedataloading', this.#moveLayers); // Remove the listener so we only do this once.
    }
  };

  /*
     * Function definitions.
     */

  // Setting up SearchBox.
  #setUpSearchBox() {
    const map = this.#map;
    const mapParams = this.#mapParams;
    const wholeAreaBbox = [mapParams.southwest_boundary.lng, mapParams.southwest_boundary.lat, mapParams.northeast_boundary.lng, mapParams.northeast_boundary.lat];
    this.#searchBox = new MapboxSearchBox();
    this.#searchBox.accessToken = this.#mapboxApiKey;
    this.#searchBox.options = {
      bbox: [[wholeAreaBbox[0], wholeAreaBbox[1]], [wholeAreaBbox[2], wholeAreaBbox[3]]],
      language: i18next.t('common:mapbox-language-code'),
    };

    this.#searchBox.addEventListener('retrieve', () => {
      const getNeighborhoodInView = () => {
        if (map.queryRenderedFeatures({ layers: ['neighborhoods'] }).length === 0) {
          map.flyTo({ zoom: map.getZoom() - 1 });
        } else {
          map.off('moveend', getNeighborhoodInView);
        }
      };
      map.on('moveend', getNeighborhoodInView);
    });

    map.addControl(this.#searchBox);
  }

  // Temporarily shows a tooltip. Used when the user clicks the 'Copy Link' button.
  #setTemporaryTooltip(btn, message) {
    $(btn).attr('data-original-title', message).tooltip('enable').tooltip('show');
    this.#hideTooltip(btn);
  }

  #hideTooltip(btn) {
    setTimeout(() => {
      $(btn).tooltip('hide').tooltip('disable');
    }, 1000);
  }

  /**
     * Renders the neighborhoods and an overlay outside the neighborhood boundaries on the map. Also configures
     * SearchBox to filter out outside neighborhoods.
     */
  #renderNeighborhoodsHelper() {
    const map = this.#map;
    map.addSource('neighborhoods', {
      type: 'geojson',
      data: this.#neighborhoodData,
      promoteId: 'region_id',
    });
    map.addLayer({
      id: 'neighborhoods',
      type: 'fill',
      source: 'neighborhoods',
      paint: {
        'fill-color': '#000000',
        'fill-opacity': 0.0,
      },
    });

    // Create layer for an overlay outside of neighborhood boundaries using turf.mask.
    const outsideNeighborhoods = turf.mask(this.#neighborhoodData);
    map.addSource('outside-neighborhoods', {
      type: 'geojson',
      data: outsideNeighborhoods,
    });
    map.addLayer({
      id: 'outside-neighborhoods',
      type: 'fill',
      source: 'outside-neighborhoods',
      paint: {
        'fill-opacity': 0.3,
        'fill-color': '#000000',
      },
    });
    this.#setUpSearchBox();
  }

  /**
     * @param {Object} neighborhoodDataIn - GeoJSON of the city's neighborhoods.
     */
  renderNeighborhoods(neighborhoodDataIn) {
    this.#neighborhoodData = neighborhoodDataIn;
    // If the map already loaded, it's safe to render neighborhoods now. O/w they will load after the map does.
    this.#status.neighborhoodsLoaded = true;
    if (this.#status.mapLoaded) {
      this.#renderNeighborhoodsHelper();
    }
  }

  /**
     * Renders the streets on the map. Adds the hover/click events for the streets as well.
     *
     * We have two separate data sources for the streets. The 'streets' source contains all the streets in the city. The
     * 'streets-chosen' source contains the streets that have been added to the route. This just makes it a bit easier
     * to keep track of the streets in the route and render streets differently when we reverse their direction.
     *
     * Because Mapbox doesn't allow us to change the line-pattern (or switch between line-pattern and line-color) based
     * on feature state, we have four separate layers for the streets:
     * 1. streets: streets that aren't in the route (light blue colored).
     * 2. streets-chosen: streets that are in the route (white/blue arrow pattern).
     * 3. chosen-hover-flip: streets in the route on hover (translucent dark/light blue arrow pattern).
     * 4. chosen-hover-remove: streets in the route after being reversed, on hover (red/purple arrow pattern).
     */
  #renderStreetsHelper() {
    const map = this.#map;
    map.addSource('streets', {
      type: 'geojson',
      data: this.#streetData,
      promoteId: 'street_edge_id',
    });
    this.#streetsInRoute = { type: 'FeatureCollection', features: [] };
    map.addSource('streets-chosen', {
      type: 'geojson',
      data: this.#streetsInRoute,
      promoteId: 'street_edge_id',
    });

    map.addLayer({
      id: 'streets',
      type: 'line',
      source: 'streets',
      paint: {
        'line-color': ['case',
          ['boolean', ['feature-state', 'hover'], false], '#236ee0',
          '#ddefff',
        ],
        // Line width scales based on zoom level.
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          12, 2,
          15, 7,
        ],
        // Show only when street hasn't been chosen.
        'line-opacity': ['case',
          ['==', ['string', ['feature-state', 'chosen'], 'not chosen'], 'not chosen'], 0.75,
          0.0,
        ],
      },
    });
    map.addLayer({
      id: 'streets-chosen',
      type: 'line',
      source: 'streets-chosen',
      paint: {
        'line-pattern': 'street-arrow',
        // Line width scales based on zoom level.
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          12, 2,
          15, 7,
        ],
        // Hide when street is being hovered over.
        'line-opacity': ['case',
          ['boolean', ['feature-state', 'hover'], false], 0.0, 0.75,
        ],
      },
    });
    map.addLayer({
      id: 'chosen-hover-flip',
      type: 'line',
      source: 'streets-chosen',
      paint: {
        'line-pattern': 'street-arrow-hover-reverse',
        // Line width scales based on zoom level.
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          12, 2,
          15, 7,
        ],
        // Show only when hovered and street has been chosen.
        'line-opacity': ['case',
          ['all',
            ['boolean', ['feature-state', 'hover'], false],
            ['==', ['string', ['feature-state', 'chosen'], 'not chosen'], 'chosen'],
          ], 0.75, 0.0,
        ],
      },
    });
    map.addLayer({
      id: 'chosen-hover-remove',
      type: 'line',
      source: 'streets-chosen',
      paint: {
        'line-pattern': 'street-arrow-hover-delete',
        // Line width scales based on zoom level.
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          12, 2,
          15, 7,
        ],
        // Show only when hovered and street has been chosen and reversed.
        'line-opacity': ['case',
          ['all',
            ['boolean', ['feature-state', 'hover'], false],
            ['==', ['string', ['feature-state', 'chosen'], 'not chosen'], 'chosen reversed'],
          ], 0.75, 0.0,
        ],
      },
    });

    // Create tooltips for when the user hovers over a street.
    const neighborhoodPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false })
      .setHTML(i18next.t('one-neighborhood-warning'));
    const hoverChoosePopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 10, maxWidth: '340px' })
      .setHTML(i18next.t('hover-add-street'));
    const hoverReversePopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false })
      .setHTML(`<img src="assets/images/icons/routebuilder/reverse-hover.png" alt="Reverse" width="24" height="24">`);
    hoverReversePopup._content.className = 'tooltip-no-outline'; // Remove default styling.
    const hoverDeletePopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false })
      .setHTML(`<img src="assets/images/icons/routebuilder/delete-hover.png" alt="Reverse" width="24" height="24">`);
    hoverDeletePopup._content.className = 'tooltip-no-outline'; // Remove default styling.

    // Mark when a street is being hovered over.
    let hoveredStreet = null;
    let clickedStreet = null;
    map.on('mousemove', 'streets', (event) => {
      const street = event.features[0];
      // Don't show hover effects if the street was just clicked on.
      if (street.properties.street_edge_id === clickedStreet) return;
      const chosenState = street.state ? street.state.chosen : 'not chosen';

      // If we moved directly from hovering over one street to another, set the previous as hover: false.
      if (hoveredStreet) {
        map.setFeatureState({ source: 'streets', id: hoveredStreet }, { hover: false });
        map.setFeatureState({ source: 'streets-chosen', id: hoveredStreet }, { hover: false });
      }
      hoveredStreet = street.properties.street_edge_id;

      // Set the hover state.
      map.setFeatureState({ source: 'streets', id: hoveredStreet }, { hover: true });
      if (chosenState !== 'not chosen' && clickedStreet !== street.properties.street_edge_id) {
        map.setFeatureState({ source: 'streets-chosen', id: hoveredStreet }, { hover: true });
      }

      // Update the reverse/delete tooltips above the cursor.
      if (chosenState === 'chosen') {
        hoverReversePopup.setLngLat(event.lngLat);
        if (!hoverReversePopup.isOpen()) {
          hoverReversePopup.addTo(map);
          hoverReversePopup._content.parentNode.querySelector('[class*="tip"]').remove(); // Remove the arrow.
        }
      } else if (chosenState === 'chosen reversed') {
        hoverDeletePopup.setLngLat(event.lngLat);
        if (!hoverDeletePopup.isOpen()) {
          hoverDeletePopup.addTo(map);
          hoverDeletePopup._content.parentNode.querySelector('[class*="tip"]').remove(); // Remove the arrow.
        }
      } else if (this.#streetsInRoute.features.length === 0) { // Not yet chosen and route is empty.
        hoverChoosePopup.setLngLat(event.lngLat);
        if (!hoverChoosePopup.isOpen()) {
          hoverChoosePopup.addTo(map);
          hoverChoosePopup._content.parentNode.querySelector('[class*="tip"]').remove(); // Remove the arrow.
        }
      }
      map.getCanvas().style.cursor = 'pointer';

      // Show a tooltip informing user that they can't have multiple regions in the same route.
      if (this.#currRegionId && this.#currRegionId !== street.properties.region_id) {
        neighborhoodPopup.setLngLat(event.lngLat).addTo(map);
      }
    });

    // When not hovering over any streets, set prev street to hover: false and reset cursor.
    map.on('mouseleave', 'streets', () => {
      if (hoveredStreet) {
        map.setFeatureState({ source: 'streets', id: hoveredStreet }, { hover: false });
        map.setFeatureState({ source: 'streets-chosen', id: hoveredStreet }, { hover: false });
      }
      hoveredStreet = null;
      clickedStreet = null; // This helps avoid showing hover effects directly after clicking a street.
      map.getCanvas().style.cursor = '';
      neighborhoodPopup.remove();
      hoverChoosePopup.remove();
      hoverReversePopup.remove();
      hoverDeletePopup.remove();
    });

    // When a street is clicked, toggle it as being chosen for the route or not.
    map.on('click', 'streets', (event) => {
      const streetFeature = event.features[0];

      // Retrieve complete street geometry from source data rather than using the
      // viewport-limited feature from the event object which may be incomplete
      const street = this.#streetData.features.find((s) =>
        s.properties.street_edge_id === streetFeature.properties.street_edge_id,
      );

      if (this.#currRegionId && this.#currRegionId !== street.properties.region_id) {
        return;
      }

      hoveredStreet = street.properties.street_edge_id;
      clickedStreet = hoveredStreet;
      const prevState = streetFeature.state;

      if (prevState.chosen === 'chosen') { // If the street was in the route, reverse it.
        map.setFeatureState({ source: 'streets', id: clickedStreet }, { chosen: 'chosen reversed' });
        map.setFeatureState({ source: 'streets-chosen', id: clickedStreet }, { chosen: 'chosen reversed' });

        const streetToReverse = this.#streetsInRoute.features.find((s) => s.properties.street_edge_id === clickedStreet);
        streetToReverse.geometry.coordinates.reverse();
        streetToReverse.properties.reverse = !streetToReverse.properties.reverse;
        map.getSource('streets-chosen').setData(this.#streetsInRoute);

        hoverReversePopup.remove(); // Hide the reverse tooltip.
      } else if (prevState.chosen === 'chosen reversed') { // If street was in the route & reversed, remove it.
        map.setFeatureState({ source: 'streets', id: clickedStreet }, { chosen: 'not chosen' });

        this.#streetsInRoute.features = this.#streetsInRoute.features.filter((s) => s.properties.street_edge_id !== clickedStreet);
        map.getSource('streets-chosen').setData(this.#streetsInRoute);

        hoverDeletePopup.remove(); // Hide the delete tooltip.

        // Once the route is empty again, any street can be selected. Update styles.
        if (this.#streetsInRoute.features.length === 0) {
          this.#resetUI();
        }
      } else { // If the street was not in the route, add it to the route.
        map.setFeatureState({ source: 'streets', id: hoveredStreet }, { chosen: 'chosen' });

        // Check if we should reverse the street direction to minimize number of contiguous sections.
        if (this.#shouldReverseStreet(street)) {
          street.geometry.coordinates.reverse();
          street.properties.reverse = !street.properties.reverse;
        }

        // Add the new street to the route and set it's state.
        this.#streetsInRoute.features.push(street);
        map.getSource('streets-chosen').setData(this.#streetsInRoute);
        map.setFeatureState({ source: 'streets-chosen', id: hoveredStreet }, { chosen: 'chosen' });

        hoverChoosePopup.remove(); // Hide the start building a route tooltip.

        // If this was first street added, make additional UI changes.
        if (this.#streetsInRoute.features.length === 1) {
          // Remove the intro instructions and show the route length UI on the right.
          this.#introUI.style.visibility = 'hidden';
          this.#streetDistOverlay.style.visibility = 'visible';
          map.removeControl(this.#searchBox);

          // Change style to show you can't choose streets in other regions.
          this.#currRegionId = street.properties.region_id;
          map.setFeatureState({ source: 'neighborhoods', id: this.#currRegionId }, { current: true });
          map.setPaintProperty('neighborhoods', 'fill-opacity', ['case', ['boolean', ['feature-state', 'current'], false], 0.0, 0.3]);
          map.setPaintProperty('outside-neighborhoods', 'fill-opacity', 0.5);
        }
      }

      // Set hover to false so that we don't show hover effect immediately after being clicked.
      map.setFeatureState({ source: 'streets', id: hoveredStreet }, { hover: false });
      map.setFeatureState({ source: 'streets-chosen', id: hoveredStreet }, { hover: false });
      this.#updateMarkers();
      this.#setRouteDistanceText();
    });
  }

  /**
     * @param {Object} streetDataIn - GeoJSON of the city's streets.
     */
  renderStreets(streetDataIn) {
    this.#streetData = streetDataIn;
    // If the map already loaded, it's safe to render streets now. O/w they will load after the map does.
    this.#status.streetsLoaded = true;
    if (this.#status.mapLoaded) {
      this.#renderStreetsHelper();
    }
  }

  /**
     * Updates the route distance text shown in the upper-right corner of the map.
     */
  #setRouteDistanceText() {
    const routeDist = this.#streetsInRoute.features.reduce((sum, street) => sum + turf.length(street, { units: this.#units }), 0);
    this.#streetDistanceEl.innerText = i18next.t('route-length', { dist: routeDist.toFixed(2) });
  }

  /**
     * Delete old markers and draw new ones.
     */
  #updateMarkers() {
    this.#currentMarkers.forEach((m) => m.remove());
    this.#currentMarkers = [];
    this.#drawContiguousEndpointMarkers();
  }

  /**
     * Draws the endpoints for the contiguous sections of the route on the map.
     */
  #drawContiguousEndpointMarkers() {
    const map = this.#map;
    const contigSections = this.#computeContiguousRoutes();
    if (contigSections.length === 0) return;

    // Add start point.
    const startPointEl = document.createElement('div');
    startPointEl.className = 'marker-start';
    const startPoint = contigSections[0][0].geometry.coordinates[0];
    const rotation = turf.bearing(startPoint, contigSections[0][0].geometry.coordinates[1]);
    const startMarker = new mapboxgl.Marker(startPointEl).setLngLat(startPoint).setRotation(rotation).addTo(map);
    this.#currentMarkers.push(startMarker);

    // Add colors for the midpoints.
    for (let i = 0; i < contigSections.length - 1; i++) {
      const midpointEl1 = document.createElement('div');
      const midpointEl2 = document.createElement('div');
      midpointEl1.className = midpointEl2.className = 'marker-number';
      midpointEl1.innerHTML = midpointEl2.innerHTML = (i + 1).toString();
      midpointEl1.style.background = midpointEl2.style.background = this.#endpointColors[i % this.#endpointColors.length];
      const midPoint1 = contigSections[i].slice(-1)[0].geometry.coordinates.slice(-1)[0];
      const midPoint2 = contigSections[i + 1][0].geometry.coordinates[0];
      const p1Marker = new mapboxgl.Marker(midpointEl1).setLngLat(midPoint1).addTo(map);
      const p2Marker = new mapboxgl.Marker(midpointEl2).setLngLat(midPoint2).addTo(map);
      this.#currentMarkers.push(p1Marker);
      this.#currentMarkers.push(p2Marker);
    }

    // Add endpoint.
    const endPointEl = document.createElement('div');
    endPointEl.className = 'marker-end';
    const endPoint = contigSections.slice(-1)[0].slice(-1)[0].geometry.coordinates.slice(-1)[0];
    const endMarker = new mapboxgl.Marker(endPointEl).setLngLat(endPoint).addTo(map);
    this.#currentMarkers.push(endMarker);
  }

  // TODO do something to preserve ordering, I'm not sure if mapbox guarantees that ordering is preserved.
  //      Could either add a property with the ordering, or keep track in a separate list.

  /**
     * Computes a set of contiguous sections of the route.
     *
     * We do this by looping through the streets in the order that they were added to the route, checking the remaining
     * streets in the route (also in the order they were chosen) to see if any of their start points are connected to
     * the end point of the current street. When there are no connected streets, that contiguous section is done and
     * we start a new one.
     * @returns {Array<Array<Object>>}
     */
  #computeContiguousRoutes() {
    const contiguousSections = [];
    let currContiguousSection = [];
    const streetsInRouteCopy = Array.from(this.#streetsInRoute.features); // shallow copy
    while (streetsInRouteCopy.length > 0) {
      if (currContiguousSection.length === 0) {
        currContiguousSection.push(streetsInRouteCopy.shift());
      } else {
        // Search for least recently chosen street with endpoint within 10 m of the current street.
        const currStreet = currContiguousSection.slice(-1)[0];
        const p1 = turf.point(currStreet.geometry.coordinates.slice(-1)[0]);
        let connectedStreetFound = false;
        for (let i = 0; i < streetsInRouteCopy.length; i++) {
          const p2 = turf.point(streetsInRouteCopy[i].geometry.coordinates[0]);
          if (turf.distance(p1, p2, { units: 'kilometers' }) < 0.01) {
            currContiguousSection.push(streetsInRouteCopy.splice(i, 1)[0]);
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
     * @param {Object} street
     * @returns {boolean}
     */
  #shouldReverseStreet(street) {
    let shouldReverse = false;
    const contiguousSegments = this.#computeContiguousRoutes();

    // Look through last street in each segment (in reverse order) to see if any of them are connected to the
    // current street. If so, check if the new street would add on to the contiguous route normally or reversed.
    const currStreetStart = turf.point(street.geometry.coordinates[0]);
    const currStreetEnd = turf.point(street.geometry.coordinates.slice(-1)[0]);
    for (let i = contiguousSegments.length - 1; i >= 0; i--) {
      const lastStreetEnd = turf.point(contiguousSegments[i].slice(-1)[0].geometry.coordinates.slice(-1)[0]);
      if (turf.distance(lastStreetEnd, currStreetStart, { units: 'kilometers' }) < 0.01) {
        break; // Street would already be part of contiguous route, no need to reverse.
      } else if (turf.distance(lastStreetEnd, currStreetEnd, { units: 'kilometers' }) < 0.01) {
        shouldReverse = true;
        break; // Street would be part of contiguous route if reversed.
      }
    }
    return shouldReverse;
  }

  #clickCancelRoute() {
    window.logWebpageActivity('RouteBuilder_Click=CancelRoute');
    this.#deleteRouteModal.style.visibility = 'visible';
  }

  #clickResumeRoute() {
    window.logWebpageActivity('RouteBuilder_Click=ResumeRoute');
    this.#deleteRouteModal.style.visibility = 'hidden';
  }

  /**
     * Clear the current route and reset the map.
     * @param {Event} [e]
     */
  #clearRoute(e) {
    const map = this.#map;
    // Remove all the streets from the route.
    this.#streetsInRoute.features.forEach((s) => {
      map.setFeatureState({ source: 'streets', id: s.properties.street_edge_id }, { chosen: 'not chosen' });
    });
    this.#streetsInRoute.features = [];
    map.getSource('streets-chosen').setData(this.#streetsInRoute);

    // Reset the map.
    map.setFeatureState({ source: 'neighborhoods', id: this.#currRegionId }, { current: false });
    this.#currRegionId = null;
    this.#setRouteDistanceText();
    this.#updateMarkers();

    this.#resetUI();

    // Log if clearing route from a button.
    if (e && e.target && e.target.id) {
      if (e.target.id === 'delete-route-button') {
        window.logWebpageActivity(`RouteBuilder_Click=ConfirmCancelRoute`);
      } else if (e.target.id === 'build-new-route-button') {
        window.logWebpageActivity(`RouteBuilder_Click=BuildNewRoute`);
      }
    }
  }

  #resetUI() {
    const map = this.#map;
    // Update neighborhood styling.
    map.setFeatureState({ source: 'neighborhoods', id: this.#currRegionId }, { current: false });
    map.setPaintProperty('neighborhoods', 'fill-opacity', 0.0);
    map.setPaintProperty('outside-neighborhoods', 'fill-opacity', 0.3);
    this.#currRegionId = null;

    // Show intro UI and hide all others.
    this.#introUI.style.visibility = 'visible';
    this.#streetDistOverlay.style.visibility = 'hidden';
    this.#routeSavedModal.style.visibility = 'hidden';
    this.#deleteRouteModal.style.visibility = 'hidden';
    map.addControl(this.#searchBox);
  }

  /**
     * Saves the route to the database, shows the Route Saved modal, and updates the links/buttons in that modal.
     */
  #saveRoute() {
    // Get list of street IDs in the correct order.
    const streetProps = this.#computeContiguousRoutes().flat().map((s) => ({
      street_id: s.properties.street_edge_id,
      reverse: s.properties.reverse === true,
    }));

    // Save the route and then update UI.
    fetch('/saveRoute', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ region_id: this.#currRegionId, streets: streetProps }),
    })
      .then((response) => response.json())
      .then((data) => {
        this.#routeSavedModal.style.visibility = 'visible';
        const exploreRelURL = `/explore?routeId=${data.route_id}`;
        const exploreURL = `${window.location.origin}${exploreRelURL}`;

        // Update link and tooltip for Explore route button.
        this.#exploreButton.off('click');
        this.#exploreButton.click(() => {
          window.logWebpageActivity(`RouteBuilder_Click=Explore_RouteId=${data.route_id}`);
          window.location.replace(exploreRelURL);
        });

        // Add the 'copied to clipboard' tooltip on click.
        this.#linkTextEl.textContent = exploreURL;
        this.#copyLinkButton.off('click');
        this.#copyLinkButton.click((e) => {
          navigator.clipboard.writeText(exploreURL);
          this.#setTemporaryTooltip(e.currentTarget, i18next.t('copied-to-clipboard'));
          window.logWebpageActivity(`RouteBuilder_Click=Copy_RouteId=${data.route_id}`);
        });

        // Update link for the 'View in LabelMap' button.
        this.#viewInLabelmapButton.off('click');
        this.#viewInLabelmapButton.click(() => {
          window.logWebpageActivity(`RouteBuilder_Click=LabelMap_RouteId=${data.route_id}`);
          window.open(`/labelMap?routes=${data.route_id}`, '_blank');
        });

        window.logWebpageActivity(`RouteBuilder_Click=SaveSuccess_RouteId=${data.route_id}`);
      })
      .catch((error) => {
        console.error('Error:', error);
        window.logWebpageActivity(`RouteBuilder_Click=SaveError`);
      });
  }
}
