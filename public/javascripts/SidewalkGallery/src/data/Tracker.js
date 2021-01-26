/**
 * Logs information from the Sidewalk Gallery.
 * 
 * @returns {Tracker}
 * @constructor
 */
function Tracker() {
    let self = this;
    let actions = [];

    function _init() {
        //_trackWindowEvents();
    }

    // TODO: update/include for v1.1
    function _trackWindowEvents() {
        let prefix = "LowLevelEvent_";

        // Track all mouse related events.
        $(document).on('mousedown mouseup mouseover mouseout mousemove click contextmenu dblclick', function(e) {
            self.push(prefix + e.type, {
                cursorX: 'pageX' in e ? e.pageX : null,
                cursorY: 'pageY' in e ? e.pageY : null
            });
        });

        // Keyboard related events.
        $(document).on('keydown keyup', function(e) {
            self.push(prefix + e.type, {
                keyCode: 'keyCode' in e ? e.keyCode : null
            });
        });
    }

    /**
     * Creates action to be added to action buffer.
     * 
     * @param action Action name.
     * @param suppData Optional supplementary data about action.
     * @param notes Optional notes about action.
     * @private
     */
    function _createAction(action, suppData, notes) {
        if (!notes) {
            notes = {};
        }

        let note = _notesToString(notes);
        let timestamp = new Date().getTime();

        let data = {
            action: action,
            pano_id: suppData && suppData.panoId ? suppData.panoId : null,
            note: note,
            timestamp: timestamp
        };

        return data;
    }

    /**
     * Return list of actions.
     */
    function getActions() {
        return actions;
    }

    /**
     * Convert notes object to string.
     * 
     * @param {*} notes Notes object.
     */
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
     * Pushes information to action list (to be submitted to the database).
     * 
     * @param action (required) Action name.
     * @param suppData (optional) Supplementary data to be logged about action.
     * @param notes (optional) Notes to be logged into the notes fieldin database.
     */
    function push(action, suppData, notes) {
        let item = _createAction(action, suppData, notes);
        actions.push(item);

        // TODO: change action buffer size limit
        if (actions.length > 10) {
            let data = sg.form.compileSubmissionData();
            sg.form.submit(data, true);
        }
        return this;
    }

    /**
     * Empties actions stored in the Tracker.
     */
    function refresh() {
        actions = [];
        self.push("RefreshTracker");
    }

    _init();

    self.getActions = getActions;
    self.push = push;
    self.refresh = refresh;

    return this;
}
