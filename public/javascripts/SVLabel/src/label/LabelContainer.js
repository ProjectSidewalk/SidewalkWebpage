/**
 * Label Container module. This is responsible for storing the label objects that were created in the current session.
 *
 * @memberof svl
 */
class LabelContainer {
  #jquery;
  #labelsToLog = {};
  #allLabels = {};
  #nextTempLabelId;

  /**
   * @param $ jQuery object.
   * @param nextTemporaryLabelId
   */
  constructor($, nextTemporaryLabelId) {
    this.#jquery = $;
    this.#nextTempLabelId = nextTemporaryLabelId;
  }

  /**
   * Helper func to add a label to given list. Our labels are sorted in objects with panoId keys and lists as values.
   * @param labelListObj
   * @param label
   */
  #addLabelToListObject(labelListObj, label) {
    const panoId = label.getPanoId();
    const tempId = label.getProperty('temporaryLabelId');

    // Make sure that there is a list available for the given pano ID.
    if (!(panoId in labelListObj)) labelListObj[panoId] = [];

    // If it's not already in the last, add it.
    const inList = labelListObj[panoId].filter((l) => l.getProperty('temporaryLabelId') === tempId).length > 0;
    if (!inList) labelListObj[panoId].push(label);
  }

  /**
   * Create a Label object. If the label is new, it won't have a labelId yet, so we assign a temporary one.
   * @returns {Label}
   */
  createLabel(params, isNew) {
    if (isNew) {
      params.temporaryLabelId = this.#nextTempLabelId;
      this.#nextTempLabelId++;
    }
    const label = new Label(params);

    // If in tutorial, update the current label id field in onboarding.
    if (svl.onboarding) {
      svl.onboarding.setCurrentLabelId(label.getProperty('temporaryLabelId'));
    }

    // Add to list of labels. If new, also add to current canvas labels.
    if (isNew) {
      this.#addLabelToListObject(this.#labelsToLog, label);
      svl.overallStats.incrementLabelCount();

      // Save a screenshot of the pano when a new label is placed.
      // Use the setTimeout to avoid blocking UI rendering and interactions.
      if (svl.makeCrops && !params.tutorial) {
        setTimeout(() => {
          try {
            svl.canvas.saveCanvasScreenshot(label);
          } catch (e) {
            // todo: better logging
            console.log('Error saving pano screenshot: ', e);
          }
        }, 0);
      }
    }
    this.#addLabelToListObject(this.#allLabels, label);

    return label;
  }

  /**
   * Query server for previous labels placed by this user and create label objects for them.
   * @param regionId
   * @param callback
   */
  fetchLabelsToResumeMission(regionId, callback) {
    this.#jquery.getJSON('/label/resumeMission', { regionId }, (result) => {
      const labelArr = result.labels;
      for (let i = 0; i < labelArr.length; i++) {
        const originalCanvasXY = {
          x: labelArr[i].canvasX,
          y: labelArr[i].canvasY,
        };

        // Get the canvas coordinates for the label given the current POV.
        const povOfLabelIfCentered = util.pano.canvasCoordToCenteredPov(
          labelArr[i].originalPov, originalCanvasXY.x, originalCanvasXY.y,
          util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT,
        );
        labelArr[i].currCanvasXY = util.pano.centeredPovToCanvasCoord(
          povOfLabelIfCentered, svl.panoViewer.getPov(),
          util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT, svl.LABEL_ICON_RADIUS,
        );

        labelArr[i].originalCanvasXY = originalCanvasXY;
        labelArr[i].povOfLabelIfCentered = povOfLabelIfCentered;
        labelArr[i].panoXY = { x: labelArr[i].panoX, y: labelArr[i].panoY };
        const label = this.createLabel(labelArr[i], false);

        // Prevent hover info from being rendered initially.
        label.setHoverInfoVisibility('hidden');
      }

      if (callback) callback(result);
    });
  }

  /**
   * Returns labels for the current pano ID.
   */
  getCanvasLabels() {
    const panoId = svl.panoViewer.getPanoId();
    return this.#allLabels[panoId] ? this.#allLabels[panoId] : [];
  }

  /**
   * Get labels that need to be logged to the back-end because they are new or the user has interacted with them.
   */
  getLabelsToLog() {
    return Object.keys(this.#labelsToLog).reduce((r, k) => r.concat(this.#labelsToLog[k]), []);
  }

  getAllLabels() {
    return Object.keys(this.#allLabels).reduce((r, k) => r.concat(this.#allLabels[k]), []);
  }

  /**
   * Find a label with matching temporary ID.
   * @param tempId
   */
  findLabelByTempId(tempId) {
    const matchingLabels = this.getCanvasLabels().filter((l) => l.getProperty('temporaryLabelId') === tempId);
    if (matchingLabels.length > 1) {
      console.warn('Multiple labels with same temp ID!');
      console.log(this.getCanvasLabels());
    }
    // Returns most recent version of label (though there shouldn't be multiple).
    return matchingLabels[matchingLabels.length - 1];
  }

  /**
   * Adds a label to the list of labels that should be logged; called when a user interacts with an existing label.
   * @param tempId
   */
  addToLabelsToLog(tempId) {
    const match = this.findLabelByTempId(tempId);
    if (match) this.#addLabelToListObject(this.#labelsToLog, match);
  }

  clearLabelsToLog() {
    this.#labelsToLog = {};
  }

  countLabels() {
    const allLabels = this.getAllLabels();
    return allLabels.filter((l) => !l.isDeleted()).length;
  }

  /**
   * Removes a passed label, updates the canvas, and updates label counts.
   */
  removeLabel(label) {
    if (!label) {
      return false;
    }
    svl.tracker.push('RemoveLabel', { labelType: label.getProperty('labelType') });
    if (svl.isOnboarding()) this.#jquery(document).trigger('RemoveLabel');
    svl.overallStats.decrementLabelCount();
    label.remove();
    this.#addLabelToListObject(this.#labelsToLog, label);
    svl.canvas.clear().render();
    return this;
  }
}
