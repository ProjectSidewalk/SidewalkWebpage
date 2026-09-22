/**
 * The minimap in the bottom-right corner of the UI: a small north-up map that stays centered on the current pano.
 *
 * This class is the only place that names the map library (MapLibre GL, #5429). Everything else draws on the minimap
 * through the methods here, in plain {lat, lng} and DOM elements: addMarker() for the peg, label icons, crumbs and
 * flags; setStreetLines() for a Task's streets; project()/getZoom()/getBounds() for the canvas overlays that
 * ObservedArea and RouteOverview align to the map. Keeping the library behind this seam is what lets the basemap
 * change without touching its callers, so don't hand the map object out.
 *
 * @typedef {object} MinimapMarker
 * @property {HTMLElement} element - The marker's wrapper: what receives focus and the tooltip.
 * @property {HTMLElement} content - The visual the marker was created with, for restyling it in place.
 * @property {(latLng: {lat: number, lng: number}) => void} setLatLng - Moves the marker.
 * @property {(visible: boolean) => void} setVisible - Shows or hides the marker without destroying it.
 * @property {() => void} remove - Takes the marker off the map for good.
 *
 * @typedef {object} MinimapStreetLine
 * @property {'audited'|'remaining'|'completed'|'other'} kind - How to draw it; see MinimapStyle.streetLayers.
 * @property {number[][]} coordinates - The line as [lng, lat] pairs, in walking order (chevrons point along it).
 */
class Minimap {
  // Zoom bounds for the minimap. ObservedArea's REFERENCE_ZOOM must match DEFAULT. MapLibre's zoom z shows the scale
  // of Google's raster z + 1 (a 512px world tile, not 256px), so these are one below the Google minimap's 16/20/18/12.
  /** @type {number} */
  static #MIN_ZOOM = 15;
  /** @type {number} */
  static #MAX_ZOOM = 19;
  /** @type {number} */
  static #DEFAULT_ZOOM = 17;

  // Zoom floor while fitted to the whole route/region; far below MIN_ZOOM, which only bounds manual zooming.
  /** @type {number} */
  static #OVERVIEW_MIN_ZOOM = 11;

  // Route start/finish flags reuse RouteBuilder's flag icons at its rasterized size, planted at the pole base.
  static #ROUTE_FLAG_SIZE_PX = 27;
  static #START_FLAG_SRC = util.assetPath('images/icons/routebuilder/flag-start.svg');
  static #FINISH_FLAG_SRC = util.assetPath('images/icons/routebuilder/flag-end.svg');

  /**
   * A neighborhood mission's start and finish flags, planted on first use and moved after; see updateMissionFlags().
   * @type {{start: ?MinimapMarker, finish: ?MinimapMarker}}
   */
  #missionFlags = { start: null, finish: null };

  // Id of the GeoJSON source holding every street line.
  static #STREETS_SOURCE = 'streets';

  /** The map, or null when it couldn't be created (no WebGL2, or MapLibre failed to load); see create(). */
  /** @type {?maplibregl.Map} */
  #map = null;

  /** The street-level zoom the map is at or animating to, so a recenter mid-animation can't strand a fraction. */
  #targetZoom = Minimap.#DEFAULT_ZOOM;

  /** Each task's lines as GeoJSON features, keyed by its caller's key; together they are the streets source's data. */
  #streetFeatures = new Map();

  /** Handle of the pending animation frame that will upload #streetFeatures, or null when the source is current. */
  #streetFlushHandle = null;

  /** @type {number} */
  #minimapPaneBlinkInterval;

  /** True while the minimap is fitted to the whole route/region instead of following the user. */
  #overviewMode = false;

  /**
   * Creates the map and its street layers. Resolves as soon as the style is ready to draw on — deliberately not when
   * the basemap tiles have arrived: the tile host is a third party, and Explore must start (streets, peg, labels and
   * fog over a blank background) even if it never answers.
   * @param {{lat: number, lng: number}} initialLocation - Initial lat/lng location.
   * @returns {Promise<void>}
   */
  async #init(initialLocation) {
    this.#map = new maplibregl.Map({
      container: 'minimap',
      style: MinimapBasemapStyle.build(initialLocation.lat),
      center: Minimap.#lngLat(initialLocation),
      zoom: Minimap.#DEFAULT_ZOOM,
      minZoom: Minimap.#MIN_ZOOM,
      maxZoom: Minimap.#MAX_ZOOM,
      // Drag to pan and nothing else. Zooming is #setupZoomControls' (whole levels, recentered on the pano), rotation
      // would break north-up, and keyboard panning would take the arrow keys Explore walks with. The next pano, zoom
      // step, or overview recenters a panned map.
      interactive: true,
      dragPan: true,
      scrollZoom: false,
      boxZoom: false,
      doubleClickZoom: false,
      dragRotate: false,
      keyboard: false,
      touchZoomRotate: false,
      touchPitch: false,
      // Added by #addAttribution in its compact form; the default would cover a third of a map this small.
      attributionControl: false,
      // MapLibre names the canvas and the credits button itself, in English unless given these.
      locale: {
        'Map.Title': i18next.t('audit:right-ui.minimap.map-title'),
        'AttributionControl.ToggleAttribution': i18next.t('audit:right-ui.minimap.attribution-toggle'),
      },
    });
    this.#addAttribution();

    this.#setupZoomControls();

    // Redraw the observed-area overlay as the map moves, so the fog/FOV stay aligned through a zoom animation and not
    // just at its end; the route overview inset tracks the same moves so its "current extent" box follows along.
    // A resize is a move too: MapLibre watches its container, so a UI-scale change or the tutorial's fixed square
    // lands here once the map has caught up with its new size.
    // MapLibre gives an interactive canvas a tab stop; it would focus a map the keyboard can't do anything with.
    this.#map.getCanvas().setAttribute('tabindex', '-1');
    this.#map.on('dragend', () => svl.tracker.push('Minimap_Pan'));

    this.#map.on('move', () => {
      this.#updateRecenterButton();
      // ObservedArea.update redraws the inset too, so the inset is drawn here only before ObservedArea exists.
      if (svl.observedArea) svl.observedArea.update();
      else if (svl.routeOverview) svl.routeOverview.render();
    });

    await new Promise((resolve) => this.#map.once('style.load', resolve));

    const pixelRatio = window.devicePixelRatio || 1;
    this.#map.addImage(MinimapStyle.CHEVRON_IMAGE_ID, MinimapStyle.chevronImage(pixelRatio), { pixelRatio });
    this.#map.addSource(Minimap.#STREETS_SOURCE, { type: 'geojson', data: this.#streetFeatureCollection() });
    // Over the road names: with roads at real width a name runs down the middle of its street, where it would hide
    // the route line. The route matters more than the name, which shows wherever the street isn't on the route.
    for (const layer of MinimapStyle.streetLayers(Minimap.#STREETS_SOURCE)) this.#map.addLayer(layer);
  }

  /**
   * Adds the map data attribution as a collapsed "i" button that expands on click, and logs each toggle.
   *
   * MapLibre opens a compact attribution as soon as the tile source reports its credits, and closes it on the first
   * drag of the map. This map can't be dragged, so left alone the credits would cover a third of it for the whole
   * session. Closing them the moment they first open leaves the button, which still toggles them.
   *
   * Mounted in the holder, not via addControl: inside the map's isolated stacking context (#minimap in
   * svl-minimap.css) the expanded credits would open under the legend.
   */
  #addAttribution() {
    const holder = document.getElementById('minimap-holder');
    if (!holder) return;
    // The bottom-right class keeps MapLibre's own compact-attribution styling, which keys on the control's corner.
    const corner = document.createElement('div');
    corner.id = 'minimap-attribution';
    corner.className = 'maplibregl-ctrl-bottom-right';
    corner.appendChild(new maplibregl.AttributionControl({ compact: true }).onAdd(this.#map));
    holder.appendChild(corner);
    const attribution = corner.querySelector('.maplibregl-ctrl-attrib');
    const button = corner.querySelector('.maplibregl-ctrl-attrib-button');
    if (!attribution || !button) return;
    const opened = 'maplibregl-compact-show';
    // Closed the way MapLibre's own toggle closes it: the class shows the credits, and the <details> `open`
    // attribute is what the <summary> button announces as expanded to assistive tech.
    const close = () => {
      attribution.classList.remove(opened);
      attribution.removeAttribute('open');
    };
    const observer = new MutationObserver(() => {
      if (!attribution.classList.contains(opened)) return;
      observer.disconnect();
      close();
    });
    observer.observe(attribution, { attributes: true, attributeFilter: ['class'] });
    // MapLibre toggles the class in its own click handler on the button, which runs before this one.
    button.addEventListener('click', () => {
      const isOpen = attribution.classList.contains(opened);
      svl.tracker.push('Click_MinimapAttribution', { action: isOpen ? 'open' : 'close', trigger: 'button' });
    });
    // Like the legend card, the open credits are a popover: a click elsewhere or Esc dismisses them.
    const dismiss = (trigger) => {
      if (!attribution.classList.contains(opened)) return;
      close();
      svl.tracker.push('Click_MinimapAttribution', { action: 'close', trigger });
    };
    document.addEventListener('pointerdown', (e) => {
      if (!corner.contains(/** @type {Node} */ (e.target))) dismiss('outside');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      dismiss('escape');
      if (corner.contains(document.activeElement)) button.focus();
    });
  }

  /**
   * Wires up the minimap's zoom interactions: scroll-wheel zooming over the map and the on-map +/- buttons. Each step
   * recenters on the current pano so the map never drifts off-center, keeping the FOV cone aligned.
   */
  #setupZoomControls() {
    const holder = document.getElementById('minimap-holder');
    if (holder) {
      // Scroll wheel: one notch per zoom level. preventDefault stops the wheel from scrolling the sidebar/page.
      holder.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.#changeZoom(e.deltaY < 0 ? 1 : -1);
      }, { passive: false });
    }

    const zoomInButton = document.getElementById('minimap-zoom-in');
    const zoomOutButton = document.getElementById('minimap-zoom-out');
    if (zoomInButton) zoomInButton.addEventListener('click', () => this.#changeZoom(1));
    if (zoomOutButton) zoomOutButton.addEventListener('click', () => this.#changeZoom(-1));

    const fitButton = document.getElementById('minimap-zoom-fit');
    if (fitButton) {
      fitButton.addEventListener('click', () => this.toggleOverview('fit-button'));
    }

    const recenterButton = document.getElementById('minimap-recenter');
    if (recenterButton) {
      recenterButton.addEventListener('click', () => {
        this.#targetZoom = Minimap.#DEFAULT_ZOOM;
        this.#map.easeTo({ center: Minimap.#lngLat(svl.panoViewer.getPosition()), zoom: this.#targetZoom });
        svl.tracker.push('Click_MinimapRecenter');
      });
    }
  }

  /**
   * Shows the recenter button only while the map is panned away from the user, so it doubles as the sign that the
   * view is off-center. Not in the overview, whose own button already leads back.
   */
  #updateRecenterButton() {
    const button = document.getElementById('minimap-recenter');
    if (!button || !svl.panoViewer) return;
    const container = this.#map.getContainer();
    const pano = this.project(svl.panoViewer.getPosition());
    const offBy = Math.hypot(pano.x - container.clientWidth / 2, pano.y - container.clientHeight / 2);
    // A few px of slack: a pano change recenters, but the easing and subpixel positions never land exactly.
    const panned = !this.#overviewMode && offBy > 8;
    if (button.hidden === !panned) return;
    // Leaving focus on a button that's about to vanish would drop keyboard focus to the page.
    if (!panned && document.activeElement === button) document.getElementById('minimap-zoom-in')?.focus();
    button.hidden = !panned;
  }

  /**
   * Toggles the fitted whole-route overview: fits to the route if currently at street level, or returns to street
   * level if already fitted. Invoked by the ⛶ button and, on designated routes, by clicking the route-overview inset.
   * @param {string} trigger - What initiated the toggle (for interaction logging).
   */
  toggleOverview(trigger) {
    if (!this.#map || svl.ui.minimap.holder.hasClass('minimap-tutorial')) return;
    if (this.#overviewMode) {
      this.exitOverview(trigger);
    } else {
      this.enterOverview();
    }
    svl.tracker.push('Click_MinimapFitRoute', { mode: this.#overviewMode ? 'overview' : 'street', trigger });
  }

  /**
   * Changes the minimap zoom by the given (signed) number of levels, clamped to the configured min/max.
   * @param {number} delta - Number of zoom levels to add (positive zooms in, negative zooms out).
   */
  #changeZoom(delta) {
    if (!this.#map || svl.ui.minimap.holder.hasClass('minimap-tutorial')) return;
    // Manual zooming while fitted means the user wants street level back; the exit already resets the zoom.
    if (this.#overviewMode) {
      this.exitOverview('zoom');
      return;
    }
    // Step from the target, not getZoom(): a wheel notch landing mid-animation would otherwise step from a fraction.
    const newZoom = Math.min(Minimap.#MAX_ZOOM, Math.max(Minimap.#MIN_ZOOM, this.#targetZoom + delta));
    if (newZoom !== this.#targetZoom) {
      this.#targetZoom = newZoom;
      // Naming the center keeps the pano under the peg for the whole animation. easeTo skips the animation itself
      // under prefers-reduced-motion.
      this.#map.easeTo({ zoom: newZoom, center: Minimap.#lngLat(svl.panoViewer.getPosition()), duration: 200 });
    }
  }

  /**
   * Fits the minimap to all loaded streets (the route when on one, the region otherwise) so the user can see
   * overall progress at a glance. The fog/FOV/ring overlays are hidden via the minimap-overview class while fitted —
   * they only make sense at street zoom, centered on the user.
   */
  enterOverview() {
    if (!this.#map) return;
    const bounds = this.#streetBounds();
    if (!bounds || this.#overviewMode) return;
    this.#overviewMode = true;
    this.#updateFitButtonLabel();
    svl.ui.minimap.holder.addClass('minimap-overview');
    this.#map.setMinZoom(Minimap.#OVERVIEW_MIN_ZOOM);
    this.#map.fitBounds(bounds, { padding: 12, animate: false });
  }

  /**
   * Leaves the fitted overview and returns to street-level zoom centered on the user's pano.
   * @param {string} trigger - What ended the overview (for interaction logging).
   */
  exitOverview(trigger) {
    if (!this.#overviewMode) return;
    this.#overviewMode = false;
    this.#updateFitButtonLabel();
    svl.ui.minimap.holder.removeClass('minimap-overview');
    // Zoom in before raising the floor: raising it first would make MapLibre clamp the zoom itself, firing a move at
    // the overview's center.
    this.#targetZoom = Minimap.#DEFAULT_ZOOM;
    this.#map.jumpTo({ zoom: this.#targetZoom, center: Minimap.#lngLat(svl.panoViewer.getPosition()) });
    this.#map.setMinZoom(Minimap.#MIN_ZOOM);
    svl.tracker.push('MinimapOverview_End', { trigger });
  }

  /**
   * Syncs the fit/overview button's tooltip and aria-label to the current mode: "show whole route" at street level,
   * "back to street level" while fitted to the route.
   */
  #updateFitButtonLabel() {
    const fitButton = document.getElementById('minimap-zoom-fit');
    if (!fitButton) return;
    const key = this.#overviewMode ? 'audit:right-ui.minimap.fit-street' : 'audit:right-ui.minimap.fit-mission';
    const label = i18next.t(key);
    fitButton.title = label;
    fitButton.setAttribute('aria-label', label);
  }

  /**
   * Bounds framing "your route": on a designated route, every loaded street; on a region audit, the current
   * mission's streets plus the one you're on (the region as a whole would zoom out far past the route — #4639).
   * @returns {?maplibregl.LngLatBounds} Null if no street geometry is available yet.
   */
  #streetBounds() {
    if (!svl.taskContainer) return null;
    let tasks;
    if (svl.regionModel && svl.regionModel.isRoute) {
      // On a designated route every loaded street IS the route, so fit them all.
      tasks = svl.taskContainer.getTasks();
    } else {
      // A region audit loads the entire region; fit just this mission's streets plus the street you're on. Early
      // in a mission that's essentially the current street — i.e. a normal street-level view, not the whole region.
      const mission = svl.missionContainer && svl.missionContainer.getCurrentMission();
      tasks = ((mission && mission.getRoute()) || []).slice();
      const current = svl.taskContainer.getCurrentTask();
      if (current && !tasks.includes(current)) tasks.push(current);
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const task of tasks) {
      for (const coord of task.getGeoJSON().geometry.coordinates) {
        bounds.extend(coord);
      }
    }
    return bounds.isEmpty() ? null : bounds;
  }

  /**
   * Updates the minimap's mission-progress bar: fills it to the mission's completion fraction and labels it with the
   * percentage and the distance explored so far out of the mission's target (e.g. "65%  325/500 ft").
   * @param {Mission} mission - The current mission.
   */
  updateMissionProgress(mission) {
    this.updateMissionFlags(mission);
    const totalMeters = mission.getDistance('meters');
    // Free-exploration missions (#4451) have no distance target; a "0/0" progress bar would be meaningless, so hide it.
    if (!totalMeters) {
      svl.ui.minimap.missionProgress.css('display', 'none');
      return;
    }
    svl.ui.minimap.missionProgress.css('display', '');

    const fraction = mission.getMissionCompletionRate();
    const doneMeters = Math.min(Math.max(mission.getProperty('distanceProgress') || 0, 0), totalMeters);
    const percent = Math.round(fraction * 100);

    svl.ui.minimap.missionProgressFill.css('width', `${percent}%`);
    svl.ui.minimap.missionProgressPercent.text(`${percent}%`);
    svl.ui.minimap.missionProgressDistance.text(
      i18next.t('common:distance-progress', { done: doneMeters, total: totalMeters }),
    );
    svl.ui.minimap.missionProgress.attr('aria-valuenow', percent);
  }

  /**
   * Resets the mission-progress bar to 0% for a freshly started mission, mirroring the sidebar bar's reset when the
   * mission-complete modal closes. Shows "0 / <target>" so the new mission's length is visible right away, and
   * re-plants the flags for the new mission: its start is where the last one finished, so the red finish flag the
   * user just reached becomes the green start flag without waiting for their next step (#5378).
   * @param {Mission} [mission] - The newly started mission; if absent, the distance label is cleared.
   */
  resetMissionProgress(mission) {
    svl.ui.minimap.missionProgressFill.css('width', '0%');
    svl.ui.minimap.missionProgressPercent.text('0%');
    svl.ui.minimap.missionProgress.attr('aria-valuenow', 0);
    if (mission) {
      this.updateMissionFlags(mission);
      const totalMeters = mission.getDistance('meters');
      svl.ui.minimap.missionProgressDistance.text(
        i18next.t('common:distance-progress', { done: 0, total: totalMeters }),
      );
    } else {
      svl.ui.minimap.missionProgressDistance.text('');
    }
  }

  /**
   * Makes the minimap start to blink; used in the tutorial.
   */
  blinkMinimap() {
    this.stopBlinkingMinimap();
    this.#minimapPaneBlinkInterval = window.setInterval(() => {
      svl.ui.minimap.overlay.toggleClass('highlight-50');
    }, 500);
  }

  /**
   * Stops the minimap from blinking; used in the tutorial.
   */
  stopBlinkingMinimap() {
    window.clearInterval(this.#minimapPaneBlinkInterval);
    svl.ui.minimap.overlay.removeClass('highlight-50');
  }

  /**
   * @param {{lat: number, lng: number}} latLng
   * @returns {[number, number]} The same point in MapLibre's [lng, lat] order.
   */
  static #lngLat(latLng) {
    return [latLng.lng, latLng.lat];
  }

  /**
   * Puts a DOM element on the map at a location. Every marker on the minimap comes through here: the peg, label
   * icons, visited and forward crumbs, and the route/mission flags.
   *
   * What a marker is to assistive tech follows from what it does. One with an onClick is a button (focusable,
   * activated by click or Enter) named by its title. One with only a title is an image named by it. One with
   * neither is decoration: hidden from the accessibility tree and click-through, so it can't swallow a click meant
   * for a marker beneath it (the crumbs nearest the user sit inside the peg's box, #2561).
   * @param {{lat: number, lng: number}} latLng - Where the marker goes.
   * @param {HTMLElement} content - The marker's visual. It may carry its own CSS transform (the peg rotates): the
   *                                map positions a wrapper around it, never the element itself.
   * @param {object} [options]
   * @param {'center'|'bottom'} [options.anchor='center'] - Which part of the content sits on the location.
   * @param {?(() => void)} [options.onClick] - Makes the marker a button that calls this.
   * @param {?string} [options.title] - Hover tooltip and accessible name.
   * @param {number} [options.zIndex=0] - Stacking order among markers.
   * @returns {MinimapMarker}
   */
  addMarker(latLng, content, { anchor = 'center', onClick = null, title = null, zIndex = 0 } = {}) {
    const element = document.createElement('div');
    element.className = 'minimap-marker';
    element.style.zIndex = String(zIndex);
    element.appendChild(content);
    if (title) element.title = title;

    // MapLibre gives a marker built from our own element no role or name, so each one states what it is here.
    if (onClick) {
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
      element.setAttribute('aria-label', title || '');
      element.addEventListener('click', onClick);
      // Enter only: Space is Explore's global "step forward" key, so a marker acting on it too would fire both.
      element.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        onClick();
      });
    } else if (title) {
      element.setAttribute('role', 'img');
      element.setAttribute('aria-label', title);
    } else {
      element.setAttribute('role', 'presentation');
      element.setAttribute('aria-label', '');
      element.setAttribute('aria-hidden', 'true');
      element.classList.add('minimap-marker-decorative');
    }

    // Without a map the marker is kept but never shown, so its callers need no special case.
    if (!this.#map) {
      return { element, content, setLatLng: () => {}, setVisible: () => {}, remove: () => {} };
    }

    // Subpixel positioning keeps markers from jittering against the fog canvas during a zoom animation.
    const marker = new maplibregl.Marker({ element, anchor, subpixelPositioning: true })
      .setLngLat(Minimap.#lngLat(latLng))
      .addTo(this.#map);
    return {
      element,
      content,
      setLatLng: (newLatLng) => marker.setLngLat(Minimap.#lngLat(newLatLng)),
      setVisible: (visible) => element.toggleAttribute('hidden', !visible),
      remove: () => marker.remove(),
    };
  }

  /**
   * Sets how one street is drawn, replacing whatever it drew before. The map is updated once per animation frame
   * however many streets change in it, so rendering a whole region's tasks on load costs a single upload.
   * @param {string|number} key - Which drawing of a street this is. Distinct per task, not per street: a route that
   *                              walks a street out and back draws it twice, once per direction.
   * @param {MinimapStreetLine[]} lines - Its lines. A line needs two points to be one, so shorter ones are dropped
   *                                      (turf can slice a street's half down to a single point at an endpoint).
   */
  setStreetLines(key, lines) {
    const features = lines
      .filter((line) => line.coordinates.length > 1)
      .map((line) => ({
        type: 'Feature',
        properties: { kind: line.kind },
        geometry: { type: 'LineString', coordinates: line.coordinates },
      }));
    if (features.length > 0) {
      this.#streetFeatures.set(key, features);
    } else {
      this.#streetFeatures.delete(key);
    }
    this.#scheduleStreetFlush();
  }

  /**
   * Stops drawing a street.
   * @param {string|number} key - The key it was drawn under by setStreetLines.
   */
  clearStreetLines(key) {
    if (this.#streetFeatures.delete(key)) this.#scheduleStreetFlush();
  }

  /** @returns {object} Every street's lines as one GeoJSON FeatureCollection. */
  #streetFeatureCollection() {
    return { type: 'FeatureCollection', features: [...this.#streetFeatures.values()].flat() };
  }

  /** Queues one upload of the street lines for the next animation frame, unless one is already queued. */
  #scheduleStreetFlush() {
    if (!this.#map || this.#streetFlushHandle !== null) return;
    this.#streetFlushHandle = window.requestAnimationFrame(() => {
      this.#streetFlushHandle = null;
      this.#map.getSource(Minimap.#STREETS_SOURCE).setData(this.#streetFeatureCollection());
    });
  }

  /**
   * @returns {boolean} Whether the map exists; project(), getZoom() and getBounds() need it, so overlays check first.
   */
  isAvailable() {
    return this.#map !== null;
  }

  /**
   * Where a location falls on the minimap, for overlays drawn on the canvases stacked over the map.
   * @param {{lat: number, lng: number}} latLng
   * @returns {{x: number, y: number}} CSS px from the map's top-left corner.
   */
  project(latLng) {
    const point = this.#map.project(Minimap.#lngLat(latLng));
    return { x: point.x, y: point.y };
  }

  /** @returns {number} The current zoom level; fractional while a zoom is animating. */
  getZoom() {
    return this.#map.getZoom();
  }

  /** @returns {{north: number, south: number, east: number, west: number}} The geographic extent now on screen. */
  getBounds() {
    const bounds = this.#map.getBounds();
    return { north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest() };
  }

  /**
   * Shows or hides the basemap, leaving the streets and markers drawn over it. The tutorial hides it: its minimap is
   * a fixed screenshot, set as the holder's background, that the markers and fog are aligned to.
   * @param {boolean} visible
   */
  setBasemapVisible(visible) {
    if (!this.#map) return;
    // A hidden basemap means the tutorial's fixed screenshot is the backdrop, and panning would slide the map off it.
    if (visible) this.#map.dragPan.enable();
    else this.#map.dragPan.disable();
    const visibility = visible ? 'visible' : 'none';
    for (const layer of this.#map.getStyle().layers) {
      if (layer.type === 'background' || layer.source === MinimapBasemapStyle.SOURCE_ID) {
        this.#map.setLayoutProperty(layer.id, 'visibility', visibility);
      }
    }
  }

  /**
   * Sets the center of the minimap to the given lat/lng.
   * @param {{lat: number, lng: number}} latLng
   */
  setMinimapLocation(latLng) {
    if (!this.#map) return;
    // Reaching a new pano while fitted means the user is exploring again — drop back to street level first.
    if (this.#overviewMode) this.exitOverview('pano-changed');
    // Naming the zoom finishes any zoom animation this jump cuts short, instead of leaving it at a fraction.
    this.#map.jumpTo({ center: Minimap.#lngLat(latLng), zoom: this.#targetZoom });
  }

  /**
   * Draws the route's start and finish flags on the minimap (routes only), reusing the same flag icons the user
   * placed while building the route so building and walking read as one experience. The flags reinforce route
   * status already conveyed textually (progress bar, finish toast, compass message); their tooltip names them for
   * anyone hovering.
   * @param {{lat: number, lng: number}} start - Route start (first street's walking-start coordinate).
   * @param {{lat: number, lng: number}} finish - Route finish (last street's walking-end coordinate).
   */
  showRouteEndpoints(start, finish) {
    this.#plantFlag(start, Minimap.#START_FLAG_SRC, i18next.t('audit:right-ui.minimap.route-start-flag'));
    this.#plantFlag(finish, Minimap.#FINISH_FLAG_SRC, i18next.t('audit:right-ui.minimap.route-finish-flag'));
  }

  /**
   * Plants a neighborhood mission's start and finish flags, so a mission reads the way a RouteBuilder route does.
   * The start is where the mission began (recorded on the task it began on, and persisted with it). The finish is
   * only knowable once the mission's remaining distance fits on the current street, since a neighborhood mission
   * picks each next street as it goes; until then no finish flag shows. Routes keep their whole-route flags; the
   * tutorial and free exploration have no mission to frame.
   * @param {Mission} mission - The current mission.
   */
  updateMissionFlags(mission) {
    const noMissionToFrame = (svl.regionModel && svl.regionModel.isRoute) || !svl.taskContainer
      || (svl.isOnboarding && svl.isOnboarding()) || (svl.isExploreAddressMode && svl.isExploreAddressMode());
    if (noMissionToFrame) return;
    const missionId = mission.getProperty('missionId');
    const startTask = svl.taskContainer.getTasks().find((task) => task.getMissionStart(missionId));
    this.#placeFlag('start', startTask ? startTask.getMissionStart(missionId) : null,
      Minimap.#START_FLAG_SRC, 'mission-start-flag');
    this.#placeFlag('finish', Minimap.missionFinish(mission, svl.taskContainer.getCurrentTask()),
      Minimap.#FINISH_FLAG_SRC, 'mission-finish-flag');
  }

  /**
   * Where a mission will end, once that point lies on the current street: the mission's remaining distance walked
   * along the street from the furthest point reached. Null while a later, not-yet-chosen street will carry the end.
   * @param {Mission} mission - The current mission.
   * @param {?Task} task - The current task.
   * @returns {?{lat: number, lng: number}}
   */
  static missionFinish(mission, task) {
    const totalMeters = mission.getDistance('meters');
    if (!totalMeters || !task) return null;
    const remainingKm = Math.max(0, totalMeters - (mission.getProperty('distanceProgress') || 0)) / 1000;
    const remainder = NavigationService.remainderOfStreet(task);
    if (remainingKm > turf.length(remainder)) return null;
    const [lng, lat] = turf.along(remainder, remainingKm).geometry.coordinates;
    return { lat, lng };
  }

  /**
   * Plants, moves, or hides one of the mission flags.
   * @param {'start'|'finish'} which - Which flag.
   * @param {?{lat: number, lng: number}} latLng - Where it goes, or null to hide it.
   * @param {string} src - The flag image.
   * @param {string} i18nKey - Key under audit:right-ui.minimap for its tooltip.
   */
  #placeFlag(which, latLng, src, i18nKey) {
    const flag = this.#missionFlags[which];
    if (!latLng) {
      if (flag) flag.setVisible(false);
      return;
    }
    if (!flag) {
      this.#missionFlags[which] = this.#plantFlag(latLng, src, i18next.t(`audit:right-ui.minimap.${i18nKey}`));
      return;
    }
    flag.setLatLng(latLng);
    flag.setVisible(true);
  }

  /**
   * One flag marker, planted with its pole base on the point (the bottom anchor matches RouteBuilder's icon-anchor).
   * @param {{lat: number, lng: number}} latLng - Where to plant it.
   * @param {string} src - The flag image.
   * @param {string} title - Hover tooltip and accessible name.
   * @returns {MinimapMarker}
   */
  #plantFlag(latLng, src, title) {
    const content = document.createElement('img');
    content.src = src;
    content.alt = title;
    content.style.width = `${Minimap.#ROUTE_FLAG_SIZE_PX}px`;
    return this.addMarker(latLng, content, { anchor: 'bottom', title });
  }

  /**
   * Makes MapLibre available as the `maplibregl` global the rest of this class names.
   *
   * MapLibre 6 ships only as ES modules, which this classic-script bundle can load only through import(). The URL is
   * the view's #maplibre-module preload link, the one place that can fingerprint a vendor file; the library's chunks
   * resolve relative to it, so they stay beside it under their own names. A global already present (the jsdom tests'
   * stand-in) is kept.
   * @returns {Promise<void>}
   */
  static async #loadLibrary() {
    if (typeof maplibregl !== 'undefined') return;
    const link = /** @type {?HTMLLinkElement} */ (document.getElementById('maplibre-module'));
    if (!link) throw new Error('Minimap: no #maplibre-module link on the page to load MapLibre from');
    window.maplibregl = await import(link.href);
  }

  /**
   * Takes down whatever #init built and says in the minimap's place that the map can't be shown.
   * @param {Error} error - Why the map couldn't be created.
   */
  #showUnavailable(error) {
    console.error('Minimap: the map could not be created, so Explore continues without it.', error);
    if (this.#map) {
      try {
        this.#map.remove();
      } catch (removeError) {
        console.error(removeError);
      }
    }
    this.#map = null;
    document.getElementById('minimap-attribution')?.remove();
    svl.ui.minimap.holder.addClass('minimap-unavailable');
    const message = document.getElementById('minimap-unavailable-message');
    if (message) message.hidden = false;
    svl.tracker.push('Minimap_Unavailable', { error: String(error && error.message ? error.message : error) });
  }

  /**
   * Factory function that creates the minimap in the bottom-right of the UI.
   *
   * Never rejects. MapLibre needs WebGL2 and throws without it (hardware acceleration off, a GPU the browser
   * blocklists, some remote desktops); a minimap that can't draw must not stop the rest of Explore from starting, so
   * that and any failure to load the library leave a minimap that draws nothing and says so.
   * @param {{lat: number, lng: number}} initialLocation - Initial lat/lng location.
   * @returns {Promise<Minimap>} The minimap instance.
   */
  static async create(initialLocation) {
    const newMinimap = new Minimap();
    try {
      await Minimap.#loadLibrary();
      await newMinimap.#init(initialLocation);
    } catch (error) {
      newMinimap.#showUnavailable(error);
    }
    return newMinimap;
  }
}
