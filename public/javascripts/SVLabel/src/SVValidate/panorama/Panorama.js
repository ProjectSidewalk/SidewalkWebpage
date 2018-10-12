/**
 * This function creates/controls the Google StreetView panorama that is used in the validation
 * interface. It uses the Panomarker API to place labels onto the panorama.
 * @constructor
 */
function Panorama() {
    var label = {
        canvasHeight: undefined,
        canvasWidth: undefined,
        canvasX: undefined,
        canvasY: undefined,
        heading: undefined,
        labelType: undefined,
        pitch: undefined,
        zoom: undefined
    };

    var icons = {
        CurbRamp : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_CurbRamp.png',
        NoCurbRamp : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_NoCurbRamp.png',
        Obstacle : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Obstacle.png',
        SurfaceProblem : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_SurfaceProblem.png',
        Other : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Other.png',
        Occlusion : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_Other.png',
        NoSidewalk : 'assets/javascripts/SVLabel/img/admin_label_tool/AdminTool_NoSidewalk.png'
    };

    var panoCanvas = document.getElementById("svv-panorama");

    function _init() {
        // Test Label (for now)
        // Manually getting stats from: http://0.0.0.0:9000/adminapi/label/72980

        // Onboarding location (for now)
        var initLoc = {
            pano: "stxXyCKAbd73DmkM2vsIHA",
            heading: 270,
            pitch: 0,
            visible: true,
            zoom: 1
        };

        if (typeof google != "undefined") {
            svv.panorama = new google.maps.StreetViewPanorama(panoCanvas);
            svv.panorama.setPano(initLoc.pano);

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

            svv.panorama.set('pov', {heading: initLoc.heading, pitch: initLoc.pitch});
            svv.panorama.set('zoom', initLoc.zoom);
        } else {
            console.log("No typeof google");
        }

        setLabel(72980);
        renderLabel();
    }

    function _handleData(labelMetadata) {
        console.log('setLabel Label type: ' + labelMetadata['label_type_key']);

        label = {
            canvasHeight: labelMetadata['canvas_height'],
            canvasWidth: labelMetadata['canvas_width'],
            canvasX: labelMetadata['canvas_x'],
            canvasY: labelMetadata['canvas_y'],
            heading: labelMetadata['heading'],
            labelType: labelMetadata['label_type_key'],
            pitch: labelMetadata['pitch'],
            zoom: labelMetadata['zoom']
        };

        // label.labelType = labelMetadata['label_type_key'];
        console.log("setLabel Label type (2): " + label.labelType);
    }

    /**
     * Sets the panorama ID to an ID.
     * @param panoId    String representation of the Panorama ID
     */
    function setPanoramaID(panoId) {
        svv.panoramaID = panoId;
    }

    /**
     * Retrieves a label from the database
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
    }

    function renderLabel() {
        var url = icons[label.labelType];
        var pos = getPosition(label.canvasX, label.canvasY, label.canvasWidth,
            label.canvasHeight, label.zoom, label.heading, label.pitch);

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
    // hello

    self.renderLabel = renderLabel;
    self.setPanoramaID = setPanoramaID;
}