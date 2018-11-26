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

    /**
     *
     * @param action
     * @param notes
     * @param extraData
     * @private
     */
    function _createAction(action, notes, extraData) {
        console.log("[Tracker.js] createAction");
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

        var data = {
            action: action,
            gsv_panorama_id: panorama.getPanoId(),
            lat: panorama.getPosition().lat,
            lng: panorama.getPosition().lng,
            heading: panorama.getPov().heading,
            mission_id: svv.missionContainer.getCurrentMission().getProperty("missionId"),
            note: note,
            pitch: panorama.getPov().pitch,
            timestamp: timestamp,
            zoom: panorama.getPov().zoom
        };

        console.log("[Tracker.js] data ");
        console.log(data);

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
        /*
        console.log("Action: " + action);
        console.log("Notes: " + notes);
        console.log("Extra Data: " + extraData);
        console.log("item.labelId: " + item.labelId);
        */
        if (actions.length > 2) {
            var data = svv.form.compileSubmissionData();
            svv.form.submit(data, true);
        }
        return this;
    }

    function refresh() {
        prevActions = prevActions.concat(actions);
        actions = [];
        self.push("RefreshTracker");
    }

    /**
     * Submits data from the Tracker to the backend
     */
    function submitForm() {

    }

    self.getActions = getActions;
    self.push = push;
    self.refresh = refresh;
    self.submitForm = submitForm;

    return this;
}