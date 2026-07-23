/**
 * RouteBuilder — the /routeBuilder page. Building is staged coarse-to-fine: the user first clicks the neighborhood
 * to build in (routes are constrained to one region, so the choice is made explicit and the map zooms to it), then
 * clicks points on the map — the first click drops a start (previewed by a ghost flag), and each further click
 * extends the route from the last point along an A* walking path over the street network (RouteGraph). Routes are
 * contiguous by construction. Clicking the drawn route opens a small action menu (RoutePopover: reverse / delete).
 * A slim Start/End address seed (DirectionsPanel) can plant the first two points, implicitly selecting the region.
 * The save flow lives in SaveModal; saved routes surface as cards on the intro panel (SavedRoutesPanel). The
 * in-progress route is drafted to sessionStorage so reloads (e.g. the sign-in round-trip) can't lose it.
 *
 * The route is defined entirely by #waypoints (ordered snapped points); the drawn streets, endpoint flags, and
 * stats are all derived from them by #recompute, so add / undo / reverse are just edits to that list followed by a
 * recompute.
 */
class RouteBuilder {
  /**
   * Resolves a design-system color token for Mapbox paint, which takes literal colors rather than CSS variables.
   * Same approach as ps-map's addStreetsToMap, so a token retune reaches every map in the app.
   *
   * @param {string} name - The CSS custom property, e.g. '--color-asphalt-500'.
   * @returns {string}
   */
  static #token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // Zoom eased to when the first point lands, close enough that the basemap renders street names for building.
  static BUILD_ZOOM = 15.5;
  // How far a clicked or geocoded point may be from a street and still snap to it. Generous enough for a click
  // aimed at a street or an address set back from one, tight enough that a point in another part of the city
  // doesn't silently attach to the nearest street of the selected neighborhood.
  static MAX_SNAP_DISTANCE_M = 250;
  // How long the explorer takes to walk the route in the preview animation.
  static EXPLORER_ANIMATION_MS = 2500;
  // How long the pointer rests on the drawn route before its action menu opens (discoverable but not twitchy).
  static ROUTE_MENU_HOVER_MS = 500;
  // How long the co-located next-step hint stays anchored to the newest flag.
  static HINT_DURATION_MS = 7000;
  // Storage key for the in-progress route draft. Resumed only on a page reload (see #isPageReload); a fresh visit
  // starts blank and clears it.
  static DRAFT_KEY = 'rb-route-draft';

  // Muted categorical tints cycled by region id, so adjacent neighborhoods read as visually distinct choices.
  static NEIGHBORHOOD_FILL_COLORS = ['#78C9AB', '#FBD98C', '#F29173', '#9F9DB1', '#78B0EA'];

  // Neighborhood paints by stage: while choosing, every region is washed and outlined so the map reads as a set of
  // clickable choices; once one is selected, only it stays outlined and the wash drops to a hover-only tint.
  static NEIGHBORHOOD_PAINT_CHOOSING = {
    fillOpacity: ['case', ['boolean', ['feature-state', 'hover'], false], 0.38, 0.18],
    lineOpacity: 0.4,
  };

  static NEIGHBORHOOD_PAINT_SELECTED = {
    fillOpacity: ['case', ['boolean', ['feature-state', 'hover'], false], 0.15, 0.0],
    lineOpacity: ['case', ['boolean', ['feature-state', 'current'], false], 0.5, 0.0],
  };

  #status = {
    mapLoaded: false,
    neighborhoodsRendered: false, // Neighborhood source/layers have been added to the map.
    streetsRendered: false, // Street source/layers/handlers have been added to the map.
    pendingRouteRestored: false,
  };

  #units;
  #minutesPer100m;

  #mapboxApiKey;
  #map;
  #cityView; // The city's default {center, zoom}, for resetting the camera when starting over.
  #isSignedIn;

  // Route state. The route is #waypoints plus the resolved street list of each leg between them (#segments);
  // the drawn streets, endpoint flags, and stats are derived from those.
  #neighborhoodData = null;
  #currRegionId = null;
  #streetData = null;
  #streetsInRoute = null; // The 'streets-chosen' GeoJSON source: cloned, oriented street features for the route.
  #waypoints = []; // Ordered [{ lng, lat }] snapped points the user clicked/seeded.
  #segments = []; // Per leg (waypoint i -> i+1), the resolved [{ streetId, flip }] in walking order.
  #loadSeq = 0; // Saved-route load counter, so only the newest load may draw (see #loadRouteForEditing).
  #chosenIds = new Set(); // Street ids currently drawn (their 'chosen' feature-state hides the base street).
  #endpointData = { type: 'FeatureCollection', features: [] }; // The 'route-endpoints' symbol source (flags).
  #routeGraph = null; // Built from #streetData as soon as it arrives (the ghost flag needs it pre-click).
  #ghostRaf = null; // Pending requestAnimationFrame id for the ghost-flag update.
  #ghostLngLat = null; // Latest mouse position awaiting a ghost-flag update.
  #explorerRaf = null; // Pending requestAnimationFrame id for the save-hover explorer animation.
  #hintPopup = null; // The next-step hint anchored at the newest flag (null when not showing).
  #hintTimeout = null; // Auto-hide timer for #hintPopup.
  #cursorGuide = null; // The pointer-following what-a-click-does bubble (created lazily).
  #editingRouteId = null; // The saved route loaded in the editor (null while building a brand-new route).
  #savedBaseline = null; // JSON of #routeStreetsPayload() at the last save/load; differing payload = unsaved edits.

  // Collaborators.
  #saveModal;
  #savedRoutes;
  #undoStack;
  #directionsPanel;
  #routePopover;

  // DOM elements.
  #panel;
  #ctaEl;
  #deleteRouteModal;
  #streetDistanceEl;
  #routeTimeEl;
  #statsCaptionEl;
  #routeStatsEl;
  #saveButton;
  #previewButton;
  #defaultSaveLabel;
  #deleteTitleEl;
  #deleteExplanationEl;
  #deleteConfirmButton;
  #defaultDeleteCopy;

  /**
   * @param {string} mapboxApiKey
   * @param {Object} mapParams - City center/boundaries/zoom for initializing the map.
   * @param {boolean} isSignedIn - Whether the user is signed in (vs anonymous), from the server.
   * @param {number} minutesPer100m - The city's labeling pace (minutes per 100 m), for the exploration-time
   *   estimate; server-provided (ConfigService.getCityLabelingSpeed).
   */
  constructor(mapboxApiKey, mapParams, isSignedIn, minutesPer100m) {
    this.#mapboxApiKey = mapboxApiKey;
    this.#isSignedIn = isSignedIn === true;
    this.#units = i18next.t('common:unit-distance');
    this.#minutesPer100m = minutesPer100m;

    // Get the DOM elements.
    this.#panel = document.getElementById('routebuilder-panel');
    this.#ctaEl = document.getElementById('routebuilder-cta');
    this.#deleteRouteModal = document.getElementById('delete-route-modal-backdrop');
    this.#streetDistanceEl = document.getElementById('route-length-val');
    this.#routeTimeEl = document.getElementById('route-time-val');
    this.#statsCaptionEl = document.getElementById('route-stats-caption');
    this.#routeStatsEl = document.getElementById('route-stats');
    this.#saveButton = document.getElementById('save-button');
    this.#previewButton = document.getElementById('preview-button');
    this.#defaultSaveLabel = this.#saveButton.textContent;
    this.#deleteTitleEl = document.getElementById('delete-route-title');
    this.#deleteExplanationEl = document.getElementById('delete-route-explanation');
    this.#deleteConfirmButton = document.getElementById('delete-route-button');
    // The confirm modal's server-rendered copy is for the brand-new-route case; editing swaps it (and back).
    this.#defaultDeleteCopy = {
      title: this.#deleteTitleEl.textContent,
      explanation: this.#deleteExplanationEl.textContent,
      button: this.#deleteConfirmButton.textContent,
    };

    // Wire the route-management buttons.
    document.getElementById('cancel-button').addEventListener('click', () => this.#clickCancelRoute());
    // Clears everything so the user can start a fresh route (confirming first if unsaved work would be lost),
    // zooming back out to the city view so the neighborhood choice is on screen.
    document.getElementById('new-route-button').addEventListener('click', async () => {
      window.logWebpageActivity('RouteBuilder_Click=NewRoute');
      if (!(await this.#unsavedWorkConfirmed())) return;
      this.#exitEditSession();
      this.#map.flyTo({ center: this.#cityView.center, zoom: this.#cityView.zoom, duration: 1200 });
    });
    document.getElementById('delete-route-button').addEventListener('click', () => this.#clearRoute());
    document.getElementById('cancel-delete-route-button').addEventListener('click', () => this.#clickResumeRoute());
    this.#initEstTimeTooltip();

    this.#saveModal = new SaveModal({
      isSignedIn: this.#isSignedIn,
      getRegionId: () => this.#currRegionId,
      getStreetsPayload: () => this.#routeStreetsPayload(),
      getSuggestedName: () => this.#suggestedRouteName(),
      getCamera: () => this.#cameraSnapshot(),
      onSaved: (saved) => this.#handleRouteSaved(saved),
      onClose: () => this.#saveButton.focus(),
    });
    this.#savedRoutes = new SavedRoutesPanel({
      isSignedIn: this.#isSignedIn,
      formatMeta: (distanceMeters, regionName) => this.#formatRouteMeta(distanceMeters, regionName),
      setTemporaryTooltip: (btn, message) => this.#setTemporaryTooltip(btn, message),
      onView: (routeId) => this.#loadRouteForEditing(routeId),
    });
    this.#savedRoutes.refresh();

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
    this.#cityView = { center: [mapParams.city_center.lng, mapParams.city_center.lat], zoom: mapParams.default_zoom };
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
      // Each render is isolated so a failure in one can't silently block the other from ever wiring up.
      this.#status.mapLoaded = true;
      if (this.#neighborhoodData !== null) {
        try {
          this.#renderNeighborhoodsHelper();
        } catch (e) {
          console.error('Failed to render neighborhoods:', e);
        }
      }
      if (this.#streetData !== null) {
        try {
          this.#renderStreetsHelper();
        } catch (e) {
          console.error('Failed to render streets:', e);
        }
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
      onSetStart: (lngLat) => this.#setStartFromAddress(lngLat),
      onSetEnd: (lngLat) => this.#addWaypoint(lngLat, 'AddressEnd'),
    });
    this.#routePopover = new RoutePopover(this.#map, () => this.#reverseRoute(), () => this.#openDeleteConfirm());

    // A brand-new route saves through the name modal; a loaded saved route updates in place, Word-style.
    this.#saveButton.addEventListener('click', () => {
      if (this.#editingRouteId !== null) {
        this.#updateSavedRoute();
      } else {
        this.#saveModal.open();
      }
    });
    // A playful preview: the explorer walks the route from start to end.
    this.#previewButton.addEventListener('click', () => {
      window.logWebpageActivity('RouteBuilder_Click=PreviewRoute');
      this.#animateExplorer();
    });

    document.getElementById('poi-toggle-checkbox')?.addEventListener('change', (e) => {
      window.logWebpageActivity(`RouteBuilder_Click=TogglePois_Visible=${e.target.checked}`);
      this.#setPoiVisibility(e.target.checked);
    });

    // The draft is written on route edits, but the camera moves without edits — rewrite it as the page unloads
    // so a reload restores the exact view the user left.
    window.addEventListener('pagehide', () => this.#saveDraft());

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

  /**
   * Wires the estimate's info tooltip to show on hover, keyboard focus, and click/tap, dismissing on mouse-out,
   * blur, Escape, or an outside click. A native `title` (the prior affordance) never opens on click and isn't
   * reachable by keyboard or touch; this follows the ARIA tooltip pattern (focusable trigger + aria-describedby).
   */
  #initEstTimeTooltip() {
    const val = this.#routeTimeEl;
    const tip = document.getElementById('route-time-tip');
    if (!val || !tip) return;
    const show = () => {
      tip.hidden = false;
    };
    const hide = () => {
      tip.hidden = true;
    };
    val.addEventListener('mouseenter', show);
    val.addEventListener('mouseleave', hide);
    val.addEventListener('focus', show);
    val.addEventListener('blur', hide);
    val.addEventListener('click', show);
    val.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hide();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        show();
      }
    });
    // A tap/click outside the estimate closes a tip opened by tap, where there's no mouse-out to dismiss it.
    document.addEventListener('click', (e) => {
      if (!val.contains(e.target)) hide();
    });
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
   * Updates the on-map call-to-action for the pre-route stages: pick a neighborhood, then a start point. Once the
   * route has started, guidance moves to the hint anchored at the newest flag (#showHint) and the pill hides.
   */
  #updateCta() {
    if (!this.#ctaEl) return;
    if (!this.#routeStarted()) {
      const key = this.#currRegionId === null ? 'cta-select-region' : 'cta-pick-start';
      this.#ctaEl.innerHTML = `
        <img src="/assets/images/icons/routebuilder/flag-start.svg" class="cta-flag" alt="">
        <span>${i18next.t(key)}</span>`;
      this.#ctaEl.hidden = false;
    } else {
      this.#ctaEl.hidden = true;
    }
  }

  /**
   * Shows a transient next-step hint anchored beside a route point, so guidance sits where the user is already
   * looking instead of in the far-away top-center pill.
   *
   * @param {Array<number>} coord - [lng, lat] to anchor at (the newest flag).
   * @param {string} text
   */
  #showHint(coord, text) {
    this.#hideHint();
    this.#hintPopup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      anchor: 'left',
      offset: 18,
      maxWidth: '260px',
      className: 'rb-map-hint',
    }).setLngLat(coord).setText(text).addTo(this.#map);
    this.#hintTimeout = setTimeout(() => this.#hideHint(), RouteBuilder.HINT_DURATION_MS);
  }

  /** Removes the next-step hint (if showing). */
  #hideHint() {
    clearTimeout(this.#hintTimeout);
    this.#hintTimeout = null;
    this.#hintPopup?.remove();
    this.#hintPopup = null;
  }

  /**
   * Renders the neighborhoods: an invisible fill that acts as the hover/click target while choosing where to
   * build (lightly tinted on hover), name labels shown only during that choice, and a solid outline drawn for the
   * selected region alone — boundaries stay off the map otherwise to keep the visual noise down.
   */
  #renderNeighborhoodsHelper() {
    const map = this.#map;
    // Precompute each region's tint as a property — plain data beats a computed style expression here.
    this.#neighborhoodData.features.forEach((feature) => {
      const colors = RouteBuilder.NEIGHBORHOOD_FILL_COLORS;
      feature.properties.fill_color = colors[Math.abs(feature.properties.region_id) % colors.length];
    });
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
        'fill-color': ['get', 'fill_color'],
        'fill-opacity': RouteBuilder.NEIGHBORHOOD_PAINT_CHOOSING.fillOpacity,
      },
    });
    map.addLayer({
      id: 'neighborhoods-outline',
      type: 'line',
      source: 'neighborhoods',
      paint: {
        'line-color': RouteBuilder.#token('--color-asphalt-500'),
        'line-width': ['case', ['boolean', ['feature-state', 'current'], false], 2, 1.5],
        'line-opacity': RouteBuilder.NEIGHBORHOOD_PAINT_CHOOSING.lineOpacity,
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
        'text-color': RouteBuilder.#token('--color-asphalt-500'),
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
    map.setPaintProperty('neighborhoods-fill', 'fill-opacity', RouteBuilder.NEIGHBORHOOD_PAINT_SELECTED.fillOpacity);
    map.setPaintProperty(
      'neighborhoods-outline', 'line-opacity', RouteBuilder.NEIGHBORHOOD_PAINT_SELECTED.lineOpacity,
    );
    // Mousemove doesn't fire during the zoom animation, so drop the stale pointer feedback now.
    this.#clearGhostStart();
    this.#setCursorGuide(null);

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
        // Quiet neutral base network; the ghost flag (not a street highlight) previews where a click lands.
        'line-color': RouteBuilder.#token('--color-neutral-500'),
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

      // Ghost flag: a translucent preview of exactly where the next click lands — the start flag before the route
      // begins, the end flag while extending it.
      map.addSource('ghost-start', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'ghost-start',
        type: 'symbol',
        source: 'ghost-start',
        layout: {
          'icon-image': ['concat', 'routebuilder-', ['get', 'kind'], '-flag'],
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
          'text-color': RouteBuilder.#token('--color-asphalt-500'),
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

    // Resting the pointer on the drawn route opens its action menu (so it's discoverable without knowing to
    // click); clicking opens it immediately, with keyboard focus.
    let routeHoverTimer = null;
    map.on('mousemove', 'streets-chosen', (event) => {
      // The menu edits the in-progress route; a previewed/restored saved route (no waypoints) has no menu.
      if (this.#waypoints.length === 0) return;
      map.getCanvas().style.cursor = 'pointer';
      if (this.#routePopover.isOpen()) return;
      clearTimeout(routeHoverTimer);
      const lngLat = event.lngLat;
      routeHoverTimer = setTimeout(() => {
        if (this.#routePopover.isOpen() || this.#waypoints.length === 0) return;
        window.logWebpageActivity('RouteBuilder_Hover=RouteMenu_Open');
        this.#routePopover.open(lngLat);
      }, RouteBuilder.ROUTE_MENU_HOVER_MS);
    });
    map.on('mouseleave', 'streets-chosen', () => {
      clearTimeout(routeHoverTimer);
      map.getCanvas().style.cursor = '';
    });
    map.on('mousemove', (event) => this.#onMapPointerMove(event.lngLat));
    map.on('mouseout', () => {
      this.#clearGhostStart();
      this.#setCursorGuide(null);
    });

    // Click handling follows the staged flow. On the drawn route: open the reverse/delete menu (a small pixel box
    // around the click gives the thin line a comfortable hit target). Before any point exists: clicking a
    // neighborhood selects it (clicking a different one moves the selection); clicking inside the selected one
    // plants the start. After that, clicks extend the route.
    map.on('click', (event) => {
      const { x, y } = event.point;
      const onRoute = this.#waypoints.length > 0
        && map.queryRenderedFeatures([[x - 6, y - 6], [x + 6, y + 6]], { layers: ['streets-chosen'] }).length > 0;
      if (onRoute) {
        window.logWebpageActivity('RouteBuilder_Click=RouteMenu_Open');
        this.#routePopover.open(event.lngLat, true);
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

    this.#status.streetsRendered = true;
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
   * Returns the region id whose neighborhood polygon contains a coordinate, or null if none does.
   *
   * Tests the loaded polygons rather than what the map has rendered, so it answers for points outside the
   * current viewport too — a geocoded address in another neighborhood is exactly the case that must not read as
   * "no region" and slip past the one-neighborhood rule.
   *
   * @param {Object} lngLat - {lng, lat}.
   * @returns {number|null}
   */
  #regionIdContaining(lngLat) {
    const region = this.#neighborhoodData?.features.find(
      (f) => turf.booleanPointInPolygon([lngLat.lng, lngLat.lat], f),
    );
    return region ? region.properties.region_id : null;
  }

  /**
   * Pointer pipeline for the map (rAF-throttled — snapping scans the street network, so at most one pass per
   * frame): keeps the ghost flag (where the next click lands) and the cursor guide (what the next click does) in
   * sync with the mouse.
   *
   * @param {Object} lngLat - The mouse position {lng, lat}.
   */
  #onMapPointerMove(lngLat) {
    this.#ghostLngLat = lngLat;
    if (this.#ghostRaf !== null) return;
    this.#ghostRaf = requestAnimationFrame(() => {
      this.#ghostRaf = null;
      const point = this.#map.project(this.#ghostLngLat);
      const hoverRegionId = this.#regionIdAtPoint(point);
      this.#updateGhost(hoverRegionId);
      this.#updateCursorGuide(hoverRegionId, point);
    });
  }

  /**
   * Moves the ghost flag to the intersection nearest the mouse. Once a neighborhood is selected this is the click
   * affordance: a translucent start flag before the first point, then a translucent end flag while extending.
   * Snapping is restricted to the selected region; hovering a different region shows a not-allowed cursor once the
   * route is locked there.
   *
   * @param {number|null} hoverRegionId - Region under the pointer, if any.
   */
  #updateGhost(hoverRegionId) {
    const source = this.#map.getSource('ghost-start');
    if (!source || this.#currRegionId === null || !this.#routeGraph) return;
    if (this.#routeStarted() && hoverRegionId !== null && hoverRegionId !== this.#currRegionId) {
      this.#clearGhostStart();
      this.#map.getCanvas().style.cursor = 'not-allowed';
      return;
    }
    if (this.#map.getCanvas().style.cursor === 'not-allowed') this.#map.getCanvas().style.cursor = '';

    const snap = this.#routeGraph.snapToStreet(this.#ghostLngLat, this.#currRegionId);
    if (!snap) return;
    const kind = this.#routeStarted() ? 'end' : 'start';
    source.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: { kind }, geometry: { type: 'Point', coordinates: snap.nodeLngLat },
      }],
    });
  }

  /**
   * The cursor guide: a small bubble following the pointer that says what a click here does — pick or switch a
   * neighborhood (named), start the route, or set the end point. It retires once the mechanic is demonstrably
   * learned (2+ points) and stays out of the way of the drawn route's own menu.
   *
   * @param {number|null} hoverRegionId - Region under the pointer, if any.
   * @param {Object} point - Screen {x, y} of the pointer.
   */
  #updateCursorGuide(hoverRegionId, point) {
    let text = null;
    const overRoute = this.#streetsInRoute !== null && this.#streetsInRoute.features.length > 0
      && this.#map.queryRenderedFeatures([[point.x - 6, point.y - 6], [point.x + 6, point.y + 6]],
        { layers: ['streets-chosen'] }).length > 0;
    if (!overRoute && !this.#routePopover.isOpen()) {
      if (!this.#routeStarted()) {
        if (hoverRegionId !== null && hoverRegionId !== this.#currRegionId) {
          text = i18next.t('guide-select-region', { region: this.#getRegionName(hoverRegionId) ?? '' });
        } else if (hoverRegionId !== null) {
          text = i18next.t('guide-pick-start');
        }
      } else if (this.#waypoints.length === 1 && hoverRegionId === this.#currRegionId) {
        text = i18next.t('guide-pick-end');
      }
    }
    this.#setCursorGuide(text);
  }

  /**
   * Shows the pointer-following guide bubble with the given text, or hides it when null.
   * @param {string|null} text
   */
  #setCursorGuide(text) {
    if (text === null) {
      this.#cursorGuide?.remove();
      return;
    }
    if (!this.#cursorGuide) {
      this.#cursorGuide = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        maxWidth: '260px',
        offset: 30, // Large enough that the bubble clears the ghost flag sitting at the snapped intersection.
        className: 'rb-cursor-guide',
      }).trackPointer();
    }
    this.#cursorGuide.setText(text);
    if (!this.#cursorGuide.isOpen()) this.#cursorGuide.addTo(this.#map);
  }

  /** Hides the ghost flag (mouse left the map, or the click just landed). */
  #clearGhostStart() {
    this.#map.getSource('ghost-start')?.setData({ type: 'FeatureCollection', features: [] });
  }

  /**
   * @param {Object} streetDataIn - GeoJSON of the city's streets.
   */
  renderStreets(streetDataIn) {
    this.#streetData = streetDataIn;
    // If the map already loaded, it's safe to render streets now. O/w they will load after the map does.
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
    if (!this.#status.neighborhoodsRendered || this.#streetData === null || this.#streetsInRoute === null) return;
    // A route restored for the post-sign-in save flow is drawn but has no waypoints; a fresh click starts over
    // rather than leaving the (waypoint-derived) route and the drawn streets out of sync.
    if (this.#waypoints.length === 0 && this.#streetsInRoute.features.length > 0) this.#emptyRoute();
    const graph = this.#getRouteGraph();

    // Region rule: a point in a different neighborhood than the selected one is refused (with a toast). The
    // polygon under the point decides, and snapping is restricted to the selected region, so a point near a
    // boundary can't silently slip across it.
    const pointRegionId = this.#regionIdContaining(lngLat);
    if (this.#currRegionId !== null && pointRegionId !== null && pointRegionId !== this.#currRegionId) {
      this.#showMapMessage(i18next.t('one-neighborhood-warning'));
      window.logWebpageActivity(`RouteBuilder_AddWaypoint=DifferentRegion_Source=${source}`);
      return;
    }
    // Capped: an address the geocoder places outside the selected neighborhood would otherwise snap to whatever
    // street of it happens to be nearest, silently extending the route to somewhere the user never pointed at.
    const snap = graph.snapToStreet(lngLat, this.#currRegionId, RouteBuilder.MAX_SNAP_DISTANCE_M);
    if (!snap) {
      this.#showMapMessage(i18next.t('no-street-nearby'));
      window.logWebpageActivity(`RouteBuilder_AddWaypoint=NoStreetNearby_Source=${source}`);
      return;
    }
    // An address-seeded first point selects its region implicitly (no zoom-to-fit; we ease to the point below).
    if (this.#currRegionId === null) this.#selectRegion(snap.regionId, false);

    const point = { lng: snap.nodeLngLat[0], lat: snap.nodeLngLat[1] };
    // A non-first point must be reachable from the current end along the street network. The leg this finds is
    // the leg we keep — re-deriving it during the redraw would be both wasted work and a chance to diverge.
    let newSegment = null;
    if (this.#waypoints.length > 0) {
      const result = graph.route(this.#waypoints[this.#waypoints.length - 1], point, this.#currRegionId);
      if (result.error) {
        this.#showMapMessage(i18next.t('no-path-error'));
        window.logWebpageActivity(`RouteBuilder_AddWaypoint=NoPath_Source=${source}`);
        return;
      }
      newSegment = result.streets;
    }

    this.#waypoints.push(point);
    if (newSegment !== null) this.#segments.push(newSegment);
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
    this.#setCursorGuide(null); // Stale until the next pointer move re-evaluates it for the new stage.
    // The one static hint: right after the end point lands, reassure that the route isn't capped at two clicks.
    if (this.#waypoints.length === 2) {
      this.#showHint([point.lng, point.lat], i18next.t('hint-extend'));
    }
    window.logWebpageActivity(`RouteBuilder_AddWaypoint=Success_Count=${this.#waypoints.length}_Source=${source}`);
  }

  /**
   * Redraws every derived piece of state (drawn streets, endpoint flags, stats, direction-panel fields, CTA) from
   * #segments. The street features are cloned from the source data and oriented to the walking direction, so the
   * originals are never mutated.
   *
   * This does no routing. Each leg is resolved once, when it is created (#addWaypoint) or read back from a saved
   * route, and then carried verbatim — so what is drawn is always exactly the street list that will be saved.
   * Re-routing here instead would mean a saved route's own streets are only ever a suggestion: a street the graph
   * can't represent would silently vanish, and a parallel street sharing both endpoints could silently take
   * another's place, on every load and every subsequent edit.
   */
  #recompute() {
    const map = this.#map;
    this.#hideHint(); // Any old next-step hint is anchored to a point that may just have moved or vanished.
    this.#clearChosenStates();

    const features = [];
    this.#segments.flat().forEach(({ streetId, flip }) => {
      const orig = this.#getRouteGraph().getFeature(streetId);
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
    this.#streetsInRoute.features = features;
    map.getSource('streets-chosen').setData(this.#streetsInRoute);

    this.#updateEndpointFlags();
    this.#updateStats();
    this.#syncDirectionsFields();
    this.#directionsPanel.setEndVisible(this.#routeStarted());
    this.#updateCta();
    this.#saveDraft();
  }

  /**
   * Plants the route's first point from an address typed into the Start field.
   *
   * Every waypoint is appended to the route's tail, so once a route exists there is no such thing as "setting the
   * start" — feeding the typed point through would extend the route to it and flag it as the finish, the exact
   * opposite of what the field says it does. Rather than silently reinterpret it, say the route has to be cleared.
   *
   * @param {Object} lngLat - {lng, lat} of the geocoded address.
   */
  #setStartFromAddress(lngLat) {
    if (this.#waypoints.length > 0) {
      this.#showMapMessage(i18next.t('start-locked-warning'));
      this.#syncDirectionsFields(); // Put the route's real start back in the field the user just overwrote.
      window.logWebpageActivity('RouteBuilder_AddWaypoint=StartLocked_Source=AddressStart');
      return;
    }
    this.#addWaypoint(lngLat, 'AddressStart');
  }

  /**
   * Clears the 'chosen' feature-state of every currently drawn street, so base streets hidden underneath the
   * route reappear once they leave it.
   */
  #clearChosenStates() {
    this.#chosenIds.forEach((id) => this.#map.setFeatureState({ source: 'streets', id }, { chosen: false }));
    this.#chosenIds.clear();
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
   * Updates the stats block in the planner card: a headline of estimated exploration time (distance x the city's
   * labeling pace) and distance, with a street-count + neighborhood caption below. Cleared when the route is empty.
   */
  #updateStats() {
    const feats = this.#streetsInRoute.features;
    // A lone start point isn't a route yet: no stats to show, nothing to save.
    const hasRoute = feats.length > 0;
    this.#routeStatsEl.hidden = !hasRoute;
    this.#updateSaveButton();
    if (!hasRoute) {
      this.#streetDistanceEl.innerText = '';
      this.#routeTimeEl.innerText = '';
      this.#statsCaptionEl.textContent = '';
      return;
    }

    // RouteGraph measured every street once when it was built, so re-measuring the route's geometry on each
    // redraw would be repeating that work for the whole route on every click.
    const graph = this.#getRouteGraph();
    const km = this.#segments.flat().reduce((sum, { streetId }) => sum + graph.getLengthM(streetId), 0) / 1000;
    this.#streetDistanceEl.innerText = this.#formatDistance(km);
    this.#routeTimeEl.innerText = this.#formatEstTime(km);

    const regionName = this.#getRegionName(this.#currRegionId);
    this.#statsCaptionEl.textContent = regionName
      ? i18next.t('street-count-in-region', { count: feats.length, region: regionName })
      : i18next.t('street-count', { count: feats.length });
  }

  /**
   * Whether the loaded saved route has edits that haven't been written back to the database.
   * @returns {boolean}
   */
  #isDirty() {
    return this.#editingRouteId !== null
      && JSON.stringify(this.#routeStreetsPayload()) !== this.#savedBaseline;
  }

  /**
   * Keeps the save button's label and enabled state in sync with the editing state: "Save route" for a new
   * route, "Update route" for a loaded route with unsaved edits, and a disabled "Saved" once written back.
   * Also mirrors the editing state onto the planner card, which shows the saved-route cards while a saved
   * route is open so the just-saved/loaded route is visible in the panel.
   */
  #updateSaveButton() {
    this.#panel.dataset.editing = this.#editingRouteId !== null;
    const hasRoute = (this.#streetsInRoute?.features.length ?? 0) > 0;
    this.#previewButton.disabled = !hasRoute;
    if (this.#editingRouteId === null) {
      this.#saveButton.textContent = this.#defaultSaveLabel;
      this.#saveButton.disabled = !hasRoute;
    } else if (this.#isDirty()) {
      this.#saveButton.textContent = i18next.t('save-update');
      this.#saveButton.disabled = !hasRoute;
    } else {
      this.#saveButton.textContent = i18next.t('save-saved');
      this.#saveButton.disabled = true;
    }
  }

  /**
   * Formats a route length in the user's display units, e.g. "0.48 mi".
   * @param {number} km
   * @returns {string}
   */
  #formatDistance(km) {
    const dist = this.#units === 'miles' ? util.math.kmsToMiles(km) : km;
    return i18next.t('route-length', { dist: dist.toFixed(2) });
  }

  /**
   * Formats the estimated exploration time for a route length, e.g. "~31 min" or "~1 hr 5 min".
   * @param {number} km
   * @returns {string}
   */
  #formatEstTime(km) {
    const minutes = Math.max(1, Math.round((km * 1000 / 100) * this.#minutesPer100m));
    return minutes < 60
      ? i18next.t('est-time-minutes', { min: minutes })
      : i18next.t('est-time-hours', { hours: Math.floor(minutes / 60), min: minutes % 60 });
  }

  /**
   * One-line meta description for a saved-route card: distance, estimated exploration time, and neighborhood.
   *
   * @param {number} distanceMeters
   * @param {string|null} regionName
   * @returns {string}
   */
  #formatRouteMeta(distanceMeters, regionName) {
    const km = distanceMeters / 1000;
    return [this.#formatDistance(km), this.#formatEstTime(km), regionName].filter(Boolean).join(' · ');
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
   * Walks the explorer along the route from start to end — a playful preview, triggered by the Preview button.
   * One run at a time; the icon lingers at the end for a beat, then disappears.
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
   *
   * The existing streets are reversed in place rather than re-routed, so a reversal can't quietly pick a
   * different path back, and undoing one is exact.
   */
  #reverseRoute() {
    if (this.#waypoints.length < 2) return;
    this.#applyReverse();
    this.#undoStack.push({ type: 'reverse' });
    this.#recompute();
  }

  /** Flips the route end-to-end: waypoint order, leg order, and each leg's street order and direction. */
  #applyReverse() {
    this.#waypoints.reverse();
    this.#segments.reverse();
    this.#segments = this.#segments.map(
      (segment) => segment.slice().reverse().map(({ streetId, flip }) => ({ streetId, flip: !flip })),
    );
  }

  /**
   * Undoes the last edit: either the most recently added waypoint (and its leg) or a reversal. Empties the route
   * once the start is removed.
   */
  #undo() {
    const action = this.#undoStack.pop();
    if (action === null) return;
    if (action.type === 'reverse') {
      this.#applyReverse();
      this.#recompute();
      return;
    }
    if (this.#waypoints.length === 0) return;
    this.#waypoints.pop();
    this.#segments.pop();
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
    this.#clearChosenStates();
    this.#waypoints = [];
    this.#segments = [];
    this.#streetsInRoute.features = [];
    map.getSource('streets-chosen').setData(this.#streetsInRoute);
    this.#updateEndpointFlags();
    this.#routePopover.close();
    this.#cancelExplorer();
    this.#hideHint();
    this.#unlockRegion();
    this.#editingRouteId = null;
    this.#savedBaseline = null;
    this.#updateStats();
    this.#saveDraft();
    this.#savedRoutes.markActive(null);
  }

  /** Releases the region selection: back to the choosing stage (all regions washed/outlined, labels visible). */
  #unlockRegion() {
    const map = this.#map;
    if (this.#currRegionId !== null) {
      map.setFeatureState({ source: 'neighborhoods', id: this.#currRegionId }, { current: false });
    }
    this.#currRegionId = null;
    if (map.getLayer('neighborhoods-label')) {
      map.setLayoutProperty('neighborhoods-label', 'visibility', 'visible');
      map.setPaintProperty('neighborhoods-fill', 'fill-opacity', RouteBuilder.NEIGHBORHOOD_PAINT_CHOOSING.fillOpacity);
      map.setPaintProperty(
        'neighborhoods-outline', 'line-opacity', RouteBuilder.NEIGHBORHOOD_PAINT_CHOOSING.lineOpacity,
      );
    }
  }

  /**
   * Restores a route stashed in sessionStorage before a sign-in reload, then reopens the save modal. With no
   * stash, falls back to the in-progress draft (#restoreDraft) so a plain reload doesn't lose work either.
   *
   * Runs once, after the map, neighborhoods, and streets have all *rendered* — the streets-rendered gate matters:
   * drawing the route needs the 'streets-chosen' source, which doesn't exist while the street GeoJSON has merely
   * arrived.
   */
  #maybeRestorePendingRoute() {
    if (this.#status.pendingRouteRestored
      || !this.#status.neighborhoodsRendered || !this.#status.streetsRendered) return;

    this.#status.pendingRouteRestored = true;
    const pending = SaveModal.consumePendingRoute();
    if (!pending) {
      // Deep link from the dashboard's route cards: /routeBuilder?preview=<id> opens the route in the editor.
      const previewParam = new URLSearchParams(window.location.search).get('preview');
      const previewId = previewParam !== null && /^\d+$/.test(previewParam) ? Number(previewParam) : null;
      // A reload keeps the ?preview in the URL, so refreshing after editing the previewed route would refetch
      // the saved version and lose the edits — silently, since the unsaved-work check has nothing in memory to
      // notice yet, and re-loading destroys the draft before it's read. An edited draft for the same route wins.
      if (previewId !== null && RouteBuilder.#isPageReload() && this.#draftEditingRouteId() === previewId) {
        this.#restoreDraft();
      } else if (previewId !== null) {
        this.#loadRouteForEditing(previewId);
      } else if (RouteBuilder.#isPageReload()) {
        // Only a genuine reload (e.g. an accidental refresh) resumes the in-progress draft. Arriving fresh —
        // Tools -> RouteBuilder, a link, or returning after finishing a route — must start blank so the user never
        // unknowingly edits the route they just worked on. Drop the stale same-tab draft so a later reload of this
        // fresh page can't resurrect it either.
        this.#restoreDraft();
      } else {
        try {
          sessionStorage.removeItem(RouteBuilder.DRAFT_KEY);
        } catch {
          // Storage unavailable; nothing to clear.
        }
      }
      return;
    }

    const region = this.#regionOfFirstStreet(pending.streets);
    if (region === null) return;
    this.#selectRegion(region, false);
    if (this.#seedRouteFromStreets(pending.streets) === 0) return;
    this.#setPanelState('building');
    this.#applyCamera(pending.camera); // Back to the exact view the user left for the sign-in round trip.
    this.#saveModal.open(pending.name || null, pending.description || null);
  }

  /**
   * Adopts a stored street list as the current route: each street becomes its own leg, carried verbatim, with a
   * waypoint at every street boundary so further editing extends it exactly like a route clicked out by hand.
   *
   * The stored ids are trusted rather than re-routed between the endpoints. Re-routing loses information the
   * stored list has and the graph doesn't: a street whose endpoints merge into a single node has no edge at all
   * and would simply disappear, and where two streets connect the same pair of intersections the router can only
   * pick one, silently swapping the other out. Either way the damage is invisible and the next update writes it
   * back over the real route.
   *
   * @param {Array<{street_id: number, reverse: boolean}>} streets - Ordered streets in the /saveRoute wire format.
   * @returns {number} How many of the streets resolved against the loaded street data (0 = nothing to draw).
   */
  #seedRouteFromStreets(streets) {
    const graph = this.#getRouteGraph();
    const resolved = streets
      .map((stored) => ({ streetId: stored.street_id, flip: stored.reverse === true }))
      .filter(({ streetId }) => graph.getFeature(streetId) !== undefined);
    if (resolved.length === 0) return 0;

    this.#segments = resolved.map((street) => [street]);
    this.#waypoints = this.#waypointsFromSegments();
    this.#recompute();
    return resolved.length;
  }

  /**
   * The waypoint chain for the current legs: the first street's start, then the end of each leg in walking order.
   * Keeps the waypoints.length === segments.length + 1 invariant the editing actions rely on.
   *
   * @returns {Array<{lng: number, lat: number}>}
   */
  #waypointsFromSegments() {
    if (this.#segments.length === 0) return [];
    const legEnds = this.#segments.map((segment) => {
      const last = segment[segment.length - 1];
      const coords = this.#orientedCoords(last);
      return coords[coords.length - 1];
    });
    const start = this.#orientedCoords(this.#segments[0][0])[0];
    return [start, ...legEnds].map(([lng, lat]) => ({ lng, lat }));
  }

  /**
   * The region of the first stored street that exists in the loaded street data.
   *
   * @param {Array<{street_id: number}>} streets - Stored streets in the /saveRoute wire format.
   * @returns {?number} null when none of them resolve, which means there is no route left to draw.
   */
  #regionOfFirstStreet(streets) {
    for (const stored of streets) {
      const feature = this.#getRouteGraph().getFeature(stored.street_id);
      if (feature) return feature.properties.region_id;
    }
    return null;
  }

  /** A street's coordinates in the route's walking direction (a copy when flipped; never mutates the source). */
  #orientedCoords({ streetId, flip }) {
    const coords = this.#getRouteGraph().getFeature(streetId).geometry.coordinates;
    return flip ? coords.slice().reverse() : coords;
  }

  /**
   * Confirms with the user before an action that would discard unsaved work: edits to a loaded saved route, or a
   * drawn-but-never-saved route. No-ops (resolves true) when nothing would be lost.
   *
   * @returns {Promise<boolean>} True to proceed.
   */
  #unsavedWorkConfirmed() {
    const unsavedWork = this.#editingRouteId !== null
      ? this.#isDirty()
      : (this.#streetsInRoute?.features.length ?? 0) > 0;
    if (!unsavedWork) return Promise.resolve(true);
    return ConfirmDialog.confirm({
      message: i18next.t('unsaved-continue-confirm'),
      confirmText: i18next.t('common:continue'),
      cancelText: i18next.t('common:cancel'),
    });
  }

  /** Closes the editing session (or clears a new route), back to the intro state. The saved route is untouched. */
  #exitEditSession() {
    this.#emptyRoute();
    this.#undoStack.clear();
    this.#resetUI();
  }

  /**
   * Loads a saved route into the editor: its streets are drawn, its waypoints reconstructed, and further edits
   * update the same route in place. Clicking the already-loaded route's card closes the session instead.
   *
   * @param {number} routeId
   */
  async #loadRouteForEditing(routeId) {
    if (this.#editingRouteId === routeId) {
      if (!(await this.#unsavedWorkConfirmed())) return;
      window.logWebpageActivity('RouteBuilder_Click=ExitEditSession');
      this.#exitEditSession();
      return;
    }
    if (!(await this.#unsavedWorkConfirmed())) return;
    // Cards stay clickable while a load is in flight, and nothing else serializes two of them: the confirm above
    // sees no drawn route yet, so it doesn't ask. Without a token the last response wins rather than the last
    // click, and a slow first load would wipe the route the user actually asked for and leave them editing it.
    const loadId = ++this.#loadSeq;
    fetch(`/userapi/routes/${routeId}/streets`, { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data) => {
        if (!this.#status.streetsRendered || loadId !== this.#loadSeq) return;
        // Resolve the stored streets before touching anything: if none of them are in the loaded street data
        // (every street hidden, or the region closed, since the route was saved), the user keeps what they had
        // open and gets told, rather than silently losing it to a load that then draws nothing.
        const region = this.#regionOfFirstStreet(data.streets);
        if (region === null) {
          this.#showMapMessage(i18next.t('route-load-empty'));
          return;
        }
        this.#emptyRoute(); // Also closes any previous editing session.
        this.#undoStack.clear();
        this.#selectRegion(region, false);
        const drawn = this.#seedRouteFromStreets(data.streets);
        this.#setPanelState('building');
        // If streets were dropped (e.g. since hidden as low-quality), say so — the user is looking at, and will
        // save, the reduced route.
        if (drawn !== data.streets.length) {
          Toast.show({ message: i18next.t('route-adjusted'), duration: 4000 });
        }
        this.#editingRouteId = routeId;
        // The baseline is what's actually drawn, so an untouched load reads as clean.
        this.#savedBaseline = JSON.stringify(this.#routeStreetsPayload());
        this.#saveDraft();
        this.#savedRoutes.markActive(routeId);
        this.#updateSaveButton();
        const coords = this.#streetsInRoute.features.flatMap((f) => f.geometry.coordinates);
        this.#map.fitBounds(turf.bbox({ type: 'MultiPoint', coordinates: coords }),
          { padding: 80, maxZoom: 16, duration: 900 });
      })
      .catch((e) => {
        if (loadId !== this.#loadSeq) return;
        console.error('Failed to load the route for editing:', e);
        this.#showMapMessage(i18next.t('route-load-error'));
      });
  }

  /**
   * Writes the current street list back to the loaded saved route (PUT). The route keeps its id, slug, stats,
   * and share links; in-progress explorations reconcile server-side.
   */
  #updateSavedRoute() {
    const payload = this.#routeStreetsPayload();
    const routeId = this.#editingRouteId;
    window.logWebpageActivity(`RouteBuilder_Click=UpdateRoute_RouteId=${routeId}`);
    fetch(`/userapi/routes/${routeId}`, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ streets: payload }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`${response.status}`))))
      .then((updated) => {
        this.#savedBaseline = JSON.stringify(payload);
        this.#saveDraft();
        this.#updateSaveButton();
        // A guest's card list is localStorage, so refresh() alone would re-render the first save's numbers.
        if (!this.#isSignedIn) this.#recordGuestRoute(updated);
        this.#savedRoutes.refresh();
        Toast.show({ message: i18next.t('route-updated'), duration: 3000 });
        window.logWebpageActivity(`RouteBuilder_Click=UpdateSuccess_RouteId=${routeId}`);
      })
      .catch((e) => {
        // A 404 means the route isn't ours anymore (e.g. a guest whose anonymous session rotated).
        const gone = e.message === '404' || e.message === '403';
        this.#showMapMessage(i18next.t(gone ? 'route-update-gone' : 'save-error'));
        window.logWebpageActivity('RouteBuilder_Click=UpdateError');
      });
  }

  /**
   * The current map camera pose, in the shape mapbox-gl's jumpTo accepts (JSON-safe for the draft stash).
   * @returns {{center: Array<number>, zoom: number, bearing: number, pitch: number}}
   */
  #cameraSnapshot() {
    const center = this.#map.getCenter();
    return {
      center: [center.lng, center.lat],
      zoom: this.#map.getZoom(),
      bearing: this.#map.getBearing(),
      pitch: this.#map.getPitch(),
    };
  }

  /**
   * Restores a camera pose captured by #cameraSnapshot, so a reload puts the user back at the exact view they
   * left rather than a recomputed one.
   *
   * @param {Object} [camera] - A stashed #cameraSnapshot (possibly absent or corrupt — stashes cross reloads).
   * @returns {boolean} False when the pose was unusable, so the caller can fall back (e.g. to a fitBounds).
   */
  #applyCamera(camera) {
    const usable = Array.isArray(camera?.center) && camera.center.length === 2
      && camera.center.every(Number.isFinite) && Number.isFinite(camera.zoom);
    if (!usable) return false;
    this.#map.jumpTo({
      center: camera.center,
      zoom: camera.zoom,
      bearing: Number.isFinite(camera.bearing) ? camera.bearing : 0,
      pitch: Number.isFinite(camera.pitch) ? camera.pitch : 0,
    });
    return true;
  }

  /**
   * Persists the in-progress route (waypoints + region) to this tab's storage so a reload — including the sign-in
   * round-trip — can restore it. Cleared when the route empties.
   */
  #saveDraft() {
    try {
      if (this.#waypoints.length > 0) {
        sessionStorage.setItem(
          RouteBuilder.DRAFT_KEY,
          JSON.stringify({
            regionId: this.#currRegionId,
            waypoints: this.#waypoints,
            // The resolved legs, not just the waypoints: the route is never re-derived by routing, so a draft
            // that only stored waypoints would restore as an empty route.
            segments: this.#segments,
            // The editing session too, so a reload resumes updating the same route instead of saving a copy.
            editingRouteId: this.#editingRouteId,
            savedBaseline: this.#savedBaseline,
            camera: this.#cameraSnapshot(), // Refreshed on pagehide, so a reload keeps the user's exact view.
          }),
        );
      } else {
        sessionStorage.removeItem(RouteBuilder.DRAFT_KEY);
      }
    } catch {
      // Storage unavailable (e.g. private browsing): building still works, it just won't survive a reload.
    }
  }

  /**
   * True when the Navigation Timing type is 'reload' (a refresh). Gates draft resume: resume on reload, start blank
   * on a navigate/back-forward. Returns false (start blank) when the Navigation Timing API is unavailable — the safer
   * default, since it never silently reopens an old route.
   * @returns {boolean}
   */
  static #isPageReload() {
    const nav = performance.getEntriesByType('navigation')[0];
    return nav ? nav.type === 'reload' : false;
  }

  /**
   * The saved route this tab's draft is an edit of, if any.
   *
   * @returns {?number} null when there's no draft, it isn't editing a saved route, or storage is unavailable.
   */
  #draftEditingRouteId() {
    try {
      const draft = JSON.parse(sessionStorage.getItem(RouteBuilder.DRAFT_KEY));
      return Number.isInteger(draft?.editingRouteId) ? draft.editingRouteId : null;
    } catch {
      return null;
    }
  }

  /**
   * Restores an unsaved in-progress route from this tab's draft stash: its region, waypoints, and resolved legs.
   * The camera returns to the stashed view, falling back to fitting the restored route when the draft predates
   * the camera field or it's corrupt.
   */
  #restoreDraft() {
    let draft = null;
    try {
      draft = JSON.parse(sessionStorage.getItem(RouteBuilder.DRAFT_KEY));
    } catch {
      return; // Storage unavailable or a corrupted draft: start fresh.
    }
    if (!draft || !Array.isArray(draft.waypoints) || draft.waypoints.length === 0) return;
    if (draft.regionId === null || draft.regionId === undefined) return;
    // waypoints.length === segments.length + 1 is the invariant the editing actions rely on; a draft that
    // doesn't satisfy it (corrupt, or written by an older build) is dropped rather than restored inconsistent.
    if (!Array.isArray(draft.segments) || draft.segments.length !== draft.waypoints.length - 1) return;

    // A draft must never be able to break page init — on any failure, drop it and start fresh.
    try {
      this.#selectRegion(draft.regionId, false);
      this.#waypoints = draft.waypoints;
      this.#segments = draft.segments;
      if (Number.isInteger(draft.editingRouteId)) {
        this.#editingRouteId = draft.editingRouteId;
        this.#savedBaseline = typeof draft.savedBaseline === 'string' ? draft.savedBaseline : null;
        this.#savedRoutes.markActive(draft.editingRouteId);
      }
      this.#setPanelState('building');
      this.#recompute();
      this.#updateSaveButton();
      if (!this.#applyCamera(draft.camera)) {
        const coords = this.#streetsInRoute.features.flatMap((f) => f.geometry.coordinates);
        const points = coords.length > 0 ? coords : this.#waypoints.map((wp) => [wp.lng, wp.lat]);
        this.#map.fitBounds(turf.bbox({ type: 'MultiPoint', coordinates: points }),
          { padding: 80, maxZoom: 16, duration: 800 });
      }
    } catch (e) {
      console.error('Failed to restore the route draft:', e);
      try {
        sessionStorage.removeItem(RouteBuilder.DRAFT_KEY);
      } catch {
        // Storage unavailable; nothing further to clean up.
      }
      this.#emptyRoute();
      this.#resetUI();
    }
  }

  /**
   * The trash-can / route-menu delete action. For a loaded saved route with no unsaved edits there is nothing to
   * lose, so the session just closes; otherwise the confirmation modal opens, with its copy swapped while editing
   * (discarding edits leaves the saved route intact — the server-rendered copy is about losing an unsaved route).
   */
  #openDeleteConfirm() {
    const editing = this.#editingRouteId !== null;
    if (editing && !this.#isDirty()) {
      window.logWebpageActivity('RouteBuilder_Click=ExitEditSession');
      this.#exitEditSession();
      return;
    }
    this.#deleteTitleEl.textContent = editing ? i18next.t('discard-edit-title') : this.#defaultDeleteCopy.title;
    this.#deleteExplanationEl.textContent = editing
      ? i18next.t('discard-edit-explanation')
      : this.#defaultDeleteCopy.explanation;
    this.#deleteConfirmButton.textContent = editing
      ? i18next.t('discard-edit-button')
      : this.#defaultDeleteCopy.button;
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

  /** Clears the current route and resets the map to the intro state. */
  #clearRoute() {
    this.#emptyRoute();
    this.#undoStack.clear();
    this.#resetUI();
    window.logWebpageActivity('RouteBuilder_Click=ConfirmCancelRoute');
  }

  #resetUI() {
    this.#setPanelState('empty');
    this.#deleteRouteModal.style.visibility = 'hidden';
    this.#saveModal.hide();
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
   * After a successful first save: records the route (device-local list for guests), then keeps the route on the
   * map as an editing session — like saving a document, further edits update the same route via "Update route".
   * The new card is highlighted in "Your saved routes" and a toast confirms.
   *
   * @param {Object} saved - The POST /saveRoute response: route_id, name, slug, distance_meters, thumbnail_url.
   */
  #handleRouteSaved(saved) {
    const routeId = saved.route_id;
    if (!this.#isSignedIn) this.#recordGuestRoute(saved);
    this.#editingRouteId = routeId;
    this.#savedBaseline = JSON.stringify(this.#routeStreetsPayload());
    this.#saveDraft();
    this.#savedRoutes.markActive(routeId);
    this.#savedRoutes.refresh(routeId);
    this.#updateSaveButton();
    Toast.show({ message: i18next.t('route-saved'), duration: 3000 });
  }

  /**
   * Mirrors a just-saved route into the guest's device-local card list.
   *
   * The distance, geometry and thumbnail come from the server's response rather than being recomputed here, so a
   * guest card always describes what was actually stored — and an update refreshes it rather than leaving the
   * first save's numbers on the card forever.
   *
   * @param {Object} saved - A /saveRoute or route-update response.
   */
  #recordGuestRoute(saved) {
    this.#savedRoutes.recordGuestRoute({
      routeId: saved.route_id,
      name: saved.name,
      slug: saved.slug,
      regionName: this.#getRegionName(this.#currRegionId),
      url: `${window.location.origin}/r/${saved.slug}`,
      distanceMeters: saved.distance_meters,
      thumbnailUrl: saved.thumbnail_url,
    });
  }

  /**
   * Suggests a route name for the save modal from the reverse-geocoded start/end streets — "Palisade Ave to
   * Cedar Ln", or just the street name for a single-street loop. Falls back to "Route in {region}" when the
   * street names haven't resolved (geocoding is async/best-effort).
   *
   * @returns {string}
   */
  #suggestedRouteName() {
    const { start, end } = this.#directionsPanel.getEndpointStreetNames();
    if (start && end) {
      return start === end ? start : i18next.t('route-name-streets', { start, end });
    }
    const regionName = this.#getRegionName(this.#currRegionId);
    return regionName ? i18next.t('route-name-default', { region: regionName }) : '';
  }
}
