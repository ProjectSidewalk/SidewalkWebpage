/**
 * RouteBuilder — the /routeBuilder page. Lets a user click streets on a Mapbox map to assemble a custom route,
 * then save/share it. The save flow lives in SaveModal; the anonymous "recent routes on this device" recovery
 * panel lives in GuestRoutes.
 */
class RouteBuilder {
  #status = {
    mapLoaded: false,
    neighborhoodsLoaded: false, // Neighborhood GeoJSON has arrived from the server.
    neighborhoodsRendered: false, // Neighborhood source/layers have been added to the map.
    streetsLoaded: false,
    pendingRouteRestored: false,
  };

  // Constants used throughout the code.
  #endpointColors = ['#80c32a', '#ffc300', '#ff9700', '#ff6a00'];
  #units;

  #mapboxApiKey;
  #map;
  #isSignedIn;

  // Variables used throughout the code.
  #neighborhoodData = null;
  #currRegionId = null;
  #streetData = null;
  #streetsInRoute = null;
  #currentMarkers = [];
  #routeGraph = null; // Built lazily from #streetData on the first auto-route (#4579).

  // Collaborators.
  #saveModal;
  #guestRoutes;
  #undoStack;
  #streetPopover;
  #directionsPanel;

  // DOM elements.
  #panel;
  #deleteRouteModal;
  #routeSavedModal;
  #routeSavedNameEl;
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
   * @param {boolean} isSignedIn - Whether the user is signed in (vs anonymous), from the server.
   */
  constructor($, mapboxApiKey, mapParams, isSignedIn) {
    this.#mapboxApiKey = mapboxApiKey;
    this.#isSignedIn = isSignedIn === true;
    this.#units = i18next.t('common:unit-distance');

    // Get the DOM elements.
    this.#panel = document.getElementById('routebuilder-panel');
    this.#deleteRouteModal = document.getElementById('delete-route-modal-backdrop');
    this.#routeSavedModal = document.getElementById('route-saved-modal-backdrop');
    this.#routeSavedNameEl = document.getElementById('route-saved-name');
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

    this.#saveModal = new SaveModal({
      isSignedIn: this.#isSignedIn,
      getRegionId: () => this.#currRegionId,
      getRegionName: () => this.#getRegionName(this.#currRegionId),
      getStreetsPayload: () => this.#routeStreetsPayload(),
      onSaved: (routeId, name) => this.#showRouteSavedModal(routeId, name),
      onClose: () => this.#saveButton.focus(),
    });
    this.#guestRoutes = new GuestRoutes((btn, message) => this.#setTemporaryTooltip(btn, message));
    this.#guestRoutes.render();

    this.#undoStack = new UndoStack(document.getElementById('undo-button'));
    document.getElementById('undo-button').addEventListener('click', () => {
      window.logWebpageActivity('RouteBuilder_Click=Undo');
      this.#undo();
    });
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd+Z undoes the last route edit, except while typing in a form field.
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !/^(input|textarea|select)$/i.test(e.target.tagName)) {
        e.preventDefault();
        window.logWebpageActivity('RouteBuilder_KeyboardShortcut=Undo');
        this.#undo();
      }
    });

    const legend = document.getElementById('routebuilder-legend');
    legend?.addEventListener('toggle', () => {
      window.logWebpageActivity(`RouteBuilder_Click=ToggleLegend_Open=${legend.open}`);
    });

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

    this.#streetPopover = new StreetPopover(
      this.#map,
      (streetId) => this.#reverseStreet(streetId),
      (streetId) => this.#removeStreet(streetId),
    );

    this.#directionsPanel = new DirectionsPanel({
      map: this.#map,
      mapboxApiKey: this.#mapboxApiKey,
      bbox: [
        [mapParams.southwest_boundary.lng, mapParams.southwest_boundary.lat],
        [mapParams.northeast_boundary.lng, mapParams.northeast_boundary.lat],
      ],
      onPinsChanged: (start, end) => this.#autoRoute(start, end),
    });

    this.#saveButton.addEventListener('click', () => this.#saveModal.open());
  }

  // Arrow field so the reference stays stable for the map on/off pair.
  #moveLayers = () => {
    const map = this.#map;
    if (map.getLayer('streets') && map.getLayer('streets-chosen') && map.getLayer('neighborhoods')) {
      map.moveLayer('streets', 'streets-chosen');
      map.moveLayer('streets', 'neighborhoods');
      map.off('sourcedataloading', this.#moveLayers); // Remove the listener so we only do this once.
    }
  };

  /*
   * Function definitions.
   */

  // Confirms a copy-link click with a transient toast over the button (same pattern as the dashboard).
  #setTemporaryTooltip(btn, message) {
    Toast.show({ message, reference: btn, duration: 1500 });
  }

  /**
   * Switches the left trip-planner panel between its two states (CSS shows/hides the matching sections).
   * @param {'empty'|'building'} state - 'empty' shows the intro/getting-started block; 'building' shows the
   *                                     route length + Save/Undo/Clear.
   */
  #setPanelState(state) {
    this.#panel.dataset.state = state;
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
    this.#status.neighborhoodsRendered = true;
    this.#maybeRestorePendingRoute();
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
   * 'streets-chosen' source contains the streets that have been added to the route (white/blue arrow pattern). This
   * just makes it a bit easier to keep track of the streets in the route and render streets differently when we
   * reverse their direction. Clicking a chosen street opens the labeled reverse/remove menu (StreetPopover).
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
          ['boolean', ['feature-state', 'chosen'], false], 0.0, 0.75,
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
        'line-opacity': 0.75,
      },
    });

    // Create tooltips for when the user hovers over a street.
    const neighborhoodPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false })
      .setHTML(i18next.t('one-neighborhood-warning'));
    const hoverInfoPopup
      = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 10, maxWidth: '340px' });

    // Mark when a street is being hovered over. Street names are resolved once per hovered street — the
    // basemap query is not free, and mousemove fires many times per second.
    let hoveredStreet = null;
    let clickedStreet = null;
    const streetNameCache = new Map();
    map.on('mousemove', 'streets', (event) => {
      const street = event.features[0];
      // Don't show hover effects if the street was just clicked on.
      if (street.properties.street_edge_id === clickedStreet) return;
      const isChosen = street.state?.chosen === true;
      const streetId = street.properties.street_edge_id;
      const streetChanged = streetId !== hoveredStreet;

      // If we moved directly from hovering over one street to another, set the previous as hover: false.
      if (hoveredStreet && streetChanged) {
        map.setFeatureState({ source: 'streets', id: hoveredStreet }, { hover: false });
      }
      hoveredStreet = streetId;
      map.setFeatureState({ source: 'streets', id: hoveredStreet }, { hover: true });
      map.getCanvas().style.cursor = 'pointer';

      // A street in another neighborhood can't be added, so only the warning is shown — not an add tooltip
      // inviting a click that would be refused.
      if (this.#currRegionId && this.#currRegionId !== street.properties.region_id) {
        hoverInfoPopup.remove();
        neighborhoodPopup.setLngLat(event.lngLat).addTo(map);
        return;
      }
      neighborhoodPopup.remove();

      // Tooltip above the cursor: the street's name (from the basemap, when one renders nearby) plus what a
      // click will do — add the street, or open the reverse/remove menu for a street already in the route.
      if (streetChanged && !streetNameCache.has(streetId)) {
        streetNameCache.set(streetId, this.#basemapStreetName(event.point));
      }
      const streetName = streetNameCache.get(streetId);
      // escapeValue off: the name goes through Popup.setText (plain text), not into markup.
      const interp = { street: streetName, interpolation: { escapeValue: false } };
      let tooltipText;
      if (isChosen) {
        tooltipText = streetName
          ? i18next.t('hover-street-options-named', interp)
          : i18next.t('hover-street-options');
      } else {
        tooltipText = streetName
          ? i18next.t('hover-add-street-named', interp)
          : i18next.t('hover-add-street');
      }
      hoverInfoPopup.setLngLat(event.lngLat).setText(tooltipText);
      if (!hoverInfoPopup.isOpen()) {
        hoverInfoPopup.addTo(map);
        hoverInfoPopup._content.parentNode.querySelector('[class*="tip"]').remove(); // Remove the arrow.
      }
    });

    // When not hovering over any streets, set prev street to hover: false and reset cursor.
    map.on('mouseleave', 'streets', () => {
      if (hoveredStreet) {
        map.setFeatureState({ source: 'streets', id: hoveredStreet }, { hover: false });
      }
      hoveredStreet = null;
      clickedStreet = null; // This helps avoid showing hover effects directly after clicking a street.
      map.getCanvas().style.cursor = '';
      neighborhoodPopup.remove();
      hoverInfoPopup.remove();
    });

    // Clicking an unchosen street adds it to the route; clicking a chosen one opens the reverse/remove menu.
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

      if (streetFeature.state.chosen === true) { // Street already in the route: open the action menu.
        this.#streetPopover.open(clickedStreet, event.lngLat);
      } else { // If the street was not in the route, add it to the route.
        this.#addStreetToRoute(street);
        hoverInfoPopup.remove(); // Hide the add-street tooltip.
        this.#updateMarkers();
        this.#setRouteDistanceText();
      }

      // Set hover to false so that we don't show hover effect immediately after being clicked.
      map.setFeatureState({ source: 'streets', id: hoveredStreet }, { hover: false });
    });

    this.#maybeRestorePendingRoute();
  }

  /**
   * Best-effort street-name lookup from the basemap's rendered road labels near a screen point (#4575).
   *
   * Road names aren't in our own street data, and basemap label features only exist where a label happens to
   * render — so this returns null along unlabeled stretches and the tooltip degrades to generic text. Purely
   * presentational, which is why it reads the basemap instead of a backend source.
   *
   * @param {Object} point - Screen point ({x, y}) from a map mouse event.
   * @returns {string|null} The street name, or null if no labeled road is nearby.
   */
  #basemapStreetName(point) {
    const radius = 30; // px search window around the cursor.
    const features = this.#map.queryRenderedFeatures([
      [point.x - radius, point.y - radius],
      [point.x + radius, point.y + radius],
    ]);
    const named = features.find((f) => f.sourceLayer === 'road' && f.properties?.name);
    return named ? named.properties.name : null;
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
    const routeDist = this.#streetsInRoute.features
      .reduce((sum, street) => sum + turf.length(street, { units: this.#units }), 0);
    this.#streetDistanceEl.innerText = i18next.t('route-length', { dist: routeDist.toFixed(2) });
  }

  /**
   * Delete old markers and draw new ones, and keep the directions panel in sync with the route's endpoints.
   * The contiguous sections are computed once here (it's O(n²)) and shared by both consumers.
   */
  #updateMarkers() {
    this.#currentMarkers.forEach((m) => m.remove());
    this.#currentMarkers = [];
    const sections = this.#computeContiguousRoutes();
    this.#drawContiguousEndpointMarkers(sections);
    this.#syncDirectionsPanel(sections);
  }

  /**
   * Mirrors the route's current endpoints onto the directions panel (pins + reverse-geocoded field text).
   *
   * @param {Array<Array<Object>>} sections - The route's contiguous sections.
   */
  #syncDirectionsPanel(sections) {
    if (sections.length === 0) {
      this.#directionsPanel.clearPins();
      return;
    }
    const startCoord = sections[0][0].geometry.coordinates[0];
    const lastSection = sections[sections.length - 1];
    const lastCoords = lastSection[lastSection.length - 1].geometry.coordinates;
    this.#directionsPanel.updateFromRoute(startCoord, lastCoords[lastCoords.length - 1]);
  }

  /**
   * Builds (once) and returns the street-network graph used for auto-routing.
   */
  #getRouteGraph() {
    if (!this.#routeGraph) this.#routeGraph = new RouteGraph(this.#streetData.features);
    return this.#routeGraph;
  }

  /**
   * The route in undo-snapshot form: ordered street ids with their current orientation.
   * @returns {Array<{streetId: number, reverse: boolean}>}
   */
  #routeSnapshot() {
    return this.#streetsInRoute.features.map((s) => ({
      streetId: s.properties.street_edge_id,
      reverse: s.properties.reverse === true,
    }));
  }

  /**
   * Empties the route's streets and region state without touching overlays or the undo stack (callers decide
   * what to record and which UI state follows).
   */
  #emptyRouteSilently() {
    const map = this.#map;
    this.#streetsInRoute.features.forEach((s) => {
      map.setFeatureState({ source: 'streets', id: s.properties.street_edge_id }, { chosen: false });
    });
    this.#streetsInRoute.features = [];
    map.getSource('streets-chosen').setData(this.#streetsInRoute);
    map.setFeatureState({ source: 'neighborhoods', id: this.#currRegionId }, { current: false });
    this.#currRegionId = null;
  }

  /**
   * Computes a walking route between the directions panel's pins and replaces the current route with it
   * (undoable in one step). The result feeds the normal editing pipeline, so the auto-routed streets can be
   * tweaked street-by-street afterwards (#4579).
   *
   * @param {Object} start - {lng, lat}.
   * @param {Object} end - {lng, lat}.
   */
  #autoRoute(start, end) {
    // The neighborhoods source must exist too: adding the first street sets a feature state on it.
    if (!this.#status.mapLoaded || !this.#status.streetsLoaded || !this.#status.neighborhoodsLoaded
      || this.#streetsInRoute === null) return;

    const result = this.#getRouteGraph().route(start, end);
    if (result.error) {
      const isRegionError = result.error === 'different-region';
      this.#directionsPanel.setError(i18next.t(isRegionError ? 'different-region-error' : 'no-path-error'));
      window.logWebpageActivity(`RouteBuilder_AutoRoute=${isRegionError ? 'DifferentRegion' : 'NoPath'}`);
      return;
    }

    // One undo step brings back whatever the route looked like before (possibly empty).
    this.#undoStack.push({ type: 'replace', streets: this.#routeSnapshot() });
    this.#emptyRouteSilently();

    result.streets.forEach(({ streetId, flip }) => {
      const street = this.#streetData.features.find((s) => s.properties.street_edge_id === streetId);
      if (!street) return;
      const forceReverse = flip ? !(street.properties.reverse === true) : street.properties.reverse === true;
      this.#addStreetToRoute(street, forceReverse, { record: false });
    });
    this.#updateMarkers();
    this.#setRouteDistanceText();
    window.logWebpageActivity(`RouteBuilder_AutoRoute=Success_Streets=${result.streets.length}`);
  }

  /**
   * Builds a start/end flag marker element: the flag (centered on the route point) with an always-upright
   * text label hanging below it (#3433). The label is positioned absolutely so the marker element's box — and
   * therefore Mapbox's centering — is exactly the flag.
   *
   * @param {string} flagClass - 'marker-start' or 'marker-end'.
   * @param {string} label - The visible/aria label text.
   * @param {number} [rotationDeg] - Bearing to rotate the flag by (the label stays upright).
   * @returns {HTMLElement}
   */
  static #makeEndpointMarkerEl(flagClass, label, rotationDeg = null) {
    const el = document.createElement('div');
    el.className = 'marker-endpoint';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
    const flag = document.createElement('div');
    flag.className = flagClass;
    if (rotationDeg !== null) flag.style.transform = `rotate(${rotationDeg}deg)`;
    const labelEl = document.createElement('span');
    labelEl.className = 'marker-endpoint-label';
    labelEl.textContent = label;
    el.append(flag, labelEl);
    return el;
  }

  /**
   * Draws the endpoints for the contiguous sections of the route on the map.
   *
   * @param {Array<Array<Object>>} contigSections - The route's contiguous sections.
   */
  #drawContiguousEndpointMarkers(contigSections) {
    const map = this.#map;
    if (contigSections.length === 0) return;

    // Add start point, with a visible "Start" label (#3433).
    const startPoint = contigSections[0][0].geometry.coordinates[0];
    const rotation = turf.bearing(startPoint, contigSections[0][0].geometry.coordinates[1]);
    const startPointEl = RouteBuilder.#makeEndpointMarkerEl('marker-start', i18next.t('marker-start'), rotation);
    const startMarker = new mapboxgl.Marker(startPointEl).setLngLat(startPoint).addTo(map);
    this.#currentMarkers.push(startMarker);

    // Numbered pairs mark a gap between contiguous sections: section i ends and section i+1 begins (#4577).
    for (let i = 0; i < contigSections.length - 1; i++) {
      const midpointEl1 = document.createElement('div');
      const midpointEl2 = document.createElement('div');
      midpointEl1.className = midpointEl2.className = 'marker-number';
      midpointEl1.innerHTML = midpointEl2.innerHTML = (i + 1).toString();
      midpointEl1.style.background = this.#endpointColors[i % this.#endpointColors.length];
      midpointEl2.style.background = this.#endpointColors[i % this.#endpointColors.length];
      const gapEndAria = i18next.t('section-gap-end-aria', { num: i + 1 });
      const gapStartAria = i18next.t('section-gap-start-aria', { num: i + 2 });
      midpointEl1.setAttribute('role', 'img');
      midpointEl1.setAttribute('aria-label', gapEndAria);
      midpointEl1.title = gapEndAria;
      midpointEl2.setAttribute('role', 'img');
      midpointEl2.setAttribute('aria-label', gapStartAria);
      midpointEl2.title = gapStartAria;
      const midPoint1 = contigSections[i].slice(-1)[0].geometry.coordinates.slice(-1)[0];
      const midPoint2 = contigSections[i + 1][0].geometry.coordinates[0];
      const p1Marker = new mapboxgl.Marker(midpointEl1).setLngLat(midPoint1).addTo(map);
      const p2Marker = new mapboxgl.Marker(midpointEl2).setLngLat(midPoint2).addTo(map);
      this.#currentMarkers.push(p1Marker);
      this.#currentMarkers.push(p2Marker);
    }

    // Add endpoint, with a visible "End" label (#3433).
    const endPointEl = RouteBuilder.#makeEndpointMarkerEl('marker-end', i18next.t('marker-end'));
    const endPoint = contigSections.slice(-1)[0].slice(-1)[0].geometry.coordinates.slice(-1)[0];
    const endMarker = new mapboxgl.Marker(endPointEl).setLngLat(endPoint).addTo(map);
    this.#currentMarkers.push(endMarker);
  }

  // TODO do something to preserve ordering, I'm not sure if mapbox guarantees that ordering is preserved.
  //      Could either add a property with the ordering, or keep track in a separate list.

  /**
   * Computes a set of contiguous sections of the route.
   *
   * Loop through the streets in the order that they were added to the route, checking the remaining streets in the
   * route (also in the order they were chosen) to see if any of their start points are connected to the end point of
   * the current street. When there are no connected streets, that contiguous section is done, and we start a new one.
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

  /**
   * Adds a street to the route: sets its orientation and feature states, and applies the first-street UI changes.
   *
   * @param {Object} street - The street's full GeoJSON feature from the streets source data.
   * @param {boolean} [forceReverse] - Target orientation (used when restoring a stashed route or undoing a
   *                                   removal); when omitted, the street is oriented to minimize the number of
   *                                   contiguous sections.
   * @param {Object} [opts]
   * @param {boolean} [opts.record=true] - Whether to record the action on the undo stack (off during undo).
   * @param {number} [opts.index] - Position in the route to insert at (used when undoing a removal).
   */
  #addStreetToRoute(street, forceReverse = null, { record = true, index = null } = {}) {
    const map = this.#map;
    const streetId = street.properties.street_edge_id;
    map.setFeatureState({ source: 'streets', id: streetId }, { chosen: true });

    const flip = forceReverse === null
      ? this.#shouldReverseStreet(street)
      : (street.properties.reverse === true) !== forceReverse;
    if (flip) {
      street.geometry.coordinates.reverse();
      street.properties.reverse = !street.properties.reverse;
    }

    if (index === null) {
      this.#streetsInRoute.features.push(street);
    } else {
      this.#streetsInRoute.features.splice(index, 0, street);
    }
    map.getSource('streets-chosen').setData(this.#streetsInRoute);
    if (record) this.#undoStack.push({ type: 'add', streetId });

    // If this was first street added, make additional UI changes.
    if (this.#streetsInRoute.features.length === 1) {
      // Switch the panel from its intro state to the route-building state (length + Save/Undo/Clear).
      this.#setPanelState('building');

      // Change style to show you can't choose streets in other regions.
      this.#currRegionId = street.properties.region_id;
      map.setFeatureState({ source: 'neighborhoods', id: this.#currRegionId }, { current: true });
      map.setPaintProperty(
        'neighborhoods', 'fill-opacity', ['case', ['boolean', ['feature-state', 'current'], false], 0.0, 0.3],
      );
      map.setPaintProperty('outside-neighborhoods', 'fill-opacity', 0.5);
    }
  }

  /**
   * Reverses a street's walking direction in the route.
   *
   * @param {number} streetId
   * @param {Object} [opts]
   * @param {boolean} [opts.record=true] - Whether to record the action on the undo stack (off during undo).
   */
  #reverseStreet(streetId, { record = true } = {}) {
    const street = this.#streetsInRoute.features.find((s) => s.properties.street_edge_id === streetId);
    if (!street) return;
    street.geometry.coordinates.reverse();
    street.properties.reverse = !street.properties.reverse;
    this.#map.getSource('streets-chosen').setData(this.#streetsInRoute);
    if (record) this.#undoStack.push({ type: 'reverse', streetId });
    this.#updateMarkers();
    this.#setRouteDistanceText(); // Unchanged by a reverse today, but every mutation refreshes the readout.
  }

  /**
   * Removes a street from the route; resets to the intro state if the route becomes empty.
   *
   * @param {number} streetId
   * @param {Object} [opts]
   * @param {boolean} [opts.record=true] - Whether to record the action on the undo stack (off during undo).
   */
  #removeStreet(streetId, { record = true } = {}) {
    const index = this.#streetsInRoute.features.findIndex((s) => s.properties.street_edge_id === streetId);
    if (index === -1) return;
    const [street] = this.#streetsInRoute.features.splice(index, 1);
    this.#map.setFeatureState({ source: 'streets', id: streetId }, { chosen: false });
    this.#map.getSource('streets-chosen').setData(this.#streetsInRoute);
    if (record) {
      this.#undoStack.push({ type: 'remove', streetId, index, reverse: street.properties.reverse === true });
    }
    this.#updateMarkers();
    this.#setRouteDistanceText();

    // Once the route is empty again, any street can be selected. Update styles.
    if (this.#streetsInRoute.features.length === 0) {
      this.#resetUI();
    }
  }

  /**
   * Re-adds a snapshot's streets to the route (without recording) and refreshes markers + distance.
   *
   * @param {Array<{streetId: number, reverse: boolean}>} streets - Snapshot from #routeSnapshot.
   * @param {number} [insertIndex] - Position to insert at (single-street restores); appends when omitted.
   */
  #restoreSnapshot(streets, insertIndex = null) {
    streets.forEach((s) => {
      const street = this.#streetData.features.find((f) => f.properties.street_edge_id === s.streetId);
      if (street) this.#addStreetToRoute(street, s.reverse, { record: false, index: insertIndex });
    });
    this.#updateMarkers();
    this.#setRouteDistanceText();
  }

  /**
   * Undoes the most recent route edit by applying its inverse (without re-recording it).
   */
  #undo() {
    const action = this.#undoStack.pop();
    if (!action) return;
    switch (action.type) {
      case 'add':
        this.#removeStreet(action.streetId, { record: false });
        break;
      case 'reverse':
        this.#reverseStreet(action.streetId, { record: false });
        break;
      case 'remove':
        this.#restoreSnapshot([{ streetId: action.streetId, reverse: action.reverse }], action.index);
        break;
      case 'clear':
        this.#restoreSnapshot(action.streets);
        break;
      case 'replace': // An auto-route replaced the whole route; restore the prior snapshot (possibly empty).
        this.#emptyRouteSilently();
        this.#restoreSnapshot(action.streets);
        if (this.#streetsInRoute.features.length === 0) this.#resetUI();
        break;
    }
  }

  /**
   * Restores a route stashed in sessionStorage before a sign-in reload, then reopens the save modal.
   *
   * Runs once, after the map, neighborhoods, and streets have all rendered (so sources/feature states exist).
   */
  #maybeRestorePendingRoute() {
    if (this.#status.pendingRouteRestored || !this.#status.mapLoaded
      || !this.#status.neighborhoodsRendered || !this.#status.streetsLoaded) return;

    this.#status.pendingRouteRestored = true;
    const pending = SaveModal.consumePendingRoute();
    if (!pending) return;

    pending.streets.forEach((stashedStreet) => {
      const street = this.#streetData.features.find(
        (s) => s.properties.street_edge_id === stashedStreet.street_id,
      );
      if (street) this.#addStreetToRoute(street, stashedStreet.reverse === true);
    });
    if (this.#streetsInRoute.features.length === 0) return;

    this.#updateMarkers();
    this.#setRouteDistanceText();
    this.#saveModal.open(pending.name || null);
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
    // Record the whole route so a clear can be undone in one step.
    if (this.#streetsInRoute.features.length > 0) {
      this.#undoStack.push({ type: 'clear', streets: this.#routeSnapshot() });
    }

    // Remove all the streets from the route.
    this.#streetsInRoute.features.forEach((s) => {
      map.setFeatureState({ source: 'streets', id: s.properties.street_edge_id }, { chosen: false });
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

    // Return the panel to its intro state and hide all modals.
    this.#setPanelState('empty');
    this.#routeSavedModal.style.visibility = 'hidden';
    this.#deleteRouteModal.style.visibility = 'hidden';
    this.#saveModal.hide();
    this.#streetPopover.close();
    this.#guestRoutes.render();
    this.#directionsPanel.clearPins();
  }

  /**
   * Looks up a region's display name from the neighborhoods GeoJSON.
   *
   * @param {number} regionId
   * @returns {string|null} The region name, or null if unknown.
   */
  #getRegionName(regionId) {
    const region = this.#neighborhoodData?.features.find((n) => n.properties.region_id === regionId);
    return region ? region.properties.region_name : null;
  }

  /**
   * Returns the ordered street list for the route in the POST /saveRoute wire format.
   * @returns {Array<{street_id: number, reverse: boolean}>}
   */
  #routeStreetsPayload() {
    return this.#computeContiguousRoutes().flat().map((s) => ({
      street_id: s.properties.street_edge_id,
      reverse: s.properties.reverse === true,
    }));
  }

  /**
   * Shows the Route Saved modal and wires up its share/explore/labelmap actions.
   *
   * @param {number} routeId
   * @param {string} name - The route's saved name.
   */
  #showRouteSavedModal(routeId, name) {
    this.#routeSavedModal.style.visibility = 'visible';
    const exploreRelURL = `/explore?routeId=${routeId}`;
    const exploreURL = `${window.location.origin}${exploreRelURL}`;
    this.#routeSavedNameEl.textContent = name;

    // For guests, remember the route on this device so a forgotten link isn't fatal.
    if (!this.#isSignedIn) {
      this.#guestRoutes.record(routeId, name, this.#getRegionName(this.#currRegionId), exploreURL);
    }

    // Update link and tooltip for Explore route button.
    this.#exploreButton.off('click');
    this.#exploreButton.click(() => {
      window.logWebpageActivity(`RouteBuilder_Click=Explore_RouteId=${routeId}`);
      window.location.replace(exploreRelURL);
    });

    // Add the 'copied to clipboard' tooltip on click.
    this.#linkTextEl.textContent = exploreURL;
    this.#copyLinkButton.off('click');
    this.#copyLinkButton.click((e) => {
      navigator.clipboard.writeText(exploreURL);
      this.#setTemporaryTooltip(e.currentTarget, i18next.t('copied-to-clipboard'));
      window.logWebpageActivity(`RouteBuilder_Click=Copy_RouteId=${routeId}`);
    });

    // Update link for the 'View in LabelMap' button.
    this.#viewInLabelmapButton.off('click');
    this.#viewInLabelmapButton.click(() => {
      window.logWebpageActivity(`RouteBuilder_Click=LabelMap_RouteId=${routeId}`);
      window.open(`/labelMap?routes=${routeId}`, '_blank');
    });
  }
}
