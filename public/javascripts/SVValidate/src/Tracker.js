/**
 * Logs information from the Validation interface
 * @returns {Tracker}
 * @constructor
 */
function Tracker() {
    let self = this;
    let actions = [];

    function _init() {
        _trackWindowEvents();
    }

    function _trackWindowEvents() {
        const prefix = 'LowLevelEvent_';

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
     * @private
     */
    function _createAction(action, notes) {
        const panoViewer = svv.panoViewer ? svv.panoViewer : null;
        const position = panoViewer ? panoViewer.getPosition() : { lat: null, lng: null };
        const pov = panoViewer ? panoViewer.getPov() : { heading: null, pitch: null, zoom: null };

        const missionContainer = svv.missionContainer ? svv.missionContainer : null;
        const currentMission = missionContainer ? missionContainer.getCurrentMission() : null;

        return {
            action: action,
            pano_id: panoViewer ? panoViewer.getPanoId() : null,
            lat: position.lat,
            lng: position.lng,
            heading: pov ? pov.heading : null,
            pitch: pov ? pov.pitch : null,
            zoom: pov ? pov.zoom : null,
            mission_id: currentMission ? currentMission.getProperty('missionId') : null,
            note: _notesToString(notes || {}),
            timestamp: new Date(),
        };
    }

    function getActions() {
        return actions;
    }

    function _notesToString(notes) {
        if (!notes)
            return '';

        let noteString = '';
        for (let key in notes) {
            if (noteString.length > 0)
                noteString += ',';
            noteString += key + ':' + notes[key];
        }

        return noteString;
    }

    /**
     * Pushes information to action list (to be submitted to the database)
     * @param action    (required) Action
     * @param notes     (optional) Notes to be logged into the notes field database
     */
    function push(action, notes) {
        const item = _createAction(action, notes);
        const prevItem = actions.slice(-1)[0];
        actions.push(item);
        if (actions.length > 200) {
            const data = svv.form.compileSubmissionData(false);
            svv.form.submit(data, true);
        }
        // If there is a one-hour break between interactions (in ms), refresh the page to avoid weird bugs.
        if (prevItem && item.timestamp - prevItem.timestamp > 3600000) window.location.reload();
        return this;
    }

    /**
     * Empties actions stored in the Tracker.
     */
    function refresh() {
        actions = [];
        self.push('RefreshTracker');
    }

    _init();

    self.getActions = getActions;
    self.push = push;
    self.refresh = refresh;

    return this;
}
