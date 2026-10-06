/**
 * Manages the pano zoom level and the zoom-in/zoom-out button UI.
 *
 * Todo. Separate the UI component and the logic component.
 *
 * @memberof svl
 */

import { svl } from '../svl.js';

export class ZoomControl {
  // Scroll wheel / trackpad zoom tuning.
  static #ZOOM_WHEEL_SENSITIVITY = 0.0015;

  #canvas;
  #tracker;
  #uiZoomControl;
  #properties = {
    maxZoomLevel: 3,
    minZoomLevel: 1,
  };

  #status = {
    disableZoomIn: false,
    disableZoomOut: true,
  };

  #lock = {
    disableZoomIn: false,
    disableZoomOut: false,
  };

  #zoomBlink = {
    isBlinking: false,
  };

  #blinkInterval;
  #wheelTrackTimeout;
  // The pinch in progress (#5664): the zoom it started from, and which way it is currently going ('In'/'Out'/null).
  #pinch = null;

  /**
   * @param {object} canvas - The Explore canvas (cleared/rendered on zoom changes).
   * @param {object} [tracker] - Optional interaction tracker for logging zoom events.
   */
  constructor(canvas, tracker) {
    this.#canvas = canvas;
    this.#tracker = tracker;
    this.#uiZoomControl = {
      zoomIn: document.getElementById('zoom-in-button'),
      zoomOut: document.getElementById('zoom-out-button'),
    };

    this.#uiZoomControl.zoomIn.addEventListener('click', () => this.#handleZoomInButtonClick());
    this.#uiZoomControl.zoomOut.addEventListener('click', () => this.#handleZoomOutButtonClick());
    // Not passive: the handler stops the page from scrolling under the pano.
    svl.ui.streetview.viewControlLayer.addEventListener('wheel', (e) => this.#handleZoomWheel(e), { passive: false });
  }

  /**
   * Get the zoom in UI control.
   */
  getZoomInUI() {
    return this.#uiZoomControl.zoomIn;
  }

  /**
   * Get the zoom out UI control.
   */
  getZoomOutUI() {
    return this.#uiZoomControl.zoomOut;
  }

  /**
   * Blink the zoom in button.
   */
  blinkZoomIn() {
    this.stopBlinking();
    this.#zoomBlink.isBlinking = true;
    this.#blinkInterval = window.setInterval(() => {
      this.#uiZoomControl.zoomIn.classList.toggle('highlight-50');
    }, 500);
  }

  /**
   * Blink the zoom out button.
   */
  blinkZoomOut() {
    this.stopBlinking();
    this.#zoomBlink.isBlinking = true;
    this.#blinkInterval = window.setInterval(() => {
      this.#uiZoomControl.zoomOut.classList.toggle('highlight-50');
    }, 500);
  }

  /**
   * Disables zooming in.
   * @returns {ZoomControl} this.
   */
  disableZoomIn() {
    if (!this.#lock.disableZoomIn) {
      this.#status.disableZoomIn = true;
      this.#uiZoomControl.zoomIn.setAttribute('aria-disabled', 'true');
    }
    return this;
  }

  /**
   * Disables zoom out.
   * @returns {ZoomControl} this.
   */
  disableZoomOut() {
    if (!this.#lock.disableZoomOut) {
      this.#status.disableZoomOut = true;
      this.#uiZoomControl.zoomOut.setAttribute('aria-disabled', 'true');
    }
    return this;
  }

  /**
   * Enable zoom in.
   * @returns {ZoomControl} this.
   */
  enableZoomIn() {
    if (!this.#lock.disableZoomIn) {
      this.#status.disableZoomIn = false;
      this.#uiZoomControl.zoomIn.setAttribute('aria-disabled', 'false');
    }
    return this;
  }

  /**
   * Enable zoom out.
   * @returns {ZoomControl} this.
   */
  enableZoomOut() {
    if (!this.#lock.disableZoomOut) {
      this.#status.disableZoomOut = false;
      this.#uiZoomControl.zoomOut.setAttribute('aria-disabled', 'false');
    }
    return this;
  }

  /**
   * Syncs the zoom buttons' enabled/disabled state to a zoom level applied to the pano outside this control — the
   * label card's "Explore here" POV seed sets the pano zoom directly, before this control exists, so the buttons
   * would otherwise keep their default (min-zoom) state and leave zoom-out dead until the first zoom-in (#4637).
   * Only touches the button UI; it does not re-apply the zoom to the pano.
   * @param {number} zoomLevel - The pano's current zoom level.
   */
  syncButtonsToZoom(zoomLevel) {
    if (zoomLevel <= this.#properties.minZoomLevel) {
      this.enableZoomIn();
      this.disableZoomOut();
    } else if (zoomLevel >= this.#properties.maxZoomLevel) {
      this.disableZoomIn();
      this.enableZoomOut();
    } else {
      this.enableZoomIn();
      this.enableZoomOut();
    }
  }

  /**
   * Get status.
   * @param {string} name
   * @returns {*}
   */
  getStatus(name) {
    if (name in this.#status) {
      return this.#status[name];
    } else {
      throw new Error(`You cannot access a property "${name}".`);
    }
  }

  /**
   * Get a property.
   * @param {string} name
   * @returns {*}
   */
  getProperty(name) {
    if (name in this.#properties) {
      return this.#properties[name];
    } else {
      throw new Error(`You cannot access a property "${name}".`);
    }
  }

  /** Lock zoom in. @returns {ZoomControl} this. */
  lockDisableZoomIn() {
    this.#lock.disableZoomIn = true;
    return this;
  }

  /** Lock zoom out. @returns {ZoomControl} this. */
  lockDisableZoomOut() {
    this.#lock.disableZoomOut = true;
    return this;
  }

  /**
   * Callback for the zoom-in button. Increments the pano zoom level.
   */
  #handleZoomInButtonClick() {
    if (this.#uiZoomControl.zoomIn.getAttribute('aria-disabled') === 'true') return;
    if (this.#tracker) this.#tracker.push('Click_ZoomIn');

    const pov = svl.panoViewer.getPov();

    if (pov.zoom < this.#properties.maxZoomLevel && this.#zoomBlink.isBlinking === false) {
      svl.zoomShortcutAlert.zoomClicked();
    }

    if (!this.#status.disableZoomIn) {
      this.#setZoom(pov.zoom + 1);
      this.#canvas.clear().render();
      document.dispatchEvent(new CustomEvent('ZoomIn'));
    }
  }

  /**
   * Callback for the zoom-out button. Decrements the pano zoom level.
   */
  #handleZoomOutButtonClick() {
    if (this.#uiZoomControl.zoomOut.getAttribute('aria-disabled') === 'true') return;
    if (this.#tracker) this.#tracker.push('Click_ZoomOut');

    const pov = svl.panoViewer.getPov();
    if (pov.zoom > this.#properties.minZoomLevel && this.#zoomBlink.isBlinking === false) {
      svl.zoomShortcutAlert.zoomClicked();
    }

    if (!this.#status.disableZoomOut) {
      this.#setZoom(pov.zoom - 1);
      this.#canvas.clear().render();
      document.dispatchEvent(new CustomEvent('ZoomOut'));
    }
  }

  /**
   * Callback for the scroll wheel / trackpad over the pano.
   * @param {WheelEvent} e
   */
  #handleZoomWheel(e) {
    // Prevent the page from scrolling while zooming the pano.
    e.preventDefault();

    // Scrolling up (negative deltaY) zooms in; scrolling down zooms out.
    const zoomDelta = -e.deltaY * ZoomControl.#ZOOM_WHEEL_SENSITIVITY;

    // Honor the disable locks (e.g. onboarding) and skip no-op zooms at the min/max.
    if (zoomDelta > 0 && this.#status.disableZoomIn) return;
    if (zoomDelta < 0 && this.#status.disableZoomOut) return;

    this.#setZoom(svl.panoViewer.getPov().zoom + zoomDelta);

    // Log scroll zooming, but debounce so a single gesture doesn't flood the tracker.
    if (this.#tracker) {
      window.clearTimeout(this.#wheelTrackTimeout);
      this.#wheelTrackTimeout = window.setTimeout(() => {
        this.#tracker.push(zoomDelta > 0 ? 'Scroll_ZoomIn' : 'Scroll_ZoomOut');
      }, 250);
    }
  }

  /**
   * Starts a two-finger pinch over the pano. Zoom then follows the fingers through `pinchZoom` until `pinchEnd`.
   */
  pinchStart() {
    this.#pinch = { startZoom: svl.panoViewer.getPov().zoom, direction: null };
  }

  /**
   * Zooms to follow a pinch, through the same clamp and disable locks as the buttons and the wheel.
   * @param {number} zoomDelta - log2 of the finger spread relative to the start of the pinch; +1 is twice as far apart.
   */
  pinchZoom(zoomDelta) {
    if (!this.#pinch) return;
    const current = svl.panoViewer.getPov().zoom;
    const target = this.#pinch.startZoom + zoomDelta;
    if (target > current && this.#status.disableZoomIn) return;
    if (target < current && this.#status.disableZoomOut) return;
    if (target === current) return;

    // Logged the way Validate logs pinches (PinchZoomDetector): a Start when a direction begins, an End when it stops.
    const direction = target > current ? 'In' : 'Out';
    if (direction !== this.#pinch.direction) {
      if (this.#pinch.direction) this.#tracker?.push(`Pinch_Zoom${this.#pinch.direction}_End`);
      this.#tracker?.push(`Pinch_Zoom${direction}_Start`);
      this.#pinch.direction = direction;
    }
    this.#setZoom(target);
  }

  /**
   * Ends the pinch begun by `pinchStart`.
   */
  pinchEnd() {
    if (this.#pinch?.direction) this.#tracker?.push(`Pinch_Zoom${this.#pinch.direction}_End`);
    this.#pinch = null;
  }

  /**
   * Zoom in. Called when the keyboard shortcut for zoom in is used.
   * @returns {ZoomControl|boolean} this if zoomed in, false if zoom in is disabled.
   */
  zoomIn() {
    if (!this.#status.disableZoomIn) {
      const pov = svl.panoViewer.getPov();
      this.#setZoom(pov.zoom + 1);
      this.#canvas.clear().render();
      document.dispatchEvent(new CustomEvent('ZoomIn'));
      return this;
    } else {
      return false;
    }
  }

  /**
   * Zoom out. Called from outside this class (and by the keyboard shortcut) to zoom out from a pano.
   * @returns {ZoomControl|boolean} this if zoomed out, false if zoom out is disabled.
   */
  zoomOut() {
    if (!this.#status.disableZoomOut) {
      const pov = svl.panoViewer.getPov();
      this.#setZoom(pov.zoom - 1);
      this.#canvas.clear().render();
      document.dispatchEvent(new CustomEvent('ZoomOut'));
      return this;
    } else {
      return false;
    }
  }

  /**
   * Sets the zoom level of the Street View.
   * @param {number} zoomLevelIn
   * @returns {number|boolean} The clamped zoom level, or false if a non-number was passed.
   */
  #setZoom(zoomLevelIn) {
    if (typeof zoomLevelIn !== 'number') {
      return false;
    }

    // Set the zoom level and change the panorama properties.
    let zoomLevel;
    if (zoomLevelIn <= this.#properties.minZoomLevel) {
      zoomLevel = this.#properties.minZoomLevel;
      this.enableZoomIn();
      this.disableZoomOut();
    } else if (zoomLevelIn >= this.#properties.maxZoomLevel) {
      zoomLevel = this.#properties.maxZoomLevel;
      this.disableZoomIn();
      this.enableZoomOut();
    } else {
      zoomLevel = zoomLevelIn;
      this.enableZoomIn();
      this.enableZoomOut();
    }
    svl.panoManager.setZoom(zoomLevel);
    const labels = svl.labelContainer.getCanvasLabels();
    for (let i = 0; i < labels.length; i += 1) {
      labels[i].setHoverInfoVisibility('hidden');
    }
    svl.canvas.hideHoverCard();
    svl.canvas.clear().render();
    return zoomLevel;
  }

  /**
   * Stop blinking the zoom-in and zoom-out buttons.
   */
  stopBlinking() {
    window.clearInterval(this.#blinkInterval);
    this.#zoomBlink.isBlinking = false;
    this.#uiZoomControl.zoomIn.classList.remove('highlight-50');
    this.#uiZoomControl.zoomOut.classList.remove('highlight-50');
  }

  /**
   * Sets the maximum zoom level.
   * @param {number} zoomLevel
   * @returns {ZoomControl} this.
   */
  setMaxZoomLevel(zoomLevel) {
    this.#properties.maxZoomLevel = zoomLevel;
    return this;
  }

  /**
   * Sets the minimum zoom level.
   * @param {number} zoomLevel
   * @returns {ZoomControl} this.
   */
  setMinZoomLevel(zoomLevel) {
    this.#properties.minZoomLevel = zoomLevel;
    return this;
  }

  /** Unlock zoom in. @returns {ZoomControl} this. */
  unlockDisableZoomIn() {
    this.#lock.disableZoomIn = false;
    return this;
  }

  /** Unlock zoom out. @returns {ZoomControl} this. */
  unlockDisableZoomOut() {
    this.#lock.disableZoomOut = false;
    return this;
  }

  /**
   * Change the opacity of zoom buttons.
   * @returns {ZoomControl} this.
   */
  updateOpacity() {
    const pov = svl.panoViewer.getPov();

    if (pov) {
      const zoom = pov.zoom;
      // Disable the zoom-in button at max zoom and the zoom-out button at min zoom.
      // This runs on every canvas render, so only touch the DOM when a button actually changes state.
      const zoomInOff = String(zoom >= this.#properties.maxZoomLevel || this.#status.disableZoomIn);
      const zoomOutOff = String(zoom <= this.#properties.minZoomLevel || this.#status.disableZoomOut);
      const { zoomIn, zoomOut } = this.#uiZoomControl;
      if (zoomIn.getAttribute('aria-disabled') !== zoomInOff) zoomIn.setAttribute('aria-disabled', zoomInOff);
      if (zoomOut.getAttribute('aria-disabled') !== zoomOutOff) zoomOut.setAttribute('aria-disabled', zoomOutOff);
    }
    return this;
  }
}
