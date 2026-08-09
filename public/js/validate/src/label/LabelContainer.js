/**
 * Keeps track of labels that have appeared on the panorama.
 *
 * Construct instances via the `static async create()` factory, which renders the first label before resolving.
 */
class LabelContainer {
  // These three are set in resetLabelList.
  #labels;  // All labels in the mission.
  #currLabelIndex;
  #currLabel;

  #labelsToSubmit = [];
  #submittedLabels = [];
  #lastLabelFormData; // Holds prior label's metadata formatted for submission, making it easier to submit an undo.

  #properties = {
    validationTimestamp: new Date(),
  };

  /**
   * @param {Array} labelList Initial list of labels to be validated (generated when the page is loaded).
   */
  constructor(labelList) {
    this.resetLabelList(labelList);
  }

  /**
   * Creates a LabelContainer and renders its first label.
   * @param {Array} labelList Initial list of labels to be validated.
   * @returns {Promise<LabelContainer>}
   */
  static async create(labelList) {
    const labelContainer = new LabelContainer(labelList);
    await labelContainer.renderCurrentLabel();
    return labelContainer;
  }

  /**
   * Gets a specific property from the LabelContainer.
   * @param {string} key Property name.
   * @returns Value associated with this property or null.
   */
  getProperty(key) {
    return key in this.#properties ? this.#properties[key] : null;
  }

  /**
   * Sets a property for the LabelContainer.
   * @param {string} key Name of property.
   * @param value Value of property.
   * @returns {LabelContainer}
   */
  setProperty(key, value) {
    this.#properties[key] = value;
    return this;
  }

  /**
   * Returns the last validated label's form data for submission to the back end, useful for undoing a label.
   * @returns Form data for last validated label from this mission.
   */
  getPriorLabelFormData() {
    return this.#lastLabelFormData;
  }

  /**
   * Returns the Label object for the current label.
   * @returns {Label}
   */
  getCurrentLabel() {
    return this.#currLabel;
  }

  /**
   * Goes back to the last label.
   */
  async undoLabel() {
    this.#lastLabelFormData = undefined;
    this.#currLabelIndex -= 1;
    this.#currLabel = this.#labels[this.#currLabelIndex];
    await this.renderCurrentLabel();
  }

  /**
   * Moves to the next label in the list. If there are no more labels, shows the mission complete modal.
   * @returns {Promise<void>}
   */
  async moveToNextLabel() {
    this.#currLabelIndex += 1;
    this.#currLabel = this.#labels[this.#currLabelIndex];
    if (this.#currLabel === undefined) {
      svv.modalNoNewMission.show();
    } else {
      await this.renderCurrentLabel();
      if (svv.labelVisibilityControl && !svv.labelVisibilityControl.isVisible()) {
        svv.labelVisibilityControl.unhideLabel();
      }

      // Update zoom availability on desktop.
      if (svv.zoomControl) {
        svv.zoomControl.updateZoomAvailability();
      }
    }
  }

  /**
   * Renders the current label on the pano, updating the UI accordingly.
   *
   * Labels whose imagery no viewer can render are dropped from the mission rather than shown (#4810): the pano area
   * is empty behind a failed load, so rendering the rest of the UI over it would ask for a verdict on a label
   * nobody can see. A dropped label is never validated — it goes back in the pool for whoever gets it next — and
   * the backend hands out exactly as many labels as the mission still needs, so dropping one leaves the mission
   * that much short of finishing.
   */
  async renderCurrentLabel() {
    // Prevent UI interaction and show that we're working on loading the next label.
    svv.ui.validationMenu.holder.addClass('validate-disabled');
    svv.ui.viewer.holder.addClass('validate-disabled');
    svv.ui.holder.css('cursor', 'wait');
    if (svv.keyboard) svv.keyboard.disableKeyboard();

    if (this.#currLabelIndex > 0) {
      svv.undoValidation.enableUndo();
    }

    // Render the new pano and the label on it, updating the surrounding UI given the new label's info.
    const nSkipped = await this.#loadPanoForCurrentLabel();
    if (nSkipped > 0) this.#showSkippedLabelsToast(nSkipped);

    // Every label left in the mission failed to load. The UI stays disabled behind the modal — there is nothing to
    // validate, and the mission resumes with a fresh set of labels the next time the user opens Validate.
    if (!this.#currLabel) {
      svv.modalNoNewMission.show();
      return;
    }

    // The card is anchored to the marker of the label we're leaving, so it can't carry over to the next one.
    // (Undefined on the very first render, which happens while LabelContainer itself is still being constructed.)
    svv.labelVisibilityControl?.hideLabelCard();
    svv.labelCard.render(this.#currLabel);
    svv.validationMenu.resetMenu(this.#currLabel);
    if (svv.adminVersion) svv.adminInfo.updateAdminInfo(this.#currLabel);
    svv.panoManager.renderPanoMarker(this.#currLabel);
    // Every label starts visible. Without this the toggle keeps saying "Show Label" over a marker that renderPanoMarker
    // just drew in full — you'd have to hide and re-show to get the two back in agreement.
    svv.labelVisibilityControl?.unhideLabel();

    // Re-enable UI interaction now that everything has loaded. Also need to invalidate the cached cursor so that it
    // will reset, which is why we attach a timestamp to it below.
    svv.ui.validationMenu.holder.removeClass('validate-disabled');
    svv.ui.viewer.holder.removeClass('validate-disabled');
    svv.ui.holder.css('cursor', '');
    svv.ui.viewer.controlLayer.css('cursor', `url(/assets/images/icons/openhand.cur?${Date.now()}) 4 4, move`);
    if (svv.keyboard) svv.keyboard.enableKeyboard();
  }

  /**
   * Loads the current label's pano, dropping labels whose imagery won't load until one renders or none are left.
   *
   * A dropped label is spliced out of the list rather than stepped over, so that the indices the undo button walks
   * back through only ever hold labels the user actually saw.
   *
   * @returns {Promise<number>} How many labels were dropped.
   */
  async #loadPanoForCurrentLabel() {
    let nSkipped = 0;
    while (this.#currLabel) {
      this.#currLabel.setProperty('startTimestamp', new Date());
      const panoData = await svv.panoManager.setPanorama(
        this.#currLabel.getAuditProperty('panoId'), this.#currLabel.getAuditProperty('backupImage'),
      );
      if (panoData) return nSkipped;

      // Log it: this is invisible to the user by design, so the tracker is the only signal we have for how often
      // imagery fails in production (#4810).
      svv.tracker.push('LabelSkipped_NoImagery', {
        labelId: this.#currLabel.getAuditProperty('labelId'),
        panoId: this.#currLabel.getAuditProperty('panoId'),
      });
      nSkipped += 1;
      this.#labels.splice(this.#currLabelIndex, 1);
      this.#currLabel = this.#labels[this.#currLabelIndex];
    }
    return nSkipped;
  }

  /**
   * Tells the user a label went by without them seeing it, so a mission that ends early isn't a mystery.
   * @param {number} nSkipped How many labels were dropped.
   */
  #showSkippedLabelsToast(nSkipped) {
    Toast.show({
      message: i18next.t('center-ui.imagery-unavailable', { count: nSkipped }),
      reference: document.getElementById('svv-panorama-holder'),
      dark: true,    // It floats over street imagery, where a white card glares.
      compact: true, // An aside, not an announcement.
    });
  }

  /**
   * Creates a list of label objects to be validated from label metadata. Called when a new mission is loaded.
   * @param {Array} labelList List of label metadata objects.
   */
  resetLabelList(labelList) {
    this.#labels = labelList.map((key) => new Label(key));
    this.#currLabelIndex = 0;
    this.#currLabel = this.#labels[this.#currLabelIndex];
  }

  /**
   * Returns a list of labels for the current mission.
   */
  getLabels() {
    return this.#labels;
  }

  /**
   * Validates the current label.
   */
  validateCurrentLabel(action, timestamp, comment) {
    this.#currLabel.validate(action, comment);
    this.setProperty('validationTimestamp', timestamp);
  }

  /**
   * Gets a list of current labels that have not been sent to the backend yet.
   * @returns {Array}
   */
  getLabelsToSubmit() {
    return this.#labelsToSubmit;
  }

  /**
   * Pushes label metadata to the list of labels that need to be submitted to the backend.
   * @param {number} labelId Integer label ID.
   * @param {object} labelMetadata Label metadata (validationProperties object).
   * @param {object} commentData Comment data (commentProperties object).
   */
  pushToLabelsToSubmit(labelId, labelMetadata, commentData) {
    // If the most recent label is the same as current (meaning it was an undo), remove the undo and use this one.
    const mostRecentLabel = this.#labelsToSubmit[this.#labelsToSubmit.length - 1];
    let redone = false;
    if (mostRecentLabel && mostRecentLabel.label_id === labelId) {
      this.#labelsToSubmit.pop();
      redone = true;
    }

    const data = {
      canvas_height: svv.canvasHeight(),
      canvas_width: svv.canvasWidth(),
      canvas_x: labelMetadata.canvasX,
      canvas_y: labelMetadata.canvasY,
      end_timestamp: labelMetadata.endTimestamp,
      heading: labelMetadata.heading,
      label_id: labelId,
      mission_id: svv.missionContainer.getCurrentMission().getProperty('missionId'),
      pitch: labelMetadata.pitch,
      start_timestamp: labelMetadata.startTimestamp,
      validation_result: labelMetadata.validationResult,
      old_severity: labelMetadata.oldSeverity,
      new_severity: labelMetadata.newSeverity,
      old_tags: labelMetadata.oldTags,
      new_tags: labelMetadata.newTags,
      comment: commentData,
      zoom: labelMetadata.zoom,
      source: svv.form.getSource(),
      undone: false,
      redone,
      viewer_type: svv.panoManager.getActiveViewerName(),
    };
    this.#labelsToSubmit.push(data);
    this.#lastLabelFormData = data;
  }

  /**
   * Pushes a label object directly (for undo purposes) to the list of current labels.
   * @param {object} validation The completed label validation object ready to be pushed to the list of labels.
   */
  pushUndoValidation(validation) {
    validation.undone = true;
    validation.redone = false;
    this.#labelsToSubmit.push(validation);
  }

  /**
   * Takes the last label out of the list of labels that have not been submitted to the backend.
   */
  pop() {
    this.#labelsToSubmit.pop();
  }

  /**
   * Moves the labelsToSubmit to submittedLabels and clears the labelsToSubmit array.
   */
  refresh() {
    this.#submittedLabels.concat(this.#labelsToSubmit);
    this.#labelsToSubmit = [];
  }
}
