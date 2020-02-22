/**
 *
 *
 * @param svHolder: One single DOM element
 * @returns {{className: string}}
 * @constructor
 */
function AdminPanorama(svHolder) {
    var self = {
        className: "AdminPanorama",
        label: undefined,
        labelMarker: undefined,
        panoId: undefined,
        panorama: undefined
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

    // Determined experimentally; varies w/ GSV Panorama size
    var zoomLevel = {
        1: 1,
        2: 1.95,
        3: 2.95
    };

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

        self.svHolder.append($(self.panoCanvas));

        self.panorama = typeof google != "undefined" ? new google.maps.StreetViewPanorama(self.panoCanvas, { mode: 'html4' }) : null;
        self.panorama.addListener('pano_changed', function() {
            if (self.labelMarker) {
                var currentPano = self.panorama.getPano();
                if (currentPano === self.panoId) {
                    self.labelMarker.setVisible(true);
                } else {
                    self.labelMarker.setVisible(false);
                }
            }
        });

        if (self.panorama) {
            self.panorama.set('addressControl', false);
            self.panorama.set('clickToGo', true);
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
     * Sets the panorama ID and POV from label metadata
     * @param panoId
     * @param heading
     * @param pitch
     * @param zoom
     */
    function setPano(panoId, heading, pitch, zoom) {
        if (typeof google != "undefined") {
            self.svHolder.css('visibility', 'hidden');
            self.panoId = panoId;

            self.panorama.setPano(panoId);
            self.panorama.set('pov', {heading: heading, pitch: pitch});
            self.panorama.set('zoom', zoomLevel[zoom]);

            // Based off code from Onboarding.
            // We write another callback function because of a bug in the Google Maps API that
            // causes the screen to go black.
            // This callback gives time for the pano to load for 500ms. Afterwards, we trigger a
            // resize and reset the POV/Zoom.
            function callback () {
                google.maps.event.trigger(self.panorama, 'resize');
                self.panorama.set('pov', {heading: heading, pitch: pitch});
                self.panorama.set('zoom', zoomLevel[zoom]);
                self.svHolder.css('visibility', 'visible');
                renderLabel(self.label);
            }
            setTimeout(callback, 500);
        }
        return this;
    }

    function setLabel (label) {
        self.label = label;
    }

    /**
     * Renders a Panomarker (label) onto Google Streetview Panorama.
     * @param label: instance of AdminPanoramaLabel
     * @returns {renderLabel}
     */
    function renderLabel (label) {
        console.log("pre:")
        var url = icons[label['label_type']];
        var pos = getPosition(label['canvasX'], label['canvasY'], label['originalCanvasWidth'],
            label['originalCanvasHeight'], label['zoom'], label['heading'], label['pitch']);

        self.labelMarker = new PanoMarker ({
            container: self.panoCanvas,
            pano: self.panorama,
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

    //init
    _init();

    self.setPano = setPano;
    self.setLabel = setLabel;
    self.renderLabel = renderLabel;
    return self;
}
