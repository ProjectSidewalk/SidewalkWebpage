/**
 * Keeps track of labels that have appeared on the panorama.
 *
 * Nothing is rendered at construction: everything that describes a label to the validator subscribes first
 * (onLabelShown, onLoadingChange), and then Main renders the first label with renderCurrentLabel().
 */

import { util } from '../../common/utilities.js';
import { Label } from './Label.js';
/** @typedef {import('../Main.js').ValidateUi} ValidateUi */
/** @typedef {import('../Main.js').ValidateConfig} ValidateConfig */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */
/** @typedef {import('../panorama/PanoLoadingStatus.js').PanoLoadingStatus} PanoLoadingStatus */
/** @typedef {import('../modal/ModalMissionComplete.js').ModalMissionComplete} ModalMissionComplete */
/** @typedef {import('../modal/ModalNoNewMission.js').ModalNoNewMission} ModalNoNewMission */
/** @typedef {import('../mission/MissionContainer.js').MissionContainer} MissionContainer */
/** @typedef {import('../Tracker.js').Tracker} Tracker */

export class LabelContainer {
  // A mission that has had to ask for replacement labels twice and still can't render one is not having a run of bad
  // luck — imagery is broadly unavailable (a provider outage or quota). Stop asking and tell the user (#4810).
  static #MAX_TOP_UP_ROUNDS = 2;

  /**
   * How many upcoming labels have their pano warmed while the current one is judged (#5581, #5562). Two covers a
   * verdict cast the moment the current label appears and the one after it, and caps what a validator who quits
   * mid-mission downloaded for nothing at two labels' worth.
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
    // When the current label finished rendering, as a millisecond epoch; what the verdict menus measure a tap from.
    renderedTimestamp: 0,
  };

  /** @type {ValidateUi} */
  #ui;
  /** @type {ValidateConfig} */
  #config;
  /** @type {PanoManager} */
  #panoManager;
  /** @type {PanoLoadingStatus} */
  #panoLoadingStatus;
  /** @type {ModalMissionComplete} */
  #modalMissionComplete;
  /** @type {ModalNoNewMission} */
  #modalNoNewMission;
  /** @type {MissionContainer} */
  #missionContainer;
  /** @type {Tracker} */
  #tracker;

  /** @type {Array<(loading: boolean) => void>} Told as the tool locks for a label's load and as it is handed back. */
  #loadingListeners = [];

  /** @type {Array<(label: Label) => void>} Told once a label's pano is on screen, facing it. */
  #shownListeners = [];

  /**
   * How long a label has to have been on screen before a verdict on it counts, in milliseconds.
   *
   * Double-tap protection: the tap that advanced to this label is often still coming down as it appears, and with
   * panos prefetched (#5562) it appears within tens of milliseconds. Measured from the render rather than from the
   * previous verdict so that a validator working at a steady pace is never told no; a deliberate verdict on a label
   * that has been up for less than this is not something a person does.
   */
  static VERDICT_GRACE_MS = 300;

  /**
   * @param {Array} labelList - Initial list of labels to be validated (generated when the page is loaded).
   * @param {string} labelType - Label type of the mission these labels belong to.
   * @param {ValidateUi} ui - What dims while a label loads, and the pano layer whose cursor says so.
   * @param {ValidateConfig} config - The frame each validation is measured in, and the queue it is reported under.
   * @param {PanoManager} panoManager - Loads each label's pano and draws it on it.
   * @param {PanoLoadingStatus} panoLoadingStatus - Captions a load that turns slow.
   * @param {ModalMissionComplete} modalMissionComplete - Its being up is its own loading state.
   * @param {ModalNoNewMission} modalNoNewMission - Shown when the mission runs out of labels that will load.
   * @param {MissionContainer} missionContainer - The mission each validation counts toward.
   * @param {Tracker} tracker - Logs loads, drops and verdicts.
   */
  constructor(labelList, labelType, ui, config, panoManager, panoLoadingStatus, modalMissionComplete,
    modalNoNewMission, missionContainer, tracker) {
    this.#ui = ui;
    this.#config = config;
    this.#panoManager = panoManager;
    this.#panoLoadingStatus = panoLoadingStatus;
    this.#modalMissionComplete = modalMissionComplete;
    this.#modalNoNewMission = modalNoNewMission;
    this.#missionContainer = missionContainer;
    this.#tracker = tracker;
    this.resetLabelList(labelList, labelType);
  }

  /**
   * Registers what reacts to the tool locking for a label's load (true) and being handed back (false).
   * @param {(loading: boolean) => void} listener
   */
  onLoadingChange(listener) {
    this.#loadingListeners.push(listener);
  }

  /**
   * Registers what describes a label to the validator once its pano is on screen facing it.
   * @param {(label: Label) => void} listener
   */
  onLabelShown(listener) {
    this.#shownListeners.push(listener);
  }

  /** @returns {boolean} Whether there is a validated label before the current one to go back to. */
  hasPreviousLabel() {
    return this.#currLabelIndex > 0;
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
   * Takes back the last validation, for the undo button: an unsent verdict is dropped from the batch, a sent one gets
   * a retraction queued behind it.
   * @returns {Record<string, any>} The verdict taken back, as it was compiled for submission.
   */
  retractLastValidation() {
    const priorLabelFormData = this.#lastLabelFormData;
    if (this.#labelsToSubmit.length > 0) {
      this.pop();
    } else {
      this.pushUndoValidation(priorLabelFormData);
    }
    return priorLabelFormData;
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
    this.#tracker.push('ValidateInputDropped_Loading', { source });
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
   * validation the user can actually redo, and turns Back off either way.
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

    return this.#currLabel === previousLabel;
  }

  /**
   * Moves to the next label in the list. If there are no more labels, shows the mission complete modal.
   * @returns {Promise<void>}
   */
  async moveToNextLabel() {
    if (this.dropInputWhileLoading('NextLabel')) return;

    this.#currLabelIndex += 1;
    this.#currLabel = this.#labels[this.#currLabelIndex];
    // Shows the no-more-labels modal when it can't produce a label to show, after asking the backend to replace any
    // it had to drop, so there is nothing left to set up here.
    await this.renderCurrentLabel();
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
      // A mission modal covering the pano is its own loading state (the "Great job!" button stays disabled until the
      // next mission's first label is up), so a status under it would only show through the backdrop as clutter.
      const coveredByModal = this.#modalMissionComplete.isShowing() || this.#modalNoNewMission.isShowing();
      // Logged against the label loading when the load turns slow, which a deferral can have moved on from this one.
      if (!coveredByModal) {
        this.#panoLoadingStatus.begin(() => {
          if (!this.#currLabel) return;
          this.#tracker.push('PanoLoadingStatus_Shown', {
            labelId: this.#currLabel.getAuditProperty('labelId'),
            panoId: this.#currLabel.getAuditProperty('panoId'),
          });
        }, { immediate: this.#panoManager.blanksPanoWhileLoading() });
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
        this.#modalNoNewMission.show({ imageryUnavailable: this.#labelsOwed > 0 });
        return;
      }

      // Awaited so the tool unlocks only once the pano is on screen facing this label: on a viewer that paints during
      // loads, that is renderPanoMarker's reveal, not setPanorama resolving (#5582).
      try {
        await this.#panoManager.renderPanoMarker(this.#currLabel);
      } finally {
        // Only now, with the pano facing the label: the label that just loaded may have swapped the active viewer,
        // so anything that listens to a viewer (the speed limit sign, #4828) has to be told rather than left
        // waiting. Told even when the draw failed: the finally below hands the tool back, and a menu still showing
        // the previous label's verdict would submit nothing and skip this label on the next click.
        for (const listener of this.#shownListeners) listener(this.#currLabel);
      }

      this.setProperty('renderedTimestamp', Date.now());
      // Now that this label's imagery is on screen and the connection is idle, start on the next ones' (#5562, #5581).
      this.#prefetchUpcomingPanos();
    } catch (error) {
      // The only trace a render failure leaves. It used to announce itself by stranding the lock, which turned every
      // later tap and keypress into a ValidateInputDropped_Loading — unusable for the validator, but at least loud.
      // Releasing the lock in the finally takes that away: the caller either swallows the rejection (Form) or drops
      // it on the floor (moveToNextLabel), so without this the tool would come back looking healthy and say nothing.
      // Read defensively rather than as a plain `error.message`: a rejection carrying something other than an Error
      // — a bare `Promise.reject()`, a string thrown by a viewer SDK — would make this line a TypeError of its own,
      // losing the event and handing the caller an exception unrelated to what actually failed.
      this.#tracker.push('ValidateRenderFailed', { error: error?.message ?? String(error) });
      // The finally hands the tool back, so a canvas still held unpainted for the reveal would leave the validator
      // judging a blank pano area (#5582).
      this.#panoManager.revealPendingCanvas();
      throw error;
    } finally {
      // The out-of-labels path releases early on purpose, so that the modal's own disableKeyboard is what stands;
      // the condition is what keeps this from re-enabling the keyboard behind it. Every other way out lands here,
      // a throw included — leaving #loading set would drop every tap and keypress for the rest of the session.
      if (this.#loading) this.#setUiBusy(false);
      this.#panoLoadingStatus.end();
    }
  }

  /**
   * Starts fetching the imagery of the labels coming up, so that by the time each is the current label its load is
   * quick. Two warm-ups per label, one for each viewer that might show it; fire and forget, since a prefetch that
   * fails only means that load pays full price, which is what it would have done anyway.
   *
   * - The backup pano, for a label whose pano is known to have expired (#5562). Those go straight to the Pannellum
   *   fallback (#5561), the one viewer that loads from a URL this page controls, so the image can be on the device
   *   before the label is. A live label's backup would be bytes nobody looks at, so it is left alone.
   * - The provider's own pano (#5581), since a jump to an unrelated pano never hits the provider's neighbor cache. On
   *   Mapillary this warms the image's metadata and thumbnail; PanoManager.prefetchPano is a no-op for a provider
   *   that can't be warmed. A label that goes to its backup is skipped here, as its load won't ask the provider.
   * @returns {void}
   */
  #prefetchUpcomingPanos() {
    const from = this.#currLabelIndex + 1;
    const upcoming = this.#labels.slice(from, from + LabelContainer.#PREFETCH_AHEAD);
    const goesToBackup = (label) => label.getAuditProperty('expired') === true && label.getAuditProperty('backupImage');
    this.#panoManager.prefetchBackups(upcoming.filter(goesToBackup).map((l) => l.getAuditProperty('backupImage')));
    for (const label of upcoming) {
      if (!goesToBackup(label)) this.#panoManager.prefetchPano(label.getAuditProperty('panoId'));
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
    for (const region of this.#ui.busyRegion) {
      region.classList.toggle('validate-disabled', busy);
      // The class is only opacity and pointer-events, so on its own it says nothing to a screen reader. Except on the
      // region holding the loading status's live region (desktop's #svv-application-holder): assistive tech may hold
      // a busy subtree's changes until aria-busy clears, which happens in the same tick the status hides, so the
      // status would never be spoken there (#5581). That status is what tells a screen reader the load is slow.
      if (busy && !(loadingStatus && region.contains(loadingStatus))) region.setAttribute('aria-busy', 'true');
      else region.removeAttribute('aria-busy');
    }
    this.#ui.holder.style.cursor = busy ? 'wait' : '';
    if (!busy) {
      // The cursor is cached by the browser, so a timestamp is attached to invalidate it and force the reset.
      const openHand = `url(${util.assetPath('images/icons/openhand.cur')}?${Date.now()}) 4 4, move`;
      this.#ui.viewer.controlLayer.style.cursor = openHand;
    }
    for (const listener of this.#loadingListeners) listener(busy);
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
      const { panoData, reason } = await this.#panoManager.setPanorama(
        panoId, label.getAuditProperty('backupImage'), { expired: label.getAuditProperty('expired') === true },
      );
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
        this.#tracker.push('ValidateUndo_ImageryUnavailable', { ...ids, reason });
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
          this.#tracker.push('LabelDeferred_SlowImagery', { ...ids, attempt });
          this.#labels.push(label);
          this.#panoManager.prefetchPano(panoId);
          this.#currLabel = this.#labels[this.#currLabelIndex];
          // A label that was the last one left comes straight back, and "trying the next label" would be untrue.
          if (this.#currLabel !== label) this.#panoLoadingStatus.setMessage('validate:pano-loading.skipping');
          continue;
        }
      }

      // Log it: this is invisible to the user by design, so the tracker is the only signal we have for how often
      // imagery fails in production (#4810). Slow and missing imagery are told apart because they call for different
      // fixes: a slow provider is a network or CDN problem, a missing pano is expired imagery (#5581).
      this.#tracker.push(reason === 'slow' ? 'LabelSkipped_SlowImagery' : 'LabelSkipped_NoImagery', ids);
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
          validate_params: this.#config.validateParams,
        }),
      });
      if (!response.ok) throw new Error(`Replacement labels request failed with HTTP ${response.status}`);
      labels = (await response.json()).labels;
    } catch (error) {
      // Nothing to retry into — the caller falls through to the no-more-labels modal, and the mission resumes with a
      // fresh set of labels next time the user opens Validate.
      this.#tracker.push('LabelTopUpFailed', { error: error.message });
      return false;
    }

    this.#tracker.push('LabelTopUp', { requested: this.#labelsOwed, received: labels.length });
    if (labels.length === 0) return false;

    for (const labelMetadata of labels) {
      const label = new Label(labelMetadata, this.#config);
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
    this.#labels = labelList.map((key) => new Label(key, this.#config));
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
   * Validates the current label and moves on to the next one, unless this one finished the mission.
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

    const label = this.#currLabel;
    label.validate(action, comment, this.#panoManager.panoViewer);
    this.setProperty('validationTimestamp', timestamp);

    if (comment) this.#tracker.push('ValidationTextField_DataEntered', { validation: action, text: comment });

    const mission = this.#missionContainer.getCurrentMission();
    if (['Agree', 'Disagree', 'Unsure'].includes(action)) {
      mission.updateValidationResult(action, false);
      this.pushToLabelsToSubmit(
        label.getAuditProperty('labelId'), label.getProperties(), label.commentData(mission.getProperty('missionId')),
      );
      // A verdict is the thing worth not losing: get it to the server now rather than at the next deadline (#5561).
      // Armed before the mission's progress moves: a verdict that completes the mission drains everything in the
      // mission-complete submit, whose drain cancels this timer, so that last verdict costs no extra POST.
      this.#tracker.flushSoon();
      this.#missionContainer.updateAMission();
    }

    // A completed mission's next label arrives with the mission-complete response (Form.js), not from here.
    if (!mission.isComplete()) {
      this.moveToNextLabel(); // NOTE That this returns a Promise that we're ignoring right now.
    }
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
      canvas_height: this.#config.canvasHeight(),
      canvas_width: this.#config.canvasWidth(),
      canvas_x: labelMetadata.canvasX,
      canvas_y: labelMetadata.canvasY,
      end_timestamp: labelMetadata.endTimestamp,
      heading: labelMetadata.heading,
      label_id: labelId,
      mission_id: this.#missionContainer.getCurrentMission().getProperty('missionId'),
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
      source: this.#config.source,
      undone: false,
      redone,
      viewer_type: this.#panoManager.getActiveViewerName(),
    };
    this.#labelsToSubmit.push(data);
    this.#lastLabelFormData = data;
  }

  /**
   * Pushes a label object directly (for undo purposes) to the list of current labels.
   * @param {Record<string, any>} validation - The completed label validation, ready to be pushed to the list of labels.
   */
  pushUndoValidation(validation) {
    // A copy: the object handed in is the verdict as it was buffered, and a POST that failed may be holding it for a
    // resend. Marking that one undone would turn the resend into a retraction of whatever vote replaced it.
    this.#labelsToSubmit.push({ ...validation, undone: true, redone: false });
  }

  /**
   * Takes the last label out of the list of labels that have not been submitted to the backend.
   */
  pop() {
    this.#labelsToSubmit.pop();
  }

  /** Clears the validations buffered for submission, once the form has taken them. */
  refresh() {
    this.#labelsToSubmit = [];
  }
}
