/**
 * Logs interaction data from the Explore/Audit interface.
 *
 * @memberof svl
 */
class Tracker {
  #actions = [];
  #waitingOnSubmit = false;
  #currentLabel = null;
  #updatedLabels = [];
  #currentAuditTask = null;

  constructor() {
    this.init();
  }

  init() {
    this.trackWindowEvents();
  }

  getCurrentLabel() {
    return this.#currentLabel;
  }

  setAuditTaskID(taskID) {
    this.#currentAuditTask = taskID;
  }

  trackWindowEvents() {
    const prefix = 'LowLevelEvent_';

    // track all mouse related events
    $(document).on('mousedown mouseup mouseover mouseout mousemove click contextmenu dblclick', (e, extra) => {
      if (extra) {
        if (typeof extra.lowLevelLogging !== 'undefined' && !extra.lowLevelLogging) { // {lowLevelLogging: false}
          return;
        }
      }

      this.push(prefix + e.type, {
        cursorX: 'pageX' in e ? e.pageX : null,
        cursorY: 'pageY' in e ? e.pageY : null,
      });
    });

    // keyboard related events
    $(document).on('keydown keyup', (e) => {
      this.push(prefix + e.type, {
        keyCode: 'keyCode' in e ? e.keyCode : null,
      });
    });
  }

  #isCanvasInteraction(action) {
    return action.indexOf('LabelingCanvas') >= 0;
  }

  #isContextMenuAction(action) {
    return action.indexOf('ContextMenu') >= 0;
  }

  #isContextMenuClose(action) {
    return action === 'ContextMenu_Close';
  }

  #isDeleteLabelAction(action) {
    return action.indexOf('RemoveLabel') >= 0;
  }

  #isClickLabelDeleteAction(action) {
    return action.indexOf('Click_LabelDelete') >= 0;
  }

  #isSeverityShortcutAction(action) {
    return action.indexOf('KeyboardShortcut_Severity') >= 0;
  }

  #isFinishLabelingAction(action) {
    return action.indexOf('LabelingCanvas_FinishLabeling') >= 0;
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
   * This function pushes action type, time stamp, current pov, and current panoId into actions list.
   */
  create(action, notes, extraData) {
    extraData = extraData || {};

    let auditTaskId;
    if ('canvas' in svl && svl.canvas.getCurrentLabel()) {
      auditTaskId = svl.canvas.getCurrentLabel().getProperties().auditTaskId;
    } else {
      auditTaskId = this.#currentAuditTask;
    }

    if ('temporaryLabelId' in extraData) {
      if (this.#currentLabel !== null) {
        this.#updatedLabels.push(this.#currentLabel);
        svl.labelContainer.addToLabelsToLog(this.#currentLabel);
      }
      this.#currentLabel = extraData.temporaryLabelId;
    }

    // Initialize variables. Note you cannot get pov, pano_id, or latLng before the map and pano load.
    const panoViewer = svl.panoViewer ? svl.panoViewer : null;
    const latlng = panoViewer ? panoViewer.getPosition() : { lat: null, lng: null };
    const pov = panoViewer ? panoViewer.getPov() : { heading: null, pitch: null, zoom: null };

    return {
      action,
      pano_id: panoViewer ? panoViewer.getPanoId() : null,
      lat: latlng.lat,
      lng: latlng.lng,
      heading: pov.heading,
      pitch: pov.pitch,
      zoom: pov.zoom,
      note: this.#notesToString(notes || {}),
      temporary_label_id: this.#currentLabel,
      audit_task_id: auditTaskId,
      timestamp: new Date(),
    };
  }

  /**
   * @param {string} action the action to be stored in the database
   * @param [notes] the notes field in the database
   * @param [extraData] extra data that should not be stored in the notes field in db
   */
  push(action, notes, extraData) {
    let labelProperties;
    if (this.#isContextMenuAction(action) || this.#isSeverityShortcutAction(action)) {
      labelProperties = svl.contextMenu.getTargetLabel().getProperties();
      this.#currentLabel = labelProperties.temporaryLabelId;

      if (notes === null || typeof (notes) === 'undefined') {
        notes = { auditTaskId: labelProperties.auditTaskId };
      } else {
        notes.auditTaskId = labelProperties.auditTaskId;
      }

      // Reset currentLabel to null if this is a context menu event that fired after the menu already closed.
      if (svl.contextMenu.isOpen()) {
        this.#updatedLabels.push(this.#currentLabel);
        svl.labelContainer.addToLabelsToLog(this.#currentLabel);
      } else {
        this.#currentLabel = null;
      }
    } else if (this.#isClickLabelDeleteAction(action)) {
      labelProperties = svl.canvas.getCurrentLabel().getProperties();
      this.#currentLabel = labelProperties.temporaryLabelId;
      this.#updatedLabels.push(this.#currentLabel);
      svl.labelContainer.addToLabelsToLog(this.#currentLabel);

      if (notes === null || typeof (notes) === 'undefined') {
        notes = { auditTaskId: labelProperties.auditTaskId };
      } else {
        notes.auditTaskId = labelProperties.auditTaskId;
      }
    }

    const item = this.create(action, notes, extraData);
    const prevItem = this.#actions.slice(-1)[0];
    this.#actions.push(item);
    let contextMenuLabel = true;

    if (this.#isFinishLabelingAction(action) && (notes.labelType === 'Occlusion')) {
      contextMenuLabel = false;
    }

    // We are done interacting with a label, so set currentLabel to null.
    if (this.#isContextMenuClose(action) || this.#isDeleteLabelAction(action) || !contextMenuLabel) {
      this.#currentLabel = null;
    }

    // Submit the data collected thus far if actions is too long.
    if (!this.#waitingOnSubmit && this.#actions.length > 200
      && !this.#isCanvasInteraction(action) && !this.#isContextMenuAction(action)) {
      if (Object.hasOwn(svl, 'form') && Object.hasOwn(svl, 'taskContainer')) {
        this.#waitingOnSubmit = true;
        svl.form.submitData().then(() => this.#waitingOnSubmit = false);
      }
    }

    // If there is a one-hour break between interactions (in ms), refresh the page to avoid weird bugs.
    if (prevItem && item.timestamp - prevItem.timestamp > 3600000) window.location.reload();

    return this;
  }

  /**
   * Refresh the current actions.
   */
  refresh() {
    this.#actions = [];

    this.#updatedLabels = [];
    if (this.#currentLabel !== null) {
      this.#updatedLabels.push(this.#currentLabel);
      svl.labelContainer.addToLabelsToLog(this.#currentLabel);
    }

    this.push('RefreshTracker');
  }
}
