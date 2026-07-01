/**
 * Logs information from the Validation interface.
 */
class Tracker {
    #actions = [];

    constructor() {
        this.#trackWindowEvents();
    }

    #trackWindowEvents() {
        const prefix = 'LowLevelEvent_';

        // track all mouse related events
        $(document).on('mousedown mouseup mouseover mouseout mousemove click contextmenu dblclick', (e) => {
            this.push(prefix + e.type, {
                cursorX: 'pageX' in e ? e.pageX : null,
                cursorY: 'pageY' in e ? e.pageY : null
            });
        });

        // keyboard related events
        $(document).on('keydown keyup', (e) => {
            this.push(prefix + e.type, {
                keyCode: 'keyCode' in e ? e.keyCode : null
            });
        });
    }

    /**
     * @param {string} action
     * @param {object} notes
     */
    #createAction(action, notes) {
        const panoViewer = svv.panoManager && svv.panoViewer ? svv.panoViewer : null;
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
            note: this.#notesToString(notes || {}),
            timestamp: new Date(),
        };
    }

    getActions() {
        return this.#actions;
    }

    #notesToString(notes) {
        if (!notes)
            return '';

        let noteString = '';
        for (const key in notes) {
            if (noteString.length > 0)
                noteString += ',';
            noteString += key + ':' + notes[key];
        }

        return noteString;
    }

    /**
     * Pushes information to action list (to be submitted to the database).
     * @param {string} action
     * @param {object} [notes] Notes to be logged into the notes field database.
     */
    push(action, notes) {
        const item = this.#createAction(action, notes);
        const prevItem = this.#actions.slice(-1)[0];
        this.#actions.push(item);
        if (this.#actions.length > 200) {
            const data = svv.form.compileSubmissionData(false);
            svv.form.submit(data, true); // Note that this happens async
        }
        // If there is a one-hour break between interactions (in ms), refresh the page to avoid weird bugs.
        if (prevItem && item.timestamp - prevItem.timestamp > 3600000) window.location.reload();
        return this;
    }

    /**
     * Empties actions stored in the Tracker.
     */
    refresh() {
        this.#actions = [];
        this.push('RefreshTracker');
    }
}
