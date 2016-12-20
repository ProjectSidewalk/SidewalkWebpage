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

    this.init = function () {
        this.trackWindowEvents();
    };

    this.trackWindowEvents = function() {
        var prefix = "LowLevelEvent_";

        // track all mouse related events
        $(document).on('mousedown mouseup mouseover mouseout mousemove click contextmenu dblclick', function(e) {
            self.push(prefix + e.type, {
                cursorX: e.originalEvent.x,
                cursorY: e.originalEvent.y
            });
        });

        // keyboard related events
        $(document).on('keydown keyup', function(e) {
            self.push(prefix + e.type, {
                keyCode: e.keyCode
            });
        });
    };

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

    this._notesToString = function (param) {
        if (!param)
            return "";

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

    this.create = function (action, notes, extraData) {
        if (!notes)
            notes = {};

        if (!extraData)
            extraData = {};

        var pov, latlng, panoId, temporaryLabelId;

        var note = this._notesToString(notes);

        if ('temporaryLabelId' in extraData) {
            temporaryLabelId = extraData['temporaryLabelId'];
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

    /**
     * @param action: the action to be stored in the database
     * @param notes: (optional) the notes field in the database
     * @param extraData: (optional) extra data that should not be stored in the notes field in db
     */
    this.push = function (action, notes, extraData) {
        var item = self.create(action, notes, extraData);
        actions.push(item);

        // Submit the data collected thus far if actions is too long.
        if (actions.length > 200 && !self._isCanvasInteraction(action) && !self._isContextMenuAction(action)) {
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

    this.init();
}

