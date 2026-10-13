/**
 * Manages the pano zoom level and the zoom-in/zoom-out button UI.
 *
 * Each button is a gate: the zoom's own limit holds the one at the end of its range, and the tutorial and the survey
 * hold them by name. The button shows disabled while anything holds it.
 */

import { Gate } from '../../common/Gate.js';
/** @typedef {import('../canvas/Canvas.js').Canvas} Canvas */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */
/** @typedef {import('../alert/ZoomShortcutAlert.js').ZoomShortcutAlert} ZoomShortcutAlert */

export class ZoomControl {
  // Scroll wheel / trackpad zoom tuning.
  static #ZOOM_WHEEL_SENSITIVITY = 0.0015;

  #canvas;
  #panoManager;
  #zoomShortcutAlert;
  #tracker;
  #uiZoomControl;
  #properties = {
    maxZoomLevel: 3,
    minZoomLevel: 1,
  };

  /** @type {Gate} Whether zooming in is allowed; zoomIn() does nothing while it is held. */
  zoomInGate = new Gate();

  /** @type {Gate} Whether zooming out is allowed; the limit holds it while at minimum zoom. */
  zoomOutGate = new Gate();

  #zoomBlink = {
    isBlinking: false,
  };

  #blinkInterval;
  #wheelTrackTimeout;

  /**
   * @param {HTMLElement} viewControlLayer - The layer over the pano, whose scroll wheel zooms it.
   * @param {Canvas} canvas - The Explore canvas, whose hover card goes as the zoom changes.
   * @param {PanoManager} panoManager - Whose view is zoomed.
   * @param {ZoomShortcutAlert} zoomShortcutAlert - Told of button clicks, so it can suggest the key.
   * @param {Tracker} tracker
   */
  constructor(viewControlLayer, canvas, panoManager, zoomShortcutAlert, tracker) {
    this.#canvas = canvas;
    this.#panoManager = panoManager;
    this.#zoomShortcutAlert = zoomShortcutAlert;
    this.#tracker = tracker;
    this.#uiZoomControl = {
      zoomIn: document.getElementById('zoom-in-button'),
      zoomOut: document.getElementById('zoom-out-button'),
    };

    // The view a label card's "Explore here" hop opens on is already zoomed in (#4637).
    this.syncButtonsToZoom(panoManager.getPov().zoom);
    const showGate = (button, gate) => {
      const show = (held) => button.setAttribute('aria-disabled', String(held));
      show(gate.isHeld());
      gate.onChanged(show);
    };
    showGate(this.#uiZoomControl.zoomIn, this.zoomInGate);
    showGate(this.#uiZoomControl.zoomOut, this.zoomOutGate);

    this.#uiZoomControl.zoomIn.addEventListener('click', () => this.#handleZoomInButtonClick());
    this.#uiZoomControl.zoomOut.addEventListener('click', () => this.#handleZoomOutButtonClick());
    // Not passive: the handler stops the page from scrolling under the pano.
    viewControlLayer.addEventListener('wheel', (e) => this.#handleZoomWheel(e), { passive: false });
    // A move keeps the previous pano's zoom, so the buttons follow the view rather than this control's own calls.
    panoManager.onPovChanged(() => this.syncButtonsToZoom(panoManager.getPov().zoom));
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
   * Syncs the zoom buttons' enabled/disabled state to the pano's zoom, so a zoom applied outside this control (a
   * seeded view, a move that carries the previous pano's zoom over) can't leave zoom-out dead until the first
   * zoom-in (#4637). Runs on every view change; the gates only touch the DOM when a button actually changes state.
   * Only touches the button UI; it does not re-apply the zoom to the pano.
   * @param {number} zoomLevel - The pano's current zoom level.
   */
  syncButtonsToZoom(zoomLevel) {
    const atLimit = (gate, held) => (held ? gate.hold('limit') : gate.release('limit'));
    atLimit(this.zoomInGate, zoomLevel >= this.#properties.maxZoomLevel);
    atLimit(this.zoomOutGate, zoomLevel <= this.#properties.minZoomLevel);
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

  /**
   * Callback for the zoom-in button. Increments the pano zoom level.
   */
  #handleZoomInButtonClick() {
    if (this.zoomInGate.isHeld()) return;
    this.#tracker.push('Click_ZoomIn');

    const pov = this.#panoManager.getPov();

    if (pov.zoom < this.#properties.maxZoomLevel && this.#zoomBlink.isBlinking === false) {
      this.#zoomShortcutAlert.zoomClicked();
    }

    this.#setZoom(pov.zoom + 1);
    document.dispatchEvent(new CustomEvent('ZoomIn'));
  }

  /**
   * Callback for the zoom-out button. Decrements the pano zoom level.
   */
  #handleZoomOutButtonClick() {
    if (this.zoomOutGate.isHeld()) return;
    this.#tracker.push('Click_ZoomOut');

    const pov = this.#panoManager.getPov();
    if (pov.zoom > this.#properties.minZoomLevel && this.#zoomBlink.isBlinking === false) {
      this.#zoomShortcutAlert.zoomClicked();
    }

    this.#setZoom(pov.zoom - 1);
    document.dispatchEvent(new CustomEvent('ZoomOut'));
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
    if (zoomDelta > 0 && this.zoomInGate.isHeld()) return;
    if (zoomDelta < 0 && this.zoomOutGate.isHeld()) return;

    this.#setZoom(this.#panoManager.getPov().zoom + zoomDelta);

    // Log scroll zooming, but debounce so a single gesture doesn't flood the tracker.
    window.clearTimeout(this.#wheelTrackTimeout);
    this.#wheelTrackTimeout = window.setTimeout(() => {
      this.#tracker.push(zoomDelta > 0 ? 'Scroll_ZoomIn' : 'Scroll_ZoomOut');
    }, 250);
  }

  /**
   * Zoom in. Called when the keyboard shortcut for zoom in is used.
   * @returns {ZoomControl|boolean} this if zoomed in, false if zoom in is disabled.
   */
  zoomIn() {
    if (!this.zoomInGate.isHeld()) {
      const pov = this.#panoManager.getPov();
      this.#setZoom(pov.zoom + 1);
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
    if (!this.zoomOutGate.isHeld()) {
      const pov = this.#panoManager.getPov();
      this.#setZoom(pov.zoom - 1);
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

    const zoomLevel = Math.min(Math.max(zoomLevelIn, this.#properties.minZoomLevel), this.#properties.maxZoomLevel);
    // The hover card is anchored to a label that is about to move; the view change itself re-renders the canvas and
    // syncs the buttons.
    this.#canvas.showLabelHoverInfo(undefined);
    this.#panoManager.setZoom(zoomLevel);
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
}
