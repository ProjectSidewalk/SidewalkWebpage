/**
 * A generic, reusable toast notification. Renders a small card with an optional icon, a title, a message, an optional
 * action button, and a close (X) button. It lives on <body> (fixed-positioned) and floats over a reference element.
 *
 * Dismiss behavior: the toast starts slightly transparent and fades itself out after `duration` ms. Hovering it makes
 * it fully opaque, reveals the close button, and pauses the auto-dismiss timer until the cursor leaves. Clicking the
 * close button (or calling dismiss()) fades it out immediately.
 *
 * Specialized toasts (e.g. badge-unlock celebrations) should extend or compose this class rather than re-implement it.
 */
class Toast {
  // Fade-out transition duration (ms). Kept in sync with the CSS opacity transition on `.ps-toast`.
  static #FADE_MS = 300;

  #el;
  #reference;
  #duration;
  #timerId = null;
  #dismissed = false;
  #repositionHandler = null;

  /**
   * @param {Object} opts
   * @param {string} [opts.title] Bold heading line.
   * @param {string} [opts.message] Secondary message line.
   * @param {string} [opts.icon] Image URL shown to the left of the text.
   * @param {string} [opts.iconAlt] Alt text for the icon image (defaults to '').
   * @param {Object} [opts.button] Optional action button: { label, href } or { label, onClick }.
   * @param {HTMLElement} [opts.reference] Element the toast floats over (defaults to the viewport).
   * @param {number} [opts.duration] Milliseconds before auto-dismiss when not hovered (defaults to 5000).
   */
  constructor(opts = {}) {
    this.#reference = opts.reference || null;
    this.#duration = opts.duration ?? 5000;
    this.#el = this.#build(opts);
  }

  /**
   * Convenience factory: builds a toast, shows it, and returns the instance.
   * @param {Object} opts See the constructor.
   * @returns {Toast}
   */
  static show(opts = {}) {
    const toast = new Toast(opts);
    toast.show();
    return toast;
  }

  /** Builds the toast DOM subtree (but does not attach it to the page). */
  #build(opts) {
    const el = document.createElement('div');
    el.className = 'ps-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    if (opts.icon) {
      const icon = document.createElement('img');
      icon.className = 'ps-toast__icon';
      icon.src = opts.icon;
      icon.alt = opts.iconAlt || '';
      el.appendChild(icon);
    }

    const text = document.createElement('div');
    text.className = 'ps-toast__text';
    if (opts.title) {
      const title = document.createElement('div');
      title.className = 'ps-toast__title';
      title.textContent = opts.title;
      text.appendChild(title);
    }
    if (opts.message) {
      const message = document.createElement('div');
      message.className = 'ps-toast__message';
      message.textContent = opts.message;
      text.appendChild(message);
    }
    el.appendChild(text);

    if (opts.button) el.appendChild(this.#buildButton(opts.button));

    // Close button.
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ps-toast__close';
    close.setAttribute('aria-label', i18next.t('common:close'));
    const closeIcon = document.createElement('img');
    closeIcon.className = 'ps-toast__close-icon';
    closeIcon.src = '/assets/images/icons/cross.svg';
    closeIcon.alt = '';
    close.appendChild(closeIcon);
    close.addEventListener('click', () => this.dismiss());
    el.appendChild(close);

    // Hovering makes the toast fully opaque and pauses the auto-dismiss timer; leaving restarts it.
    el.addEventListener('mouseenter', () => {
      el.classList.add('ps-toast--hover');
      this.#clearTimer();
    });
    el.addEventListener('mouseleave', () => {
      el.classList.remove('ps-toast--hover');
      this.#startTimer();
    });

    return el;
  }

  /**
   * Builds the action button using the shared design-system button classes.
   * @param {Object} button { label, href, newTab } for a link-style action or { label, onClick } for a callback.
   * @returns {HTMLElement}
   */
  #buildButton(button) {
    const el = button.href ? document.createElement('a') : document.createElement('button');
    el.className = 'ps-toast__button button-ps button--primary button--small';
    el.textContent = button.label;
    if (button.href) {
      el.href = button.href;
      if (button.newTab) {
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
      }
    } else {
      el.type = 'button';
      if (button.onClick) el.addEventListener('click', button.onClick);
    }
    return el;
  }

  /** Attaches the toast to its host, positions it over the reference, makes it visible, and starts dismiss timer. */
  show() {
    this.#host().appendChild(this.#el);
    this.#position();

    // The toast is fixed-positioned over the reference, so keep it aligned as the viewport changes.
    this.#repositionHandler = () => this.#position();
    window.addEventListener('resize', this.#repositionHandler);

    // Force a reflow so the entry transition runs from the initial (hidden) state.
    void this.#el.offsetWidth;
    this.#el.classList.add('ps-toast--visible');
    this.#startTimer();
  }

  /**
   * The element to mount the toast into. Normally <body>, but if the reference lives inside a modal <dialog> (opened
   * with showModal(), e.g. the LabelMap label-detail popup), that dialog renders in the browser's top layer — above
   * every normal stacking context regardless of z-index. Mounting the toast inside that dialog puts it in the same top
   * layer so it floats above the popup instead of behind it. The dialog has no transform, so the toast's fixed
   * positioning stays viewport-relative either way.
   * @returns {HTMLElement}
   */
  #host() {
    const dialog = this.#reference && this.#reference.closest && this.#reference.closest('dialog');
    return dialog && dialog.matches(':modal') ? dialog : document.body;
  }

  /**
   * Positions the toast horizontally centered over the reference element. Vertically it sits 10% down from the top.
   */
  #position() {
    const VERTICAL_FRACTION = 0.10;
    const rect = this.#reference
      ? this.#reference.getBoundingClientRect()
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    this.#el.style.left = `${rect.left + rect.width / 2}px`;
    this.#el.style.top = `${rect.top + rect.height * VERTICAL_FRACTION}px`;
  }

  /** Fades the toast out and removes it from the DOM. Safe to call more than once. */
  dismiss() {
    if (this.#dismissed) return;
    this.#dismissed = true;
    this.#clearTimer();
    if (this.#repositionHandler) window.removeEventListener('resize', this.#repositionHandler);
    this.#el.classList.remove('ps-toast--visible');
    setTimeout(() => this.#el.remove(), Toast.#FADE_MS);
  }

  /** Starts (or restarts) the auto-dismiss countdown. A non-positive duration disables auto-dismiss. */
  #startTimer() {
    this.#clearTimer();
    if (this.#duration > 0) this.#timerId = setTimeout(() => this.dismiss(), this.#duration);
  }

  /** Cancels any pending auto-dismiss countdown. */
  #clearTimer() {
    if (this.#timerId !== null) {
      clearTimeout(this.#timerId);
      this.#timerId = null;
    }
  }
}

/**
 * The slim Start/End address seed for the planner card. Typing an address in either field (Mapbox search) plants a
 * waypoint at that location — Start plants the route's first point, End extends it — after which the route is refined
 * by clicking the map. The fields also mirror the route's current endpoints (reverse-geocoded) as it's edited. The
 * panel renders no markers of its own; the route's start/end flags are the only endpoint markers.
 */
class DirectionsPanel {
  // Skip a reverse-geocode when an endpoint moved less than this — the label wouldn't meaningfully change.
  static MIN_MOVE_FOR_GEOCODE_M = 15;

  // A typed address label is kept while the endpoint stays within this distance of it — the route snapping to a
  // nearby street must not overwrite the user's own words with a reverse-geocoded neighbor.
  static KEEP_USER_LABEL_M = 100;

  #map;
  #mapboxApiKey;
  #onSetStart;
  #onSetEnd;
  #lastGeocoded = { start: null, end: null }; // Last [lng, lat] each field was reverse-geocoded for.
  #userLabelCoord = { start: null, end: null }; // Where the user last picked an address by typing (if anywhere).
  #endpointStreets = { start: null, end: null }; // Street name at each endpoint (for the suggested route name).

  /**
   * @param {Object} opts
   * @param {Object} opts.map - The Mapbox map.
   * @param {string} opts.mapboxApiKey
   * @param {Object} opts.bbox - Search bounds: [[west, south], [east, north]].
   * @param {Function} opts.onSetStart - Called with {lng, lat} when a Start address is chosen.
   * @param {Function} opts.onSetEnd - Called with {lng, lat} when an End address is chosen.
   */
  constructor(opts) {
    this.#map = opts.map;
    this.#mapboxApiKey = opts.mapboxApiKey;
    this.#onSetStart = opts.onSetStart;
    this.#onSetEnd = opts.onSetEnd;

    this.#buildSearchBox('start', opts.bbox, i18next.t('directions-start-placeholder'));
    this.#buildSearchBox('end', opts.bbox, i18next.t('directions-end-placeholder'));
  }

  /**
   * Creates a Mapbox search box bound to one of the panel's slots.
   *
   * @param {string} which - 'start' or 'end'.
   * @param {Object} bbox - Search bounds.
   * @param {string} placeholder
   * @returns {Object} The MapboxSearchBox instance.
   */
  #buildSearchBox(which, bbox, placeholder) {
    const box = new MapboxSearchBox();
    box.accessToken = this.#mapboxApiKey;
    box.options = {
      bbox,
      language: i18next.t('common:mapbox-language-code'),
      placeholder,
    };
    box.theme = {
      variables: {
        borderRadius: '8px',
      },
      // The library reserves 40px of input padding for its 20px search icon; tighten the icon-to-text gap.
      cssText: '.Input { padding-left: 32px; height: 34px; } .SearchIcon { left: 8px; }',
    };
    // onAdd builds the search box's element for this map; we place it in the panel instead of a map corner.
    document.getElementById(`directions-${which}-slot`).append(box.onAdd(this.#map));

    box.addEventListener('retrieve', (event) => {
      const feature = event.detail?.features?.[0];
      const coord = feature?.geometry?.coordinates;
      if (!coord) return;
      window.logWebpageActivity(`RouteBuilder_Click=${which === 'start' ? 'SetStartAddress' : 'SetEndAddress'}`);
      this.#lastGeocoded[which] = coord; // The user just named this point; no need to reverse-geocode it.
      this.#userLabelCoord[which] = coord;
      this.#endpointStreets[which] = DirectionsPanel.#streetNameFromProps(feature.properties);
      const lngLat = { lng: coord[0], lat: coord[1] };
      if (which === 'start') this.#onSetStart(lngLat);
      else this.#onSetEnd(lngLat);
    });
    return box;
  }

  /**
   * Syncs the fields with the route's current endpoints (reverse-geocoded, throttled by distance moved).
   *
   * @param {Array<number>} startCoord - The route's first coordinate [lng, lat].
   * @param {Array<number>} endCoord - The route's last coordinate [lng, lat].
   */
  updateFromRoute(startCoord, endCoord) {
    this.updateStart(startCoord);
    this.#reverseGeocodeInto('end', { lng: endCoord[0], lat: endCoord[1] });
  }

  /**
   * Syncs just the Start field with the route's start — used when only the first point exists (no end yet).
   *
   * @param {Array<number>} startCoord - The start point [lng, lat].
   */
  updateStart(startCoord) {
    this.#reverseGeocodeInto('start', { lng: startCoord[0], lat: startCoord[1] });
  }

  /**
   * Shows or hides the End field's row — it stays hidden until the route has a start, so the page opens with a
   * single obvious first step.
   *
   * @param {boolean} visible
   */
  setEndVisible(visible) {
    const row = document.getElementById('directions-end-row');
    if (row) row.hidden = !visible;
  }

  /** Clears both fields (route emptied / reset). */
  clearFields() {
    this.#lastGeocoded = { start: null, end: null };
    this.#userLabelCoord = { start: null, end: null };
    this.#endpointStreets = { start: null, end: null };
    this.#setFieldText('start', '');
    this.#setFieldText('end', '');
  }

  /**
   * The street name at each endpoint, as far as geocoding has resolved them (best-effort; either may be null).
   * @returns {{start: string|null, end: string|null}}
   */
  getEndpointStreetNames() {
    return { start: this.#endpointStreets.start, end: this.#endpointStreets.end };
  }

  /**
   * Extracts the bare street name from a Mapbox geocoding/search feature's properties: the street context of an
   * address result, or the feature's own name for a street result.
   *
   * @param {Object} [props] - The feature's properties.
   * @returns {string|null}
   */
  static #streetNameFromProps(props) {
    if (!props) return null;
    const contextStreet = props.context?.street?.name;
    const ownName = props.feature_type === 'street' ? (props.name_preferred || props.name) : null;
    return contextStreet || ownName || null;
  }

  /**
   * Fills a field with the nearest address/place name for a coordinate, unless it barely moved since the last
   * lookup or the user is typing in / recently typed that field.
   *
   * @param {string} which - 'start' or 'end'.
   * @param {Object} lngLat - {lng, lat}.
   */
  #reverseGeocodeInto(which, lngLat) {
    const coord = [lngLat.lng, lngLat.lat];
    const last = this.#lastGeocoded[which];
    if (last && RouteGraph.distanceM(last, coord) < DirectionsPanel.MIN_MOVE_FOR_GEOCODE_M) return;
    // A user-typed address stays in the field while the endpoint is still near it (e.g. after route snapping).
    const typedAt = this.#userLabelCoord[which];
    if (typedAt && RouteGraph.distanceM(typedAt, coord) < DirectionsPanel.KEEP_USER_LABEL_M) return;
    const slot = document.getElementById(`directions-${which}-slot`);
    if (slot?.contains(document.activeElement)) return; // Don't clobber what the user is typing.
    this.#lastGeocoded[which] = coord;
    this.#userLabelCoord[which] = null; // The endpoint left the typed address behind; the field follows it now.
    // Cleared at dispatch, not on response: a failed lookup must not leave a street name for a stale coordinate.
    this.#endpointStreets[which] = null;

    const params = new URLSearchParams({
      longitude: lngLat.lng,
      latitude: lngLat.lat,
      types: 'address,street',
      language: i18next.t('common:mapbox-language-code'),
      access_token: this.#mapboxApiKey,
    });
    fetch(`https://api.mapbox.com/search/geocode/v6/reverse?${params}`)
      .then((response) => response.json())
      .then((data) => {
        const props = data.features?.[0]?.properties;
        this.#endpointStreets[which] = DirectionsPanel.#streetNameFromProps(props);
        const label = props?.name_preferred || props?.name || props?.full_address;
        if (label) this.#setFieldText(which, label);
      })
      .catch(() => {
        // Reverse geocoding is best-effort decoration; the route is unaffected.
      });
  }

  /**
   * Sets a search box's visible text without triggering a search.
   *
   * @param {string} which - 'start' or 'end'.
   * @param {string} text
   */
  #setFieldText(which, text) {
    const slot = document.getElementById(`directions-${which}-slot`);
    const input = slot?.querySelector('input');
    if (input) input.value = text;
  }
}

/**
 * Google Encoded Polyline Algorithm (precision 5) helpers, matching the backend's PolylineEncoder. These feed the
 * static-map thumbnail URLs for guest-saved routes, whose geometry only exists client-side.
 */

/**
 * Encodes a sequence of [lng, lat] coordinates as a polyline string.
 *
 * @param {Array<Array<number>>} coords - Coordinates as [longitude, latitude] pairs, in path order.
 * @returns {string} The encoded polyline (empty for no coordinates).
 */
function encodePolyline(coords) {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const encodeDiff = (diff) => {
    let v = diff < 0 ? ~(diff * 2) : diff * 2;
    let chunk = '';
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return chunk + String.fromCharCode(v + 63);
  };
  coords.forEach(([lng, lat]) => {
    const lat5 = Math.round(lat * 1e5);
    const lng5 = Math.round(lng * 1e5);
    out += encodeDiff(lat5 - prevLat) + encodeDiff(lng5 - prevLng);
    prevLat = lat5;
    prevLng = lng5;
  });
  return out;
}

/**
 * Thins a coordinate sequence to at most maxPoints, always keeping the first and last points — thumbnails are
 * tiny, and the polyline rides in a URL.
 *
 * @param {Array<Array<number>>} coords - [lng, lat] pairs.
 * @param {number} maxPoints
 * @returns {Array<Array<number>>}
 */
function decimateCoords(coords, maxPoints) {
  if (coords.length <= maxPoints) return coords;
  const step = Math.ceil(coords.length / (maxPoints - 1));
  return coords.filter((c, i) => i % step === 0).concat([coords[coords.length - 1]]);
}

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
  // Zoom eased to when the first point lands, close enough that the basemap renders street names for building.
  static BUILD_ZOOM = 15.5;
  // How long the explorer takes to walk the route in the preview animation.
  static EXPLORER_ANIMATION_MS = 2500;
  // How long the pointer rests on the drawn route before its action menu opens (discoverable but not twitchy).
  static ROUTE_MENU_HOVER_MS = 500;
  // How long the co-located next-step hint stays anchored to the newest flag.
  static HINT_DURATION_MS = 7000;
  // Storage key for the in-progress route draft, restored after any reload (e.g. the sign-in round-trip).
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
    neighborhoodsLoaded: false, // Neighborhood GeoJSON has arrived from the server.
    neighborhoodsRendered: false, // Neighborhood source/layers have been added to the map.
    streetsLoaded: false, // Street GeoJSON has arrived from the server.
    streetsRendered: false, // Street source/layers/handlers have been added to the map.
    pendingRouteRestored: false,
  };

  #units;
  #minutesPer100m;

  #mapboxApiKey;
  #map;
  #cityView; // The city's default {center, zoom}, for resetting the camera when starting over.
  #isSignedIn;

  // Route state. The route is fully defined by #waypoints; everything else is derived from it.
  #neighborhoodData = null;
  #currRegionId = null;
  #streetData = null;
  #streetsInRoute = null; // The 'streets-chosen' GeoJSON source: cloned, oriented street features for the route.
  #waypoints = []; // Ordered [{ lng, lat }] snapped points the user clicked/seeded.
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
    document.getElementById('new-route-button').addEventListener('click', () => {
      window.logWebpageActivity('RouteBuilder_Click=NewRoute');
      if (!this.#unsavedWorkConfirmed()) return;
      this.#exitEditSession();
      this.#map.flyTo({ center: this.#cityView.center, zoom: this.#cityView.zoom, duration: 1200 });
    });
    document.getElementById('delete-route-button').addEventListener('click', (e) => this.#clearRoute(e));
    document.getElementById('cancel-delete-route-button').addEventListener('click', () => this.#clickResumeRoute());

    this.#saveModal = new SaveModal({
      isSignedIn: this.#isSignedIn,
      getRegionId: () => this.#currRegionId,
      getStreetsPayload: () => this.#routeStreetsPayload(),
      getSuggestedName: () => this.#suggestedRouteName(),
      onSaved: (routeId, name, slug) => this.#handleRouteSaved(routeId, name, slug),
      onClose: () => this.#saveButton.focus(),
    });
    this.#savedRoutes = new SavedRoutesPanel({
      isSignedIn: this.#isSignedIn,
      formatMeta: (distanceMeters, regionName) => this.#formatRouteMeta(distanceMeters, regionName),
      setTemporaryTooltip: (btn, message) => this.#setTemporaryTooltip(btn, message),
      onView: (routeId) => this.#loadRouteForEditing(routeId),
      thumbnailUrl: (encodedPolyline) => this.#thumbnailUrl(encodedPolyline),
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
      if (this.#status.neighborhoodsLoaded) {
        try {
          this.#renderNeighborhoodsHelper();
        } catch (e) {
          console.error('Failed to render neighborhoods:', e);
        }
      }
      if (this.#status.streetsLoaded) {
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
      onSetStart: (lngLat) => this.#addWaypoint(lngLat, 'AddressStart'),
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
        'line-color': '#2D2A3F',
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
        // Quiet neutral base network; the ghost flag (not a street highlight) previews where a click lands.
        'line-color': '#B3B3B3', // --color-neutral-500 (map paint can't read CSS tokens).
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
    this.#setCursorGuide(null); // Stale until the next pointer move re-evaluates it for the new stage.
    // The one static hint: right after the end point lands, reassure that the route isn't capped at two clicks.
    if (this.#waypoints.length === 2) {
      this.#showHint([point.lng, point.lat], i18next.t('hint-extend'));
    }
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
    this.#hideHint(); // Any old next-step hint is anchored to a point that may just have moved or vanished.
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
    this.#saveDraft();
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

    const km = feats.reduce((sum, street) => sum + turf.length(street, { units: 'kilometers' }), 0);
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
    const dist = this.#units === 'miles' ? km / 1.609344 : km;
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
   * Builds a Mapbox Static Images URL rendering a route's path on the project basemap, for saved-route cards.
   *
   * @param {string} encodedPolyline - The route geometry as an encoded polyline.
   * @returns {string}
   */
  #thumbnailUrl(encodedPolyline) {
    const path = encodeURIComponent(encodedPolyline);
    return 'https://api.mapbox.com/styles/v1/projectsidewalk/cloov4big002801rc0qw75w5g/static/'
      + `path-4+3E8BD9-0.9(${path})/auto/400x200@2x?padding=30&access_token=${this.#mapboxApiKey}`;
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
      if (previewParam !== null && /^\d+$/.test(previewParam)) {
        this.#loadRouteForEditing(Number(previewParam));
      } else {
        this.#restoreDraft();
      }
      return;
    }

    const features = this.#drawStreetList(pending.streets);
    if (features.length === 0) return;

    this.#selectRegion(features[0].properties.region_id, false);
    // Reconstruct the waypoints so the restored route is editable after the save modal closes.
    this.#waypoints = this.#waypointsFromStreets(features);
    this.#setPanelState('building');
    this.#recompute();
    this.#saveModal.open(pending.name || null, pending.description || null);
  }

  /**
   * Draws a saved street list as the current route geometry: each street is cloned from the loaded street data
   * and oriented to its walking direction.
   *
   * @param {Array<{street_id: number, reverse: boolean}>} streets - Ordered streets in the /saveRoute wire format.
   * @returns {Array<Object>} The drawn features (empty when none of the ids exist in the loaded street data).
   */
  #drawStreetList(streets) {
    const map = this.#map;
    const features = [];
    streets.forEach((stashed) => {
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
    if (features.length > 0) {
      this.#streetsInRoute.features = features;
      map.getSource('streets-chosen').setData(this.#streetsInRoute);
    }
    return features;
  }

  /**
   * Derives the dense waypoint chain for an already-drawn (oriented) street list: the first street's start, then
   * every street's end in walking order. With a waypoint at each street boundary, #recompute's A* pass between
   * adjacent boundary nodes reproduces the street sequence, so a loaded saved route is editable exactly like one
   * the user just clicked out — and what's drawn is always exactly what an update will save.
   *
   * @param {Array<Object>} features - Oriented street features (as returned by #drawStreetList).
   * @returns {Array<{lng: number, lat: number}>}
   */
  #waypointsFromStreets(features) {
    if (features.length === 0) return [];
    const first = features[0].geometry.coordinates[0];
    const waypoints = [{ lng: first[0], lat: first[1] }];
    features.forEach((f) => {
      const end = f.geometry.coordinates[f.geometry.coordinates.length - 1];
      waypoints.push({ lng: end[0], lat: end[1] });
    });
    return waypoints;
  }

  /**
   * Confirms with the user before an action that would discard unsaved work: edits to a loaded saved route, or a
   * drawn-but-never-saved route. No-ops (returns true) when nothing would be lost.
   *
   * @returns {boolean} True to proceed.
   */
  #unsavedWorkConfirmed() {
    const unsavedWork = this.#editingRouteId !== null
      ? this.#isDirty()
      : (this.#streetsInRoute?.features.length ?? 0) > 0;
    return !unsavedWork || window.confirm(i18next.t('unsaved-continue-confirm'));
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
  #loadRouteForEditing(routeId) {
    if (this.#editingRouteId === routeId) {
      if (!this.#unsavedWorkConfirmed()) return;
      window.logWebpageActivity('RouteBuilder_Click=ExitEditSession');
      this.#exitEditSession();
      return;
    }
    if (!this.#unsavedWorkConfirmed()) return;
    fetch(`/userapi/routes/${routeId}/streets`, { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data) => {
        if (!this.#status.streetsRendered) return;
        this.#emptyRoute(); // Also closes any previous editing session.
        this.#undoStack.clear();
        const features = this.#drawStreetList(data.streets);
        if (features.length === 0) return;
        this.#selectRegion(features[0].properties.region_id, false);
        this.#waypoints = this.#waypointsFromStreets(features);
        this.#setPanelState('building');
        this.#recompute();
        // If streets were dropped (e.g. since hidden as low-quality) or rerouted, say so — the user is looking
        // at, and will save, the adjusted route.
        if (this.#streetsInRoute.features.length !== data.streets.length) {
          Toast.show({ message: i18next.t('route-adjusted'), duration: 4000 });
        }
        this.#editingRouteId = routeId;
        // The baseline is what's actually drawn (post-recompute), so an untouched load reads as clean.
        this.#savedBaseline = JSON.stringify(this.#routeStreetsPayload());
        this.#saveDraft();
        this.#savedRoutes.markActive(routeId);
        this.#updateSaveButton();
        const coords = this.#streetsInRoute.features.flatMap((f) => f.geometry.coordinates);
        this.#map.fitBounds(turf.bbox({ type: 'MultiPoint', coordinates: coords }),
          { padding: 80, maxZoom: 16, duration: 900 });
      })
      .catch((e) => {
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
      .then(() => {
        this.#savedBaseline = JSON.stringify(payload);
        this.#saveDraft();
        this.#updateSaveButton();
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
            // The editing session too, so a reload resumes updating the same route instead of saving a copy.
            editingRouteId: this.#editingRouteId,
            savedBaseline: this.#savedBaseline,
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
   * Restores an unsaved in-progress route from this tab's draft stash. The draft holds only the waypoints and
   * region; everything else is recomputed, and the camera fits the restored route.
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

    // A draft must never be able to break page init — on any failure, drop it and start fresh.
    try {
      this.#selectRegion(draft.regionId, false);
      this.#waypoints = draft.waypoints;
      if (Number.isInteger(draft.editingRouteId)) {
        this.#editingRouteId = draft.editingRouteId;
        this.#savedBaseline = typeof draft.savedBaseline === 'string' ? draft.savedBaseline : null;
        this.#savedRoutes.markActive(draft.editingRouteId);
      }
      this.#setPanelState('building');
      this.#recompute();
      this.#updateSaveButton();
      const coords = this.#streetsInRoute.features.flatMap((f) => f.geometry.coordinates);
      const points = coords.length > 0 ? coords : this.#waypoints.map((wp) => [wp.lng, wp.lat]);
      this.#map.fitBounds(turf.bbox({ type: 'MultiPoint', coordinates: points }),
        { padding: 80, maxZoom: 16, duration: 800 });
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
    }
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
   * @param {number} routeId
   * @param {string} name - The route's saved name.
   * @param {string} slug - The route's URL slug, for the /r/<slug> share link.
   */
  #handleRouteSaved(routeId, name, slug) {
    if (!this.#isSignedIn) {
      const km = this.#streetsInRoute.features
        .reduce((sum, street) => sum + turf.length(street, { units: 'kilometers' }), 0);
      const coords = this.#streetsInRoute.features.flatMap((f) => f.geometry.coordinates);
      this.#savedRoutes.recordGuestRoute({
        routeId,
        name,
        slug,
        regionName: this.#getRegionName(this.#currRegionId),
        url: `${window.location.origin}/r/${slug}`,
        distanceMeters: km * 1000,
        encodedPolyline: encodePolyline(decimateCoords(coords, 60)),
      });
    }
    this.#editingRouteId = routeId;
    this.#savedBaseline = JSON.stringify(this.#routeStreetsPayload());
    this.#saveDraft();
    this.#savedRoutes.markActive(routeId);
    this.#savedRoutes.refresh(routeId);
    this.#updateSaveButton();
    Toast.show({ message: i18next.t('route-saved'), duration: 3000 });
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

/**
 * Client-side street-network graph for auto-routing (#4579): builds an adjacency graph from the city's street
 * GeoJSON (endpoints within ~10 m are merged into one node, the same connectivity tolerance the builder's
 * contiguous-section logic uses) and answers shortest-walking-path queries with A*.
 *
 * All geometry math is self-contained (haversine / equirectangular approximations) so the class stays fast and
 * unit-testable without the map or turf. Routing is restricted to a single region, matching the current
 * one-neighborhood-per-route constraint (#3488 tracks lifting it).
 */
class RouteGraph {
  // Endpoints within this distance are considered the same intersection (mirrors #computeContiguousRoutes).
  static NODE_TOLERANCE_M = 10;
  static EARTH_RADIUS_M = 6371008.8;

  #nodes = new Map(); // key -> { lng, lat, edges: [{ streetId, regionId, weightM, otherKey }] }
  #features = new Map(); // streetId -> live GeoJSON feature (geometry may be reversed in place by editing)
  #featureLengths = new Map(); // streetId -> geometry length in meters (for the snap prefilter)

  /**
   * @param {Array<Object>} streetFeatures - GeoJSON LineString features with street_edge_id + region_id properties.
   */
  constructor(streetFeatures) {
    streetFeatures.forEach((feature) => {
      const coords = feature.geometry.coordinates;
      if (!coords || coords.length < 2) return;
      const streetId = feature.properties.street_edge_id;
      this.#features.set(streetId, feature);
      const lengthM = RouteGraph.lineLengthM(coords);
      this.#featureLengths.set(streetId, lengthM);

      const keyA = this.#nodeKeyFor(coords[0]);
      const keyB = this.#nodeKeyFor(coords[coords.length - 1]);
      if (keyA === keyB) return; // Degenerate loop/stub: no usable connectivity.
      const edge = {
        streetId,
        regionId: feature.properties.region_id,
        weightM: lengthM,
      };
      this.#nodes.get(keyA).edges.push({ ...edge, otherKey: keyB });
      this.#nodes.get(keyB).edges.push({ ...edge, otherKey: keyA });
    });
  }

  /**
   * Great-circle distance between two [lng, lat] points in meters.
   */
  static distanceM(a, b) {
    const toRad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toRad;
    const dLng = (b[0] - a[0]) * toRad;
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * sinLng * sinLng;
    return 2 * RouteGraph.EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
  }

  /**
   * Length of a LineString's coordinates in meters.
   */
  static lineLengthM(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
      total += RouteGraph.distanceM(coords[i - 1], coords[i]);
    }
    return total;
  }

  /**
   * Returns the node key for a coordinate, merging with any existing node within NODE_TOLERANCE_M
   * (scans the neighboring quantized cells so near-boundary endpoints still merge).
   *
   * @param {Array<number>} coord - [lng, lat].
   * @returns {string} The (possibly newly created) node's key.
   */
  #nodeKeyFor(coord) {
    // Cells are ~11 m N-S, but longitude cells shrink with latitude (~7.6 m at 47°N), so the scan reaches
    // ±2 cells east-west to keep covering the 10 m tolerance away from the equator.
    const cellLng = Math.round(coord[0] * 10000);
    const cellLat = Math.round(coord[1] * 10000);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cellLng + dx},${cellLat + dy}`;
        const node = this.#nodes.get(key);
        if (node && RouteGraph.distanceM(coord, [node.lng, node.lat]) < RouteGraph.NODE_TOLERANCE_M) {
          return key;
        }
      }
    }
    const key = `${cellLng},${cellLat}`;
    this.#nodes.set(key, { lng: coord[0], lat: coord[1], edges: [] });
    return key;
  }

  /**
   * Finds the street nearest to a point, and which of its endpoint nodes is closer.
   *
   * @param {Object} point - {lng, lat}.
   * @param {number} [regionId] - When given, only streets in this region are considered (e.g. so the start-point
   *   preview near a boundary can't snap into a neighboring region).
   * @returns {Object|null} {streetId, regionId, nodeKey, nodeLngLat, distanceM} or null when there are no streets.
   *                        nodeLngLat is the [lng, lat] of the snapped endpoint node (where a route starts/joins).
   */
  snapToStreet(point, regionId = null) {
    const p = [point.lng, point.lat];
    let best = null;
    this.#features.forEach((feature, streetId) => {
      if (regionId !== null && feature.properties.region_id !== regionId) return;
      const coords = feature.geometry.coordinates;
      // Prefilter: no vertex can be closer than (distance to the first vertex - geometry length), so the
      // per-vertex scan is skipped for the vast majority of streets that are nowhere near the point.
      if (best !== null
        && RouteGraph.distanceM(p, coords[0]) - this.#featureLengths.get(streetId) > best.distanceM) {
        return;
      }
      // Nearest vertex is a good-enough proxy for nearest point on the line at street-segment scale.
      let minD = Infinity;
      for (const c of coords) {
        const d = RouteGraph.distanceM(p, c);
        if (d < minD) minD = d;
      }
      if (best === null || minD < best.distanceM) {
        const dStart = RouteGraph.distanceM(p, coords[0]);
        const dEnd = RouteGraph.distanceM(p, coords[coords.length - 1]);
        const nearerEnd = dStart <= dEnd ? coords[0] : coords[coords.length - 1];
        best = {
          streetId,
          regionId: feature.properties.region_id,
          nodeKey: this.#findExistingNodeKey(nearerEnd),
          nodeLngLat: nearerEnd,
          distanceM: minD,
        };
      }
    });
    return best;
  }

  /** Returns the existing node key for a coordinate (which was inserted during construction). */
  #findExistingNodeKey(coord) {
    return this.#nodeKeyFor(coord); // Always merges with the node created at build time.
  }

  /**
   * Computes the shortest walking path between two points along the street network.
   *
   * @param {Object} start - {lng, lat}.
   * @param {Object} end - {lng, lat}.
   * @returns {Object} One of:
   *   {streets: [{streetId, flip}]} — the ordered streets; flip means "traverse against the feature's current
   *     coordinate order" so the caller can orient each street for the route;
   *   {error: 'different-region'} — the pins snap to streets in different neighborhoods;
   *   {error: 'no-path'} — no connected path exists (or a pin found no street).
   */
  route(start, end) {
    const from = this.snapToStreet(start);
    const to = this.snapToStreet(end);
    if (!from || !to) return { error: 'no-path' };
    if (from.regionId !== to.regionId) return { error: 'different-region' };
    const regionId = from.regionId;

    if (from.nodeKey === to.nodeKey) return { error: 'no-path' }; // Start and end at the same intersection.

    // A* over the region's subgraph: g = meters walked, h = straight-line meters to the goal.
    const goal = this.#nodes.get(to.nodeKey);
    const goalCoord = [goal.lng, goal.lat];
    const g = new Map([[from.nodeKey, 0]]);
    const cameFrom = new Map(); // nodeKey -> { prevKey, streetId }
    const open = new Map(); // nodeKey -> f score
    const startNode = this.#nodes.get(from.nodeKey);
    open.set(from.nodeKey, RouteGraph.distanceM([startNode.lng, startNode.lat], goalCoord));
    const closed = new Set();

    while (open.size > 0) {
      // Extract the open node with the lowest f. Linear scan is fine at region scale (hundreds of nodes).
      let currentKey = null;
      let bestF = Infinity;
      open.forEach((f, key) => {
        if (f < bestF) {
          bestF = f;
          currentKey = key;
        }
      });
      open.delete(currentKey);
      if (currentKey === to.nodeKey) return { streets: this.#reconstructPath(cameFrom, from.nodeKey, to.nodeKey) };
      closed.add(currentKey);

      const current = this.#nodes.get(currentKey);
      for (const edge of current.edges) {
        if (edge.regionId !== regionId || closed.has(edge.otherKey)) continue;
        const tentativeG = g.get(currentKey) + edge.weightM;
        if (tentativeG < (g.get(edge.otherKey) ?? Infinity)) {
          g.set(edge.otherKey, tentativeG);
          cameFrom.set(edge.otherKey, { prevKey: currentKey, streetId: edge.streetId });
          const other = this.#nodes.get(edge.otherKey);
          open.set(edge.otherKey, tentativeG + RouteGraph.distanceM([other.lng, other.lat], goalCoord));
        }
      }
    }
    return { error: 'no-path' };
  }

  /**
   * Walks cameFrom back from the goal, emitting streets in start-to-end order with their traversal direction.
   */
  #reconstructPath(cameFrom, startKey, endKey) {
    const streets = [];
    let key = endKey;
    while (key !== startKey) {
      const step = cameFrom.get(key);
      const feature = this.#features.get(step.streetId);
      const coords = feature.geometry.coordinates;
      const entryNode = this.#nodes.get(step.prevKey);
      // Entered at the geometry's first coordinate -> walked in coordinate order; otherwise it must be flipped.
      const enteredAtFirst
        = RouteGraph.distanceM([entryNode.lng, entryNode.lat], coords[0]) < RouteGraph.NODE_TOLERANCE_M * 1.5;
      streets.unshift({ streetId: step.streetId, flip: !enteredAtFirst });
      key = step.prevKey;
    }
    return streets;
  }
}

/**
 * The small action menu for the drawn route: two labeled rows, "Reverse route direction" and "Delete route". It
 * opens on click or after a short hover on the route (so it's discoverable), anchored where the pointer is. These
 * act on the whole route (auto-routed routes are edited by adding/undoing points, not street-by-street).
 */
class RoutePopover {
  #map;
  #popup;
  #onReverse;
  #onDelete;

  /**
   * @param {Object} map - The Mapbox map.
   * @param {Function} onReverse - Called when "Reverse route direction" is clicked.
   * @param {Function} onDelete - Called when "Delete route" is clicked.
   */
  constructor(map, onReverse, onDelete) {
    this.#map = map;
    this.#onReverse = onReverse;
    this.#onDelete = onDelete;
    this.#popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: true,
      offset: 12,
      maxWidth: '280px',
      className: 'route-popover-popup',
    });
  }

  /**
   * Whether the menu is currently open.
   * @returns {boolean}
   */
  isOpen() {
    return this.#popup.isOpen();
  }

  /**
   * Opens the menu at the given location.
   *
   * @param {Object} lngLat - Where to anchor the popup (the pointer location on the route).
   * @param {boolean} [focus=false] - Move keyboard focus into the menu (for click-opens; a hover-open must not
   *   steal focus from whatever the user is doing).
   */
  open(lngLat, focus = false) {
    const container = document.createElement('div');
    container.className = 'route-popover';
    container.setAttribute('role', 'menu');
    container.innerHTML = `
      <button type="button" class="route-popover-btn route-popover-reverse" role="menuitem">
        <span class="route-popover-icon-chip">
          <img src="/assets/images/icons/repeat-feather.svg" alt="" class="route-popover-icon">
        </span>
        <span>${i18next.t('reverse-direction')}</span>
      </button>
      <button type="button" class="route-popover-btn route-popover-delete" role="menuitem">
        <span class="route-popover-icon-chip route-popover-icon-chip--danger">
          <img src="/assets/images/icons/trash-2-red-feather.svg" alt="" class="route-popover-icon">
        </span>
        <span>${i18next.t('delete-route')}</span>
      </button>`;
    container.querySelector('.route-popover-reverse').addEventListener('click', () => {
      window.logWebpageActivity('RouteBuilder_Click=ReverseRoute_Popover');
      this.close();
      this.#onReverse();
    });
    container.querySelector('.route-popover-delete').addEventListener('click', () => {
      window.logWebpageActivity('RouteBuilder_Click=DeleteRoute_Popover');
      this.close();
      this.#onDelete();
    });

    this.#popup.setLngLat(lngLat).setDOMContent(container).addTo(this.#map);
    if (focus) container.querySelector('.route-popover-reverse').focus();
  }

  /** Closes the menu (no-op if it isn't open). */
  close() {
    this.#popup.remove();
  }
}

/**
 * The "Your saved routes" section on the RouteBuilder intro panel: a card per route with its name, a meta line
 * (distance · est. exploration time · neighborhood), and Explore / copy-link actions. Signed-in users see their
 * account's routes (GET /userapi/routes); anonymous users see the device-local list kept in localStorage, so a
 * forgotten share link isn't fatal.
 */
class SavedRoutesPanel {
  static STORAGE_KEY = 'rb-guest-routes';
  static MAX_GUEST_ROUTES = 20;
  // Kept small so the panel doesn't scroll; the dashboard link below the list is the "see all" path.
  static MAX_SHOWN = 3;

  #isSignedIn;
  #formatMeta;
  #setTemporaryTooltip;
  #onView;
  #thumbnailUrl;
  #panel;
  #list;
  #activeRouteId = null; // Route currently previewed on the map (its card carries the active style).

  /**
   * @param {Object} opts
   * @param {boolean} opts.isSignedIn - Whether the user is signed in (selects the routes source).
   * @param {Function} opts.formatMeta - (distanceMeters, regionName) => the card's meta line.
   * @param {Function} opts.setTemporaryTooltip - (buttonEl, message) that flashes a confirmation tooltip.
   * @param {Function} opts.onView - Called with the route id when a card body is clicked (opens it in the editor).
   * @param {Function} opts.thumbnailUrl - (encodedPolyline) => static-map thumbnail URL for a card.
   */
  constructor(opts) {
    this.#isSignedIn = opts.isSignedIn === true;
    this.#formatMeta = opts.formatMeta;
    this.#setTemporaryTooltip = opts.setTemporaryTooltip;
    this.#onView = opts.onView;
    this.#thumbnailUrl = opts.thumbnailUrl;
    this.#panel = document.getElementById('saved-routes-panel');
    this.#list = document.getElementById('saved-routes-list');
  }

  /**
   * Marks the card whose route is being previewed on the map (or clears the mark with null). The mark survives
   * re-renders, so it also applies when a deep-linked preview loads before the cards do.
   *
   * @param {number|null} routeId
   */
  markActive(routeId) {
    this.#activeRouteId = routeId;
    this.#list?.querySelectorAll('.saved-route-card').forEach((card) => {
      card.classList.toggle('saved-route-card--active', Number(card.dataset.routeId) === routeId);
    });
  }

  /**
   * Re-reads the routes (account routes over HTTP, or the device-local list) and re-renders the section.
   *
   * @param {number} [highlightRouteId] - Route to visually mark as just-saved.
   */
  refresh(highlightRouteId = null) {
    if (!this.#panel) return;
    if (this.#isSignedIn) {
      fetch('/userapi/routes', { headers: { Accept: 'application/json' } })
        .then((response) => (response.ok ? response.json() : []))
        .then((routes) => this.#render(routes.map((r) => ({
          routeId: r.route_id,
          name: r.name,
          slug: r.slug,
          description: r.description,
          regionName: r.region_name,
          distanceMeters: r.distance_meters,
          savedAt: r.created_at,
          startedCount: r.started_count,
          completedCount: r.completed_count,
          encodedPolyline: r.encoded_polyline,
        })), highlightRouteId))
        .catch(() => this.#render([], null));
    } else {
      this.#render(this.#readGuestRoutes(), highlightRouteId);
    }
  }

  /**
   * Prepends a guest-saved route to the device-local list (capped, newest first).
   *
   * @param {Object} route - {routeId, name, regionName, url, distanceMeters}.
   */
  recordGuestRoute(route) {
    const routes = this.#readGuestRoutes().filter((r) => r.routeId !== route.routeId);
    routes.unshift({ ...route, savedAt: new Date().toISOString() });
    try {
      localStorage.setItem(
        SavedRoutesPanel.STORAGE_KEY, JSON.stringify(routes.slice(0, SavedRoutesPanel.MAX_GUEST_ROUTES)),
      );
    } catch {
      // Storage unavailable (e.g. private browsing): the card still renders for this page load.
    }
  }

  /**
   * Reads the guest routes list from localStorage.
   * @returns {Array<Object>} Saved route records, newest first; empty if none or storage is unavailable.
   */
  #readGuestRoutes() {
    try {
      const raw = localStorage.getItem(SavedRoutesPanel.STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Renders the newest few routes as cards (the section hides itself when there are none).
   *
   * @param {Array<Object>} routes - {routeId, name, regionName, distanceMeters, savedAt, [url]}.
   * @param {number|null} highlightRouteId
   */
  #render(routes, highlightRouteId) {
    const sorted = routes
      .slice()
      .sort((a, b) => new Date(b.savedAt ?? 0) - new Date(a.savedAt ?? 0))
      .slice(0, SavedRoutesPanel.MAX_SHOWN);
    this.#panel.hidden = sorted.length === 0;
    if (sorted.length === 0) return;

    // With more routes than the panel shows, the dashboard link doubles as the "see the rest" affordance.
    const dashboardLink = document.getElementById('saved-routes-dashboard-link');
    if (dashboardLink && routes.length > SavedRoutesPanel.MAX_SHOWN) {
      dashboardLink.textContent = i18next.t('see-all-routes', { count: routes.length });
    }

    this.#list.innerHTML = sorted.map((route) => {
      const cardClasses = ['saved-route-card',
        route.routeId === highlightRouteId ? 'saved-route-card--new' : '',
        route.routeId === this.#activeRouteId ? 'saved-route-card--active' : ''].filter(Boolean).join(' ');
      const thumb = route.encodedPolyline
        ? `<img class="saved-route-thumb" src="${this.#thumbnailUrl(route.encodedPolyline)}" alt="" loading="lazy">`
        : '';
      const usage = typeof route.startedCount === 'number'
        ? `<span class="saved-route-usage" title="${i18next.t('route-usage-tooltip')}">
             ${i18next.t('route-usage', { started: route.startedCount, completed: route.completedCount })}
           </span>`
        : '';
      return `
      <li class="${cardClasses}" data-route-id="${route.routeId}">
        <button type="button" class="saved-route-view" data-route-id="${route.routeId}"
                title="${i18next.t('saved-view-title')}">
          ${thumb}
          <span class="saved-route-name"></span>
          <span class="saved-route-desc" hidden></span>
          <span class="saved-route-meta"></span>
          ${usage}
        </button>
        <div class="saved-route-actions">
          <a class="button-ps button--primary button--tiny saved-route-explore" href="/explore?routeId=${route.routeId}"
             data-route-id="${route.routeId}">${i18next.t('saved-explore')}</a>
          <button type="button" class="button-ps button--secondary button--tiny saved-route-copy"
                  data-route-id="${route.routeId}">${i18next.t('recent-copy-link')}</button>
        </div>
      </li>`;
    }).join('');

    // Names, descriptions, and region text are user/geo data: set via textContent so they can't inject markup.
    this.#list.querySelectorAll('.saved-route-card').forEach((card, i) => {
      const route = sorted[i];
      card.querySelector('.saved-route-name').textContent = route.name;
      const descEl = card.querySelector('.saved-route-desc');
      descEl.textContent = route.description ?? '';
      descEl.hidden = !route.description;
      card.querySelector('.saved-route-meta').textContent = typeof route.distanceMeters === 'number'
        ? this.#formatMeta(route.distanceMeters, route.regionName)
        : (route.regionName ?? '');
      // The copy button builds its URL from the slug; kept in a data attribute so user text can't inject markup.
      if (route.slug) card.querySelector('.saved-route-copy').dataset.slug = route.slug;
    });

    this.#list.querySelectorAll('.saved-route-view').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.logWebpageActivity(`RouteBuilder_Click=SavedRoute_Edit_RouteId=${btn.dataset.routeId}`);
        this.#onView(Number(btn.dataset.routeId));
      });
    });
    this.#list.querySelectorAll('.saved-route-explore').forEach((link) => {
      link.addEventListener('click', () => {
        window.logWebpageActivity(`RouteBuilder_Click=SavedRoute_Explore_RouteId=${link.dataset.routeId}`);
      });
    });
    this.#list.querySelectorAll('.saved-route-copy').forEach((btn) => {
      btn.addEventListener('click', () => {
        // Older guest records predate slugs; their links fall back to the routeId form, which keeps working.
        const url = btn.dataset.slug
          ? `${window.location.origin}/r/${btn.dataset.slug}`
          : `${window.location.origin}/explore?routeId=${btn.dataset.routeId}`;
        navigator.clipboard.writeText(url);
        this.#setTemporaryTooltip(btn, i18next.t('copied-to-clipboard'));
        window.logWebpageActivity(`RouteBuilder_Click=SavedRoute_Copy_RouteId=${btn.dataset.routeId}`);
      });
    });
  }
}

/**
 * The name-your-route save modal (#3343). Owns the name input, submission to POST /saveRoute, and the anonymous
 * "sign in to save" flow: the in-progress route is stashed in sessionStorage, the sign-in modal reloads the page,
 * and RouteBuilder restores the stash (via consumePendingRoute) so the user lands back in the save flow.
 */
class SaveModal {
  // Storage key for the pending route stashed across the sign-in page reload.
  static PENDING_ROUTE_KEY = 'rb-pending-route';

  #backdrop;
  #nameInput;
  #descriptionInput;
  #nameError;
  #isSignedIn;
  #getRegionId;
  #getStreetsPayload;
  #getSuggestedName;
  #onSaved;
  #onClose;

  /**
   * @param {Object} opts
   * @param {boolean} opts.isSignedIn - Whether the user is signed in (vs anonymous), from the server.
   * @param {Function} opts.getRegionId - Returns the current route's region id.
   * @param {Function} opts.getStreetsPayload - Returns the ordered street list in the /saveRoute wire format.
   * @param {Function} opts.getSuggestedName - Returns a suggested route name (e.g. from the endpoint streets).
   * @param {Function} opts.onSaved - Called with (routeId, name, slug) after a successful save.
   * @param {Function} opts.onClose - Called after the modal closes (e.g. to restore focus).
   */
  constructor(opts) {
    this.#isSignedIn = opts.isSignedIn === true;
    this.#getRegionId = opts.getRegionId;
    this.#getStreetsPayload = opts.getStreetsPayload;
    this.#getSuggestedName = opts.getSuggestedName;
    this.#onSaved = opts.onSaved;
    this.#onClose = opts.onClose;

    this.#backdrop = document.getElementById('save-route-modal-backdrop');
    this.#nameInput = document.getElementById('route-name-input');
    this.#descriptionInput = document.getElementById('route-description-input');
    this.#nameError = document.getElementById('route-name-error');

    // The sign-in button only exists for anonymous users.
    document.getElementById('confirm-save-button').addEventListener('click', () => this.#submit());
    document.getElementById('cancel-save-button').addEventListener('click', () => this.#cancel());
    document.getElementById('close-save-modal-button').addEventListener('click', () => this.#cancel());
    document.getElementById('signin-save-button')?.addEventListener('click', () => this.#stashRouteAndSignIn());
    this.#nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.#submit();
    });
    // Focus is always inside the dialog while it's open, so Escape bubbles here.
    this.#backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.#cancel();
    });
  }

  /**
   * Reads and clears the route stashed before a sign-in reload.
   * @returns {Object|null} {regionId, name, description, streets} or null if there is nothing (valid) to restore.
   */
  static consumePendingRoute() {
    try {
      const stash = sessionStorage.getItem(SaveModal.PENDING_ROUTE_KEY);
      if (stash) sessionStorage.removeItem(SaveModal.PENDING_ROUTE_KEY);
      const pending = stash ? JSON.parse(stash) : null;
      return pending && Array.isArray(pending.streets) && pending.streets.length > 0 ? pending : null;
    } catch {
      return null; // Storage unavailable or corrupted stash: nothing to restore.
    }
  }

  /**
   * Opens the save modal with a name suggestion the user can overwrite.
   *
   * @param {string} [prefillName] - Name to prefill (used when restoring a stashed route); defaults to a
   *                                 suggestion built from the route's endpoint streets (or the region).
   * @param {string} [prefillDescription] - Description to prefill (used when restoring a stashed route).
   */
  open(prefillName = null, prefillDescription = null) {
    window.logWebpageActivity('RouteBuilder_Click=OpenSaveModal');
    // maxlength doesn't apply to values set from JS, so the suggestion is clipped by hand.
    const suggestion = (prefillName ?? this.#getSuggestedName()).slice(0, this.#nameInput.maxLength);
    this.#nameInput.value = suggestion;
    if (this.#descriptionInput) this.#descriptionInput.value = prefillDescription ?? '';
    this.#nameError.hidden = true;
    this.#backdrop.style.visibility = 'visible';
    this.#nameInput.focus();
    this.#nameInput.select();
  }

  close() {
    this.#backdrop.style.visibility = 'hidden';
    this.#onClose();
  }

  /** Dismisses the modal without saving (Cancel button, the X, or Escape). */
  #cancel() {
    window.logWebpageActivity('RouteBuilder_Click=CloseSaveModal');
    this.close();
  }

  /** Hides the modal without the close callback (used by the full-UI reset). */
  hide() {
    this.#backdrop.style.visibility = 'hidden';
  }

  /**
   * Stashes the in-progress route in sessionStorage and opens the sign-in modal. Signing in reloads the page;
   * the stash is picked up via consumePendingRoute so the user lands back in the save flow with their route
   * (and typed name) intact — the route is then saved under their registered account.
   */
  #stashRouteAndSignIn() {
    window.logWebpageActivity('RouteBuilder_Click=SignInToSave');
    try {
      sessionStorage.setItem(SaveModal.PENDING_ROUTE_KEY, JSON.stringify({
        regionId: this.#getRegionId(),
        name: this.#nameInput.value.trim(),
        description: this.#descriptionInput?.value.trim() ?? '',
        streets: this.#getStreetsPayload(),
      }));
    } catch {
      // Storage unavailable: sign-in still works, the route just can't be carried across the reload.
    }
    if (window.psAuthModal) {
      window.psAuthModal.open('signIn');
    } else {
      window.location.assign('/signIn?url=%2FrouteBuilder');
    }
  }

  /**
   * Saves the route to the database, then hands off to onSaved (which shows the Route Saved modal).
   */
  #submit() {
    if (!this.#isSignedIn) window.logWebpageActivity('RouteBuilder_Click=ContinueAsGuest');
    const name = this.#nameInput.value.trim();
    const description = this.#descriptionInput?.value.trim() ?? '';

    fetch('/saveRoute', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        region_id: this.#getRegionId(),
        streets: this.#getStreetsPayload(),
        name,
        description,
      }),
    })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          // The server's message is already localized (e.g. a name rejected by the profanity guard).
          this.#nameError.textContent
            = typeof data.message === 'string' ? data.message : i18next.t('save-error');
          this.#nameError.hidden = false;
          window.logWebpageActivity('RouteBuilder_Click=SaveError');
          return;
        }
        this.hide();
        this.#onSaved(data.route_id, data.name, data.slug);
        window.logWebpageActivity(`RouteBuilder_Click=SaveSuccess_RouteId=${data.route_id}`);
      })
      .catch((error) => {
        console.error('Error:', error);
        this.#nameError.textContent = i18next.t('save-error');
        this.#nameError.hidden = false;
        window.logWebpageActivity('RouteBuilder_Click=SaveError');
      });
  }
}

/**
 * Undo history for RouteBuilder edits (#4576). A dumb LIFO of action records — RouteBuilder decides what an
 * action is and how to invert it; this class only stores them and keeps the Undo button's state in sync.
 */
class UndoStack {
  #actions = [];
  #button;

  /**
   * @param {HTMLButtonElement} button - The Undo button; disabled whenever the stack is empty.
   */
  constructor(button) {
    this.#button = button;
    this.#syncButton();
  }

  /**
   * @param {Object} action - An action record (e.g. {type: 'add', streetId: 123}).
   */
  push(action) {
    this.#actions.push(action);
    this.#syncButton();
  }

  /**
   * @returns {Object|null} The most recent action, or null if there is nothing to undo.
   */
  pop() {
    const action = this.#actions.pop() ?? null;
    this.#syncButton();
    return action;
  }

  clear() {
    this.#actions = [];
    this.#syncButton();
  }

  #syncButton() {
    this.#button.disabled = this.#actions.length === 0;
  }
}
