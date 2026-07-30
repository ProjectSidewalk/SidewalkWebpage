/**
 * Canvas Module. Owns the label canvas: drawing labels, hit-testing the cursor, and pano pan/cursor handling.
 */
class Canvas {
  // Grace period before the hover card hides once the cursor leaves the label, giving the pointer time to
  // travel from the icon onto the card (e.g. to reach its Edit/Delete buttons) without the card vanishing mid-way.
  static #HOVER_CARD_HIDE_DELAY_MS = 200;

  #ribbon;
  #ctx;
  #hoverCardHideTimer = null;
  #status = {
    currentLabel: null,
    disableLabelDelete: false,
    disableLabeling: false,
    lockDisableLabelDelete: false,
  };

  // Mouse status and mouse event callback functions.
  #mouseStatus = {
    prevX: 0,
    prevY: 0,
    isLeftDown: false,
  };

  #canvasProperties = { height: 0, width: 0 };

  /**
   * @param {Object} ribbon - The RibbonMenu, queried for the selected label type / mode.
   */
  constructor(ribbon) {
    this.#ribbon = ribbon;
    this.#init();
  }

  /**
   * Initialization: set up the canvas context and attach listeners to DOM elements.
   */
  #init() {
    // Set up the canvas context.
    const el = document.getElementById('label-canvas');
    if (!el) {
      return;
    }
    this.#ctx = el.getContext('2d');

    // Render the canvas at its on-screen (and HiDPI) resolution now that pano may be displayed at a different size
    // than the 720x480 logical frame, while keeping all drawing code in that logical frame via a context transform.
    this.#sizeCanvasToDisplay(el);

    // clearRect() operates in the logical frame thanks to the context transform set in #sizeCanvasToDisplay.
    this.#canvasProperties.width = util.EXPLORE_CANVAS_WIDTH;
    this.#canvasProperties.height = util.EXPLORE_CANVAS_HEIGHT;

    // Attach listeners to dom elements. view-control-layer handles panning, drawing-layer handles adding labels.
    svl.ui.canvas.drawingLayer.on('mousedown', (e) => this.#handleDrawingLayerMouseDown(e));
    svl.ui.canvas.drawingLayer.on('mouseup', (e) => this.#handleDrawingLayerMouseUp(e));
    svl.ui.canvas.drawingLayer.on('mousemove', (e) => this.#handleDrawingLayerMouseMove(e));
    $('#interaction-area-holder').on('mouseleave', (e) => this.#handleDrawingLayerMouseOut(e));
    svl.ui.canvas.hoverCard.on('click', () => this.#handleHoverCardClick('card'));
    svl.ui.canvas.hoverCard.on('mouseenter', () => this.#cancelScheduledHoverCardHide());
    svl.ui.canvas.hoverCard.on('mouseleave', () => this.#scheduleHoverCardHide());
    svl.ui.canvas.hoverCardEdit.on('click', (e) => {
      e.stopPropagation(); // So the card's own click handler doesn't open the menu a second time.
      this.#handleHoverCardClick('edit-button');
    });
    svl.ui.canvas.hoverCardDelete.on('click', (e) => this.#handleHoverCardDeleteClick(e));
    svl.ui.streetview.viewControlLayer.on('mousedown', (e) => this.#handlerViewControlLayerMouseDown(e));
    svl.ui.streetview.viewControlLayer.on('mouseup', (e) => this.#handlerViewControlLayerMouseUp(e));
    svl.ui.streetview.viewControlLayer.on('mousemove', (e) => this.#handlerViewControlLayerMouseMove(e));
    svl.ui.streetview.viewControlLayer.on('mouseleave', (e) => this.#handlerViewControlLayerMouseLeave(e));
    svl.ui.streetview.viewControlLayer[0].onselectstart = () => false;
  }

  /**
   * Sizes the label canvas bitmap to its on-screen size times the device pixel ratio, and scales the 2D
   * context so all drawing done in the fixed 720x480 logical frame renders at full resolution.
   * @param {HTMLCanvasElement} el - The label canvas element.
   */
  #sizeCanvasToDisplay(el) {
    const rect = el.getBoundingClientRect();
    const displayWidth = rect.width || util.EXPLORE_CANVAS_WIDTH;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(displayWidth * dpr);
    el.height = Math.round(displayWidth / util.EXPLORE_CANVAS_ASPECT_RATIO * dpr);
    // Map the 720x480 logical frame onto the full-resolution bitmap. Setting el.width/height above resets
    // the context, so this transform must be (re)applied here.
    const scale = el.width / util.EXPLORE_CANVAS_WIDTH;
    this.#ctx.setTransform(scale, 0, 0, scale, 0, 0);
    // Label icons are drawn from a raster sized for the densest display we support (see Label.preloadIcons), so on
    // anything less dense they arrive downscaled; the default 'low' filter frays their outer circle.
    this.#ctx.imageSmoothingQuality = 'high';
  }

  /**
   * Create a label at the given X/Y canvas coordinate.
   * @param {number} canvasX
   * @param {number} canvasY
   */
  #createLabel(canvasX, canvasY) {
    // Generate some metadata for the new label.
    const labelType = this.#ribbon.getStatus('selectedLabelType');
    const pov = svl.panoViewer.getPov();
    const povOfLabel = util.pano.canvasCoordToCenteredPov(
      pov, canvasX, canvasY, util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT,
    );
    const rerenderCanvasCoord = util.pano.centeredPovToCanvasCoord(
      povOfLabel, pov, util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT, svl.LABEL_ICON_RADIUS,
    );
    const param = {
      tutorial: svl.missionContainer.getCurrentMission().getProperty('missionType') === 'auditOnboarding',
      missionId: svl.missionContainer.getCurrentMission().getProperty('missionId'),
      auditTaskId: svl.taskContainer.getCurrentTask().getAuditTaskId(),
      labelType,
      originalCanvasXY: { x: canvasX, y: canvasY },
      currCanvasXY: rerenderCanvasCoord,
      povOfLabelIfCentered: povOfLabel,
      panoId: svl.panoViewer.getPanoId(),
      originalPov: pov,
    };

    // Create the label and render the context menu.
    this.#status.currentLabel = svl.labelContainer.createLabel(param, true);
    svl.contextMenu.show(this.#status.currentLabel);

    // Log the labeling event.
    svl.tracker.push('LabelingCanvas_FinishLabeling', {
      labelType,
      canvasX,
      canvasY,
    }, {
      temporaryLabelId: this.#status.currentLabel.getProperty('temporaryLabelId'),
    });

    // Play labeling sound effect.
    if ('audioEffect' in svl) {
      svl.audioEffect.play('drip');
    }

    // If in the tutorial, send an event to the onboarding module.
    if (svl.onboarding) {
      const customEvent = new CustomEvent('addTutorialLabel', {
        detail: { label: this.#status.currentLabel },
      });
      document.dispatchEvent(customEvent);
    }

    // Wait for the crop to be saved before switching back to walk mode.
    // We are hiding the 'road labels' in the labeling mode as we don't want them to show in the crop.
    // So we need to ensure we don't switch back to explore mode until the crop is saved.
    // Trying to keep the timeout as low as possible to avoid any delay in switching back to walk mode for now.
    // Can try increasing it if we save crops with the road labels.
    setTimeout(() => {
      this.#ribbon.backToWalk();
    }, 20);
  }

  /**
   * Sets the cursor over the street view image.
   * @param {string} type - One of 'OpenHand', 'ClosedHand', or 'Pointer'; uses 'default' for any other input.
   */
  #setViewControlLayerCursor(type) {
    switch (type) {
      case 'OpenHand':
        svl.ui.streetview.viewControlLayer.css('cursor', `url(/assets/images/icons/openhand.cur) 4 4, move`);
        break;
      case 'ClosedHand':
        svl.ui.streetview.viewControlLayer.css('cursor', `url(/assets/images/icons/closedhand.cur) 4 4, move`);
        break;
      case 'Pointer':
        svl.ui.streetview.viewControlLayer.css('cursor', 'pointer');
        break;
      default:
        svl.ui.streetview.viewControlLayer.css('cursor', 'default');
    }
  }

  /**
   * Returns the cursor position in the fixed 720x480 logical canvas frame.
   *
   * The street view is displayed larger than the logical frame (see the --pano-width CSS variable), so we
   * divide the on-screen position by the display scale.
   *
   * @param {MouseEvent} e - The mouse event.
   * @param {HTMLElement} dom - The element the listener is bound to.
   * @returns {{x: number, y: number}}
   */
  #canvasMousePosition(e, dom) {
    const pos = util.mousePosition(e, dom);
    const scale = util.exploreDisplayScale();
    return { x: Math.round(pos.x / scale), y: Math.round(pos.y / scale) };
  }

  /**
   * Callback fired with the mousedown event on the view control layer (where you control street view angle).
   * @param {MouseEvent} e
   */
  #handlerViewControlLayerMouseDown(e) {
    const currMousePosition = this.#canvasMousePosition(e, e.currentTarget);
    this.#mouseStatus.isLeftDown = true;
    svl.tracker.push('ViewControl_MouseDown', currMousePosition);
    this.#setViewControlLayerCursor('ClosedHand');
  }

  /**
   * Callback on mouse up event on the view control layer (where you change the Google Street view angle).
   * @param {MouseEvent} e
   */
  #handlerViewControlLayerMouseUp(e) {
    const currMousePosition = this.#canvasMousePosition(e, e.currentTarget);
    this.#mouseStatus.isLeftDown = false;
    svl.tracker.push('ViewControl_MouseUp', currMousePosition);
    const currTime = new Date();

    const selectedLabel = this.onLabel(currMousePosition.x, currMousePosition.y);
    if (selectedLabel && selectedLabel.className === 'Label') {
      this.setCurrentLabel(selectedLabel);
      this.#setViewControlLayerCursor('Pointer');

      if ('contextMenu' in svl) {
        if (this.#status.contextMenuWasOpen) {
          svl.contextMenu.hide();
        } else {
          svl.contextMenu.show(selectedLabel);
        }
        this.#status.contextMenuWasOpen = false;
      }
    } else {
      this.#setViewControlLayerCursor('OpenHand');
      if (currTime - this.#mouseStatus.prevMouseUpTime < 300) {
        // Continue logging double click. We don't have any features for it now, but it's good to know how
        // frequently people are trying to double-click. They might be trying to zoom?
        svl.tracker.push('ViewControl_DoubleClick');
      }
    }
    this.#mouseStatus.prevMouseUpTime = currTime;
  }

  #handlerViewControlLayerMouseLeave() {
    this.#setViewControlLayerCursor('OpenHand');
    this.#mouseStatus.isLeftDown = false;

    // Catches the pointer exiting the pano while still over a label, which never fires the layer's mousemove.
    this.#scheduleHoverCardHide();
  }

  /**
   * Callback fired when a user moves a mouse on the view control layer where you change the pov.
   * @param {MouseEvent} e
   */
  #handlerViewControlLayerMouseMove(e) {
    const currMousePosition = this.#canvasMousePosition(e, e.currentTarget);

    const item = this.onLabel(currMousePosition.x, currMousePosition.y);
    if (this.#mouseStatus.isLeftDown && svl.panoManager.getStatus('disablePanning') === false) {
      // If a mouse is being dragged on the control layer, move the pano.
      const pov = svl.panoViewer.getPov();
      const zoomScaling = Math.pow(2, pov.zoom);
      const dx = (currMousePosition.x - this.#mouseStatus.prevX) / zoomScaling;
      const dy = (currMousePosition.y - this.#mouseStatus.prevY) / zoomScaling;
      svl.panoManager.updatePov(dx, dy);
      this.#setViewControlLayerCursor('ClosedHand');

      // Hide any label hover info while panning so it doesn't linger over the moving pano.
      this.showLabelHoverInfo(undefined);
      this.setCurrentLabel(undefined);
    } else if (item && item.className === 'Label') {
      // Show the hover card and update the cursor when hovering over a label.
      this.#setViewControlLayerCursor('Pointer');
      const selectedLabel = item;
      this.setCurrentLabel(selectedLabel);
      this.showLabelHoverInfo(selectedLabel);
      this.clear().render();
    } else {
      // Hide the hover card after a grace period, so the pointer can travel from the icon onto the card.
      this.#setViewControlLayerCursor('OpenHand');
      this.#scheduleHoverCardHide();
    }

    this.#mouseStatus.prevX = currMousePosition.x;
    this.#mouseStatus.prevY = currMousePosition.y;
  }

  /**
   * When mousing out of the canvas, stop trying to add a label type, switching back to Explore mode.
   */
  #handleDrawingLayerMouseOut() {
    svl.tracker.push('LabelingCanvas_MouseOut');
    if (!svl.isOnboarding()) this.#ribbon.backToWalk();
  }

  /**
   * Record locations of mouse-down event. Most functionality happens on mouse-up, but mouse-down context matters.
   * @param {MouseEvent} e
   */
  #handleDrawingLayerMouseDown(e) {
    svl.tracker.push('LabelingCanvas_MouseDown', this.#canvasMousePosition(e, e.currentTarget));
  }

  /**
   * Create a new label on mouse-up if we are in a labeling mode.
   * @param {MouseEvent} e
   */
  async #handleDrawingLayerMouseUp(e) {
    const currMousePosition = this.#canvasMousePosition(e, e.currentTarget);

    if (!this.#status.disableLabeling) {
      this.#createLabel(currMousePosition.x, currMousePosition.y);
      this.clear();
      this.setOnlyLabelsOnPanoAsVisible(svl.panoViewer.getPanoId());
      this.render();
    }

    svl.tracker.push('LabelingCanvas_MouseUp', currMousePosition);
    await svl.form.submitData(); // Submit the label to the back end.
  }

  /**
   * Update the canvas based on a mouse-move event: changing cursor, re-rendering, etc.
   * @param {MouseEvent} e
   */
  #handleDrawingLayerMouseMove(e) {
    // Change the cursor according to the label type.
    const cursorUrl = Label.getCursorImageUrl(this.#ribbon.getStatus('mode'));
    if (cursorUrl) {
      const hotspot = Label.CURSOR_ICON_SIZE / 2;
      // Need to reset the cursor first, otherwise Safari strangely doesn't update the cursor.
      $(e.currentTarget).css('cursor', '');
      $(e.currentTarget).css('cursor', `url(${cursorUrl}) ${hotspot} ${hotspot}, auto`);
    }
  }

  /**
   * Delete a label. Called when a user clicks the Delete button on a label's hover card.
   * @param {MouseEvent} e
   */
  #handleHoverCardDeleteClick(e) {
    e.stopPropagation(); // Deleting must not also trigger the card's open-context-menu click.
    if (!this.#status.disableLabelDelete) {
      const currLabel = this.getCurrentLabel();
      // If in tutorial, only delete if it's the last label that the user added to the canvas.
      if (currLabel
        && (!svl.onboarding || svl.onboarding.getCurrentLabelId() === currLabel.getProperty('temporaryLabelId'))) {
        svl.tracker.push('Click_LabelDelete', { labelType: currLabel.getProperty('labelType') });
        svl.labelContainer.removeLabel(currLabel);
        this.hideHoverCard();
        this.setCurrentLabel(undefined);
      }
    }
  }

  /**
   * Opens the hovered label's context menu — fired by the card's Edit button, and by a click anywhere else on the
   * card, which is one big click target for the same action as clicking the label icon itself.
   * @param {string} via - What was clicked ('card' or 'edit-button'), logged with the event.
   */
  #handleHoverCardClick(via) {
    const currLabel = this.getCurrentLabel();
    if (currLabel && currLabel.getLabelType() !== 'Occlusion' && 'contextMenu' in svl) {
      svl.tracker.push('Click_LabelHoverCard', { labelType: currLabel.getLabelType(), via });
      this.showLabelHoverInfo(undefined);
      svl.contextMenu.show(currLabel);
    }
  }

  /**
   * Schedules hiding the hover card after a short grace period, replacing any pending hide timer. The hide is
   * aborted if the pointer reaches the card (mouseenter) or returns to a label before the timer fires.
   */
  #scheduleHoverCardHide() {
    this.#cancelScheduledHoverCardHide();
    this.#hoverCardHideTimer = setTimeout(() => {
      this.#hoverCardHideTimer = null;
      this.showLabelHoverInfo(undefined);
      this.setCurrentLabel(undefined);
    }, Canvas.#HOVER_CARD_HIDE_DELAY_MS);
  }

  #cancelScheduledHoverCardHide() {
    if (this.#hoverCardHideTimer !== null) {
      clearTimeout(this.#hoverCardHideTimer);
      this.#hoverCardHideTimer = null;
    }
  }

  /**
   * Hides the hover card immediately, without the grace period.
   */
  hideHoverCard() {
    svl.ui.canvas.hoverCard.css('visibility', 'hidden');
  }

  /**
   * Clear what's on the canvas.
   * @returns {Canvas} this.
   */
  clear() {
    this.#ctx.clearRect(0, 0, this.#canvasProperties.width, this.#canvasProperties.height);
    return this;
  }

  /**
   * Disables the use of delete buttons for labels. Used primarily in the tutorial.
   * @returns {Canvas|boolean} this, or false if delete is locked.
   */
  disableLabelDelete() {
    if (!this.#status.lockDisableLabelDelete) {
      this.#status.disableLabelDelete = true;
      return this;
    }
    return false;
  }

  /** @returns {Canvas} this. */
  disableLabeling() {
    this.#status.disableLabeling = true;
    return this;
  }

  /** @returns {Canvas|boolean} this, or false if delete is locked. */
  enableLabelDelete() {
    if (!this.#status.lockDisableLabelDelete) {
      this.#status.disableLabelDelete = false;
      return this;
    }
    return false;
  }

  /** @returns {Canvas} this. */
  enableLabeling() {
    this.#status.disableLabeling = false;
    return this;
  }

  /**
   * Returns the label that the mouse is over.
   * @returns {?Object}
   */
  getCurrentLabel() {
    return this.#status.currentLabel;
  }

  getStatus(key) {
    return this.#status[key];
  }

  /**
   * Takes cursor coordinates x and y on the canvas and returns the label right below the cursor, or false if none.
   * @param {number} x
   * @param {number} y
   * @returns {Object|boolean}
   */
  onLabel(x, y) {
    const labels = svl.labelContainer.getCanvasLabels();

    // Check labels to see if they are under the mouse cursor.
    for (let i = 0; i < labels.length; i += 1) {
      if (labels[i].isOn(x, y)) {
        this.#status.currentLabel = labels[i];
        return labels[i];
      }
    }
    return false;
  }

  /** @returns {Canvas} this. */
  lockDisableLabelDelete() {
    this.#status.lockDisableLabelDelete = true;
    return this;
  }

  /**
   * Renders labels on the canvas.
   * @returns {Canvas} this.
   */
  render() {
    if (!this.#ctx) {
      return this;
    }
    const labels = svl.labelContainer.getCanvasLabels();
    const pov = svl.panoViewer.getPov();

    // Render labels.
    for (let i = 0; i < labels.length; i += 1) {
      labels[i].render(this.#ctx, pov);
    }

    // Update the opacity of Zoom In and Zoom Out buttons.
    if (svl.zoomControl) svl.zoomControl.updateOpacity();
    return this;
  }

  /**
   * Re-rasterizes the label canvas to the current displayed pano size and redraws all labels.
   * Call this after the UI scale changes (e.g. on window resize) so the canvas stays crisp and correctly placed.
   */
  resize() {
    const el = document.getElementById('label-canvas');
    if (!el || !this.#ctx) return;
    this.#sizeCanvasToDisplay(el);
    this.clear().render();
  }

  setCurrentLabel(label) {
    this.#status.currentLabel = label;
  }

  setStatus(key, value) {
    if (key in this.#status) {
      this.#status[key] = value;
    } else {
      throw new Error('Canvas: Illegal status name.');
    }
  }

  /**
   * Sets the passed label's hoverInfoVisibility to 'visible' and all the others to 'hidden'.
   * @param {Object} label
   */
  showLabelHoverInfo(label) {
    let needToRerender = false;

    // A definitive show/hide supersedes any pending grace-period hide.
    this.#cancelScheduledHoverCardHide();

    // Hide the hover info on all the labels.
    const labels = svl.labelContainer.getCanvasLabels();
    let hoverVisibility;
    for (let i = 0; i < labels.length; i += 1) {
      hoverVisibility = labels[i].getHoverInfoVisibility();

      // If this is the label being hovered, set its visibility.
      if (label) {
        needToRerender = true;
        if (label === labels[i]) {
          labels[i].setHoverInfoVisibility('visible');
        }
      } else if (hoverVisibility === 'visible') {
        // If not hovered but was being hovered, hide it and rerender.
        needToRerender = true;
        labels[i].setHoverInfoVisibility('hidden');

        // Hide the hover card when no label is hovered.
        this.hideHoverCard();
      }
    }

    if (needToRerender) {
      this.clear().render();
    }
  }

  /** @returns {Canvas} this. */
  setVisibility(visibility) {
    const labels = svl.labelContainer.getCanvasLabels();
    for (let i = 0; i < labels.length; i += 1) {
      labels[i].setVisibility(visibility);
    }
    return this;
  }

  /**
   * Sets labels on the given pano as visible, all others as hidden.
   * @param {string} panoId
   */
  setOnlyLabelsOnPanoAsVisible(panoId) {
    const labels = svl.labelContainer.getCanvasLabels();
    for (let i = 0; i < labels.length; i += 1) {
      if (labels[i].getPanoId() === panoId && !labels[i].isDeleted()) {
        labels[i].setVisibility('visible');
      } else {
        labels[i].setVisibility('hidden');
      }
    }
  }

  /** @returns {Canvas} this. */
  unlockDisableLabelDelete() {
    this.#status.lockDisableLabelDelete = false;
    return this;
  }

  /**
   * Saves a screenshot of the canvas when the label was placed, to be uploaded to the server later.
   * @param {Object} label
   */
  saveCanvasScreenshot(label) {
    // If there is no label to associate this crop with, don't save the crop.
    if (!label) {
      console.log('No label found when making a crop.');
      return;
    }

    // Save a high-res version of the image to the label object. Uploaded after label is saved to the db.
    const newCrop = $(`.${svl.panoViewer.getCanvasClass()}`)[0].toDataURL('image/jpeg', 1);
    label.setProperty('crop', newCrop);
  }
}
