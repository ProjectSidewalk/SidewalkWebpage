/**
 * Keeps track of labels that have appeared on the panorama.
 *
 * Construct instances via the `static async create()` factory, which renders the first label before resolving.
 */
class LabelContainer {
  // A mission that has had to ask for replacement labels twice and still can't render one is not having a run of bad
  // luck — imagery is broadly unavailable (a provider outage or quota). Stop asking and tell the user (#4810).
  static #MAX_TOP_UP_ROUNDS = 2;

  // These are all set in resetLabelList.
  #labels;  // All labels in the mission.
  #currLabelIndex;
  #currLabel;
  #labelTypeId;      // The mission's label type, so replacement labels match the ones it started with.
  #seenLabelIds;     // Every label this mission has handed us, so a replacement can't duplicate one.
  #labelsOwed;       // Labels dropped for unrenderable imagery that haven't been replaced yet.
  #topUpRounds;

  #labelsToSubmit = [];
  #submittedLabels = [];
  #lastLabelFormData; // Holds prior label's metadata formatted for submission, making it easier to submit an undo.

  #properties = {
    validationTimestamp: new Date(),
  };

  /**
   * @param {Array} labelList Initial list of labels to be validated (generated when the page is loaded).
   * @param {number} labelTypeId Label type ID of the mission these labels belong to.
   */
  constructor(labelList, labelTypeId) {
    this.resetLabelList(labelList, labelTypeId);
  }

  /**
   * Creates a LabelContainer and renders its first label.
   * @param {Array} labelList Initial list of labels to be validated.
   * @param {number} labelTypeId Label type ID of the mission these labels belong to.
   * @returns {Promise<LabelContainer>}
   */
  static async create(labelList, labelTypeId) {
    const labelContainer = new LabelContainer(labelList, labelTypeId);
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
    await this.renderCurrentLabel();

    // renderCurrentLabel shows the no-more-labels modal when it can't produce a label to show — after asking the
    // backend to replace any it had to drop — so there is nothing left to set up here.
    if (!this.#currLabel) return;

    if (svv.labelVisibilityControl && !svv.labelVisibilityControl.isVisible()) {
      svv.labelVisibilityControl.unhideLabel();
    }

    // Update zoom availability on desktop.
    if (svv.zoomControl) {
      svv.zoomControl.updateZoomAvailability();
    }
  }

  /**
   * Renders the current label on the pano, updating the UI accordingly.
   */
  async renderCurrentLabel() {
    this.#setUiBusy(true);

    if (this.#currLabelIndex > 0) {
      svv.undoValidation.enableUndo();
    }

    // Render the new pano and the label on it, updating the surrounding UI given the new label's info.
    let nSkipped = await this.#loadPanoForCurrentLabel();

    // Dropping labels emptied the queue, so ask the backend to replace what it can and carry on.
    while (!this.#currLabel && await this.#topUpLabelQueue()) {
      nSkipped += await this.#loadPanoForCurrentLabel();
    }

    // Out of labels. Which modal depends on why: actually no labels vs dropped labels mean imagery is the problem.
    if (!this.#currLabel) {
      this.#setUiBusy(false);
      svv.modalNoNewMission.show({ imageryUnavailable: nSkipped > 0 });
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

    this.#setUiBusy(false);
  }

  /**
   * Locks or releases the tool while a label is being loaded.
   *
   * Every path out of renderCurrentLabel has to release it, including the ones that end at a modal: the modals live
   * inside #svv-application-holder, so the `validate-disabled` class on that holder disables their buttons too.
   *
   * @param {boolean} busy True to lock the UI, false to hand it back.
   */
  #setUiBusy(busy) {
    svv.ui.validationMenu.holder.toggleClass('validate-disabled', busy);
    svv.ui.viewer.holder.toggleClass('validate-disabled', busy);
    svv.ui.holder.css('cursor', busy ? 'wait' : '');
    if (busy) {
      if (svv.keyboard) svv.keyboard.disableKeyboard();
    } else {
      // The cursor is cached by the browser, so a timestamp is attached to invalidate it and force the reset.
      svv.ui.viewer.controlLayer.css('cursor', `url(/assets/images/icons/openhand.cur?${Date.now()}) 4 4, move`);
      if (svv.keyboard) svv.keyboard.enableKeyboard();
    }
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
      this.#labelsOwed += 1;
      this.#labels.splice(this.#currLabelIndex, 1);
      this.#currLabel = this.#labels[this.#currLabelIndex];
    }
    return nSkipped;
  }

  /**
   * Asks the backend to replace the labels this mission dropped for unrenderable imagery (#4810).
   *
   * Validate is handed exactly as many labels as its mission still needs, so without this a dropped label would
   * leave the mission unfinishable. Send along all the mission's label_ids so the back end doesn't choose a duplicate.
   *
   * @returns {Promise<boolean>} True if at least one replacement label was added to the queue.
   */
  async #topUpLabelQueue() {
    if (this.#labelsOwed < 1 || this.#topUpRounds >= LabelContainer.#MAX_TOP_UP_ROUNDS) return false;
    this.#topUpRounds += 1;

    let labels;
    try {
      const response = await fetch('/validationTask/moreLabels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          label_type_id: this.#labelTypeId,
          labels_needed: this.#labelsOwed,
          excluded_label_ids: [...this.#seenLabelIds],
          validate_params: svv.form.getValidateParams(),
        }),
      });
      if (!response.ok) throw new Error(`Replacement labels request failed with HTTP ${response.status}`);
      labels = (await response.json()).labels;
    } catch (error) {
      // Nothing to retry into — the caller falls through to the no-more-labels modal, and the mission resumes with a
      // fresh set of labels next time the user opens Validate.
      svv.tracker.push('LabelTopUpFailed', { error: error.message });
      return false;
    }

    svv.tracker.push('LabelTopUp', { requested: this.#labelsOwed, received: labels.length });
    if (labels.length === 0) return false;

    for (const labelMetadata of labels) {
      const label = new Label(labelMetadata);
      this.#labels.push(label);
      this.#seenLabelIds.add(label.getAuditProperty('labelId'));
    }
    this.#labelsOwed -= labels.length;
    this.#currLabel = this.#labels[this.#currLabelIndex];
    return true;
  }

  /**
   * Creates a list of label objects to be validated from label metadata. Called when a new mission is loaded.
   * @param {Array} labelList List of label metadata objects.
   * @param {number} labelTypeId Label type ID of the mission these labels belong to.
   */
  resetLabelList(labelList, labelTypeId) {
    this.#labels = labelList.map((key) => new Label(key));
    this.#currLabelIndex = 0;
    this.#currLabel = this.#labels[this.#currLabelIndex];
    this.#labelTypeId = labelTypeId;
    this.#seenLabelIds = new Set(this.#labels.map((label) => label.getAuditProperty('labelId')));
    this.#labelsOwed = 0;
    this.#topUpRounds = 0;
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
