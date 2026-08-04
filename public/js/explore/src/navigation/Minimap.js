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

  // Route start/finish flags reuse RouteBuilder's flag icons at its rasterized size, planted at the pole base.
  static #ROUTE_FLAG_SIZE_PX = 27;
  static #START_FLAG_SRC = '/assets/images/icons/routebuilder/flag-start.svg';
  static #FINISH_FLAG_SRC = '/assets/images/icons/routebuilder/flag-end.svg';

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
      disableDefaultUI: true,
      fullscreenControl: false,
      // No Street View pegman on the minimap — dropping it would open a "no imagery" panorama over the map.
      streetViewControl: false,
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

    // Redraw the observed-area overlay whenever the map settles (e.g. after a zoom) so the fog/FOV stay aligned; the
    // route overview inset tracks the same settle so its "current extent" box follows any zoom/recenter.
    google.maps.event.addListener(this.#map, 'idle', () => {
      if (svl.observedArea) svl.observedArea.update();
      if (svl.routeOverview) svl.routeOverview.render();
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
      fitButton.addEventListener('click', () => this.toggleOverview('fit-button'));
    }
  }

  /**
   * Toggles the fitted whole-route overview: fits to the route if currently at street level, or returns to street
   * level if already fitted. Invoked by the ⛶ button and, on designated routes, by clicking the route-overview inset.
   * @param {string} trigger - What initiated the toggle (for interaction logging).
   */
  toggleOverview(trigger) {
    if (svl.ui.minimap.holder.hasClass('minimap-tutorial')) return;
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
   */
  enterOverview() {
    const bounds = this.#streetBounds();
    if (!bounds || this.#overviewMode) return;
    this.#overviewMode = true;
    this.#updateFitButtonLabel();
    svl.ui.minimap.holder.addClass('minimap-overview');
    this.#map.setOptions({ minZoom: Minimap.#OVERVIEW_MIN_ZOOM });
    this.#map.fitBounds(bounds, 12);
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
    this.#map.setOptions({ minZoom: Minimap.#MIN_ZOOM });
    this.#map.setZoom(Minimap.#DEFAULT_ZOOM);
    this.#map.setCenter(svl.panoViewer.getPosition());
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
   * Bounds framing "your route": on a designated route, every loaded street; on a neighborhood audit, the current
   * mission's streets plus the one you're on (the region as a whole would zoom out far past the route — #4639).
   * @returns {google.maps.LatLngBounds|null} Null if no street geometry is available yet.
   */
  #streetBounds() {
    if (!svl.taskContainer) return null;
    let tasks;
    if (svl.neighborhoodModel && svl.neighborhoodModel.isRoute) {
      // On a designated route every loaded street IS the route, so fit them all.
      tasks = svl.taskContainer.getTasks();
    } else {
      // A neighborhood audit loads the entire region; fit just this mission's streets plus the street you're on. Early
      // in a mission that's essentially the current street — i.e. a normal street-level view, not the whole region.
      const mission = svl.missionContainer && svl.missionContainer.getCurrentMission();
      tasks = ((mission && mission.getRoute()) || []).slice();
      const current = svl.taskContainer.getCurrentTask();
      if (current && !tasks.includes(current)) tasks.push(current);
    }
    const bounds = new google.maps.LatLngBounds();
    for (const task of tasks) {
      for (const coord of task.getGeoJSON().geometry.coordinates) {
        bounds.extend({ lat: coord[1], lng: coord[0] });
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
    const totalMeters = mission.getDistance('meters');
    // Free-exploration missions (#4451) have no distance target; a "0/0" progress bar would be meaningless, so hide it.
    if (!totalMeters) {
      svl.ui.minimap.missionProgress.css('display', 'none');
      return;
    }
    svl.ui.minimap.missionProgress.css('display', '');

    const fraction = mission.getMissionCompletionRate();
    const doneMeters = Math.min(Math.max(mission.getProperty('distanceProgress') || 0, 0), totalMeters);
    const metric = i18next.t('common:measurement-system') === 'metric';
    const unit = i18next.t('common:unit-abbreviation-mission-distance');
    const toDisplay = (meters) => util.math.roundToTwentyFive(metric ? meters : util.math.metersToFeet(meters));
    const percent = Math.round(fraction * 100);

    svl.ui.minimap.missionProgressFill.css('width', `${percent}%`);
    svl.ui.minimap.missionProgressPercent.text(`${percent}%`);
    svl.ui.minimap.missionProgressDistance.text(`${toDisplay(doneMeters)}/${toDisplay(totalMeters)} ${unit}`);
    svl.ui.minimap.missionProgress.attr('aria-valuenow', percent);
  }

  /**
   * Resets the mission-progress bar to 0% for a freshly started mission, mirroring the sidebar bar's reset when the
   * mission-complete modal closes. Shows "0 / <target>" so the new mission's length is visible right away.
   * @param {Mission} [mission] - The newly started mission; if absent, the distance label is cleared.
   */
  resetMissionProgress(mission) {
    svl.ui.minimap.missionProgressFill.css('width', '0%');
    svl.ui.minimap.missionProgressPercent.text('0%');
    svl.ui.minimap.missionProgress.attr('aria-valuenow', 0);
    if (mission) {
      const totalMeters = mission.getDistance('meters');
      const metric = i18next.t('common:measurement-system') === 'metric';
      const unit = i18next.t('common:unit-abbreviation-mission-distance');
      const total = util.math.roundToTwentyFive(metric ? totalMeters : util.math.metersToFeet(totalMeters));
      svl.ui.minimap.missionProgressDistance.text(`0/${total} ${unit}`);
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
   * Draws the route's start and finish flags on the minimap (routes only), reusing the same flag icons the user
   * placed while building the route so building and walking read as one experience. Each flag is planted with its
   * pole base on the point (AdvancedMarkerElement's default bottom-center anchor matches RouteBuilder's icon-anchor).
   * The flags are decorative reinforcement of route status already conveyed textually (progress bar, finish toast,
   * compass message), so their images are marked decorative (empty alt) for screen readers.
   * @param {{lat: number, lng: number}} start - Route start (first street's walking-start coordinate).
   * @param {{lat: number, lng: number}} finish - Route finish (last street's walking-end coordinate).
   */
  showRouteEndpoints(start, finish) {
    const plantFlag = (latLng, src) => {
      const content = document.createElement('img');
      content.src = src;
      content.alt = '';
      content.style.width = `${Minimap.#ROUTE_FLAG_SIZE_PX}px`;
      return new google.maps.marker.AdvancedMarkerElement({
        position: new google.maps.LatLng(latLng.lat, latLng.lng),
        map: this.#map,
        content,
      });
    };
    plantFlag(start, Minimap.#START_FLAG_SRC);
    plantFlag(finish, Minimap.#FINISH_FLAG_SRC);
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
