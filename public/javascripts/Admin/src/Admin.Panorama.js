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

        self.panoViewer.addListener('pano_changed', () => {
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
                    google.maps.event.trigger(self.panoViewer.gsvPano, 'resize');
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
        const pos = util.pano.canvasCoordToCenteredPov(
            label.pov, label.canvasX, label.canvasY, label.originalCanvasWidth, label.originalCanvasHeight
        );
        const panoMarker = new PanoMarker({
            markerContainer: self.panoCanvas,
            panoViewer: self.panoViewer,
            position: { heading: pos.heading, pitch: pos.pitch },
            icon: icons[label['label_type']],
            size: { width: 20, height: 20 }
        });
        self.labelMarkers.push({
            panoId: self.panoViewer.getPanoId(),
            marker: panoMarker
        });
        if (label.aiGenerated) attachAiIndicatorToMarker(panoMarker);
    }

    function attachAiIndicatorToMarker(panoMarker) {
        if (!panoMarker.marker_.querySelector('.admin-ai-icon-marker')) {
            const indicator = AiLabelIndicator(['admin-ai-icon-marker']);
            panoMarker.marker_.appendChild(indicator);
            const $indicator = ensureAiTooltip(indicator);
        }
    }

    /**
     * Calculates heading & position for placing this Label onto the pano from the same POV when the label was placed.
     * @returns {{heading: number, pitch: number}}
     */
    function getOriginalPosition() {
        return util.pano.canvasCoordToCenteredPov(self.label.pov, self.label.canvasX, self.label.canvasY,
            self.label.originalCanvasWidth, self.label.originalCanvasHeight);
    }

    /**
     * Returns the pov of the viewer.
     * @returns {{heading: float, pitch: float, zoom: float}}
     */
    function getPov() {
        let pov = self.panoViewer.getPov();

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
