function AdminGSVLabel(params) {
    var self = { labelObj: params.labelObj,
                 labelPointObj: params.labelPointObj
    };

    var _init = function() {
        self.panorama = AdminPanorama($("#svholder")[0]);

        self.panorama.changePanoId(self.labelObj.gsvPanoramaId);

        self.panorama.setPov({
            heading: self.labelPointObj.heading,
            pitch: self.labelPointObj.pitch,
            zoom: self.labelPointObj.zoom
        });

        var adminPanoramaLabel = AdminPanoramaLabel(self.labelObj.labelTypeKey,
            self.labelPointObj.canvasX, self.labelPointObj.canvasY,
            self.labelPointObj.canvasWidth, self.labelPointObj.canvasHeight);
        self.panorama.renderLabel(adminPanoramaLabel);
    };

    _init();

    return self;
}