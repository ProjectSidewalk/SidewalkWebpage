/**
 * A holder class that inserts a pano into the supplied DOM element.
 *
 * @param {HTMLElement} svHolder The DOM element that the pano will be placed in.
 * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize
 * @param {string} viewerAccessToken An access token used to request images for the pano viewer.
 * @returns {PanoManager} The gallery panorama that was generated.
 */
 async function PanoManager(svHolder, panoViewerType, viewerAccessToken) {
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
            accessToken: viewerAccessToken,
            scrollwheel: true,
            clickToGo: true
        };

        sg.panoViewer = await panoViewerType.create(self.panoCanvas, panoOptions);

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
        const pos = util.pano.canvasCoordToCenteredPov(
            label.pov, label.canvasX, label.canvasY, label.originalCanvasWidth, label.originalCanvasHeight
        );
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
                    size: { width: 20, height: 20 }
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
        updateMarkerAiIndicator(label.aiGenerated);
    }

    /**
     * Adds or removes the AI badge on the marker.
     * @param showIndicator  True to show the AI badge, false to remove it.
     */
    function updateMarkerAiIndicator(showIndicator) {
        const markerEl = self.labelMarker.marker.marker_;
        let existingIndicator = markerEl.querySelector('.ai-icon-marker-expanded');

        if (showIndicator) {
            if (!existingIndicator) {
                existingIndicator = AiLabelIndicator(['ai-icon', 'ai-icon-marker', 'ai-icon-marker-expanded']);
                markerEl.appendChild(existingIndicator);
                const $indicator = $(existingIndicator)
                    .tooltip({
                        template: '<div class="tooltip ai-tooltip" role="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>',
                        container: 'body'
                    })
                    .tooltip('hide');
                $(markerEl).on('mouseenter', () => $indicator.tooltip('show'));
                $(markerEl).on('mouseleave', () => $indicator.tooltip('hide'));
            }
        } else if (existingIndicator) {
            $(existingIndicator).tooltip('destroy');
            existingIndicator.remove();
            existingIndicator = null;
        }
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
