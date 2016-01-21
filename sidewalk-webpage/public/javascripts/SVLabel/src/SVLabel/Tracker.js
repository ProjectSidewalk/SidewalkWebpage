var svl = svl || {};

/**
 *
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Tracker () {
    var self = {className: 'Tracker'},
        actions = [],
        prevActions = [];

    /**
     * Returns actions
     */
    function getActions () {
        return actions;
    }

    /**
     * Load the actions in storage
     */
    function load () {
        actions = svl.storage.get("tracker");
    }

    /**
     * This function pushes action type, time stamp, current pov, and current panoId into actions list.
     */
    function push (action, param) {
        var pov, latlng, panoId, note, temporaryLabelId;

        if (param) {
            if (('x' in param) && ('y' in param)) {
                note = 'x:' + param.x + ',y:' + param.y;
            } else if ('TargetPanoId' in param) {
                note = param.TargetPanoId;
            } else if ('RadioValue' in param) {
                note = param.RadioValue;
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
            } else {
                note = "";
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
            pov = svl.getPOV();
        } catch (err) {
            pov = {
                heading: null,
                pitch: null,
                zoom: null
            }
        }

        try {
            latlng = getPosition();
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
            panoId = getPanoId();
        } catch (err) {
            panoId = null;
        }

        var now = new Date(),
            timestamp = now.getUTCFullYear() + "-" + (now.getUTCMonth() + 1) + "-" + now.getUTCDate() + " " + now.getUTCHours() + ":" + now.getUTCMinutes() + ":" + now.getUTCSeconds() + "." + now.getUTCMilliseconds();

        actions.push({
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
        });
        return this;
    }

    /**
     * Put the previous labeling actions into prevActions. Then refresh the current actions.
     */
    function refresh () {
        prevActions = prevActions.concat(actions);
        actions = [];
        push("RefreshTracker");
    }

    /**
     * Save the actions in the storage
     */
    function save () {
        svl.storage.set("tracker", actions);
    }

    self.getActions = getActions;
//    self.load = load;
    self.push = push;
    self.refresh = refresh;
//    self.save = save;
    return self;
}
