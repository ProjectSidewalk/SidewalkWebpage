/**
 * Detect pinch zoom on mobile devices and push appropriate logs. This is only used for mobile devices.
 */
class PinchZoomDetector {
  static #ZOOM_UNKNOWN_CODE = 0;
  static #ZOOM_IN_CODE = 1;
  static #ZOOM_OUT_CODE = 2;

  #pinchZoomCode = 0;
  #prevZoomLevel = -1;
  #pinchZooming = false;

  constructor() {
    const screen = document.getElementById('svv-panorama');
    if (svv.panoViewer.getViewerType() === 'gsv') {
      svv.panoViewer.gsvPano.addListener('zoom_changed', this.#processZoomChange);
    }
    screen.addEventListener('touchstart', this.#processTouchstart);
    screen.addEventListener('touchend', this.#processTouchend);
  }

  /**
     * User starts pinch zooming. Don't know yet whether they are zooming in or out.
     */
  #processTouchstart = (e) => {
    if (e.touches.length >= 2) {
      this.#prevZoomLevel = svv.panoViewer.getPov().zoom;
      this.#pinchZooming = true;
      this.#pinchZoomCode = PinchZoomDetector.#ZOOM_UNKNOWN_CODE;
    }
  };

  /**
     * Determine whether a user is zooming in or out and logs their actions accordingly.
     */
  #processZoomChange = () => {
    const currentZoom = svv.panoViewer.getPov().zoom;
    // Logs interaction only if a user is pinch zooming and current zoom is less than max zoom.
    if (this.#pinchZooming && currentZoom <= 4) {
      const zoomChange = currentZoom - this.#prevZoomLevel;
      if (zoomChange > 0) {
        if (this.#pinchZoomCode !== PinchZoomDetector.#ZOOM_IN_CODE) {
          if (this.#pinchZoomCode === PinchZoomDetector.#ZOOM_OUT_CODE) {
            svv.tracker.push('Pinch_ZoomOut_End');
          }
          svv.tracker.push('Pinch_ZoomIn_Start');
          this.#pinchZoomCode = PinchZoomDetector.#ZOOM_IN_CODE;
        }
      }
      if (zoomChange < 0) {
        if (this.#pinchZoomCode !== PinchZoomDetector.#ZOOM_OUT_CODE) {
          if (this.#pinchZoomCode === PinchZoomDetector.#ZOOM_IN_CODE) {
            svv.tracker.push('Pinch_ZoomIn_End');
          }
          svv.tracker.push('Pinch_ZoomOut_Start');
          this.#pinchZoomCode = PinchZoomDetector.#ZOOM_OUT_CODE;
        }
      }
      this.#prevZoomLevel = currentZoom;
    }
  };

  /**
     * Logs zoom end interactions on mobile devices as users lift their hand off the screen.
     */
  #processTouchend = (e) => {
    if (svv.tracker && this.#pinchZooming && e.touches.length <= 1) {
      if (this.#pinchZoomCode === PinchZoomDetector.#ZOOM_IN_CODE) {
        svv.tracker.push('Pinch_ZoomIn_End');
      }
      if (this.#pinchZoomCode === PinchZoomDetector.#ZOOM_OUT_CODE) {
        svv.tracker.push('Pinch_ZoomOut_End');
      }
      this.#pinchZooming = false;
    }
  };
}
