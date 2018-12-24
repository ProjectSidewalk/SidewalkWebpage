/**
 * Class that logs information from the Validation interface
 * @returns {Tracker}
 * @constructor
 */
function Tracker() {
    var self = this;
    var panorama = undefined;
    var actions = [];
    var prevActions = [];

    function _init() {
        _trackWindowEvents();
    }

    function _trackWindowEvents() {
        var prefix = "LowLevelEvent_";

        // track all mouse related events
        $(document).on('mousedown mouseup mouseover mouseout mousemove click contextmenu dblclick', function(e) {
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

    /**
     *
     * @param action
     * @param notes
     * @param extraData
     * @private
     */
    function _createAction(action, notes, extraData) {
        // console.log("[Tracker.js] createAction: " + action);
        if (!notes) {
            notes = {};
        }

        if (!extraData) {
            extraData = {};
        }

        var note = _notesToString(notes);
        var timestamp = new Date().getTime();

        if (!svv.panorama) {
            console.log("Panorama does not exist");
        } else {
            panorama = svv.panorama;
        }

        var panoId = panorama.getPanoId();
        var position = panorama.getPosition();  // sometimes buggy, so position will be null.
        var pov = panorama.getPov();

        var data = {
            action: action,
            gsv_panorama_id: panoId,
            lat: position ? position.lat : null,
            lng: position ? position.lng : null,
            heading: pov.heading,
            mission_id: svv.missionContainer.getCurrentMission().getProperty("missionId"),
            note: note,
            pitch: pov.pitch,
            timestamp: timestamp,
            zoom: pov.zoom
        };

        return data;
    }

    function getActions() {
        return actions;
    }

    function _notesToString(notes) {
        if (!notes)
            return "";

        var noteString = "";
        for (var key in notes) {
            if (noteString.length > 0)
                noteString += ",";
            noteString += key + ':' + notes[key];
        }

        return noteString;
    }

    /**
     * Pushes information to action list (to be submitted to the database)
     * @param action    (required) Action
     * @param notes     (optional) Notes to be logged into the notes field database
     * @param extraData (optional) Extra data that should not be stored in the db notes field
     */
    function push(action, notes, extraData) {
        var item = _createAction(action, notes, extraData);
        actions.push(item);
        if (actions.length > 200) {
            var data = svv.form.compileSubmissionData();
            svv.form.submit(data, true);
        }
        return this;
    }

    /**
     * Empties actions stored in the Tracker.
     */
    function refresh() {
        prevActions = prevActions.concat(actions);
        actions = [];
        self.push("RefreshTracker");
    }

    _init();

    self.getActions = getActions;
    self.push = push;
    self.refresh = refresh;

    return this;
}