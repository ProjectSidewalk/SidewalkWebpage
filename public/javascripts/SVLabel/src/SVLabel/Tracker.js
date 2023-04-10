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
        if (!notes) notes = {};
        if (!extraData) extraData = {};

        var pov, latlng, panoId, auditTaskId;

        var note = this._notesToString(notes);

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

        // Initialize variables. Note you cannot get pov, panoid, or position before the map and pano load.
        try {
            pov = svl.map.getPov();
        } catch (err) {
            pov = {
                heading: null,
                pitch: null,
                zoom: null
            }
        }

        try {
            latlng = svl.map.getPosition();
        } catch (err) {
            latlng = {
                lat: null,
                lng: null
            };
        }
        if (!latlng) {
            latlng = {
                lat: null,
                lng: null
            };
        }

        try {
            panoId = svl.map.getPanoId();
        } catch (err) {
            panoId = null;
        }

        var timestamp = new Date().getTime();

        return {
            action : action,
            gsv_panorama_id: panoId,
            lat: latlng.lat,
            lng: latlng.lng,
            heading: pov.heading,
            pitch: pov.pitch,
            zoom: pov.zoom,
            note: note,
            temporary_label_id: currentLabel,
            audit_task_id: auditTaskId,
            timestamp: timestamp
        };
    };

    /**
     * @param action: the action to be stored in the database
     * @param notes: (optional) the notes field in the database
     * @param extraData: (optional) extra data that should not be stored in the notes field in db
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
        actions.push(item);
        var contextMenuLabel = true;

        if (self._isFinishLabelingAction(action) && (notes['labelType'] === 'NoSidewalk' || notes['labelType'] === 'Occlusion')) {
            contextMenuLabel = false;
        }

        //we are no longer interacting with a label, set currentLabel to null
        if (self._isContextMenuClose(action) || self._isDeleteLabelAction(action) || !contextMenuLabel) {
            currentLabel = null;
        }

        // Submit the data collected thus far if actions is too long.
        if (actions.length > 200 && !self._isCanvasInteraction(action) && !self._isContextMenuAction(action)) {
            self.submitForm();
        }

        return this;
    };

    this.submitForm = function() {
        if (svl.hasOwnProperty('taskContainer')) {
            var task = svl.taskContainer.getCurrentTask();
            var data = svl.form.compileSubmissionData(task);
            svl.form.submit(data, task);
        }
    };

    this.initTaskId = function() {
        self.submitForm();
    };

    /**
     * Put the previous labeling actions into prevActions. Then refresh the current actions.
     */
    this.refresh = function() {
        prevActions = prevActions.concat(actions);
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
