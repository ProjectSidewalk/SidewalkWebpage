/**
 * This function creates/controls the Google StreetView panorama that is used in the validation
 * interface. It uses the Panomarker API to place labels onto the panorama.
 * @constructor
 */
function Panorama() {
    var currentLabel = new Label();
    var panoCanvas = document.getElementById("svv-panorama");
    var panorama = undefined;
    var init = true;

    function _init() {
        // Onboarding location (for now)
        if (typeof google != "undefined") {
            // Set control options
            panorama = new google.maps.StreetViewPanorama(panoCanvas);
            panorama.set('addressControl', false);
            panorama.set('clickToGo', false);
            panorama.set('disableDefaultUI', true);
            panorama.set('linksControl', false);
            panorama.set('navigationControl', false);
            panorama.set('panControl', false);
            panorama.set('zoomControl', false);
            panorama.set('keyboardShortcuts', false);
            panorama.set('motionTracking', false);
            panorama.set('motionTrackingControl', false);
            panorama.set('showRoadLabels', false);
        } else {
            console.error("No typeof google");
        }

        // Sets to a random label
        if (init) {
            setLabel();
        }
    }

    function getCurrentLabel() {
        console.log("From method: " + currentLabel.getProperty('labelType'));
        return currentLabel;
    }

    /**
     * Sets label properties from metadata
     * @param labelMetadata JSON with label data
     * @private
     */
    function _handleData(labelMetadata) {
        console.log("_handleData");
        console.log("Label ID: " + labelMetadata['label_id']);
        setPanorama(labelMetadata['gsv_panorama_id'], labelMetadata['heading'],
                labelMetadata['pitch'], labelMetadata['zoom']);

        currentLabel.setProperty('canvasHeight', labelMetadata['canvas_height']);
        currentLabel.setProperty('canvasWidth', labelMetadata['canvas_width']);
        currentLabel.setProperty('canvasX', labelMetadata['canvas_x']);
        currentLabel.setProperty('canvasY', labelMetadata['canvas_y']);
        currentLabel.setProperty('heading', labelMetadata['heading']);
        currentLabel.setProperty('labelId', labelMetadata['label_id']);
        currentLabel.setProperty('labelType', labelMetadata['label_type']);
        currentLabel.setProperty('pitch', labelMetadata['pitch']);
        currentLabel.setProperty('zoom', labelMetadata['zoom']);
    }

    /**
     * Sets the panorama ID, and heading/pitch/zoom
     * @param panoId    String representation of the Panorama ID
     * @param heading   Photographer heading
     * @param pitch     Photographer pitch
     * @param zoom      Photographer zoom
     */
    function setPanorama(panoId, heading, pitch, zoom) {
        if (init) {
            panorama.setPano(panoId);
            panorama.set('pov', {heading: heading, pitch: pitch});
            console.log("setting pano: checkpoint 3");
            /* TODO: See if we need to adjust the zoom level */
            panorama.set('zoom', zoom);
            init = false;
        } else {
            console.log("not initializing");

            // Adding in callback function because there are some issues with Google Maps
            // setPano function. Will start to running an infinite loop if panorama does not
            // load in time.
            function changePano() {
                self.labelMarker.onRemove();
                _init();
                panorama.setPano(panoId);
                panorama.set('pov', {heading: heading, pitch: pitch});
                panorama.set('zoom', zoom);
                renderLabel();
            }
            setTimeout(changePano, 100);
            // renderLabel();
            console.log("SVV Panorama: " + panorama);
        }
        return this;
    }

    /**
     * Retrieves a currentLabel from the database
     * @param labelId   label_id
     */
    function setLabel(labelId) {
        var labelUrl = "/label/geo/" + labelId;
        $.ajax({
            url: labelUrl,
            async: false,
            dataType: 'json',
            success: function (labelMetadata) {
                _handleData(labelMetadata);
            }
        });
        renderLabel();
    }

    /**
     * Retrieves a random label from the database.
     */
    function setLabel() {
        console.log("setting label");
        var labelUrl = "/label/geo/random";
        $.ajax({
            url: labelUrl,
            async: false,
            dataType: 'json',
            success: function (labelMetadata) {
                _handleData(labelMetadata);
            }
        });
        renderLabel();
    }

    /**
     * Renders a label onto the screen using a Panomarker.
     * @returns {renderLabel}
     */
    function renderLabel() {
        console.log("render label");
        var url = currentLabel.getIconUrl();
        var pos = _getPosition(currentLabel.getProperty('canvasX'), currentLabel.getProperty('canvasY'),
            currentLabel.getProperty('canvasWidth'), currentLabel.getProperty('canvasHeight'),
            currentLabel.getProperty('zoom'), currentLabel.getProperty('heading'), currentLabel.getProperty('pitch'));

        self.labelMarker = new PanoMarker ({
            container: panoCanvas,
            pano: panorama,
            position: {heading: pos.heading, pitch: pos.pitch},
            icon: url,
            size: new google.maps.Size(20, 20),
            anchor: new google.maps.Point(10, 10)
        });
        return this;
    }


    /* TODO: move this to a util file? */
    /**
     * Calculates heading and pitch for a Google Maps marker using (x, y) coordinates
     * From PanoMarker spec
     * @param canvas_x          X coordinate (pixel) for currentLabel
     * @param canvas_y          Y coordinate (pixel) for currentLabel
     * @param canvas_width      Original canvas width
     * @param canvas_height     Original canvas height
     * @param zoom              Original zoom level of currentLabel
     * @param heading           Original heading of currentLabel
     * @param pitch             Original pitch of currentLabel
     * @returns {{heading: number, pitch: number}}
     */
    function _getPosition(canvas_x, canvas_y, canvas_width, canvas_height, zoom, heading, pitch) {
        function sgn(x) {
            return x >= 0 ? 1 : -1;
        }

        var PI = Math.PI;
        var cos = Math.cos;
        var sin = Math.sin;
        var tan = Math.tan;
        var sqrt = Math.sqrt;
        var atan2 = Math.atan2;
        var asin = Math.asin;
        var fov = _get3dFov(zoom) * PI / 180.0;
        var width = canvas_width;
        var height = canvas_height;
        var h0 = heading * PI / 180.0;
        var p0 = pitch * PI / 180.0;
        var f = 0.5 * width / tan(0.5 * fov);
        var x0 = f * cos(p0) * sin(h0);
        var y0 = f * cos(p0) * cos(h0);
        var z0 = f * sin(p0);
        var du = (canvas_x) - width / 2;
        var dv = height / 2 - (canvas_y - 5);
        var ux = sgn(cos(p0)) * cos(h0);
        var uy = -sgn(cos(p0)) * sin(h0);
        var uz = 0;
        var vx = -sin(p0) * sin(h0);
        var vy = -sin(p0) * cos(h0);
        var vz = cos(p0);
        var x = x0 + du * ux + dv * vx;
        var y = y0 + du * uy + dv * vy;
        var z = z0 + du * uz + dv * vz;
        var R = sqrt(x * x + y * y + z * z);
        var h = atan2(x, y);
        var p = asin(z / R);
        return {
            heading: h * 180.0 / PI,
            pitch: p * 180.0 / PI
        };
    }

    /**
     * From panomarker spec
     * @param zoom
     * @returns {number}
     */
    function _get3dFov (zoom) {
        return zoom <= 2 ?
            126.5 - zoom * 36.75 :  // linear descent
            195.93 / Math.pow(1.92, zoom); // parameters determined experimentally
    }

    _init();
    self.getCurrentLabel = getCurrentLabel;
    self.renderLabel = renderLabel;
    self.setLabel = setLabel;
    self.setPanorama = setPanorama;

    return self;
}