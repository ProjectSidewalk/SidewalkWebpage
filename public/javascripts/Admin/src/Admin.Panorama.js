/**
 * AdminPanorama is a class that handles the Google Street View panorama.
 * TODO so much of this code is a copy of code that's elsewhere. Need to combine a bunch into a shared module.
 * @param svHolder One single DOM element.
 * @param buttonHolder DOM element that holds the validation buttons.
 * @param admin Boolean value that indicates if the user is an admin.
 * @param {typeof PanoViewer} viewerType The type of pano viewer to initialize.
 * @param {string} viewerAccessToken An access token used to request images for the pano viewer.
 * @returns {{className: string}}
 * @constructor
 */
async function AdminPanorama(svHolder, buttonHolder, admin, viewerType, viewerAccessToken) {
    var self = {
        className: "AdminPanorama",
        label: undefined,
        labelMarkers: [],
        panoId: undefined,
        panoViewer: undefined,
        admin: admin
    };

    var icons = {
        CurbRamp : '/assets/images/icons/AdminTool_CurbRamp.png',
        NoCurbRamp : '/assets/images/icons/AdminTool_NoCurbRamp.png',
        Obstacle : '/assets/images/icons/AdminTool_Obstacle.png',
        SurfaceProblem : '/assets/images/icons/AdminTool_SurfaceProblem.png',
        Other : '/assets/images/icons/AdminTool_Other.png',
        Occlusion : '/assets/images/icons/AdminTool_Occlusion.png',
        NoSidewalk : '/assets/images/icons/AdminTool_NoSidewalk.png',
        Crosswalk : '/assets/images/icons/AdminTool_Crosswalk.png',
        Signal : '/assets/images/icons/AdminTool_Signal.png'
    };

    /**
     * This function initializes the Panorama
     */
    async function _init() {
        self.buttonHolder = $(buttonHolder);
        self.svHolder = $(svHolder);
        self.svHolder.addClass("admin-panorama");

        // svHolder's children are absolutely aligned, svHolder's position has to be either absolute or relative
        if (self.svHolder.css('position') !== "absolute" && self.svHolder.css('position') !== "relative")
            self.svHolder.css('position', 'relative');

        // Panorama will be added to panoCanvas
        self.panoCanvas = $("<div id='pano'>").css({
            width: self.svHolder.width(),
            height: self.svHolder.height()
        })[0];

        self.panoNotAvailable = $(`<div id='pano-not-avail'>${i18next.t('common:errors.title')}</div>`).css({
            'font-size': '200%',
            'padding-bottom': '15px'
        })[0];

        self.panoNotAvailableDetails =
            $(`<div id='pano-not-avail-2'>${i18next.t('common:errors.explanation')}</div>`).css({
            'font-size': '85%',
            'padding-bottom': '15px'
        })[0];

        self.panoNotAvailableAuditSuggestion =
            $(`<div id="pano-not-avail-audit"><a id="explore-street">${i18next.t('common:errors.explore-street')}</div>`).css({
            'font-size': '85%',
            'padding-bottom': '15px'
        })[0];

        self.svHolder.append($(self.panoCanvas));
        self.svHolder.append($(self.panoNotAvailable));
        self.svHolder.append($(self.panoNotAvailableDetails));
        self.svHolder.append($(self.panoNotAvailableAuditSuggestion));

        // Load the pano viewer.
        const panoOptions = {
            accessToken: viewerAccessToken,
            scrollwheel: true,
            clickToGo: !!admin // Only allow clickToGo on admin version, not on normal LabelMap.
        };
        self.panoViewer = await viewerType.create(self.panoCanvas, panoOptions);

        self.panoViewer.addListener('pano_changed', function() {
            // Only show the label if we're looking at the correct pano.
            for (let marker of self.labelMarkers) {
                if (marker.panoId === self.panoViewer.getPanoId()) {
                    marker.marker.setVisible(true);
                } else {
                    marker.marker.setVisible(false);
                }
            }
        });

        return this;
    }

    /**
     * Clears all labels from the panorama.
     */
    function clearLabels() {
        for (const marker of self.labelMarkers) {
            marker.marker.removeMarker();
        }
        self.labelMarkers = [];
    }

    /**
     * Sets the panorama ID and POV from label metadata.
     * @param panoId
     * @param {{heading: number, pitch: number, zoom: number}} pov
     */
    async function setPano(panoId, pov) {
        self.svHolder.css('visibility', 'hidden'); // Hide until we've finished rendering.
        return self.panoViewer.setPano(panoId).then(() => _panoSuccessCallback(pov), _panoFailureCallback).then(() => {
            self.svHolder.css('visibility', 'visible');
        });
    }

    /**
     * Refreshes all views for the new pano and saves historic pano metadata.
     * @param {{heading: number, pitch: number, zoom: number}} targetPov The desired pov to set for the pano
     * @returns {Promise<void>}
     * @private
     */
    async function _panoSuccessCallback(targetPov) {
        // Show the pano, hide the error messages.
        $(self.panoCanvas).css('display', 'block');
        $(self.panoNotAvailable).css('display', 'none');
        $(self.panoNotAvailableDetails).css('display', 'none');
        $(self.panoNotAvailableAuditSuggestion).css('display', 'none');
        $(self.buttonHolder).css('display', 'block');

        // There is a bug that can sometimes cause Google's panos to go black when you load a new one. We can deal with
        // it by triggering a resize event after a short delay. This seems to only be an issue with the label popup, not
        // with Explore/Gallery/Validate. Probably because of how we show/hide the popup.
        return new Promise((resolve) => {
            if (viewerType === GsvViewer) {
                setTimeout(() => {
                    google.maps.event.trigger(self.panoViewer.panorama, 'resize');
                    self.panoViewer.setPov(targetPov);
                    if (self.label) renderLabel(self.label);
                    resolve();
                }, 250);
            } else {
                resolve();
            }
        });
    }

    /**
     * Shows an error message if the pano fails to load.
     * @param error
     * @returns {Promise<void>}
     * @private
     */
    async function _panoFailureCallback(error) {
        $(self.svHolder).css('height', '');
        $(self.panoNotAvailable).text(i18next.t("common:errors.title"));
        $(self.panoCanvas).css('display', 'none');
        $(self.panoNotAvailable).css('display', 'block');
        $(self.panoNotAvailableDetails).css('display', 'block');
        $("#explore-street").attr('href', '/explore?streetEdgeId=' + self.label['streetEdgeId']);
        $(self.panoNotAvailableAuditSuggestion).css('display', 'block');
        $(self.buttonHolder).css('display', 'none');
        return Promise.resolve();
    }

    function setLabel(label) {
        self.label = label;
    }

    /**
     * Renders a PanoMarker (label) onto a Streetview Panorama.
     * @param {AdminPanoramaLabel} label
     * @returns void
     */
    function renderLabel(label) {
        const pos = getPosition(label.canvasX, label.canvasY, label.originalCanvasWidth,
            label.originalCanvasHeight, label.pov);
        self.labelMarkers.push({
            panoId: self.panoViewer.getPanoId(),
            marker: new PanoMarker({
                markerContainer: self.panoCanvas,
                panoViewer: self.panoViewer,
                position: { heading: pos.heading, pitch: pos.pitch },
                icon: icons[label['label_type']],
                size: { width: 20, height: 20 }
            })
        });
    }

    /**
     * Calculates heading and pitch for a Google Maps marker using (x, y) coordinates. From PanoMarker spec.
     * @param canvas_x          X coordinate (pixel) for label
     * @param canvas_y          Y coordinate (pixel) for label
     * @param canvas_width      Original canvas width
     * @param canvas_height     Original canvas height
     * @param {{heading: number, pitch: number, zoom: number}} pov Original pov of the label
     * @returns {{heading: number, pitch: number}}
     */
    function getPosition(canvas_x, canvas_y, canvas_width, canvas_height, pov) {
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
        var fov = get3dFov(pov.zoom) * PI / 180.0;
        var width = canvas_width;
        var height = canvas_height;
        var h0 = pov.heading * PI / 180.0;
        var p0 = pov.pitch * PI / 180.0;
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
     * Calculates heading & position for placing this Label onto the pano from the same POV when the label was placed.
     * @returns {{heading: number, pitch: number}}
     */
    function getOriginalPosition() {
        return getPosition(self.label.canvasX, self.label.canvasY, self.label.originalCanvasWidth,
            self.label.originalCanvasHeight, self.label.pov);
    }

    /**
     * From PanoMarker spec.
     * @param zoom
     * @returns {number}
     */
    function get3dFov (zoom) {
        return zoom <= 2 ?
            126.5 - zoom * 36.75 :  // linear descent
            195.93 / Math.pow(1.92, zoom); // parameters determined experimentally
    }

    /**
     * Returns the pov of the viewer.
     * @returns {{heading: float, pitch: float, zoom: float}}
     */
    function getPov() {
        let pov = self.panorama.getPov();

        // Adjust heading to be between 0 and 360.
        while (pov.heading < 0) pov.heading += 360;
        while (pov.heading > 360) pov.heading -= 360;

        return pov;
    }

    await _init();

    self.setPano = setPano;
    self.setLabel = setLabel;
    self.renderLabel = renderLabel;
    self.getOriginalPosition = getOriginalPosition;
    self.getPov = getPov;
    self.clearLabels= clearLabels;

    return self;
}
