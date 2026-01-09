/**
 * A holder class that inserts a pano into the supplied DOM element.
 *
 * @param {HTMLElement} svHolder The DOM element that the pano will be placed in.
 * @returns {PanoManager} The gallery panorama that was generated.
 */
 async function PanoManager(svHolder) {
    let self = {
        className: "PanoManager",
        labelMarker: undefined,
        panoId: undefined,
        panorama: undefined,
    };

    const icons = {
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
     * This function initializes the Panorama.
     */
    async function _init() {
        self.svHolder = $(svHolder);
        self.svHolder.addClass('admin-panorama');

        // svHolder's children are absolutely aligned, svHolder's position has to be either absolute or relative.
        if (self.svHolder.css('position') !== "absolute" && self.svHolder.css('position') !== "relative") {
            self.svHolder.css('position', 'relative');
        }

        // Pano will be added to panoCanvas.
        self.panoCanvas = $("<div id='pano'>").css({
            position: 'relative',
            top: '0px',
            width: '100%',
            height: '60vh'
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

        self.svHolder.append($(self.panoCanvas));
        self.svHolder.append($(self.panoNotAvailable));
        self.svHolder.append($(self.panoNotAvailableDetails));

        // Load the pano viewer.
        const panoOptions = {
            // infra3dToken: sg.infra3dToken,
            // mapillaryToken: sg.mapillaryToken,
            scrollwheel: true,
            clickToGo: true
        };

        sg.panoViewer = await GsvViewer.create(self.panoCanvas, panoOptions);

        sg.panoViewer.addListener('pano_changed', function() {
            // We always want to update panoId when pano changes (as it is possible the pano changes
            // for a reason OTHER THAN a user clicking on a card - for example, using clickToGo on the pano).
            if (self.labelMarker !== undefined) {
                if (self.labelMarker.panoId === sg.panoViewer.getPanoId()) {
                    // We've moved to a pano with an ID that matches the current label to show, so we render the label.
                    self.labelMarker.marker.setVisible(true);
                } else {
                    // Pano ID of label doesn't match the current pano's pano ID, so we don't show the label marker.
                    self.labelMarker.marker.setVisible(false);
                }
            }
        });

        return this;
    }

    /**
     * Sets the panorama ID and POV from label metadata.
     * @param panoId
     * @param {{heading: number, pitch: number, zoom: number}} pov
     */
    async function setPano(panoId, pov) {
        self.svHolder.css('visibility', 'hidden');
        return sg.panoViewer.setPano(panoId).then(_panoSuccessCallback, _panoFailureCallback).then(() => {
            sg.panoViewer.setPov(pov);
            self.svHolder.css('visibility', 'visible');
        });
    }

    /**
     * Refreshes all views for the new pano and saves historic pano metadata.
     * @param {PanoData} panoData The PanoData extracted from the PanoViewer when loading the pano
     * @returns {Promise<void>}
     * @private
     */
    async function _panoSuccessCallback(panoData) {
        // Store the returned pano metadata.
        const panoId = panoData.getProperty('panoId');
        sg.panoStore.addPanoMetadata(panoId, panoData);

        // Show the pano, hide the error messages.
        $(self.panoCanvas).css('display', 'block');
        $(self.panoNotAvailable).css('display', 'none');
        $(self.panoNotAvailableDetails).css('display', 'none');
        return Promise.resolve();
    }

    /**
     * Shows an error message if the pano fails to load.
     * @param error
     * @returns {Promise<void>}
     * @private
     */
    async function _panoFailureCallback(error) {
        console.error('failed to load pano!', error);
        $(self.svHolder).css('height', '');
        $(self.panoNotAvailable).text(i18next.t('common:errors.title'));
        $(self.panoCanvas).css('display', 'none');
        $(self.panoNotAvailable).css('display', 'block');
        $(self.panoNotAvailableDetails).css('display', 'block');
        return Promise.resolve();
    }

    /**
     * Renders a PanoMarker (label) onto Google Streetview Panorama.
     * @param {AdminPanoramaLabel} label
     * @returns void
     */
    function renderLabel(label) {
        // Get the PanoMarker icon url.
        const url = icons[label.label_type];
        const pos = getPosition(label.canvasX, label.canvasY, label.originalCanvasWidth,
            label.originalCanvasHeight, label.pov);
        const panoId = sg.panoViewer.getPanoId();

        if (!self.labelMarker) {
            // No PanoMarker has been added to the expanded view, so we create a new one.
            self.labelMarker = {
                panoId: panoId,
                marker: new PanoMarker({
                    markerContainer: self.panoCanvas,
                    panoViewer: sg.panoViewer,
                    position: { heading: pos.heading, pitch: pos.pitch },
                    icon: url,
                    size: new google.maps.Size(22, 22),
                    anchor: new google.maps.Point(10, 10)
                })
            };
        } else {
            // Adjust the existing PanoMarker.
            self.labelMarker.panoId = panoId;
            self.labelMarker.marker.setPosition({ heading: pos.heading, pitch: pos.pitch });
            self.labelMarker.marker.setIcon(url);
        }

        // Make our newly set PanoMarker visible.
        self.labelMarker.marker.setVisible(true);
    }

    /**
     * Calculates heading and pitch for a Google Maps marker using (x, y) coordinates From PanoMarker spec.
     * TODO this should use some shared code! I think same as UtilitiesPanoMarker.calculatePovIfCentered and PanoProperties.getPosition?
     * @param canvas_x          X coordinate (pixel) for label.
     * @param canvas_y          Y coordinate (pixel) for label.
     * @param canvas_width      Original canvas width.
     * @param canvas_height     Original canvas height.
     * @param {{heading: number, pitch: number, zoom: number}} pov Original pov of the label
     * @returns {{heading: number, pitch: number}}
     */
    function getPosition(canvas_x, canvas_y, canvas_width, canvas_height, pov) {
        function sgn(x) {
            return x >= 0 ? 1 : -1;
        }

        const PI = Math.PI;
        let cos = Math.cos;
        let sin = Math.sin;
        let tan = Math.tan;
        let sqrt = Math.sqrt;
        let atan2 = Math.atan2;
        let asin = Math.asin;
        const fov = get3dFov(pov.zoom) * PI / 180.0;
        const width = canvas_width;
        const height = canvas_height;
        const h0 = pov.heading * PI / 180.0;
        const p0 = pov.pitch * PI / 180.0;
        const f = 0.5 * width / tan(0.5 * fov);
        const x0 = f * cos(p0) * sin(h0);
        const y0 = f * cos(p0) * cos(h0);
        const z0 = f * sin(p0);
        const du = (canvas_x) - width / 2;
        const dv = height / 2 - (canvas_y - 5);
        const ux = sgn(cos(p0)) * cos(h0);
        const uy = -sgn(cos(p0)) * sin(h0);
        const uz = 0;
        const vx = -sin(p0) * sin(h0);
        const vy = -sin(p0) * cos(h0);
        const vz = cos(p0);
        const x = x0 + du * ux + dv * vx;
        const y = y0 + du * uy + dv * vy;
        const z = z0 + du * uz + dv * vz;
        const R = sqrt(x * x + y * y + z * z);
        const h = atan2(x, y);
        const p = asin(z / R);
        return {
            heading: h * 180.0 / PI,
            pitch: p * 180.0 / PI
        };
    }

    /**
     * From PanoMarker spec.
     * @param zoom
     * @returns {number}
     */
    function get3dFov(zoom) {
        return zoom <= 2 ?
            126.5 - zoom * 36.75 :  // linear descent.
            195.93 / Math.pow(1.92, zoom); // parameters determined experimentally.
    }

    /**
     * Get the current point of view.
     * @returns {{heading: number, pitch: number, zoom: number}} pov
     */
    function getPov() {
        let pov = sg.panoViewer.getPov();

        // Adjust heading to be between 0 and 360.
        while (pov.heading < 0) pov.heading += 360;
        while (pov.heading > 360) pov.heading -= 360;

        return pov;
    }

    // Increment zoom by 1 or to the maximum zoom level (3).
    function zoomIn() {
        sg.tracker.push('KeyboardShortcutZoomIn');
        const currPov = sg.panoViewer.getPov();
        currPov.zoom = Math.min(3, currPov.zoom + 1);
        sg.panoViewer.setPov(currPov);
    }

    // Decrement zoom level by 1 or to the minimum zoom level (1).
    function zoomOut() {
        sg.tracker.push('KeyboardShortcutZoomOut');
        const currPov = sg.panoViewer.getPov();
        currPov.zoom = Math.max(1, currPov.zoom - 1);
        sg.panoViewer.setPov(currPov);
    }

    await _init();

    self.setPano = setPano;
    self.renderLabel = renderLabel;
    self.getPov = getPov;
    self.zoomIn = zoomIn;
    self.zoomOut = zoomOut;
    return self;
}
