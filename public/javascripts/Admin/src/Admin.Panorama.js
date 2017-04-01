/**
 *
 *
 * @param svHolder: One single DOM element
 * @returns {{className: string}}
 * @constructor
 */
function AdminPanorama(svHolder) {
    var self = { className: "AdminPanorama" };

    /**
     * This function initializes the Panorama
     */
    function _init () {
        self.svHolder = $(svHolder);
        self.svHolder.addClass("admin-panorama");

        // svHolder's children are absolutely aligned, svHolder's position has to be either absolute or relative
        if(self.svHolder.css('position') != "absolute" && self.svHolder.css('position') != "relative")
            self.svHolder.css('position', 'relative');

        // GSV will be added to panoCanvas
        self.panoCanvas = $("<div id='pano'>").css({
            width: self.svHolder.width(),
            height: self.svHolder.height()
        })[0];

        // Where the labels are drawn
        self.drawingCanvas = $("<canvas>").attr({
            width: self.svHolder.width(),
            height: self.svHolder.height()
        }).css({
            'z-index': 2,
            'position': 'absolute',
            'top': 0,
            'left': 0,
            'width': self.svHolder.width(),
            'height': self.svHolder.height()
        })[0];

        // Add them to svHolder
        self.svHolder.append($(self.panoCanvas), $(self.drawingCanvas));

        self.ctx = self.drawingCanvas.getContext("2d");

        self.panorama = typeof google != "undefined" ? new google.maps.StreetViewPanorama(self.panoCanvas, { mode: 'html4' }) : null;
        self.panoId = null;

        self.panoPov = {
            heading: null,
            pitch: null,
            zoom: null
        };

        if (self.panorama) {
            self.panorama.set('addressControl', false);
            self.panorama.set('clickToGo', false);
            self.panorama.set('disableDefaultUI', true);
            self.panorama.set('linksControl', false);
            self.panorama.set('navigationControl', false);
            self.panorama.set('panControl', false);
            self.panorama.set('zoomControl', false);
            self.panorama.set('keyboardShortcuts', false);
            self.panorama.set('motionTracking', false);
            self.panorama.set('motionTrackingControl', false);
            self.panorama.set('showRoadLabels', false);
        }

        return this;
    }

    /**
     * @param newId
     */
    function changePanoId(newId) {
        if(self.panoId != newId) {
            self.panorama.setPano(newId);
            self.panoId = newId;
            _clearCanvas();
            self.refreshGSV();
        }
        return this;
    }

    /**
     * @param options: The options object should have "heading", "pitch" and "zoom" keys
     */
    function setPov(newPov) {
        //Only update the pov if it is different
        if(newPov.heading != self.panoPov.heading || newPov.pitch != self.panoPov.pitch
            || newPov.zoom != self.panoPov.zoom) {
            self.panorama.setPov(newPov);
            self.panoPov = newPov;
            _clearCanvas();
            self.refreshGSV();
        }
        return this;
    }

    /**
     *
     * @param label: instance of AdminPanoramaLabel
     * @returns {renderLabel}
     */
    function renderLabel (label) {
        var x = (label.canvasX / label.originalCanvasWidth) * self.drawingCanvas.width;
        var y = (label.canvasY / label.originalCanvasHeight) * self.drawingCanvas.height;

        var colorScheme = util.misc.getLabelColors();
        var fillColor = (label.label_type in colorScheme) ? colorScheme[label.label_type].fillStyle : "rgb(128, 128, 128)";


        self.ctx.save();
        self.ctx.strokeStyle = 'rgba(255,255,255,1)';
        self.ctx.lineWidth = 3;
        self.ctx.beginPath();
        self.ctx.arc(x, y, 6, 2 * Math.PI, 0, true);
        self.ctx.closePath();
        self.ctx.stroke();
        self.ctx.fillStyle = fillColor;
        self.ctx.fill();
        self.ctx.restore();

        return this;
    }

    function _clearCanvas () {
        self.ctx.clearRect(0, 0, self.drawingCanvas.width, self.drawingCanvas.height);
    }

    /*
    Sometimes strangely the GSV is not shown, calling this function might fix it
    related:http://stackoverflow.com/questions/18426083/how-do-i-force-redraw-with-google-maps-api-v3-0
     */
    function refreshGSV() {
        if (typeof google != "undefined")
            google.maps.event.trigger(self.panorama,'resize');
    }

    //init
    _init();

    self.changePanoId = changePanoId;
    self.setPov = setPov;
    self.renderLabel = renderLabel;
    self.refreshGSV = refreshGSV;
    return self;
}