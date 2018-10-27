/**
 * This function creates/controls the Google StreetView panorama that is used in the validation
 * interface. It uses the Panomarker API to place labels onto the panorama.
 * @constructor
 */
function Panorama() {
    var label = new Label();
    var panoCanvas = document.getElementById("svv-panorama");

    function _init() {
        // Onboarding location (for now)
        if (typeof google != "undefined") {
            svv.panorama = new google.maps.StreetViewPanorama(panoCanvas);

            // Set control options
            svv.panorama.set('addressControl', false);
            svv.panorama.set('clickToGo', false);
            svv.panorama.set('disableDefaultUI', true);
            svv.panorama.set('linksControl', false);
            svv.panorama.set('navigationControl', false);
            svv.panorama.set('panControl', false);
            svv.panorama.set('zoomControl', false);
            svv.panorama.set('keyboardShortcuts', false);
            svv.panorama.set('motionTracking', false);
            svv.panorama.set('motionTrackingControl', false);
            svv.panorama.set('showRoadLabels', false);
        } else {
            console.error("No typeof google");
        }

        // Label ID (for now)
        setLabel(72980);
    }

    function _handleData(labelMetadata) {
        setPano(labelMetadata['gsv_panorama_id'], labelMetadata['heading'],
            labelMetadata['pitch'], labelMetadata['zoom']);

        label.setProperty('canvasHeight', labelMetadata['canvas_height']);
        label.setProperty('canvasWidth', labelMetadata['canvas_width']);
        label.setProperty('canvasX', labelMetadata['canvas_x']);
        label.setProperty('canvasY', labelMetadata['canvas_y']);
        label.setProperty('heading', labelMetadata['heading']);
        label.setProperty('labelType', labelMetadata['label_type_key']);
        label.setProperty('pitch', labelMetadata['pitch']);
        label.setProperty('zoom', labelMetadata['zoom']);
    }

    /**
     * Sets the panorama ID, and heading/pitch/zoom
     * @param panoId    String representation of the Panorama ID
     * @param heading   Photographer heading
     * @param pitch     Photographer pitch
     * @param zoom      Photographer zoom
     */
    function setPano(panoId, heading, pitch, zoom) {
        svv.panorama.setPano(panoId);
        svv.panorama.set('pov', {heading: heading, pitch: pitch});

        /* TODO: See if we need to adjust the zoom level */
        svv.panorama.set('zoom', zoom);
    }

    /**
     * Retrieves a label from the database
     * TODO: figure out how to query labels without using the adminapi
     * @param labelId   label_id
     */
    function setLabel(labelId) {
        var labelUrl = "/adminapi/label/" + labelId;
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
     * Renders a label onto the screen using a Panomarker
     * @returns {renderLabel}
     */
    function renderLabel() {
        var url = label.getIconUrl();
        var pos = getPosition(label.getProperty('canvasX'), label.getProperty('canvasY'),
            label.getProperty('canvasWidth'), label.getProperty('canvasHeight'),
            label.getProperty('zoom'), label.getProperty('heading'), label.getProperty('pitch'));
        
        self.labelMarker = new PanoMarker ({
            container: panoCanvas,
            pano: svv.panorama,
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
     * @param canvas_x          X coordinate (pixel) for label
     * @param canvas_y          Y coordinate (pixel) for label
     * @param canvas_width      Original canvas width
     * @param canvas_height     Original canvas height
     * @param zoom              Original zoom level of label
     * @param heading           Original heading of label
     * @param pitch             Original pitch of label
     * @returns {{heading: number, pitch: number}}
     */
    function getPosition(canvas_x, canvas_y, canvas_width, canvas_height, zoom, heading, pitch) {
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
        var fov = get3dFov(zoom) * PI / 180.0;
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
    function get3dFov (zoom) {
        return zoom <= 2 ?
            126.5 - zoom * 36.75 :  // linear descent
            195.93 / Math.pow(1.92, zoom); // parameters determined experimentally
    }

    _init();
    self.renderLabel = renderLabel;
    self.setPano = setPano;

    return self;
}