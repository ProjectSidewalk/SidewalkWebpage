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
