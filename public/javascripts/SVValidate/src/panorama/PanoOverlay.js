/*
 * An additional layer on top of the panorama object on validation interface. This layer handles panning.
 */
class PanoOverlay {
  #viewControlLayer;
  #panningDisabled = false;

  // Mouse status and mouse event callback functions.
  #mouseStatus = {
    currX: 0,
    currY: 0,
    prevX: 0,
    prevY: 0,
    isLeftDown: false,
  };

  constructor() {
    this.#viewControlLayer = svv.ui.viewer.controlLayer;

    this.#viewControlLayer.bind('mousemove', this.#handlerViewControlLayerMouseMove);
    this.#viewControlLayer.bind('mousedown', this.#handlerViewControlLayerMouseDown);
    this.#viewControlLayer.bind('mouseup', this.#handlerViewControlLayerMouseUp);
    this.#viewControlLayer.bind('mouseleave', this.#handlerViewControlLayerMouseLeave);
  }

  /**
   * Disables panning on the pano canvas.
   */
  disablePanning() {
    this.#panningDisabled = true;
  }

  /**
   * Enables panning on the pano canvas.
   */
  enablePanning() {
    this.#panningDisabled = false;
  }

  /**
   * A callback function that is fired with the mouse down event on the view control layer (when panning).
   * @param {Event} e
   */
  #handlerViewControlLayerMouseDown = (e) => {
    this.#mouseStatus.isLeftDown = true;
    this.#viewControlLayer.css('cursor', 'url(/assets/images/icons/closedhand.cur) 4 4, move');

    // Hide the label's hover info as soon as panning starts so it doesn't linger over the moving pano.
    if (svv.labelVisibilityControl) svv.labelVisibilityControl.hideTagsAndDeleteButton();

    // This is necessary for supporting touch devices, because there is no mouse hover.
    this.#mouseStatus.prevX = mousePosition(e, e.currentTarget).x;
    this.#mouseStatus.prevY = mousePosition(e, e.currentTarget).y;
  };

  /**
   * This is a callback function that is called with mouse up event on the view control layer (when panning).
   */
  #handlerViewControlLayerMouseUp = () => {
    this.#viewControlLayer.css('cursor', 'url(/assets/images/icons/openhand.cur) 4 4, move');
    this.#mouseStatus.isLeftDown = false;
  };

  /**
   * Handles mouse leaving control view.
   */
  #handlerViewControlLayerMouseLeave = () => {
    this.#viewControlLayer.css('cursor', 'url(/assets/images/icons/openhand.cur) 4 4, move');
    this.#mouseStatus.isLeftDown = false;
  };

  /**
   * Callback function that is fired when a user moves a mouse on the view control layer where you change the pov.
   * @param {Event} e
   */
  #handlerViewControlLayerMouseMove = (e) => {
    this.#mouseStatus.currX = mousePosition(e, e.currentTarget).x;
    this.#mouseStatus.currY = mousePosition(e, e.currentTarget).y;

    if ((svv.panoManager.getProperty('panoLoaded')) && this.#mouseStatus.isLeftDown && this.#panningDisabled === false) {
      // If a mouse is being dragged on the control layer, move the pano.
      let dx = this.#mouseStatus.currX - this.#mouseStatus.prevX;
      let dy = this.#mouseStatus.currY - this.#mouseStatus.prevY;
      const pov = svv.panoViewer.getPov();
      const zoomLevel = pov.zoom;
      dx = dx / (2 * zoomLevel);
      dy = dy / (2 * zoomLevel);
      dx *= 0.375;
      dy *= 0.375;
      this.#updatePov(dx, dy);
    }
    this.#mouseStatus.prevX = mousePosition(e, e.currentTarget).x;
    this.#mouseStatus.prevY = mousePosition(e, e.currentTarget).y;
  };

  /**
   * Update POV of the image as a user drags their mouse cursor.
   * @param {number} dx
   * @param {number} dy
   */
  #updatePov(dx, dy) {
    const pov = svv.panoViewer.getPov();
    const viewerScaling = 0.5;
    pov.heading -= dx * viewerScaling;
    pov.pitch += dy * viewerScaling;
    svv.panoViewer.setPov(pov);
  }
}
