/**
 * Logs information from the Validation interface
 * @returns {Tracker}
 * @constructor
 */
function Tracker() {
    let self = this;
    let panorama = undefined;
    let actions = [];
    let prevActions = [];

    function _init() {
        _trackWindowEvents();
    }

    function _trackWindowEvents() {
        let prefix = "LowLevelEvent_";

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
    }

    /**
     *
     * @param action
     * @param notes
     * @param extraData
     * @private
     */
    function _createAction(action, notes, extraData) {
        if (!notes) {
            notes = {};
        }

        if (!extraData) {
            extraData = {};
        }

        let note = _notesToString(notes);
        let timestamp = new Date().getTime();

        panorama = svv.panorama ? svv.panorama : null;
        let panoId = panorama ? panorama.getPanoId() : null;
        let position = panorama ? panorama.getPosition() : null;  // sometimes buggy, so position will be null.
        let pov = panorama ? panorama.getPov() : null;

        let missionContainer = svv.missionContainer ? svv.missionContainer : null;
        let currentMission = missionContainer ? missionContainer.getCurrentMission() : null;

        let data = {
            action: action,
            gsv_panorama_id: panoId,
            lat: position ? position.lat : null,
            lng: position ? position.lng : null,
            heading: pov ? pov.heading : null,
            mission_id: currentMission ? currentMission.getProperty("missionId") : null,
            note: note,
            pitch: pov ? pov.pitch : null,
            timestamp: timestamp,
            zoom: pov ? pov.zoom : null,
            is_mobile: isMobile()
        };

        return data;
    }

    function getActions() {
        return actions;
    }

    function _notesToString(notes) {
        if (!notes)
            return "";

        let noteString = "";
        for (let key in notes) {
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
        let item = _createAction(action, notes, extraData);
        actions.push(item);
        if (actions.length > 200) {
            let data = svv.form.compileSubmissionData();
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
