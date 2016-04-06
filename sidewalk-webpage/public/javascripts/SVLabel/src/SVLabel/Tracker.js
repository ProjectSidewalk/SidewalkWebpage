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

    
    /** Returns actions */
    function getActions () { return actions; }

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
            } else if ("checked" in param) {
                note = "checked:" + param.checked;
            } else {
                note = "";
            }

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
        actions.push(item);

        // Todo. Submit the data collected thus far if actions is too long.
        if (actions.length > 150) {
            var data = svl.form.compileSubmissionData();
            svl.form.submit(data);
        }

        if ("trackerViewer" in svl) {
            svl.trackerViewer.add(item)
        }

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
    
    self.getActions = getActions;
    self.push = push;
    self.refresh = refresh;
    return self;
}

function TrackerViewer () {
    var self = { className: "TrackerViewer" },
        items = [];
    
    function add (action) {
        if (action.action == "LabelingCanvas_FinishLabeling") {
            var notes = action.note.split(","),
                pov = {heading: action.heading, pitch: action.pitch, zoom: action.zoom},
                imageCoordinates;

            var labelType, canvasX, canvasY, i, len = notes.length;
            for (i = 0; i < len; i++) {
                if (notes[i].indexOf("canvasX") >= 0) {
                    canvasX = parseInt(notes[i].split(":")[1], 10);
                } else if (notes[i].indexOf("canvasY") >= 0) {
                    canvasY = parseInt(notes[i].split(":")[1], 10);
                } else if (notes[i].indexOf("labelType") >= 0) {
                    labelType = notes[i].split(":")[1];
                }
            }

            imageCoordinates = svl.misc.canvasCoordinateToImageCoordinate(canvasX, canvasY, pov);

            items.push({
                action: action.action,
                panoId: action.gsv_panorama_id,
                labelType: labelType,
                imageX: imageCoordinates.x,
                imageY: imageCoordinates.y
            });
        }

        update();
    }

    function dump () {
        return items;
    }

    function update () {
        var i, len, item, html = "";
        len = items.length;

        for (i = 0; i < len; i ++) {
            item = items[i];
            html += "<li><small>action:" + item.action +
                ", panoId:" + item.panoId +
                ", labelType:" + item.labelType +
                ", imageX:" + Math.round(item.imageX) +
                ", imageY:" + Math.round(item.imageY) + "</small></li>"
        }
        svl.ui.tracker.itemHolder.html(html);
    }

    self.add = add;
    self.dump = dump;
    return self;
}
