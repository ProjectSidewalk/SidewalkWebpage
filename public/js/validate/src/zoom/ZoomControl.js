/**
 * Handles zooming for the pano. Also called by the Keyboard class to deal with zooming via keyboard shortcuts.
 */
class ZoomControl {
  // Zoom limits for the pano, matching the {1, 2, 3} levels used by the zoom buttons.
  static #MIN_ZOOM = 1;
  static #MAX_ZOOM = 3;
  // Scroll wheel / trackpad zoom tuning.
  static #ZOOM_WHEEL_SENSITIVITY = 0.0015;

  #zoomInButton;
  #zoomOutButton;
  #wheelTrackTimeout;

  constructor() {
    this.#zoomInButton = $('#zoom-in-button');
    this.#zoomOutButton = $('#zoom-out-button');

    this.#zoomInButton.on('click', this.#clickZoomIn);
    this.#zoomOutButton.on('click', this.#clickZoomOut);
    svv.ui.viewer.controlLayer.on('wheel', this.#wheelZoom);
  }

  /**
   * Logs interaction when the zoom in button is clicked.
   */
  #clickZoomIn = () => {
    svv.tracker.push('Click_ZoomIn');
    this.zoomIn();
  };

  /**
   * Logs interaction when the zoom out button is clicked.
   */
  #clickZoomOut = () => {
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
   * @param {Event} e jQuery wheel event.
   */
  #wheelZoom = (e) => {
    // Prevent the page from scrolling while zooming the pano.
    e.preventDefault();

    // Scrolling up (negative deltaY) zooms in; scrolling down zooms out.
    const zoomDelta = -e.originalEvent.deltaY * ZoomControl.#ZOOM_WHEEL_SENSITIVITY;

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
    // The `disabled` class greys the button out; see pano-overlay-buttons.css.
    this.#zoomInButton.toggleClass('disabled', zoomLevel >= 3);
    this.#zoomOutButton.toggleClass('disabled', zoomLevel <= 1);
  }
}
