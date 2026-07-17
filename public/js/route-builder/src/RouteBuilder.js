/**
 * RouteBuilder — the /routeBuilder page. Building is staged coarse-to-fine: the user first clicks the neighborhood
 * to build in (routes are constrained to one region, so the choice is made explicit and the map zooms to it), then
 * clicks points on the map — the first click drops a start (previewed by a ghost flag), and each further click
 * extends the route from the last point along an A* walking path over the street network (RouteGraph). Routes are
 * contiguous by construction. Clicking the drawn route opens a small action menu (RoutePopover: reverse / delete).
 * A slim Start/End address seed (DirectionsPanel) can plant the first two points, implicitly selecting the region.
 * The save flow lives in SaveModal; the anonymous "recent routes on this device" recovery list lives in
 * GuestRoutes.
 *
 * The route is defined entirely by #waypoints (ordered snapped points); the drawn streets, endpoint flags, and
 * stats are all derived from them by #recompute, so add / undo / reverse are just edits to that list followed by a
 * recompute.
 */
class RouteBuilder {
  // Zoom eased to when the first point lands, close enough that the basemap renders street names for building.
  static BUILD_ZOOM = 15.5;
  // How long the explorer takes to walk the route in the save-hover preview animation.
  static EXPLORER_ANIMATION_MS = 2500;
  #status = {
    mapLoaded: false,
    neighborhoodsLoaded: false, // Neighborhood GeoJSON has arrived from the server.
    neighborhoodsRendered: false, // Neighborhood source/layers have been added to the map.
    streetsLoaded: false,
    pendingRouteRestored: false,
  };

  #units;
  #minutesPer100m;

  #mapboxApiKey;
  #map;
  #isSignedIn;

  // Route state. The route is fully defined by #waypoints; everything else is derived from it.
  #neighborhoodData = null;
  #currRegionId = null;
  #streetData = null;
  #streetsInRoute = null; // The 'streets-chosen' GeoJSON source: cloned, oriented street features for the route.
  #waypoints = []; // Ordered [{ lng, lat }] snapped points the user clicked/seeded.
  #chosenIds = new Set(); // Street ids currently drawn (their 'chosen' feature-state hides the base street).
  #endpointData = { type: 'FeatureCollection', features: [] }; // The 'route-endpoints' symbol source (flags).
  #routeGraph = null; // Built from #streetData as soon as it arrives (the ghost start flag needs it pre-click).
  #ghostRaf = null; // Pending requestAnimationFrame id for the ghost-start-flag update.
  #ghostLngLat = null; // Latest mouse position awaiting a ghost-start-flag update.
  #explorerRaf = null; // Pending requestAnimationFrame id for the save-hover explorer animation.

  // Collaborators.
  #saveModal;
  #guestRoutes;
  #undoStack;
  #directionsPanel;
  #routePopover;

  // DOM elements.
  #panel;
  #ctaEl;
  #deleteRouteModal;
  #routeSavedModal;
  #routeSavedNameEl;
  #streetDistanceEl;
  #routeTimeEl;
  #streetCountEl;
  #regionChipEl;
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
   * @param {number} minutesPer100m - The city's labeling pace (minutes per 100 m), for the exploration-time
   *   estimate; server-provided (ConfigService.getCityLabelingSpeed).
   */
  constructor($, mapboxApiKey, mapParams, isSignedIn, minutesPer100m) {
    this.#mapboxApiKey = mapboxApiKey;
    this.#isSignedIn = isSignedIn === true;
    this.#units = i18next.t('common:unit-distance');
    this.#minutesPer100m = minutesPer100m;

    // Get the DOM elements.
    this.#panel = document.getElementById('routebuilder-panel');
    this.#ctaEl = document.getElementById('routebuilder-cta');
    this.#deleteRouteModal = document.getElementById('delete-route-modal-backdrop');
    this.#routeSavedModal = document.getElementById('route-saved-modal-backdrop');
    this.#routeSavedNameEl = document.getElementById('route-saved-name');
    this.#streetDistanceEl = document.getElementById('route-length-val');
    this.#routeTimeEl = document.getElementById('route-time-val');
    this.#streetCountEl = document.getElementById('route-street-count');
    this.#regionChipEl = document.getElementById('route-region-chip');
    this.#saveButton = document.getElementById('save-button');
    this.#exploreButton = $('#explore-button');
    this.#linkTextEl = document.getElementById('share-route-link');
    this.#copyLinkButton = $('#copy-link-button');
    this.#viewInLabelmapButton = $('#view-in-labelmap-button');

    // Wire the route-management buttons.
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
    this.#map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
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

    this.#directionsPanel = new DirectionsPanel({
      map: this.#map,
      mapboxApiKey: this.#mapboxApiKey,
      bbox: [
        [mapParams.southwest_boundary.lng, mapParams.southwest_boundary.lat],
        [mapParams.northeast_boundary.lng, mapParams.northeast_boundary.lat],
      ],
      onSetStart: (lngLat) => this.#addWaypoint(lngLat, 'AddressStart'),
      onSetEnd: (lngLat) => this.#addWaypoint(lngLat, 'AddressEnd'),
    });
    this.#routePopover = new RoutePopover(this.#map, () => this.#reverseRoute(), () => this.#openDeleteConfirm());

    this.#saveButton.addEventListener('click', () => this.#saveModal.open());
    // A playful preview: hovering (or keyboard-focusing) Save walks the explorer along the route.
    this.#saveButton.addEventListener('mouseenter', () => this.#animateExplorer());
    this.#saveButton.addEventListener('focus', () => this.#animateExplorer());

    document.getElementById('poi-toggle-checkbox')?.addEventListener('change', (e) => {
      window.logWebpageActivity(`RouteBuilder_Click=TogglePois_Visible=${e.target.checked}`);
      this.#setPoiVisibility(e.target.checked);
    });

    this.#updateCta();
  }

  /**
   * Shows or hides the basemap's point-of-interest labels (schools, parks, libraries, ...). POIs help route
   * builders aim for destinations that matter to pedestrians, but can clutter dense areas, so the legend offers a
   * toggle.
   *
   * @param {boolean} visible
   */
  #setPoiVisibility(visible) {
    (this.#map.getStyle()?.layers ?? [])
      .filter((layer) => layer.type === 'symbol' && layer.id.includes('poi'))
      .forEach((layer) => this.#map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none'));
  }

  // Arrow field so the reference stays stable for the map on/off pair. Stacks the layers bottom-to-top.
  #moveLayers = () => {
    const map = this.#map;
    if (map.getLayer('neighborhoods-outline') && map.getLayer('streets') && map.getLayer('streets-chosen')) {
      // The flag/explorer layers may not exist yet (their icons rasterize async); they are then added on top
      // anyway, so only the base layers gate the reordering.
      ['neighborhoods-fill', 'neighborhoods-outline', 'streets', 'streets-chosen', 'neighborhoods-label',
        'ghost-start', 'route-endpoints', 'route-explorer']
        .filter((id) => map.getLayer(id))
        .forEach((id) => map.moveLayer(id));
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

  // A transient message floated over the map (out-of-region / no-path feedback).
  #showMapMessage(message) {
    Toast.show({ message, duration: 2500 });
  }

  /**
   * Switches the left planner card between its two states (CSS shows/hides the matching sections).
   * @param {'empty'|'building'} state - 'empty' shows the intro; 'building' shows the length + route actions.
   */
  #setPanelState(state) {
    this.#panel.dataset.state = state;
  }

  /**
   * Whether any route content exists yet (clicked/seeded waypoints, or a restored drawn route with no waypoints).
   * @returns {boolean}
   */
  #routeStarted() {
    return this.#waypoints.length > 0 || (this.#streetsInRoute?.features.length ?? 0) > 0;
  }

  /**
   * Updates the on-map call-to-action to match the staged flow: pick a neighborhood, then a start point, then
   * extend (hidden once the route has 2+ points).
   */
  #updateCta() {
    if (!this.#ctaEl) return;
    if (!this.#routeStarted()) {
      const key = this.#currRegionId === null ? 'cta-select-region' : 'cta-pick-start';
      this.#ctaEl.innerHTML = `
        <img src="/assets/images/icons/routebuilder/flag-start.svg" class="cta-flag" alt="">
        <span>${i18next.t(key)}</span>`;
      this.#ctaEl.hidden = false;
    } else if (this.#waypoints.length === 1) {
      this.#ctaEl.textContent = i18next.t('cta-extend');
      this.#ctaEl.hidden = false;
    } else {
      this.#ctaEl.hidden = true;
    }
  }

  /**
   * Renders the neighborhoods: an invisible fill that acts as the hover/click target while choosing where to
   * build (lightly tinted on hover), name labels shown only during that choice, and a solid outline drawn for the
   * selected region alone — boundaries stay off the map otherwise to keep the visual noise down.
   */
  #renderNeighborhoodsHelper() {
    const map = this.#map;
    map.addSource('neighborhoods', {
      type: 'geojson',
      data: this.#neighborhoodData,
      promoteId: 'region_id',
    });
    map.addLayer({
      id: 'neighborhoods-fill',
      type: 'fill',
      source: 'neighborhoods',
      paint: {
        'fill-color': '#2D2A3F', // --color-asphalt-500 (map paint can't read CSS tokens).
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.12, 0.0],
      },
    });
    map.addLayer({
      id: 'neighborhoods-outline',
      type: 'line',
      source: 'neighborhoods',
      paint: {
        'line-color': '#2D2A3F',
        'line-width': 2,
        // Only the selected region is outlined; every other boundary stays invisible.
        'line-opacity': ['case', ['boolean', ['feature-state', 'current'], false], 0.5, 0.0],
      },
    });
    map.addLayer({
      id: 'neighborhoods-label',
      type: 'symbol',
      source: 'neighborhoods',
      layout: {
        'text-field': ['get', 'region_name'],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 15],
      },
      paint: {
        'text-color': '#2D2A3F',
        'text-halo-color': '#FFFFFF',
        'text-halo-width': 1.5,
      },
    });

    // While choosing a neighborhood (any time the route hasn't started), regions highlight on hover.
    let hoveredRegion = null;
    map.on('mousemove', 'neighborhoods-fill', (event) => {
      if (this.#routeStarted()) return;
      const regionId = event.features[0].properties.region_id;
      if (regionId !== hoveredRegion) {
        if (hoveredRegion !== null) {
          map.setFeatureState({ source: 'neighborhoods', id: hoveredRegion }, { hover: false });
        }
        hoveredRegion = regionId;
        map.setFeatureState({ source: 'neighborhoods', id: hoveredRegion }, { hover: true });
      }
      // Inside the selected region the ghost flag is the affordance; elsewhere the region itself is clickable.
      if (this.#currRegionId === null || regionId !== this.#currRegionId) map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'neighborhoods-fill', () => {
      if (hoveredRegion !== null) map.setFeatureState({ source: 'neighborhoods', id: hoveredRegion }, { hover: false });
      hoveredRegion = null;
      map.getCanvas().style.cursor = '';
    });

    this.#status.neighborhoodsRendered = true;
    this.#maybeRestorePendingRoute();
  }

  /**
   * Selects the neighborhood to build in: outlines it, hides the region-name labels and hover tint, and zooms the
   * map to fit it. Re-selecting a different region (before any point is placed) just moves the selection.
   *
   * @param {number} regionId
   * @param {boolean} [fit=true] - Whether to zoom the map to the region (false when an address already zoomed us).
   */
  #selectRegion(regionId, fit = true) {
    const map = this.#map;
    if (this.#currRegionId === regionId) return;
    if (this.#currRegionId !== null) {
      map.setFeatureState({ source: 'neighborhoods', id: this.#currRegionId }, { current: false });
    }
    this.#currRegionId = regionId;
    map.setFeatureState({ source: 'neighborhoods', id: regionId }, { current: true });
    if (map.getLayer('neighborhoods-label')) map.setLayoutProperty('neighborhoods-label', 'visibility', 'none');
    this.#clearGhostStart(); // Mousemove doesn't fire during the zoom animation, so drop any stale ghost now.

    if (fit) {
      const region = this.#neighborhoodData?.features.find((n) => n.properties.region_id === regionId);
      if (region) map.fitBounds(turf.bbox(region), { padding: 60, duration: 1200, maxZoom: 16 });
    }
    this.#updateCta();
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
   * Renders the streets on the map and wires the routing interaction.
   *
   * Two sources: 'streets' holds every street in the city (a thin, quiet base network you click to route along);
   * 'streets-chosen' holds the drawn route (an arrow pattern showing walking direction). A street in the route has
   * its base copy hidden via the 'chosen' feature-state. Clicking the drawn route opens the reverse/delete menu;
   * clicking anywhere else extends the route to the nearest street. Before the route starts, a ghost dot previews
   * the intersection the first click would snap to; the endpoint flags render as a symbol layer (drawn in the same
   * WebGL pass as the route line, unlike DOM markers, so they can never drift off it).
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
    // The ghost start dot needs snapping before any click, so build the routing graph right away.
    this.#getRouteGraph();

    map.addLayer({
      id: 'streets',
      type: 'line',
      source: 'streets',
      paint: {
        // Quiet neutral base network; the street a click would snap to lights up in the DS link blue on hover.
        'line-color': ['case',
          ['boolean', ['feature-state', 'hover'], false], '#3E8BD9', // --color-link-100
          '#B3B3B3', // --color-neutral-500
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 15, 4],
        // Hidden where the street is part of the drawn route (that copy renders in 'streets-chosen' instead).
        'line-opacity': ['case', ['boolean', ['feature-state', 'chosen'], false], 0.0, 0.45],
      },
    });
    map.addLayer({
      id: 'streets-chosen',
      type: 'line',
      source: 'streets-chosen',
      paint: {
        'line-pattern': 'street-arrow',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 15, 8],
        'line-opacity': 0.9,
      },
    });

    // Flag + explorer icons render as symbol layers (drawn in the same WebGL pass as the route line, unlike DOM
    // markers, so they can never drift off it). The SVGs/PNG are rasterized ourselves because Mapbox's loadImage
    // only decodes raster formats and this GL build's callback API doesn't return a promise.
    Promise.all([
      RouteBuilder.#rasterizeIcon('/assets/images/icons/routebuilder/flag-start.svg', 27),
      RouteBuilder.#rasterizeIcon('/assets/images/icons/routebuilder/flag-end.svg', 27),
      RouteBuilder.#rasterizeIcon('/assets/images/icons/project_sidewalk_flag.png', 40),
    ]).then(([startFlag, endFlag, explorer]) => {
      map.addImage('routebuilder-start-flag', startFlag.data, { pixelRatio: startFlag.pixelRatio });
      map.addImage('routebuilder-end-flag', endFlag.data, { pixelRatio: endFlag.pixelRatio });
      map.addImage('routebuilder-explorer', explorer.data, { pixelRatio: explorer.pixelRatio });

      // Ghost start flag: a translucent preview of exactly where the first click would plant the start.
      map.addSource('ghost-start', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'ghost-start',
        type: 'symbol',
        source: 'ghost-start',
        layout: {
          'icon-image': 'routebuilder-start-flag',
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
        },
        paint: {
          'icon-opacity': 0.55,
        },
      });

      map.addSource('route-endpoints', { type: 'geojson', data: this.#endpointData });
      map.addLayer({
        id: 'route-endpoints',
        type: 'symbol',
        source: 'route-endpoints',
        layout: {
          'icon-image': ['concat', 'routebuilder-', ['get', 'kind'], '-flag'],
          'icon-anchor': 'bottom', // The flag pole is planted on the route point; the label hangs below it.
          'icon-allow-overlap': true,
          'text-field': ['get', 'label'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 13,
          'text-anchor': 'top',
          'text-offset': [0, 0.4],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#2D2A3F', // --color-asphalt-500 (map paint can't read CSS tokens).
          'text-halo-color': '#FFFFFF',
          'text-halo-width': 1.5,
        },
      });

      // The explorer that walks the route in the save-hover preview animation.
      map.addSource('route-explorer', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'route-explorer',
        type: 'symbol',
        source: 'route-explorer',
        layout: {
          'icon-image': 'routebuilder-explorer',
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
    }).catch((e) => console.error('Failed to prepare map icons:', e));

    // Hover highlights the street a click would snap to — only once the route has started (before that, the ghost
    // dot is the hover affordance). Out-of-region streets show a not-allowed cursor.
    let hoveredStreet = null;
    map.on('mousemove', 'streets', (event) => {
      if (!this.#routeStarted()) return;
      const streetId = event.features[0].properties.street_edge_id;
      const regionId = event.features[0].properties.region_id;
      if (this.#currRegionId !== null && this.#currRegionId !== regionId) {
        if (hoveredStreet !== null) {
          map.setFeatureState({ source: 'streets', id: hoveredStreet }, { hover: false });
          hoveredStreet = null;
        }
        map.getCanvas().style.cursor = 'not-allowed';
        return;
      }
      if (streetId !== hoveredStreet) {
        if (hoveredStreet !== null) map.setFeatureState({ source: 'streets', id: hoveredStreet }, { hover: false });
        hoveredStreet = streetId;
        map.setFeatureState({ source: 'streets', id: hoveredStreet }, { hover: true });
      }
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'streets', () => {
      if (hoveredStreet !== null) map.setFeatureState({ source: 'streets', id: hoveredStreet }, { hover: false });
      hoveredStreet = null;
      map.getCanvas().style.cursor = '';
    });
    map.on('mousemove', (event) => this.#updateGhostStart(event.lngLat));
    map.on('mouseout', () => this.#clearGhostStart());

    // Click handling follows the staged flow. On the drawn route: open the reverse/delete menu (a small pixel box
    // around the click gives the thin line a comfortable hit target). Before any point exists: clicking a
    // neighborhood selects it (clicking a different one moves the selection); clicking inside the selected one
    // plants the start. After that, clicks extend the route.
    map.on('click', (event) => {
      const { x, y } = event.point;
      const onRoute = this.#streetsInRoute && this.#streetsInRoute.features.length > 0
        && map.queryRenderedFeatures([[x - 6, y - 6], [x + 6, y + 6]], { layers: ['streets-chosen'] }).length > 0;
      if (onRoute) {
        window.logWebpageActivity('RouteBuilder_Click=RouteMenu_Open');
        this.#routePopover.open(event.lngLat);
        return;
      }
      if (!this.#routeStarted()) {
        const clickedRegionId = this.#regionIdAtPoint(event.point);
        if (clickedRegionId === null) return; // Clicked outside every neighborhood.
        if (clickedRegionId !== this.#currRegionId) {
          window.logWebpageActivity(`RouteBuilder_Click=SelectRegion_RegionId=${clickedRegionId}`);
          this.#selectRegion(clickedRegionId);
          return;
        }
      }
      this.#addWaypoint(event.lngLat, 'MapClick');
    });

    this.#maybeRestorePendingRoute();
  }

  /**
   * Returns the region id of the neighborhood polygon under a screen point, or null if there is none.
   *
   * @param {Object} point - Screen {x, y} of a map event.
   * @returns {number|null}
   */
  #regionIdAtPoint(point) {
    if (!this.#map.getLayer('neighborhoods-fill')) return null;
    const features = this.#map.queryRenderedFeatures(point, { layers: ['neighborhoods-fill'] });
    return features.length > 0 ? features[0].properties.region_id : null;
  }

  /**
   * Moves the ghost start flag to the intersection nearest the mouse (rAF-throttled: snapping scans the street
   * network, so at most one scan per frame). Active only between selecting a neighborhood and placing the start;
   * snapping is restricted to the selected region so the preview can't slip across a boundary.
   *
   * @param {Object} lngLat - The mouse position {lng, lat}.
   */
  #updateGhostStart(lngLat) {
    if (this.#routeStarted() || this.#currRegionId === null || !this.#routeGraph) {
      return;
    }
    this.#ghostLngLat = lngLat;
    if (this.#ghostRaf !== null) return;
    this.#ghostRaf = requestAnimationFrame(() => {
      this.#ghostRaf = null;
      if (this.#routeStarted() || this.#currRegionId === null) return; // State may have changed mid-frame.
      const snap = this.#routeGraph.snapToStreet(this.#ghostLngLat, this.#currRegionId);
      const source = this.#map.getSource('ghost-start');
      if (!snap || !source) return;
      source.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: snap.nodeLngLat } }],
      });
    });
  }

  /** Hides the ghost start flag (mouse left the map, or the start was placed). */
  #clearGhostStart() {
    this.#map.getSource('ghost-start')?.setData({ type: 'FeatureCollection', features: [] });
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
   * Builds (once) and returns the street-network graph used for routing.
   */
  #getRouteGraph() {
    if (!this.#routeGraph) this.#routeGraph = new RouteGraph(this.#streetData.features);
    return this.#routeGraph;
  }

  /**
   * Adds a waypoint at the nearest street to a clicked/typed point and extends the route to it.
   *
   * The first waypoint locks the route to its region (kept lightly — a click in another region is refused with a
   * toast). A non-first waypoint must be reachable from the previous one along the street network.
   *
   * @param {Object} lngLat - {lng, lat} of the click or geocoded address.
   * @param {string} source - Where the point came from, for activity logging ('MapClick'/'AddressStart'/...).
   */
  #addWaypoint(lngLat, source) {
    if (!this.#status.neighborhoodsRendered || !this.#status.streetsLoaded || this.#streetsInRoute === null) return;
    // A route restored for the post-sign-in save flow is drawn but has no waypoints; a fresh click starts over
    // rather than leaving the (waypoint-derived) route and the drawn streets out of sync.
    if (this.#waypoints.length === 0 && this.#streetsInRoute.features.length > 0) this.#emptyRoute();
    const graph = this.#getRouteGraph();

    // Region rule: a point in a different neighborhood than the selected one is refused (with a toast). The
    // polygon under the point decides, and snapping is restricted to the selected region, so a point near a
    // boundary can't silently slip across it.
    const pointRegionId = this.#regionIdAtPoint(this.#map.project(lngLat));
    if (this.#currRegionId !== null && pointRegionId !== null && pointRegionId !== this.#currRegionId) {
      this.#showMapMessage(i18next.t('one-neighborhood-warning'));
      window.logWebpageActivity(`RouteBuilder_AddWaypoint=DifferentRegion_Source=${source}`);
      return;
    }
    const snap = graph.snapToStreet(lngLat, this.#currRegionId);
    if (!snap) return;
    // An address-seeded first point selects its region implicitly (no zoom-to-fit; we ease to the point below).
    if (this.#currRegionId === null) this.#selectRegion(snap.regionId, false);

    const point = { lng: snap.nodeLngLat[0], lat: snap.nodeLngLat[1] };
    // A non-first point must be reachable from the current end along the street network.
    if (this.#waypoints.length > 0) {
      const result = graph.route(this.#waypoints[this.#waypoints.length - 1], point);
      if (result.error) {
        this.#showMapMessage(i18next.t('no-path-error'));
        window.logWebpageActivity(`RouteBuilder_AddWaypoint=NoPath_Source=${source}`);
        return;
      }
    }

    this.#waypoints.push(point);
    this.#undoStack.push({ type: 'waypoint' });
    if (this.#waypoints.length === 1) {
      this.#setPanelState('building');
      this.#clearGhostStart();
      // Ease in close enough that street names are legible, so the user can keep building from the start point.
      if (this.#map.getZoom() < RouteBuilder.BUILD_ZOOM) {
        this.#map.easeTo({ center: [point.lng, point.lat], zoom: RouteBuilder.BUILD_ZOOM, duration: 1200 });
      }
    }
    this.#recompute();
    window.logWebpageActivity(`RouteBuilder_AddWaypoint=Success_Count=${this.#waypoints.length}_Source=${source}`);
  }

  /**
   * Rebuilds every derived piece of state (drawn streets, endpoint flags, stats, direction-panel fields, CTA)
   * from #waypoints. Each consecutive waypoint pair is routed with A*; the resulting streets are cloned from the
   * source data and oriented to the walking direction, so the originals are never mutated and rebuilds stay
   * deterministic.
   */
  #recompute() {
    const map = this.#map;
    // Clear the previous 'chosen' states so hidden base streets reappear if they left the route.
    this.#chosenIds.forEach((id) => map.setFeatureState({ source: 'streets', id }, { chosen: false }));
    this.#chosenIds.clear();

    const features = [];
    for (let i = 1; i < this.#waypoints.length; i++) {
      const result = this.#getRouteGraph().route(this.#waypoints[i - 1], this.#waypoints[i]);
      if (result.error) continue; // Reachability was checked on add; guard defensively.
      result.streets.forEach(({ streetId, flip }) => {
        const orig = this.#streetData.features.find((s) => s.properties.street_edge_id === streetId);
        if (!orig) return;
        const coords = orig.geometry.coordinates.slice(); // Shallow copy: reversing it never touches the original.
        if (flip) coords.reverse();
        features.push({
          type: 'Feature',
          properties: { street_edge_id: streetId, region_id: orig.properties.region_id, reverse: flip },
          geometry: { type: 'LineString', coordinates: coords },
        });
        map.setFeatureState({ source: 'streets', id: streetId }, { chosen: true });
        this.#chosenIds.add(streetId);
      });
    }
    this.#streetsInRoute.features = features;
    map.getSource('streets-chosen').setData(this.#streetsInRoute);

    this.#updateEndpointFlags();
    this.#updateStats();
    this.#syncDirectionsFields();
    this.#directionsPanel.setEndVisible(this.#routeStarted());
    this.#updateCta();
  }

  /**
   * Mirrors the route's current endpoints into the Start/End address fields (reverse-geocoded), or clears them.
   * A lone start point (first click, no segments yet) fills just the Start field.
   */
  #syncDirectionsFields() {
    const feats = this.#streetsInRoute.features;
    if (feats.length > 0) {
      const startCoord = feats[0].geometry.coordinates[0];
      const endCoord = feats[feats.length - 1].geometry.coordinates.slice(-1)[0];
      this.#directionsPanel.updateFromRoute(startCoord, endCoord);
    } else if (this.#waypoints.length === 1) {
      this.#directionsPanel.updateStart([this.#waypoints[0].lng, this.#waypoints[0].lat]);
    } else {
      this.#directionsPanel.clearFields();
    }
  }

  /**
   * Updates the stats block in the planner card: distance, estimated exploration time (distance x the city's
   * labeling pace), street count, and the neighborhood chip. Cleared when the route is empty.
   */
  #updateStats() {
    const feats = this.#streetsInRoute.features;
    if (feats.length === 0) {
      this.#streetDistanceEl.innerText = '';
      this.#routeTimeEl.innerText = '';
      this.#streetCountEl.innerText = '';
      this.#regionChipEl.textContent = '';
      this.#regionChipEl.hidden = true;
      return;
    }

    const km = feats.reduce((sum, street) => sum + turf.length(street, { units: 'kilometers' }), 0);
    const routeDist = this.#units === 'miles' ? km / 1.609344 : km;
    this.#streetDistanceEl.innerText = i18next.t('route-length', { dist: routeDist.toFixed(2) });

    const minutes = Math.max(1, Math.round((km * 1000 / 100) * this.#minutesPer100m));
    this.#routeTimeEl.innerText = minutes < 60
      ? i18next.t('est-time-minutes', { min: minutes })
      : i18next.t('est-time-hours', { hours: Math.floor(minutes / 60), min: minutes % 60 });

    this.#streetCountEl.innerText = i18next.t('street-count', { count: feats.length });

    const regionName = this.#getRegionName(this.#currRegionId);
    this.#regionChipEl.textContent = regionName ?? '';
    this.#regionChipEl.hidden = regionName === null;
  }

  /**
   * Rebuilds the 'route-endpoints' symbol source from the current route (or a lone start point): the start and end
   * flags, each with a Start/End text label below the point.
   */
  #updateEndpointFlags() {
    const features = [];
    const feats = this.#streetsInRoute.features;
    if (feats.length > 0) {
      const endCoord = feats[feats.length - 1].geometry.coordinates.slice(-1)[0];
      features.push(RouteBuilder.#endpointFeature('start', feats[0].geometry.coordinates[0]));
      features.push(RouteBuilder.#endpointFeature('end', endCoord));
    } else if (this.#waypoints.length === 1) {
      // A start has been dropped but no segment exists yet: show a provisional start flag.
      const wp = this.#waypoints[0];
      features.push(RouteBuilder.#endpointFeature('start', [wp.lng, wp.lat]));
    }
    this.#endpointData = { type: 'FeatureCollection', features };
    // The source may not exist yet (icons rasterize async); it is then created with #endpointData as its data.
    this.#map.getSource('route-endpoints')?.setData(this.#endpointData);
  }

  /**
   * Builds one endpoint feature for the 'route-endpoints' symbol source.
   *
   * @param {string} kind - 'start' or 'end'; selects the flag image via the layer's icon-image expression.
   * @param {Array<number>} coord - [lng, lat] of the endpoint.
   * @returns {Object} A GeoJSON Point feature.
   */
  static #endpointFeature(kind, coord) {
    return {
      type: 'Feature',
      properties: { kind, label: i18next.t(`marker-${kind}`) },
      geometry: { type: 'Point', coordinates: coord },
    };
  }

  /**
   * Rasterizes an icon file for use as a map symbol image (map.addImage needs pixel data, and Mapbox's loadImage
   * can't decode SVGs). Rendered at 2x for crisp display on high-DPI screens, preserving aspect ratio.
   *
   * @param {string} url - Same-origin image url (SVG or raster).
   * @param {number} heightPx - Displayed height in CSS pixels; width follows the image's aspect ratio.
   * @returns {Promise<{data: ImageData, pixelRatio: number}>}
   */
  static async #rasterizeIcon(url, heightPx) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const h = heightPx * 2;
    const w = Math.round((img.naturalWidth / img.naturalHeight) * h);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h), pixelRatio: 2 };
  }

  /**
   * Walks the explorer along the route from start to end — a playful preview, triggered by hovering/focusing the
   * Save button. One run at a time; the icon lingers at the end for a beat, then disappears.
   */
  #animateExplorer() {
    const feats = this.#streetsInRoute.features;
    const source = this.#map.getSource('route-explorer');
    if (this.#explorerRaf !== null || feats.length === 0 || !source) return;

    // Cumulative distance along the route's coordinates, for constant-speed interpolation.
    const coords = feats.flatMap((f) => f.geometry.coordinates);
    const cumDist = [0];
    for (let i = 1; i < coords.length; i++) {
      cumDist.push(cumDist[i - 1] + RouteGraph.distanceM(coords[i - 1], coords[i]));
    }
    const totalDist = cumDist[cumDist.length - 1];
    if (totalDist === 0) return;

    window.logWebpageActivity('RouteBuilder_RoutePreviewAnimation');
    let startTime = null;
    const step = (now) => {
      if (startTime === null) startTime = now;
      const t = Math.min((now - startTime) / RouteBuilder.EXPLORER_ANIMATION_MS, 1);
      const target = t * totalDist;
      let i = 1;
      while (i < cumDist.length - 1 && cumDist[i] < target) i++;
      const segT = (target - cumDist[i - 1]) / (cumDist[i] - cumDist[i - 1] || 1);
      const lng = coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * segT;
      const lat = coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * segT;
      source.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } }],
      });
      if (t < 1) {
        this.#explorerRaf = requestAnimationFrame(step);
      } else {
        this.#explorerRaf = null;
        setTimeout(() => {
          // Skip the cleanup if a new run started during the linger.
          if (this.#explorerRaf === null) source.setData({ type: 'FeatureCollection', features: [] });
        }, 500);
      }
    };
    this.#explorerRaf = requestAnimationFrame(step);
  }

  /** Stops the explorer animation and removes the icon (the route is being cleared or replaced). */
  #cancelExplorer() {
    if (this.#explorerRaf !== null) {
      cancelAnimationFrame(this.#explorerRaf);
      this.#explorerRaf = null;
    }
    this.#map.getSource('route-explorer')?.setData({ type: 'FeatureCollection', features: [] });
  }

  /**
   * Reverses the whole route's walking direction (swaps start and end).
   */
  #reverseRoute() {
    if (this.#waypoints.length < 2) return;
    this.#waypoints.reverse();
    this.#recompute();
  }

  /**
   * Undoes the last edit: removes the most recently added waypoint (and its segment). Empties the route once the
   * start is removed.
   */
  #undo() {
    if (this.#undoStack.pop() === null || this.#waypoints.length === 0) return;
    this.#waypoints.pop();
    if (this.#waypoints.length === 0) {
      this.#emptyRoute();
      this.#resetUI();
    } else {
      this.#recompute();
    }
  }

  /**
   * Clears #waypoints and all derived route state (drawn streets, flags, region lock). Does not touch the undo
   * stack or the panel/CTA — callers decide those.
   */
  #emptyRoute() {
    const map = this.#map;
    this.#chosenIds.forEach((id) => map.setFeatureState({ source: 'streets', id }, { chosen: false }));
    this.#chosenIds.clear();
    this.#waypoints = [];
    this.#streetsInRoute.features = [];
    map.getSource('streets-chosen').setData(this.#streetsInRoute);
    this.#updateEndpointFlags();
    this.#routePopover.close();
    this.#cancelExplorer();
    this.#unlockRegion();
    this.#updateStats();
  }

  /** Releases the region selection: hides its outline and brings the region-name labels back. */
  #unlockRegion() {
    if (this.#currRegionId !== null) {
      this.#map.setFeatureState({ source: 'neighborhoods', id: this.#currRegionId }, { current: false });
    }
    this.#currRegionId = null;
    if (this.#map.getLayer('neighborhoods-label')) {
      this.#map.setLayoutProperty('neighborhoods-label', 'visibility', 'visible');
    }
  }

  /**
   * Restores a route stashed in sessionStorage before a sign-in reload, then reopens the save modal.
   *
   * Runs once, after the map, neighborhoods, and streets have all rendered. The stash holds the saved street list
   * (not waypoints), so it's drawn directly; the user lands in the save flow rather than mid-edit.
   */
  #maybeRestorePendingRoute() {
    if (this.#status.pendingRouteRestored || !this.#status.mapLoaded
      || !this.#status.neighborhoodsRendered || !this.#status.streetsLoaded) return;

    this.#status.pendingRouteRestored = true;
    const pending = SaveModal.consumePendingRoute();
    if (!pending) return;

    const map = this.#map;
    const features = [];
    pending.streets.forEach((stashed) => {
      const orig = this.#streetData.features.find((s) => s.properties.street_edge_id === stashed.street_id);
      if (!orig) return;
      const coords = orig.geometry.coordinates.slice();
      if (stashed.reverse === true) coords.reverse();
      features.push({
        type: 'Feature',
        properties: { street_edge_id: orig.properties.street_edge_id, region_id: orig.properties.region_id,
          reverse: stashed.reverse === true },
        geometry: { type: 'LineString', coordinates: coords },
      });
      map.setFeatureState({ source: 'streets', id: orig.properties.street_edge_id }, { chosen: true });
      this.#chosenIds.add(orig.properties.street_edge_id);
    });
    if (features.length === 0) return;

    this.#selectRegion(features[0].properties.region_id, false);
    this.#streetsInRoute.features = features;
    map.getSource('streets-chosen').setData(this.#streetsInRoute);
    this.#setPanelState('building');
    this.#updateEndpointFlags();
    this.#updateStats();
    this.#directionsPanel.setEndVisible(true);
    this.#updateCta();
    this.#saveModal.open(pending.name || null);
  }

  /** Shows the delete-route confirmation modal. */
  #openDeleteConfirm() {
    this.#deleteRouteModal.style.visibility = 'visible';
  }

  #clickCancelRoute() {
    window.logWebpageActivity('RouteBuilder_Click=CancelRoute');
    this.#openDeleteConfirm();
  }

  #clickResumeRoute() {
    window.logWebpageActivity('RouteBuilder_Click=ResumeRoute');
    this.#deleteRouteModal.style.visibility = 'hidden';
  }

  /**
   * Clears the current route and resets the map to the intro state.
   * @param {Event} [e]
   */
  #clearRoute(e) {
    this.#emptyRoute();
    this.#undoStack.clear();
    this.#resetUI();

    if (e && e.target && e.target.id === 'delete-route-button') {
      window.logWebpageActivity('RouteBuilder_Click=ConfirmCancelRoute');
    } else if (e && e.target && e.target.id === 'build-new-route-button') {
      window.logWebpageActivity('RouteBuilder_Click=BuildNewRoute');
    }
  }

  #resetUI() {
    this.#setPanelState('empty');
    this.#routeSavedModal.style.visibility = 'hidden';
    this.#deleteRouteModal.style.visibility = 'hidden';
    this.#saveModal.hide();
    this.#guestRoutes.render();
    this.#directionsPanel.clearFields();
    this.#directionsPanel.setEndVisible(false);
    this.#updateCta();
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
   * Returns the ordered street list for the route in the POST /saveRoute wire format. The route is already an
   * ordered, contiguous street sequence, so this is a direct map.
   * @returns {Array<{street_id: number, reverse: boolean}>}
   */
  #routeStreetsPayload() {
    return this.#streetsInRoute.features.map((s) => ({
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
