/**
 * Keeps track of labels that have appeared on the panorama.
 *
 * Construct instances via the `static async create()` factory, which renders the first label before resolving.
 */
class LabelContainer {
  // A mission that has had to ask for replacement labels twice and still can't render one is not having a run of bad
  // luck — imagery is broadly unavailable (a provider outage or quota). Stop asking and tell the user (#4810).
  static #MAX_TOP_UP_ROUNDS = 2;

  /**
   * How many upcoming labels have their pano warmed while the current one is judged. Two covers a fast verdict on the
   * next label without fetching thumbnails for a queue the validator may never reach.
   * @type {number}
   */
  static #PREFETCH_AHEAD = 2;

  // Loads a label gets before a slow one is dropped (#5581). The first slow load sends it to the back of the queue,
  // since the pano exists and often loads on a second try once the CDN has warmed; a second one means this network
  // can't fetch it in time today, and holding the validator for a third deadline would cost more than the label.
  static #MAX_LOAD_ATTEMPTS = 2;

  // Slow loads in a row, with no load succeeding in between, after which slow labels are dropped on their first try
  // instead of deferred (#5581). Three says it is the network rather than a few unlucky panos. Deferring on a network
  // that loads nothing only postpones the "Imagery couldn't be loaded" modal: every label, and every replacement label,
  // would spend two deadlines of 12 s (plus the existence check) each before getting there, which is a quarter of an
  // hour for a mission with two top-up rounds.
  static #MAX_SLOW_STREAK = 3;

  // These are all set in resetLabelList.
  #labels;  // All labels in the mission.
  #currLabelIndex;
  #currLabel;
  #labelType;      // The mission's label type, so replacement labels match the ones it started with.
  #seenLabelIds;     // Every label this mission has handed us, so a replacement can't duplicate one.
  #labelsOwed;       // Labels dropped for unrenderable imagery that haven't been replaced yet.
  #topUpRounds;
  /** @type {Map<Label, number>} Loads tried per label that failed as slow, so a deferred label is deferred once. */
  #slowLoads;

  /**
   * Slow loads since the last load that succeeded. Kept across missions, since it measures the network, which a new
   * mission doesn't fix; see #MAX_SLOW_STREAK.
   * @type {number}
   */
  #slowStreak = 0;

  #labelsToSubmit = [];
  #submittedLabels = [];
  // Holds prior label's metadata formatted for submission, making it easier to submit an undo. Only read while the
  // undo button is live, and the button is disabled the moment an undo lands, so one undo can't be applied twice.
  #lastLabelFormData;

  // True from the moment renderCurrentLabel starts until the label it loads is on screen. In that window #currLabel
  // has already advanced but the panorama has not, so anything acting on "the current label" would be acting on one
  // the validator cannot see yet (#5211). Only #setUiBusy writes it, so what the code checks and what the validator
  // is shown can't drift apart.
  #loading = false;

  #properties = {
    validationTimestamp: new Date(),
  };

  /**
   * @param {Array} labelList - Initial list of labels to be validated (generated when the page is loaded).
   * @param {string} labelType - Label type of the mission these labels belong to.
   */
  constructor(labelList, labelType) {
    this.resetLabelList(labelList, labelType);
  }

  /**
   * Creates a LabelContainer and renders its first label.
   * @param {Array} labelList - Initial list of labels to be validated.
   * @param {string} labelType - Label type of the mission these labels belong to.
   * @returns {Promise<LabelContainer>}
   */
  static async create(labelList, labelType) {
    const labelContainer = new LabelContainer(labelList, labelType);
    await labelContainer.renderCurrentLabel();
    return labelContainer;
  }

  /**
   * Gets a specific property from the LabelContainer.
   * @param {string} key - Property name.
   * @returns {*} Value associated with this property or null.
   */
  getProperty(key) {
    return key in this.#properties ? this.#properties[key] : null;
  }

  /**
   * Sets a property for the LabelContainer.
   * @param {string} key - Name of property.
   * @param {*} value - Value of property.
   * @returns {LabelContainer}
   */
  setProperty(key, value) {
    this.#properties[key] = value;
    return this;
  }

  /**
   * Returns the last validated label's form data for submission to the back end, useful for undoing a label.
   * @returns {?object} Form data for last validated label from this mission.
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
   * Whether input aimed at the current label has to be dropped because that label's pano is still loading.
   *
   * Between advancing to a label and its imagery arriving — 1.7 s on average on the Pannellum fallback path, and up
   * to 4.5 s — `getCurrentLabel()` already returns the new label while the pano on screen is still the old one. A
   * validation cast in that window is stored against imagery the validator never saw: its POV and canvas coordinates
   * are read off the previous label's pano, and its endTimestamp predates the label appearing (#5211). The busy state
   * blocks the pointer; this covers what CSS can't, including a keypress on a button that kept focus after a click.
   *
   * @param {string} source - What was dropped, for the tracker: a verdict, a submit, an undo, or a label advance.
   * @returns {boolean} True if the caller must return without touching the current label.
   */
  dropInputWhileLoading(source) {
    if (!this.#loading) return false;
    svv.tracker.push('ValidateInputDropped_Loading', { source });
    return true;
  }

  /**
   * Goes back to the last label.
   *
   * Imagery can fail on the way back (#4810, #5581), in which case the undo is abandoned: the label the user undid
   * from is shown again and Back is disabled, as it is after an undo that worked. The label being returned to has
   * already been validated, so it can't be deferred or dropped like an unseen one: deferring it would serve it a
   * second time at the end of the mission, and dropping it would ask the backend to replace a label that counts.
   * Reporting the abandoned undo as a failed one is what keeps mission progress in step: the caller only rolls back a
   * validation the user can actually redo.
   *
   * @returns {Promise<boolean>} True if the previous label is now showing. False also covers an undo dropped for
   * arriving mid-load, which is likewise an undo the caller must not count.
   */
  async undoLabel() {
    if (this.dropInputWhileLoading('Undo')) return false;

    const previousLabel = this.#labels[this.#currLabelIndex - 1];
    this.#currLabelIndex -= 1;
    this.#currLabel = previousLabel;
    await this.renderCurrentLabel({ undo: true });

    const undone = this.#currLabel === previousLabel;
    // renderCurrentLabel re-enabled Back for the label it fell back to; pressing it would only repeat the failure.
    if (!undone) svv.undoValidation.disableUndo();
    return undone;
  }

  /**
   * Moves to the next label in the list. If there are no more labels, shows the mission complete modal.
   * @returns {Promise<void>}
   */
  async moveToNextLabel() {
    if (this.dropInputWhileLoading('NextLabel')) return;

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
   * @param {{undo?: boolean}} [options] - `undo` when the current label is one the user already validated and is
   *     stepping back to, so a failed load abandons the undo rather than passing the label over (see undoLabel).
   * @returns {Promise<void>}
   */
  async renderCurrentLabel({ undo = false } = {}) {
    try {
      this.#setUiBusy(true);
      // Logged against the label loading when the load turns slow, which a deferral can have moved on from this one.
      svv.panoLoadingStatus?.begin(() => {
        if (!this.#currLabel) return;
        svv.tracker.push('PanoLoadingStatus_Shown', {
          labelId: this.#currLabel.getAuditProperty('labelId'),
          panoId: this.#currLabel.getAuditProperty('panoId'),
        });
      }, { immediate: svv.panoManager?.blanksPanoWhileLoading?.() ?? false });

      if (this.#currLabelIndex > 0) {
        svv.undoValidation.enableUndo();
      }

      // Render the new pano and the label on it, updating the surrounding UI given the new label's info.
      await this.#loadPanoForCurrentLabel({ undo });

      // Dropping labels emptied the queue, so ask the backend to replace what it can and carry on.
      while (!this.#currLabel && await this.#topUpLabelQueue()) {
        await this.#loadPanoForCurrentLabel();
      }

      // Out of labels. Which modal depends on why: labels we still owe the mission mean imagery is the problem, and
      // a reload retries them, since the labels dropped this session are only excluded for as long as it lasts.
      if (!this.#currLabel) {
        this.#setUiBusy(false);
        svv.modalNoNewMission.show({ imageryUnavailable: this.#labelsOwed > 0 });
        return;
      }

      // The card is anchored to the marker of the label we're leaving, so it can't carry over to the next one.
      // (Undefined on the very first render, which happens while LabelContainer itself is still being constructed.)
      svv.labelVisibilityControl?.hideLabelCard();
      svv.labelCard.render(this.#currLabel);
      svv.validationMenu.resetMenu(this.#currLabel);
      if (svv.adminVersion) svv.adminInfo.updateAdminInfo(this.#currLabel);
      // Awaited so the tool unlocks only once the pano is on screen facing this label: on a viewer that paints during
      // loads, that is renderPanoMarker's reveal, not setPanorama resolving (#5582).
      await svv.panoManager.renderPanoMarker(this.#currLabel);
      // Tell the sign here rather than leave it waiting on a pano_changed: the label that just loaded may have swapped
      // the active viewer, and the viewer the sign last heard from is then the one that stays silent (#4828). Absent
      // on mobile, and on the first label, whose render runs inside LabelContainer.create — before SpeedLimit exists.
      svv.speedLimit?.refresh();
      // Every label starts visible. Without this the toggle keeps saying "Show Label" over a marker that
      // renderPanoMarker just drew in full — you'd have to hide and re-show to get the two back in agreement.
      svv.labelVisibilityControl?.unhideLabel();

      // Warm the next labels' panos while this one is being judged, since a jump to an unrelated pano never hits the
      // provider's own neighbor cache (#5581). Two ahead, so a quick verdict on the next label still finds the one
      // after it warm; the fetch is a thumbnail and metadata per label, cheap enough to sometimes waste.
      const first = this.#currLabelIndex + 1;
      const upcoming = this.#labels.slice(first, first + LabelContainer.#PREFETCH_AHEAD);
      for (const label of upcoming) svv.panoManager.prefetchPano(label.getAuditProperty('panoId'));
    } catch (error) {
      // The only trace a render failure leaves. It used to announce itself by stranding the lock, which turned every
      // later tap and keypress into a ValidateInputDropped_Loading — unusable for the validator, but at least loud.
      // Releasing the lock in the finally takes that away: the caller either swallows the rejection (Form) or drops
      // it on the floor (moveToNextLabel), so without this the tool would come back looking healthy and say nothing.
      // Read defensively rather than as a plain `error.message`: a rejection carrying something other than an Error
      // — a bare `Promise.reject()`, a string thrown by a viewer SDK — would make this line a TypeError of its own,
      // losing the event and handing the caller an exception unrelated to what actually failed.
      svv.tracker?.push('ValidateRenderFailed', { error: error?.message ?? String(error) });
      // The finally hands the tool back, so a canvas still held unpainted for the reveal would leave the validator
      // judging a blank pano area (#5582). Guarded because a cleanup that throws would replace the error reported.
      svv.panoManager?.revealPendingCanvas?.();
      throw error;
    } finally {
      // The out-of-labels path releases early on purpose, so that the modal's own disableKeyboard is what stands;
      // the condition is what keeps this from re-enabling the keyboard behind it. Every other way out lands here,
      // a throw included — leaving #loading set would drop every tap and keypress for the rest of the session.
      if (this.#loading) this.#setUiBusy(false);
      svv.panoLoadingStatus?.end();
    }
  }

  /**
   * Locks or releases the tool while a label is being loaded.
   *
   * Both halves of the lock are set here: `#loading`, which every path that acts on the current label checks, and the
   * busy state the validator sees. Setting them together is what keeps a tool that is refusing input from reading as
   * one that has simply stopped responding.
   *
   * Every path out of renderCurrentLabel has to release it, including the ones that end at a modal: on desktop the
   * modals live inside #svv-application-holder, so the `validate-disabled` class on that holder disables their
   * buttons too.
   *
   * @param {boolean} busy - True to lock the UI, false to hand it back.
   */
  #setUiBusy(busy) {
    this.#loading = busy;
    const loadingStatus = document.getElementById('svv-pano-loading');
    for (const region of svv.ui.busyRegion) {
      region.classList.toggle('validate-disabled', busy);
      // The class is only opacity and pointer-events, so on its own it says nothing to a screen reader. Except on the
      // region holding the loading status's live region (desktop's #svv-application-holder): assistive tech may hold
      // a busy subtree's changes until aria-busy clears, which happens in the same tick the status hides, so the
      // status would never be spoken there (#5581). That status is what tells a screen reader the load is slow.
      if (busy && !(loadingStatus && region.contains(loadingStatus))) region.setAttribute('aria-busy', 'true');
      else region.removeAttribute('aria-busy');
    }
    svv.ui.holder.style.cursor = busy ? 'wait' : '';
    if (busy) {
      if (svv.keyboard) svv.keyboard.disableKeyboard();
    } else {
      // The cursor is cached by the browser, so a timestamp is attached to invalidate it and force the reset.
      const openHand = `url(${util.assetPath('images/icons/openhand.cur')}?${Date.now()}) 4 4, move`;
      svv.ui.viewer.controlLayer.style.cursor = openHand;
      if (svv.keyboard) svv.keyboard.enableKeyboard();
    }
  }

  /**
   * Loads the current label's pano, passing over labels whose imagery won't load until one renders or none are left.
   *
   * A label whose pano is gone is dropped. One whose pano exists but loaded too slowly is moved to the back of the
   * queue the first time (#5581), so the validator waits out at most one deadline on it before seeing another label,
   * and dropped the second. After #MAX_SLOW_STREAK slow loads in a row a slow label is dropped the first time too.
   * Either way it is spliced out of its place rather than stepped over, so that the indices the undo button walks back
   * through only ever hold labels the user actually saw. A label being returned to by an undo is the exception: it
   * has been seen and validated, so it stays where it is and the undo is abandoned instead.
   * @param {{undo?: boolean}} [options] - `undo` when the current label is the target of an undo.
   * @returns {Promise<void>}
   */
  async #loadPanoForCurrentLabel({ undo = false } = {}) {
    let undoing = undo;
    while (this.#currLabel) {
      const label = this.#currLabel;
      const panoId = label.getAuditProperty('panoId');
      label.setProperty('startTimestamp', new Date());
      const { panoData, reason } = await svv.panoManager.setPanorama(panoId, label.getAuditProperty('backupImage'));
      if (panoData) {
        this.#slowStreak = 0;
        return;
      }
      if (reason === 'slow') this.#slowStreak += 1;

      const ids = { labelId: label.getAuditProperty('labelId'), panoId };
      if (undoing) {
        // Back to the label the user undid from. Nothing is owed and nothing is deferred: the label stays validated
        // where it is, and the one being returned to hasn't been validated yet, so it loads like any other.
        undoing = false;
        svv.tracker.push('ValidateUndo_ImageryUnavailable', { ...ids, reason });
        this.#currLabelIndex += 1;
        this.#currLabel = this.#labels[this.#currLabelIndex];
        continue;
      }

      this.#labels.splice(this.#currLabelIndex, 1);
      if (reason === 'slow') {
        const attempt = (this.#slowLoads.get(label) ?? 0) + 1;
        this.#slowLoads.set(label, attempt);
        if (attempt < LabelContainer.#MAX_LOAD_ATTEMPTS && !this.#slowImageryBreakerOpen()) {
          // Nothing is owed: the label is still in the mission, just later. The prefetch keeps the provider working on
          // its pano in the background, so the second attempt usually finds it cached.
          svv.tracker.push('LabelDeferred_SlowImagery', { ...ids, attempt });
          this.#labels.push(label);
          svv.panoManager.prefetchPano(panoId);
          this.#currLabel = this.#labels[this.#currLabelIndex];
          // A label that was the last one left comes straight back, and "trying the next label" would be untrue.
          if (this.#currLabel !== label) svv.panoLoadingStatus?.setMessage('validate:pano-loading.skipping');
          continue;
        }
      }

      // Log it: this is invisible to the user by design, so the tracker is the only signal we have for how often
      // imagery fails in production (#4810). Slow and missing imagery are told apart because they call for different
      // fixes: a slow provider is a network or CDN problem, a missing pano is expired imagery (#5581).
      svv.tracker.push(reason === 'slow' ? 'LabelSkipped_SlowImagery' : 'LabelSkipped_NoImagery', ids);
      this.#labelsOwed += 1;
      this.#currLabel = this.#labels[this.#currLabelIndex];
    }
  }

  /**
   * Whether enough loads in a row have been slow that more waiting is unlikely to help (see #MAX_SLOW_STREAK).
   * @returns {boolean} True once the streak is long enough; any load that succeeds resets it.
   */
  #slowImageryBreakerOpen() {
    return this.#slowStreak >= LabelContainer.#MAX_SLOW_STREAK;
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
    // Replacements would come from the same network that just failed #MAX_SLOW_STREAK loads in a row, each costing a
    // full deadline before being dropped in turn, so the validator goes straight to the imagery modal instead.
    if (this.#slowImageryBreakerOpen()) return false;
    this.#topUpRounds += 1;

    let labels;
    try {
      const response = await fetch('/validationTask/moreLabels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          label_type: this.#labelType,
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
   * @param {Array} labelList - List of label metadata objects.
   * @param {string} labelType - Label type of the mission these labels belong to.
   */
  resetLabelList(labelList, labelType) {
    this.#labels = labelList.map((key) => new Label(key));
    this.#currLabelIndex = 0;
    this.#currLabel = this.#labels[this.#currLabelIndex];
    this.#labelType = labelType;
    this.#seenLabelIds = new Set(this.#labels.map((label) => label.getAuditProperty('labelId')));
    this.#labelsOwed = 0;
    this.#topUpRounds = 0;
    this.#slowLoads = new Map();
  }

  /**
   * Returns a list of labels for the current mission.
   */
  getLabels() {
    return this.#labels;
  }

  /**
   * Validates the current label.
   *
   * The last gate before a validation is recorded: a verdict that arrives while the label's pano is still loading is
   * dropped here even if it got past the menu that raised it (#5211).
   *
   * @param {string} action - The verdict cast: Agree, Disagree, or Unsure.
   * @param {Date} timestamp - When the verdict was cast.
   * @param {string} comment - The comment submitted with it, if any.
   */
  validateCurrentLabel(action, timestamp, comment) {
    if (this.dropInputWhileLoading(`Validate=${action}`)) return;

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
   * @param {number} labelId - Integer label ID.
   * @param {Record<string, any>} labelMetadata - Label metadata (validationProperties object).
   * @param {object} commentData - Comment data (commentProperties object).
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
      // The type the validator saw, so the vote stays tied to it if the label's type changes later (#3671).
      label_type: labelMetadata.oldLabelType,
      // What the validator wants the label to have; the server records an edit only if it differs from the label.
      new_label_type: labelMetadata.newLabelType !== labelMetadata.oldLabelType ? labelMetadata.newLabelType : null,
      severity: labelMetadata.newSeverity,
      tags: labelMetadata.newTags,
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
   * @param {Record<string, any>} validation - The completed label validation, ready to be pushed to the list of labels.
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
