function Point(svl, x, y, pov) {
    'use strict';

    var self = {
        originalCanvasCoordinate : undefined,
        panoramaPov : undefined
    };
    var belongsTo;

    function _init(x, y, pov) {
        // Keep the original canvas coordinate and canvas pov just in case.
        self.originalCanvasCoordinate = {
            x : x,
            y : y
        };
        self.panoramaPov = {
            heading: pov.heading,
            pitch: pov.pitch,
            zoom: pov.zoom
        };
        return true;
    }

    function setBelongsTo(obj) {
        belongsTo = obj;
        return this;
    }
    self.setBelongsTo = setBelongsTo;

    _init(x, y, pov);
    return self;
}
