/**
 *
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Tracker() {
    var self = this;
    var actions = [];
    var prevActions = [];

    let waitingOnSubmit = false;

    var currentLabel = null;
    var updatedLabels = [];
    var currentAuditTask = null;

    this.init = function() {
        this.trackWindowEvents();
    };

    this.getCurrentLabel = function() {
        return currentLabel;
    };

    this.setAuditTaskID = function(taskID) {
        currentAuditTask = taskID;
    };

    this.trackWindowEvents = function() {
        var prefix = "LowLevelEvent_";

        // track all mouse related events
        $(document).on('mousedown mouseup mouseover mouseout mousemove click contextmenu dblclick', function(e, extra) {
            if (extra) {
                if (typeof extra.lowLevelLogging !== "undefined" && !extra.lowLevelLogging) { // {lowLevelLogging: false}
                    return;
                }
            }

            self.push(prefix + e.type, {
                cursorX: 'pageX' in e ? e.pageX : null,
                cursorY: 'pageY' in e ? e.pageY : null
            });
        });

        // keyboard related events
        $(document).on('keydown keyup', function(e) {
            self.push(prefix + e.type, {
                keyCode: 'keyCode' in e ? e.keyCode : null
            });
        });
    };

    this._isCanvasInteraction = function(action) {
        return action.indexOf("LabelingCanvas") >= 0;
    };

    this._isContextMenuAction = function(action) {
        return action.indexOf("ContextMenu") >= 0;
    };

    this._isContextMenuClose = function(action) {
        return action === "ContextMenu_Close";
    };

    this._isDeleteLabelAction = function(action) {
        return action.indexOf("RemoveLabel") >= 0;
    };

    this._isClickLabelDeleteAction = function(action) {
        return action.indexOf("Click_LabelDelete") >= 0;
    };

    this._isTaskStartAction = function(action) {
        return action.indexOf("TaskStart") >= 0;
    };

    this._isSeverityShortcutAction = function(action) {
        return action.indexOf("KeyboardShortcut_Severity") >= 0;
    };

    this._isFinishLabelingAction = function(action) {
        return action.indexOf("LabelingCanvas_FinishLabeling") >= 0;
    };

    /** Returns actions */
    this.getActions = function () {
        return actions;
    };

    this._notesToString = function(param) {
        if (!param) return "";

        var note = "";
        for (var key in param) {
            if (note.length > 0)
                note += ",";
            note += key + ':' + param[key];
        }
        return note;
    };

    /**
     * This function pushes action type, time stamp, current pov, and current panoId into actions list.
     */
    this.create = function(action, notes, extraData) {
        extraData = extraData || {};

        let auditTaskId;
        if ('canvas' in svl && svl.canvas.getCurrentLabel()) {
            auditTaskId = svl.canvas.getCurrentLabel().getProperties().auditTaskId;
        } else {
            auditTaskId = currentAuditTask;
        }

        if ('temporaryLabelId' in extraData) {
            if (currentLabel !== null) {
                updatedLabels.push(currentLabel);
                svl.labelContainer.addToLabelsToLog(currentLabel);
            }
            currentLabel = extraData['temporaryLabelId'];
        }

        // Initialize variables. Note you cannot get pov, pano_id, or latLng before the map and pano load.
        const panoViewer = svl.panoViewer ? svl.panoViewer : null;
        const latlng = panoViewer ? panoViewer.getPosition() : { lat: null, lng: null };
        const pov = panoViewer ? panoViewer.getPov() : { heading: null, pitch: null, zoom: null };

        return {
            action : action,
            pano_id: panoViewer ? panoViewer.getPanoId() : null,
            lat: latlng.lat,
            lng: latlng.lng,
            heading: pov.heading,
            pitch: pov.pitch,
            zoom: pov.zoom,
            note: this._notesToString(notes || {}),
            temporary_label_id: currentLabel,
            audit_task_id: auditTaskId,
            timestamp: new Date()
        };
    };

    /**
     * @param {string} action the action to be stored in the database
     * @param [notes] the notes field in the database
     * @param [extraData] extra data that should not be stored in the notes field in db
     */
    this.push = function (action, notes, extraData) {
        var labelProperties;
        if (self._isContextMenuAction(action) || self._isSeverityShortcutAction(action)) {
            labelProperties = svl.contextMenu.getTargetLabel().getProperties();
            currentLabel = labelProperties.temporaryLabelId;

            if (notes === null || typeof (notes) === 'undefined') {
                notes = {'auditTaskId': labelProperties.auditTaskId};
            } else {
                notes['auditTaskId'] = labelProperties.auditTaskId;
            }

            // Reset currentLabel to null if this is a context menu event that fired after the menu already closed.
            if (svl.contextMenu.isOpen()) {
                updatedLabels.push(currentLabel);
                svl.labelContainer.addToLabelsToLog(currentLabel);
            } else {
                currentLabel = null;
            }

        } else if (self._isClickLabelDeleteAction(action)) {
            labelProperties = svl.canvas.getCurrentLabel().getProperties();
            currentLabel = labelProperties.temporaryLabelId;
            updatedLabels.push(currentLabel);
            svl.labelContainer.addToLabelsToLog(currentLabel);

            if (notes === null || typeof(notes) === 'undefined') {
                notes = {'auditTaskId' : labelProperties.auditTaskId};
            } else {
                notes['auditTaskId'] = labelProperties.auditTaskId;
            }
        }

        var item = self.create(action, notes, extraData);
        var prevItem = actions.slice(-1)[0];
        actions.push(item);
        var contextMenuLabel = true;

        if (self._isFinishLabelingAction(action) && (notes['labelType'] === 'Occlusion')) {
            contextMenuLabel = false;
        }

        // We are no longer interacting with a label, set currentLabel to null.
        if (self._isContextMenuClose(action) || self._isDeleteLabelAction(action) || !contextMenuLabel) {
            currentLabel = null;
        }

        // Submit the data collected thus far if actions is too long.
        if (!waitingOnSubmit && actions.length > 200 && !self._isCanvasInteraction(action) && !self._isContextMenuAction(action)) {
            if (svl.hasOwnProperty('form') && svl.hasOwnProperty('taskContainer')) {
                waitingOnSubmit = true;
                svl.form.submitData().then(() => waitingOnSubmit = false);
            }
        }

        // If there is a one-hour break between interactions (in ms), refresh the page to avoid weird bugs.
        if (prevItem && item.timestamp - prevItem.timestamp > 3600000) window.location.reload();

        return this;
    };

    /**
     * Put the previous labeling actions into prevActions. Then refresh the current actions.
     */
    this.refresh = function() {
        // Commented out to save memory since we aren't using prevActions right now.
        // prevActions = prevActions.concat(actions);
        actions = [];

        updatedLabels = [];
        if (currentLabel !== null) {
            updatedLabels.push(currentLabel);
            svl.labelContainer.addToLabelsToLog(currentLabel);
        }

        self.push("RefreshTracker");
    };

    this.init();
}
