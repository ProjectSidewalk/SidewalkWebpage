/**
 * Handles zooming for the pano. Also called by the Keyboard class to deal with zooming via keyboard shortcuts.
 */

import { svv } from '../svv.js';
import { util } from '../../common/utilities.js';
import '../../common/pano-viewer/panoUtilities.js';

export class ZoomControl {
  // Zoom limits for the pano on a 3:2 frame, and on every viewer but GSV: the {1, 2, 3} levels of the zoom buttons.
  static #MIN_ZOOM = 1;
  static #MAX_ZOOM = 3;
  // Scroll wheel / trackpad zoom tuning.
  static #ZOOM_WHEEL_SENSITIVITY = 0.0015;

  #zoomInButton;
  #zoomOutButton;
  #wheelTrackTimeout;

  constructor() {
    this.#zoomInButton = svv.ui.status.zoomInButton;
    this.#zoomOutButton = svv.ui.status.zoomOutButton;

    this.#zoomInButton.addEventListener('click', this.#clickZoomIn);
    this.#zoomOutButton.addEventListener('click', this.#clickZoomOut);
    // On the pano's holder, which every wheel over the pano bubbles to: the control layer above the imagery goes
    // click-through on a touch screen (svv-panorama.css) so a finger pans the viewer, which would hand a trackpad's
    // or a mouse's wheel to GSV, whose own wheel zoom is off (#5580). Not passive, so preventDefault can stop the
    // wheel from scrolling the page.
    svv.ui.viewer.controlLayer.parentElement.addEventListener('wheel', this.#wheelZoom, { passive: false });
  }

  /**
   * Logs interaction when the zoom in button is clicked.
   */
  #clickZoomIn = () => {
    if (this.#zoomInButton.getAttribute('aria-disabled') === 'true') return;
    svv.tracker.push('Click_ZoomIn');
    this.zoomIn();
  };

  /**
   * Logs interaction when the zoom out button is clicked.
   */
  #clickZoomOut = () => {
    if (this.#zoomOutButton.getAttribute('aria-disabled') === 'true') return;
    svv.tracker.push('Click_ZoomOut');
    this.zoomOut();
  };

  /**
   * The zoom range that visibly changes this frame's view. GSV's clamps on its vertical field make part of a fixed
   * 1-3 range dead on a frame that isn't about 3:2 (a phone, either way up), so for GSV the range follows the frame
   * (util.pano.gsvZoomRange, #5580); every other viewer renders its zoom as asked.
   * @returns {{min: number, max: number}}
   */
  static range() {
    if (svv.panoViewer?.getViewerType?.() !== 'gsv') return { min: ZoomControl.#MIN_ZOOM, max: ZoomControl.#MAX_ZOOM };
    return util.pano.gsvZoomRange(svv.canvasWidth() / svv.canvasHeight());
  }

  /**
   * The current zoom, pulled into the visible range: a label can load at a zoom inside a clamp's dead zone, and a
   * step taken from there would land somewhere that still looks the same.
   * @param {{min: number, max: number}} range
   * @returns {number}
   */
  static #currentZoom({ min, max }) {
    return Math.max(min, Math.min(max, svv.panoViewer.getPov().zoom));
  }

  /**
   * Zooms in one level (a level is a zoom unit, as the buttons' {1, 2, 3} on a 3:2 frame) and updates the buttons.
   */
  zoomIn() {
    const range = ZoomControl.range();
    svv.panoManager.setZoom(Math.min(range.max, ZoomControl.#currentZoom(range) + 1));
    this.updateZoomAvailability();
  }

  /**
   * Zooms out one level and updates the buttons.
   */
  zoomOut() {
    const range = ZoomControl.range();
    svv.panoManager.setZoom(Math.max(range.min, ZoomControl.#currentZoom(range) - 1));
    this.updateZoomAvailability();
  }

  /**
   * Callback for the scroll wheel / trackpad over the pano.
   * @param {WheelEvent} e
   */
  #wheelZoom = (e) => {
    // Prevent the page from scrolling while zooming the pano.
    e.preventDefault();

    // Scrolling up (negative deltaY) zooms in; scrolling down zooms out.
    const zoomDelta = -e.deltaY * ZoomControl.#ZOOM_WHEEL_SENSITIVITY;

    const range = ZoomControl.range();
    const newZoom = Math.max(range.min, Math.min(range.max, ZoomControl.#currentZoom(range) + zoomDelta));
    svv.panoManager.setZoom(newZoom);
    this.updateZoomAvailability();

    // Log scroll zooming, but debounce so a single gesture doesn't flood the tracker.
    if (svv.tracker) {
      window.clearTimeout(this.#wheelTrackTimeout);
      this.#wheelTrackTimeout = window.setTimeout(() => {
        svv.tracker.push(zoomDelta > 0 ? 'Scroll_ZoomIn' : 'Scroll_ZoomOut');
      }, 250);
    }
  };

  /**
   * Changes the opacity and enables/disables the zoom buttons depending on the zoom: greys out zoom-in at the top
   * of the visible range and zoom-out at the bottom.
   */
  updateZoomAvailability() {
    const zoomLevel = svv.panoViewer.getPov().zoom;
    const { min, max } = ZoomControl.range();
    const EPSILON = 1e-3; // A zoom set to the bound itself can read back a hair off it.
    // `aria-disabled` greys the button out but lets it keep keyboard focus; see pano-overlay-buttons.css.
    this.#zoomInButton.setAttribute('aria-disabled', String(zoomLevel >= max - EPSILON));
    this.#zoomOutButton.setAttribute('aria-disabled', String(zoomLevel <= min + EPSILON));
  }
}
