/**
 *
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Tracker () {
    var self = this;
    var actions = [];
    var prevActions = [];

    this._isCanvasInteraction = function (action) {
        return action.indexOf("LabelingCanvas") >= 0;
    };

    this._isContextMenuAction = function (action) {
        return action.indexOf("ContextMenu") >= 0;
    };

    /** Returns actions */
    this.getActions = function () {
        return actions;
    };

    /**
     * This function pushes action type, time stamp, current pov, and current panoId into actions list.
     */

    this.create = function (action, param) {
        var pov, latlng, panoId, note, temporaryLabelId;

        if (param) {
            if (('x' in param) && ('y' in param)) {
                note = 'x:' + param.x + ',y:' + param.y;
            } else if ('TargetPanoId' in param) {
                note = "targetPanoId:" + param.TargetPanoId;
            } else if ('RadioValue' in param) {
                note = "RadioValue:" + param.RadioValue;
            } else if ('keyCode' in param) {
                note = 'keyCode:' + param.keyCode;
            } else if ('errorType' in param) {
                note = 'errorType:' + param.errorType;
            } else if ('quickCheckImageId' in param) {
                note = param.quickCheckImageId;
            } else if ('quickCheckCorrectness' in param) {
                note = param.quickCheckCorrectness;
            } else if ('labelId' in param) {
                note = 'labelId:' + param.labelId;
            } else if ("checked" in param) {
                note = "checked:" + param.checked;
            } else if ("onboardingTransition" in param) {
                note = "from:" + param.onboardingTransition;
            } else {
                note = "";
            }
            note = note + "";  // Make sure it is a string.

            if ("missionLabel" in param) {
                note += note == "" ? "" : ",";
                note += "MissionLabel:" + param.missionLabel;
            }

            if ("missionDistance" in param) {
                note += note == "" ? "" : ",";
                note += "MissionDistance:" + param.missionDistance;
            }

            if ("neighborhoodId" in param) {
                note += note == "" ? "" : ",";
                note += "NeighborhoodId:" + param.neighborhoodId;
            }

            if ("neighborhoodId")

            if ("LabelType" in param && "canvasX" in param && "canvasY" in param) {
                if (note.length != 0) { note += ","; }
                note += "labelType:" + param.LabelType + ",canvasX:" + param.canvasX + ",canvasY:" + param.canvasY;
            }
            if ('temporary_label_id' in param) {
                temporaryLabelId = param.temporary_label_id;
            }
        } else {
            note = "";
        }

        // Initialize variables. Note you cannot get pov, panoid, or position
        // before the map and SV load.
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

        var now = new Date(),
            timestamp = new Date().getTime();
        // timestamp = now.getUTCFullYear() + "-" + (now.getUTCMonth() + 1) + "-" + now.getUTCDate() + " " + now.getUTCHours() + ":" + now.getUTCMinutes() + ":" + now.getUTCSeconds() + "." + now.getUTCMilliseconds();

        var item = {
            action : action,
            gsv_panorama_id: panoId,
            lat: latlng.lat,
            lng: latlng.lng,
            heading: pov.heading,
            pitch: pov.pitch,
            zoom: pov.zoom,
            note: note,
            temporary_label_id: temporaryLabelId,
            timestamp: timestamp
        };
        return item;
    };

    this.push = function (action, param) {
        var item = self.create(action, param);
        actions.push(item);

        // Submit the data collected thus far if actions is too long.
        if (actions.length > 30 && !self._isCanvasInteraction(action) && !self._isContextMenuAction(action)) {
            var task = svl.taskContainer.getCurrentTask();
            var data = svl.form.compileSubmissionData(task);
            svl.form.submit(data, task);
        }
        return this;
    };

    /**
     * Put the previous labeling actions into prevActions. Then refresh the current actions.
     */
    this.refresh = function () {
        prevActions = prevActions.concat(actions);
        actions = [];
        self.push("RefreshTracker");
    };
}

