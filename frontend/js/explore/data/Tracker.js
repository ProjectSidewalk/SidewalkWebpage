/**
 * Logs interaction data from the Explore/Audit interface.
 *
 * Built before anything that logs, so the pano manager and the flush register later (trackPano, onFlush). A row is
 * filed under the label passed to push(), as are the rows after it until the labeler is done with that label.
 */

/** @typedef {import('../label/Label.js').Label} Label */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */

export class Tracker {
  #actions = [];
  #waitingOnSubmit = false;

  /** @type {?Label} The label being placed or edited, which each row is filed under until it is let go of. */
  #currentLabel = null;

  #currentAuditTask = null;

  /** @type {?PanoManager} Stamps each action with the pano on screen and the view of it. */
  #panoManager = null;

  /** @type {?(() => Promise<void>)} Sends the buffer when it grows long; registered by Main once the Form exists. */
  #onFlush = null;

  constructor() {
    this.trackWindowEvents();
  }

  /**
   * Names the pano manager whose live viewer stamps each action with the pano on screen.
   * @param {PanoManager} panoManager
   */
  trackPano(panoManager) {
    this.#panoManager = panoManager;
  }

  /**
   * Registers what sends the buffer once it holds more than 200 actions.
   * @param {() => Promise<void>} listener
   */
  onFlush(listener) {
    this.#onFlush = listener;
  }

  setAuditTaskID(taskID) {
    this.#currentAuditTask = taskID;
  }

  trackWindowEvents() {
    const prefix = 'LowLevelEvent_';

    const mouseEvents = [
      'mousedown', 'mouseup', 'mouseover', 'mouseout', 'mousemove', 'click', 'contextmenu', 'dblclick',
    ];
    for (const type of mouseEvents) {
      document.addEventListener(type, (/** @type {MouseEvent} */ e) => {
        // A keyboard shortcut's scripted click has no cursor; logging 0/0 would look like a real click in the corner.
        this.push(prefix + e.type, { cursorX: e.isTrusted ? e.pageX : null, cursorY: e.isTrusted ? e.pageY : null });
      });
    }

    // Keyboard related events.
    for (const type of ['keydown', 'keyup']) {
      document.addEventListener(type, (/** @type {KeyboardEvent} */ e) => {
        // Don't log which keys went into a password (e.g. the navbar's sign-in dialog).
        const isPassword = e.target instanceof HTMLInputElement && e.target.type === 'password';
        this.push(prefix + e.type, isPassword ? {} : { code: e.code });
      });
    }

    const logPageFocus = () => this.push(document.hasFocus() ? 'PageGainedFocus' : 'PageLostFocus');
    window.addEventListener('focus', logPageFocus);
    window.addEventListener('blur', logPageFocus);
    logPageFocus();
  }

  #isCanvasInteraction(action) {
    return action.indexOf('LabelingCanvas') >= 0;
  }

  #isContextMenuAction(action) {
    return action.indexOf('ContextMenu') >= 0;
  }

  /**
   * Whether an action is the labeler being done with the label the rows were filed under: the menu closing, the
   * label going, or an Occlusion placed, which opens no menu.
   * @param {string} action
   * @param {?Record<string, any>} notes
   * @returns {boolean}
   */
  #isDoneWithLabel(action, notes) {
    return action === 'ContextMenu_Close' || action.indexOf('RemoveLabel') >= 0
      || (action.indexOf('LabelingCanvas_FinishLabeling') >= 0 && notes?.labelType === 'Occlusion');
  }

  /** Returns actions */
  getActions() {
    return this.#actions;
  }

  #notesToString(param) {
    if (!param) return '';

    let note = '';
    for (const key in param) {
      if (note.length > 0) {
        note += ',';
      }
      note += `${key}:${param[key]}`;
    }
    return note;
  }

  /**
   * The row for an action: the action, when, the pano and view it happened on, and the label it is filed under.
   * @param {string} action
   * @param {?Record<string, any>} notes
   * @returns {Record<string, any>}
   */
  create(action, notes) {
    // The viewer's getters return null until the first pano has loaded (e.g. during onboarding startup), so fall
    // back to null fields rather than assuming a loaded pano.
    const panoViewer = this.#panoManager?.panoViewer ?? null;
    const latlng = panoViewer?.getPosition() ?? { lat: null, lng: null };
    const pov = panoViewer?.getPov() ?? { heading: null, pitch: null, zoom: null };

    return {
      action,
      pano_id: panoViewer?.getPanoId() ?? null,
      lat: latlng.lat,
      lng: latlng.lng,
      heading: pov.heading,
      pitch: pov.pitch,
      zoom: pov.zoom,
      note: this.#notesToString(notes || {}),
      temporary_label_id: this.#currentLabel?.getProperty('temporaryLabelId') ?? null,
      audit_task_id: this.#currentLabel?.getProperty('auditTaskId') ?? this.#currentAuditTask,
      timestamp: new Date(),
    };
  }

  /**
   * @param {string} action - The action to be stored in the database
   * @param {?Record<string, any>} [notes] - The notes field in the database
   * @param {?Label} [label] - The label the action is about, which this and the rows that follow are filed under
   *   until the labeler is done with it. A label from an earlier session is filed under its own audit task.
   */
  push(action, notes, label) {
    if (label) {
      this.#currentLabel = label;
      notes = { ...(notes ?? {}), auditTaskId: label.getProperty('auditTaskId') };
    }

    const item = this.create(action, notes);
    const prevItem = this.#actions.slice(-1)[0];
    this.#actions.push(item);

    if (this.#isDoneWithLabel(action, notes)) this.#currentLabel = null;

    // Submit the data collected thus far if actions is too long.
    if (!this.#waitingOnSubmit && this.#actions.length > 200
      && !this.#isCanvasInteraction(action) && !this.#isContextMenuAction(action)) {
      if (this.#onFlush) {
        this.#waitingOnSubmit = true;
        this.#onFlush().then(() => this.#waitingOnSubmit = false);
      }
    }

    // If there is a one-hour break between interactions (in ms), refresh the page to avoid weird bugs.
    if (prevItem && item.timestamp.getTime() - prevItem.timestamp.getTime() > 3600000) window.location.reload();

    return this;
  }

  /**
   * Refresh the current actions.
   */
  refresh() {
    this.#actions = [];
    this.push('RefreshTracker');
  }
}
