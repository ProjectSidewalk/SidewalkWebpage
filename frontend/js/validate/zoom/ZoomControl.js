/**
 * Handles zooming for the pano. Also called by the Keyboard class to deal with zooming via keyboard shortcuts.
 */

import { svv } from '../svv.js';

export class ZoomControl {
  // Zoom limits for the pano, matching the {1, 2, 3} levels used by the zoom buttons.
  static #MIN_ZOOM = 1;
  static #MAX_ZOOM = 3;
  // Zoom levels per unit of wheel deltaY. A trackpad pinch arrives as a wheel event with ctrlKey set and much less
  // deltaY per gesture than the wheel's notches carry, so at the wheel's gain one pinch moved about a fifth of a
  // level and zooming in took four or five of them (#5729). The pinch gets 4.5x the gain, the same wheel-to-pinch
  // ratio MapLibre's scroll-zoom handler uses (1/450 vs 1/100).
  static #ZOOM_WHEEL_SENSITIVITY = 0.0015;
  static #ZOOM_PINCH_SENSITIVITY = 0.007;

  #zoomInButton;
  #zoomOutButton;
  #wheelTrackTimeout;

  constructor() {
    this.#zoomInButton = svv.ui.status.zoomInButton;
    this.#zoomOutButton = svv.ui.status.zoomOutButton;

    this.#zoomInButton.addEventListener('click', this.#clickZoomIn);
    this.#zoomOutButton.addEventListener('click', this.#clickZoomOut);
    // Not passive, so preventDefault can stop the wheel from scrolling the page.
    svv.ui.viewer.controlLayer.addEventListener('wheel', this.#wheelZoom, { passive: false });
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
   * Increases zoom for the panorama and checks if 'Zoom In' button needs to be disabled.
   * Zoom levels: {1, 2, 3}
   */
  zoomIn() {
    const zoomLevel = Math.round(svv.panoViewer.getPov().zoom);
    if (zoomLevel <= 2) {
      svv.panoManager.setZoom(zoomLevel + 1);
    }
    this.updateZoomAvailability();
  }

  /**
   * Decreases zoom for the panorama and checks if 'Zoom Out' button needs to be disabled.
   * Zoom levels: {1, 2, 3}
   */
  zoomOut() {
    const zoomLevel = Math.round(svv.panoViewer.getPov().zoom);
    if (zoomLevel >= 2) {
      svv.panoManager.setZoom(zoomLevel - 1);
    }
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
    const sensitivity = e.ctrlKey ? ZoomControl.#ZOOM_PINCH_SENSITIVITY : ZoomControl.#ZOOM_WHEEL_SENSITIVITY;
    const zoomDelta = -e.deltaY * sensitivity;

    const newZoom = Math.max(
      ZoomControl.#MIN_ZOOM, Math.min(ZoomControl.#MAX_ZOOM, svv.panoViewer.getPov().zoom + zoomDelta),
    );
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
   * Changes the opacity and enables/disables the zoom buttons depending on the 'zoom level'. It
   * disables and 'greys-out' the zoom in button in the most zoomed in state and the zoom out
   * button in the most zoomed out state.
   * Zoom levels: { 1 (Zoom-out Disabled), 2 (Both buttons enabled), 3 (Zoom-In Disabled) }
   */
  updateZoomAvailability() {
    const zoomLevel = svv.panoViewer.getPov().zoom;
    // `aria-disabled` greys the button out but lets it keep keyboard focus; see pano-overlay-buttons.css.
    this.#zoomInButton.setAttribute('aria-disabled', String(zoomLevel >= 3));
    this.#zoomOutButton.setAttribute('aria-disabled', String(zoomLevel <= 1));
  }
}
