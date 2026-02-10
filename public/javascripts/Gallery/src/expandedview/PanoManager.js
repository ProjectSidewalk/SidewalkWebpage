/**
 * A holder class that inserts a pano into the supplied DOM element. Manages access to PanoViewer in Gallery.
 */
class PanoManager {
    static icons = {
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
     * Creates the HTML elements necessary to hold the PanoViewer.
     * @param {HTMLElement} svHolder The DOM element that the pano will be placed in.
     * @constructor
     */
    constructor(svHolder) {
        this.labelMarker = undefined;

        this.svHolder = $(svHolder);
        this.svHolder.addClass('admin-panorama');

        // svHolder's children are absolutely aligned, svHolder's position has to be either absolute or relative.
        if (this.svHolder.css('position') !== "absolute" && this.svHolder.css('position') !== "relative") {
            this.svHolder.css('position', 'relative');
        }

        // Pano will be added to panoCanvas.
        this.panoCanvas = $("<div id='pano'>").css({
            position: 'relative',
            top: '0px',
            width: '100%',
            height: '60vh'
        })[0];

        this.panoNotAvailable = $(`<div id='pano-not-avail'>${i18next.t('common:errors.title')}</div>`).css({
            'font-size': '200%',
            'padding-bottom': '15px'
        })[0];
        this.panoNotAvailableDetails =
            $(`<div id='pano-not-avail-2'>${i18next.t('common:errors.explanation')}</div>`).css({
                'font-size': '85%',
                'padding-bottom': '15px'
            })[0];

        this.svHolder.append($(this.panoCanvas));
        this.svHolder.append($(this.panoNotAvailable));
        this.svHolder.append($(this.panoNotAvailableDetails));
    }

    /**
     * Initializes the PanoViewer in Gallery.
     * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize
     * @param {string} viewerAccessToken An access token used to request images for the pano viewer.
     * @returns {Promise<void>}
     */
    async #init(panoViewerType, viewerAccessToken) {
        // Load the pano viewer.
        const panoOptions = {
            accessToken: viewerAccessToken,
            scrollwheel: true,
            clickToGo: true
        };

        sg.panoViewer = await panoViewerType.create(this.panoCanvas, panoOptions);

        sg.panoViewer.addListener('pano_changed', () => {
            // We always want to update panoId when pano changes (as it is possible the pano changes
            // for a reason OTHER THAN a user clicking on a card - for example, using clickToGo on the pano).
            if (this.labelMarker !== undefined) {
                if (this.labelMarker.panoId === sg.panoViewer.getPanoId()) {
                    // We've moved to a pano with an ID that matches the current label to show, so we render the label.
                    this.labelMarker.marker.setVisible(true);
                } else {
                    // Pano ID of label doesn't match the current pano's pano ID, so we don't show the label marker.
                    this.labelMarker.marker.setVisible(false);
                }
            }
        });
    }

    /**
     * Sets the panorama ID and POV from label metadata.
     * @param {string} panoId
     * @param {{heading: number, pitch: number, zoom: number}} pov
     * @returns {Promise<PanoData>}
     */
    async setPano(panoId, pov) {
        this.svHolder.css('visibility', 'hidden');
        return sg.panoViewer.setPano(panoId).then(this.#panoSuccessCallback, this.#panoFailureCallback).then((panoData) => {
            sg.panoViewer.setPov(pov);
            this.svHolder.css('visibility', 'visible');
            return panoData;
        });
    }

    /**
     * Refreshes all views for the new pano and saves historic pano metadata.
     * @param {PanoData} panoData The PanoData extracted from the PanoViewer when loading the pano
     * @returns {Promise<PanoData>}
     * @private
     */
    #panoSuccessCallback = async (panoData) => {
        // Store the returned pano metadata.
        const panoId = panoData.getPanoId();
        sg.panoStore.addPanoMetadata(panoId, panoData);

        // Show the pano, hide the error messages.
        $(this.panoCanvas).css('display', 'block');
        $(this.panoNotAvailable).css('display', 'none');
        $(this.panoNotAvailableDetails).css('display', 'none');
        return Promise.resolve(panoData);
    }

    /**
     * Shows an error message if the pano fails to load.
     * @param {Error} error
     * @returns {Promise<void>}
     * @private
     */
    #panoFailureCallback = async (error) => {
        console.error('failed to load pano!', error);
        $(this.svHolder).css('height', '');
        $(this.panoNotAvailable).text(i18next.t('common:errors.title'));
        $(this.panoCanvas).css('display', 'none');
        $(this.panoNotAvailable).css('display', 'block');
        $(this.panoNotAvailableDetails).css('display', 'block');
        return Promise.resolve();
    }

    /**
     * Renders a PanoMarker (label) onto Google Streetview Panorama.
     * @param {AdminPanoramaLabel} label
     * @returns {void}
     */
    renderLabel(label) {
        // Get the PanoMarker icon url.
        const url = PanoManager.icons[label.label_type];
        const pos = util.pano.canvasCoordToCenteredPov(
            label.pov, label.canvasX, label.canvasY, label.originalCanvasWidth, label.originalCanvasHeight
        );
        const panoId = sg.panoViewer.getPanoId();

        if (!this.labelMarker) {
            // No PanoMarker has been added to the expanded view, so we create a new one.
            this.labelMarker = {
                panoId: panoId,
                marker: new PanoMarker({
                    markerContainer: this.panoCanvas,
                    panoViewer: sg.panoViewer,
                    position: { heading: pos.heading, pitch: pos.pitch },
                    icon: url,
                    size: { width: 20, height: 20 }
                })
            };
        } else {
            // Adjust the existing PanoMarker.
            this.labelMarker.panoId = panoId;
            this.labelMarker.marker.setPosition({ heading: pos.heading, pitch: pos.pitch });
            this.labelMarker.marker.setIcon(url);
        }

        // Make our newly set PanoMarker visible.
        this.labelMarker.marker.setVisible(true);
        this.#updateMarkerAiIndicator(label.aiGenerated);
    }

    /**
     * Adds or removes the AI badge on the marker.
     * @param showIndicator  True to show the AI badge, false to remove it.
     * @private
     */
    #updateMarkerAiIndicator(showIndicator) {
        const markerEl = this.labelMarker.marker.marker_;
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
     * @returns {{heading: number, pitch: number, zoom: number}} The current pov
     */
    getPov() {
        let pov = sg.panoViewer.getPov();

        // Adjust heading to be between 0 and 360.
        while (pov.heading < 0) pov.heading += 360;
        while (pov.heading > 360) pov.heading -= 360;
        return pov;
    }

    // Increment zoom by 1 or to the maximum zoom level (3).
    zoomIn() {
        sg.tracker.push('KeyboardShortcutZoomIn');
        const currPov = sg.panoViewer.getPov();
        currPov.zoom = Math.min(3, currPov.zoom + 1);
        sg.panoViewer.setPov(currPov);
    }

    // Decrement zoom level by 1 or to the minimum zoom level (1).
    zoomOut() {
        sg.tracker.push('KeyboardShortcutZoomOut');
        const currPov = sg.panoViewer.getPov();
        currPov.zoom = Math.max(1, currPov.zoom - 1);
        sg.panoViewer.setPov(currPov);
    }

    /**
     * Factory function that sets up the panorama viewer.
     *
     * @param {HTMLElement} svHolder The DOM element that the pano will be placed in.
     * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize
     * @param {string} viewerAccessToken An access token used to request images for the pano viewer.
     * @returns {Promise<PanoManager>} The gallery panorama that was generated.
     */
    static async create(svHolder, panoViewerType, viewerAccessToken) {
        const newPanoManager = new this(svHolder);
        await newPanoManager.#init(panoViewerType, viewerAccessToken);
        return newPanoManager;
    }
}
