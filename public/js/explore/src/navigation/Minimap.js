/**
 * Handles the Google Maps minimap in the bottom-right corner of the UI.
 */
class Minimap {
  // Zoom bounds for the minimap. ObservedArea's REFERENCE_ZOOM must match DEFAULT.
  /** @type {number} */
  static #MIN_ZOOM = 16;
  /** @type {number} */
  static #MAX_ZOOM = 20;
  /** @type {number} */
  static #DEFAULT_ZOOM = 18;

  // Zoom floor while fitted to the whole route/neighborhood; far below MIN_ZOOM, which only bounds manual zooming.
  /** @type {number} */
  static #OVERVIEW_MIN_ZOOM = 12;

  /** @type {google.maps.Map} */
  #map;

  /** @type {number} */
  #minimapPaneBlinkInterval;

  /** True while the minimap is fitted to the whole route/neighborhood instead of following the user. */
  #overviewMode = false;

  /**
   * Imports necessary libraries and creates the map. Resolves once the map has finished loading.
   * @param {{lat: number, lng: number}} initialLocation - Initial lat/lng location.
   * @returns {Promise<google.maps.Map>}
   */
  async #init(initialLocation) {
    const { LatLng } = await google.maps.importLibrary('core');
    const { Map, MapTypeId, RenderingType } = await google.maps.importLibrary('maps');

    // Create the minimap.
    const mapOptions = {
      backgroundColor: 'none',
      cameraControl: false,
      center: new LatLng(initialLocation.lat, initialLocation.lng),
      clickableIcons: false,
      disableDefaultUi: true,
      fullscreenControl: false,
      // Panning is disabled (the map must stay centered on the user's pano so the FOV cone lines up); zooming is
      // instead driven manually by #setupZoomControls so the center is preserved.
      gestureHandling: 'none',
      keyboardShortcuts: false,
      // Map style is changed via cloud-based maps styling in the Google Cloud Console.
      mapId: '9c9a85114c815aa4d4dbd5d3',
      mapTypeControl: false,
      mapTypeId: MapTypeId.ROADMAP, // HYBRID is another option
      maxZoom: Minimap.#MAX_ZOOM,
      minZoom: Minimap.#MIN_ZOOM,
      renderingType: RenderingType.RASTER,
      zoom: Minimap.#DEFAULT_ZOOM,
    };
    this.#map = new Map(document.getElementById('minimap'), mapOptions);

    this.#setupZoomControls();

    // Redraw the observed-area overlay whenever the map settles (e.g. after a zoom) so the fog/FOV stay aligned.
    google.maps.event.addListener(this.#map, 'idle', () => {
      if (svl.observedArea) svl.observedArea.update();
    });

    // Return a promise that resolves once the map is idle (and therefore fully initialized).
    return new Promise((resolve) => {
      const listener = google.maps.event.addListener(this.#map, 'idle', () => {
        google.maps.event.removeListener(listener);
        resolve(this.#map);
      });
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
      fitButton.addEventListener('click', () => {
        if (svl.ui.minimap.holder.hasClass('minimap-tutorial')) return;
        if (this.#overviewMode) {
          this.exitOverview('fit-button');
        } else {
          this.enterOverview(false);
        }
        svl.tracker.push('Click_MinimapFitRoute', { mode: this.#overviewMode ? 'overview' : 'street' });
      });
    }
  }

  /**
   * Changes the minimap zoom by the given (signed) number of levels, clamped to the configured min/max.
   * @param {number} delta - Number of zoom levels to add (positive zooms in, negative zooms out).
   */
  #changeZoom(delta) {
    if (svl.ui.minimap.holder.hasClass('minimap-tutorial')) return;
    // Manual zooming while fitted means the user wants street level back; the exit already resets the zoom.
    if (this.#overviewMode) {
      this.exitOverview('zoom');
      return;
    }
    const newZoom = Math.min(Minimap.#MAX_ZOOM, Math.max(Minimap.#MIN_ZOOM, this.#map.getZoom() + delta));
    if (newZoom !== this.#map.getZoom()) {
      this.#map.setZoom(newZoom);
    }
  }

  /**
   * Fits the minimap to all loaded streets (the route when on one, the neighborhood otherwise) so the user can see
   * overall progress at a glance. The fog/FOV/ring overlays are hidden via the minimap-overview class while fitted —
   * they only make sense at street zoom, centered on the user.
   * @param {boolean} isIntro - True when shown automatically at mission start; auto-exits on first pano interaction.
   */
  enterOverview(isIntro) {
    const bounds = this.#streetBounds();
    if (!bounds || this.#overviewMode) return;
    this.#overviewMode = true;
    svl.ui.minimap.holder.addClass('minimap-overview');
    this.#map.setOptions({ minZoom: Minimap.#OVERVIEW_MIN_ZOOM });
    this.#map.fitBounds(bounds, 12);
    if (isIntro) {
      // Return to street level as soon as the user starts looking around; stepping to a new pano also exits (via
      // setMinimapLocation). exitOverview no-ops if something else already ended the overview.
      svl.ui.streetview.viewControlLayer[0].addEventListener('pointerdown',
        () => this.exitOverview('pano-interaction'), { once: true });
      svl.tracker.push('MinimapOverview_IntroShown');
    }
  }

  /**
   * Leaves the fitted overview and returns to street-level zoom centered on the user's pano.
   * @param {string} trigger - What ended the overview (for interaction logging).
   */
  exitOverview(trigger) {
    if (!this.#overviewMode) return;
    this.#overviewMode = false;
    svl.ui.minimap.holder.removeClass('minimap-overview');
    this.#map.setOptions({ minZoom: Minimap.#MIN_ZOOM });
    this.#map.setZoom(Minimap.#DEFAULT_ZOOM);
    this.#map.setCenter(svl.panoViewer.getPosition());
    svl.tracker.push('MinimapOverview_End', { trigger });
  }

  /**
   * Bounds covering every loaded task's street geometry. On a user route that's the route; on a regular mission it's
   * the neighborhood's streets — either way, the meaningful "whole picture" for the overview.
   * @returns {google.maps.LatLngBounds|null} Null if no task geometry is available yet.
   */
  #streetBounds() {
    if (!svl.taskContainer) return null;
    const bounds = new google.maps.LatLngBounds();
    for (const task of svl.taskContainer.getTasks()) {
      for (const coord of task.getGeoJSON().geometry.coordinates) {
        bounds.extend({ lat: coord[1], lng: coord[0] });
      }
    }
    return bounds.isEmpty() ? null : bounds;
  }

  /**
   * Updates the minimap's "distance left" chip with the given mission's remaining distance.
   * @param {Mission} mission - The current mission.
   */
  updateDistanceLeft(mission) {
    const remaining = Math.max(0, mission.getDistance('meters') - (mission.getProperty('distanceProgress') || 0));
    svl.ui.minimap.distanceLeft.text(
      i18next.t('right-ui.minimap.distance-left', { distance: util.misc.distanceToString(remaining) }),
    );
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
   * Get the Google map.
   * @returns {google.maps.Map}
   */
  getMap() {
    return this.#map;
  }

  /**
   * Sets the center of the minimap to the given lat/lng.
   * @param {{lat: number, lng: number}} latLng
   */
  setMinimapLocation(latLng) {
    // Reaching a new pano while fitted means the user is exploring again — drop back to street level first.
    if (this.#overviewMode) this.exitOverview('pano-changed');
    this.#map.setCenter(new google.maps.LatLng(latLng.lat, latLng.lng));
  }

  /**
   * Factory function that creates a Google Maps minimap in the bottom-right of the UI.
   * @param {{lat: number, lng: number}} initialLocation - Initial lat/lng location.
   * @returns {Promise<Minimap>} The minimap instance.
   */
  static async create(initialLocation) {
    const newMinimap = new Minimap();
    await newMinimap.#init(initialLocation);
    return newMinimap;
  }
}
