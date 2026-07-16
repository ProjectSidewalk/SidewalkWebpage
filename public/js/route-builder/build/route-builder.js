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
 * The Google-Maps-style Start/End panel for auto-routing (#4579). Typing an address in either field (Mapbox
 * search) drops a draggable pin; once both pins are set, the panel asks RouteBuilder to compute a walking route
 * between them. When the user builds a route manually instead, the fields auto-fill by reverse-geocoding the
 * route's current endpoints and keep updating as it is edited.
 */
class DirectionsPanel {
  // Skip a reverse-geocode when an endpoint moved less than this — the label wouldn't meaningfully change.
  static MIN_MOVE_FOR_GEOCODE_M = 15;

  // A typed address label is kept while the endpoint stays within this distance of it — the route snapping to
  // a nearby street must not overwrite the user's own words with a reverse-geocoded neighbor.
  static KEEP_USER_LABEL_M = 100;

  #map;
  #mapboxApiKey;
  #onPinsChanged;
  #errorEl;
  #startPin = null;
  #endPin = null;
  #lastGeocoded = { start: null, end: null }; // Last [lng, lat] each field was reverse-geocoded for.
  #userLabelCoord = { start: null, end: null }; // Where the user last picked an address by typing (if anywhere).

  /**
   * @param {Object} opts
   * @param {Object} opts.map - The Mapbox map.
   * @param {string} opts.mapboxApiKey
   * @param {Object} opts.bbox - Search bounds: [[west, south], [east, north]].
   * @param {Function} opts.onPinsChanged - Called with ({lng, lat}, {lng, lat}) whenever both pins are set and
   *                                        one of them changed (typed or dragged).
   */
  constructor(opts) {
    this.#map = opts.map;
    this.#mapboxApiKey = opts.mapboxApiKey;
    this.#onPinsChanged = opts.onPinsChanged;
    this.#errorEl = document.getElementById('directions-error');

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
    // onAdd builds the search box's element for this map; we place it in the panel instead of a map corner.
    document.getElementById(`directions-${which}-slot`).append(box.onAdd(this.#map));

    box.addEventListener('retrieve', (event) => {
      const coord = event.detail?.features?.[0]?.geometry?.coordinates;
      if (!coord) return;
      const eventName = which === 'start' ? 'SetStartPin' : 'SetEndPin';
      window.logWebpageActivity(`RouteBuilder_Click=${eventName}`);
      this.#setPin(which, { lng: coord[0], lat: coord[1] });
      this.#lastGeocoded[which] = coord; // The user just named this point; no need to reverse-geocode it.
      this.#userLabelCoord[which] = coord;
      this.#firePinsChanged();
    });
    return box;
  }

  /**
   * Places or moves a pin marker (draggable; dragging recomputes the route).
   *
   * @param {string} which - 'start' or 'end'.
   * @param {Object} lngLat - {lng, lat}.
   */
  #setPin(which, lngLat) {
    const existing = which === 'start' ? this.#startPin : this.#endPin;
    if (existing) {
      existing.setLngLat(lngLat);
      return;
    }
    const marker = new mapboxgl.Marker({
      color: which === 'start' ? '#80c32a' : '#ff6a00',
      draggable: true,
    }).setLngLat(lngLat).addTo(this.#map);
    marker.on('dragend', () => {
      window.logWebpageActivity(`RouteBuilder_Drag=${which === 'start' ? 'StartPin' : 'EndPin'}`);
      this.#userLabelCoord[which] = null; // A drag supersedes any typed address for this endpoint.
      this.#reverseGeocodeInto(which, marker.getLngLat());
      this.#firePinsChanged();
    });
    if (which === 'start') this.#startPin = marker;
    else this.#endPin = marker;
  }

  #firePinsChanged() {
    this.clearError();
    if (this.#startPin && this.#endPin) {
      this.#onPinsChanged(this.#startPin.getLngLat(), this.#endPin.getLngLat());
    }
  }

  /**
   * Syncs the panel with a manually edited route: pins follow the route's endpoints and the fields are
   * refreshed via reverse geocoding (throttled by distance moved).
   *
   * @param {Array<number>|null} startCoord - The route's first coordinate [lng, lat], or null when empty.
   * @param {Array<number>|null} endCoord - The route's last coordinate, or null when empty.
   */
  updateFromRoute(startCoord, endCoord) {
    if (!startCoord || !endCoord) {
      this.clearPins();
      return;
    }
    this.#setPin('start', { lng: startCoord[0], lat: startCoord[1] });
    this.#setPin('end', { lng: endCoord[0], lat: endCoord[1] });
    this.#reverseGeocodeInto('start', { lng: startCoord[0], lat: startCoord[1] });
    this.#reverseGeocodeInto('end', { lng: endCoord[0], lat: endCoord[1] });
  }

  /** Removes both pins and clears the fields (route emptied / reset). */
  clearPins() {
    this.#startPin?.remove();
    this.#endPin?.remove();
    this.#startPin = null;
    this.#endPin = null;
    this.#lastGeocoded = { start: null, end: null };
    this.#userLabelCoord = { start: null, end: null };
    this.#setFieldText('start', '');
    this.#setFieldText('end', '');
    this.clearError();
  }

  /**
   * Shows a routing error under the fields (e.g. no path found).
   * @param {string} message - Already-localized text.
   */
  setError(message) {
    if (!this.#errorEl) return;
    this.#errorEl.textContent = message;
    this.#errorEl.hidden = false;
  }

  clearError() {
    if (this.#errorEl) this.#errorEl.hidden = true;
  }

  /**
   * Fills a field with the nearest address/place name for a coordinate, unless it barely moved since the
   * last lookup or the user is typing in that field.
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
        const label = props?.name_preferred || props?.name || props?.full_address;
        if (label) this.#setFieldText(which, label);
      })
      .catch(() => {
        // Reverse geocoding is best-effort decoration; the pins/route are unaffected.
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
 * The device-local "Your recent routes" list for anonymous users (#3343): remembers guest-saved routes in
 * localStorage and renders the recovery panel on the RouteBuilder intro screen, so a forgotten share link isn't
 * fatal. Signed-in users don't use this — their routes live in the dashboard's My Routes section.
 */
class GuestRoutes {
  static STORAGE_KEY = 'rb-guest-routes';
  static MAX_ROUTES = 20;

  #panel;
  #list;
  #setTemporaryTooltip;

  /**
   * @param {Function} setTemporaryTooltip - Callback (buttonEl, message) that flashes a confirmation tooltip.
   */
  constructor(setTemporaryTooltip) {
    this.#panel = document.getElementById('recent-routes-panel'); // Only rendered for anonymous users.
    this.#list = document.getElementById('recent-routes-list');
    this.#setTemporaryTooltip = setTemporaryTooltip;
  }

  /** Hides the panel (used while a route is being built). */
  hide() {
    if (this.#panel) this.#panel.hidden = true;
  }

  /**
   * Reads the guest routes list from localStorage.
   * @returns {Array<Object>} Saved route records, newest first; empty if none or storage is unavailable.
   */
  read() {
    try {
      const raw = localStorage.getItem(GuestRoutes.STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Prepends a guest-saved route to the device-local recent routes list (capped, newest first).
   *
   * @param {number} routeId
   * @param {string} name
   * @param {string|null} regionName
   * @param {string} url - The shareable /explore?routeId= link.
   */
  record(routeId, name, regionName, url) {
    const routes = this.read().filter((r) => r.routeId !== routeId);
    routes.unshift({
      routeId,
      name,
      regionName,
      savedAt: new Date().toISOString(),
      url,
    });
    try {
      const capped = routes.slice(0, GuestRoutes.MAX_ROUTES);
      localStorage.setItem(GuestRoutes.STORAGE_KEY, JSON.stringify(capped));
    } catch {
      // Storage unavailable (e.g. private browsing): the copy-link flow still works.
    }
  }

  /**
   * Renders the "recent routes on this device" panel (hidden for signed-in users and empty lists).
   */
  render() {
    if (!this.#panel) return; // Panel only exists for anonymous users.
    const routes = this.read();
    this.#panel.hidden = routes.length === 0;
    if (routes.length === 0) return;

    this.#list.innerHTML = routes.map((r) => `
      <li class="recent-route-item">
        <div class="recent-route-info">
          <a href="${r.url}" class="recent-route-name" data-route-id="${r.routeId}"></a>
          <span class="recent-route-meta"></span>
        </div>
        <button type="button" class="recent-route-copy routebuilder-button white-button" data-url="${r.url}"
                data-route-id="${r.routeId}">${i18next.t('recent-copy-link')}</button>
      </li>`).join('');

    // Names and region/date are user/geo data: set via textContent so they can't inject markup.
    this.#list.querySelectorAll('.recent-route-item').forEach((item, i) => {
      const route = routes[i];
      item.querySelector('.recent-route-name').textContent = route.name;
      const date = new Date(route.savedAt).toLocaleDateString(i18next.language);
      item.querySelector('.recent-route-meta').textContent
        = route.regionName ? `${route.regionName} · ${date}` : date;
    });

    this.#list.querySelectorAll('.recent-route-name').forEach((link) => {
      link.addEventListener('click', () => {
        window.logWebpageActivity(`RouteBuilder_Click=RecoverGuestRoute_RouteId=${link.dataset.routeId}`);
      });
    });
    this.#list.querySelectorAll('.recent-route-copy').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.url);
        this.#setTemporaryTooltip(btn, i18next.t('copied-to-clipboard'));
        window.logWebpageActivity(`RouteBuilder_Click=RecoverGuestRoute_Copy_RouteId=${btn.dataset.routeId}`);
      });
    });
  }
}

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
   * @returns {Object|null} {streetId, regionId, nodeKey, distanceM} or null when there are no streets.
   */
  snapToStreet(point) {
    const p = [point.lng, point.lat];
    let best = null;
    this.#features.forEach((feature, streetId) => {
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
 * The name-your-route save modal (#3343). Owns the name input, submission to POST /saveRoute, and the anonymous
 * "sign in to save" flow: the in-progress route is stashed in sessionStorage, the sign-in modal reloads the page,
 * and RouteBuilder restores the stash (via consumePendingRoute) so the user lands back in the save flow.
 */
class SaveModal {
  // Storage key for the pending route stashed across the sign-in page reload.
  static PENDING_ROUTE_KEY = 'rb-pending-route';

  #backdrop;
  #nameInput;
  #nameError;
  #isSignedIn;
  #getRegionId;
  #getRegionName;
  #getStreetsPayload;
  #onSaved;
  #onClose;

  /**
   * @param {Object} opts
   * @param {boolean} opts.isSignedIn - Whether the user is signed in (vs anonymous), from the server.
   * @param {Function} opts.getRegionId - Returns the current route's region id.
   * @param {Function} opts.getRegionName - Returns the current route's region display name (or null).
   * @param {Function} opts.getStreetsPayload - Returns the ordered street list in the /saveRoute wire format.
   * @param {Function} opts.onSaved - Called with (routeId, name) after a successful save.
   * @param {Function} opts.onClose - Called after the modal closes (e.g. to restore focus).
   */
  constructor(opts) {
    this.#isSignedIn = opts.isSignedIn === true;
    this.#getRegionId = opts.getRegionId;
    this.#getRegionName = opts.getRegionName;
    this.#getStreetsPayload = opts.getStreetsPayload;
    this.#onSaved = opts.onSaved;
    this.#onClose = opts.onClose;

    this.#backdrop = document.getElementById('save-route-modal-backdrop');
    this.#nameInput = document.getElementById('route-name-input');
    this.#nameError = document.getElementById('route-name-error');

    // The sign-in button only exists for anonymous users.
    document.getElementById('confirm-save-button').addEventListener('click', () => this.#submit());
    document.getElementById('back-save-button').addEventListener('click', () => this.close());
    document.getElementById('signin-save-button')?.addEventListener('click', () => this.#stashRouteAndSignIn());
    this.#nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.#submit();
    });
  }

  /**
   * Reads and clears the route stashed before a sign-in reload.
   * @returns {Object|null} {regionId, name, streets} or null if there is nothing (valid) to restore.
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
   *                                 localized "Route in {region}" suggestion.
   */
  open(prefillName = null) {
    window.logWebpageActivity('RouteBuilder_Click=OpenSaveModal');
    const regionName = this.#getRegionName();
    this.#nameInput.value
      = prefillName ?? (regionName ? i18next.t('route-name-default', { region: regionName }) : '');
    this.#nameError.hidden = true;
    this.#backdrop.style.visibility = 'visible';
    this.#nameInput.focus();
    this.#nameInput.select();
  }

  close() {
    this.#backdrop.style.visibility = 'hidden';
    this.#onClose();
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

    fetch('/saveRoute', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ region_id: this.#getRegionId(), streets: this.#getStreetsPayload(), name }),
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
        this.#onSaved(data.route_id, data.name);
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
 * The labeled action menu that opens when a street already in the route is clicked (#4578): two explicit
 * buttons — "Reverse direction" and "Remove street".
 */
class StreetPopover {
  #popup;
  #onReverse;
  #onRemove;

  /**
   * @param {Object} map - The Mapbox map.
   * @param {Function} onReverse - Called with the street id when "Reverse direction" is clicked.
   * @param {Function} onRemove - Called with the street id when "Remove street" is clicked.
   */
  constructor(map, onReverse, onRemove) {
    this.map = map;
    this.#onReverse = onReverse;
    this.#onRemove = onRemove;
    this.#popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: true, offset: 10, maxWidth: '260px' });
  }

  /**
   * Opens the menu for a street at the clicked location.
   *
   * @param {number} streetId
   * @param {Object} lngLat - Where to anchor the popup (the click location).
   */
  open(streetId, lngLat) {
    const container = document.createElement('div');
    container.className = 'street-popover';
    container.innerHTML = `
      <button type="button" class="street-popover-btn street-popover-reverse">
        <img src="/assets/images/icons/routebuilder/reverse-street.svg" alt="" class="street-popover-icon">
        <span>${i18next.t('reverse-direction')}</span>
      </button>
      <button type="button" class="street-popover-btn street-popover-remove">
        <img src="/assets/images/icons/routebuilder/delete-street.svg" alt="" class="street-popover-icon">
        <span>${i18next.t('remove-street')}</span>
      </button>`;
    container.querySelector('.street-popover-reverse').addEventListener('click', () => {
      window.logWebpageActivity(`RouteBuilder_Click=ReverseStreet_StreetId=${streetId}`);
      this.#onReverse(streetId);
      this.close();
    });
    container.querySelector('.street-popover-remove').addEventListener('click', () => {
      window.logWebpageActivity(`RouteBuilder_Click=RemoveStreet_StreetId=${streetId}`);
      this.#onRemove(streetId);
      this.close();
    });

    this.#popup.setLngLat(lngLat).setDOMContent(container).addTo(this.map);
    container.querySelector('.street-popover-reverse').focus();
  }

  close() {
    this.#popup.remove();
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
