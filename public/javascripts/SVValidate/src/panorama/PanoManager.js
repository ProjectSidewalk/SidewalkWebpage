/**
 * Creates the PanoViewer and manages access to it, tracking metadata and drawing labels as PanoMarkers.
 */
class PanoManager {
    /** @type {{panoLoaded: boolean}} */
    #properties = {
        panoLoaded: false
    };

    /** @type {HTMLElement} The primary viewer's canvas element (GSV/Mapillary/Infra3d). */
    #panoCanvas;

    /** @type {HTMLElement} Sibling canvas for the Pannellum fallback viewer. */
    #pannellumCanvas;

    /** @type {PanoViewer} The primary viewer, always kept alive. */
    #primaryViewer;

    /** @type {PannellumViewer|undefined} Pannellum fallback viewer — lazy-created on first expired pano. */
    #pannellumViewer;

    /** @type {PanoViewer|undefined} Tracks which viewer the current label marker was created for. */
    #markerViewer;

    #bottomLinksClickable = false;
    #linksListener = null;

    /**
     * Initializes panoViewer on the validate page and loads the first pano.
     *
     * Tries the primary viewer first; if the first pano is expired and a backup image is available, falls back to
     * Pannellum so that a pano is always loaded before this resolves.
     *
     * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize
     * @param {string} viewerAccessToken An access token used to request images for the pano viewer
     * @param {string} startPanoId The ID of the panorama to load first
     * @param {{url: string, metadata: object}|null} startBackupImage Self-hosted backup for the first pano, or null.
     * @returns {Promise<void>} A Promise that resolves once the first pano has loaded
     */
    async #init(panoViewerType, viewerAccessToken, startPanoId, startBackupImage) {
        // Create the primary viewer without a startPanoId so viewer construction never fails due to an expired pano.
        const panoOptions = {
            accessToken: viewerAccessToken,
            defaultNavigation: false,
            scrollwheel: isMobile()
        };

        this.#panoCanvas = document.getElementById('svv-panorama');

        // Sibling canvas for the Pannellum fallback viewer, hidden until an expired pano needs it.
        this.#pannellumCanvas = document.createElement('div');
        this.#pannellumCanvas.id = 'svv-panorama-pannellum';
        this.#pannellumCanvas.style.cssText =
            'position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: none;';
        this.#panoCanvas.insertAdjacentElement('afterend', this.#pannellumCanvas);

        this.#primaryViewer = await panoViewerType.create(this.#panoCanvas, panoOptions);
        svv.panoViewer = this.#primaryViewer;

        // Load the first pano, falling back to Pannellum if the primary viewer fails.
        try {
            const panoData = await this.#primaryViewer.setPano(startPanoId);
            this.#setPanoCallback(panoData);
        } catch (_) {
            if (startBackupImage) {
                const panoData = await this.#showPannellumPano(startBackupImage);
                this.#setPanoCallback(panoData);
            }
        }
        if (panoViewerType === GsvViewer) {
            $('#imagery-source-logo-holder').remove();
        } else if (panoViewerType === MapillaryViewer) {
            $('#imagery-source-logo').attr('src', '/assets/images/logos/mapillary-logo-white.png')
                .attr('alt', 'Mapillary logo');
            $('#imagery-source-logo-holder').css        ('padding-left', '5px');
        } else if (panoViewerType === Infra3dViewer) {
            $('#imagery-source-logo').attr('src', '/assets/images/logos/infra3d-logo.svg')
                .attr('alt', 'infra3D logo');
        }

        svv.panoViewer.addListener('pov_changed', () => svv.tracker.push('POV_Changed'));
        if (isMobile()) {
            this.#sizePano();
        }

        // TODO we probably need to do this for any viewer type...
        if (panoViewerType === GsvViewer && !isMobile()) {
            this.#linksListener = this.#primaryViewer.gsvPano.addListener('links_changed', this.#makeLinksClickable.bind(this));
        }
    }

    /**
     * Gets a specific property from the PanoManager.
     * @param {string} key   Property name.
     * @returns {*} Value associated with this property or null.
     */
    getProperty(key) {
        return key in this.#properties ? this.#properties[key] : null;
    }

    /**
     * Sets a property for the PanoManager.
     * @param {string} key Name of property
     * @param {*} value Value of property
     */
    setProperty(key, value) {
        this.#properties[key] = value;
    }

    /** Returns the viewer_type enum value for the currently active viewer: 'Pannellum' or 'Default'. */
    getActiveViewerName() {
        if (!svv.panoViewer) return '';
        return svv.panoViewer === this.#pannellumViewer ? 'Pannellum' : 'Default';
    }

    /**
     * Returns the underlying PanoMarker object.
     * @returns {PanoMarker}
     */
    getPanoMarker() {
        return this.labelMarker;
    }

    /**
     * Saves historic pano metadata and updates the date text field on the pano in pano viewer.
     * @param {PanoData} panoData The PanoData extracted from the PanoViewer when loading the pano
     * @returns {PanoData}
     * @private
     */
    #setPanoCallback(panoData) {
        // Store the returned pano metadata.
        const panoId = panoData.getPanoId();
        svv.panoStore.addPanoMetadata(panoId, panoData);

        if (!isMobile()) {
            // Add the capture date of the image to the bottom-right corner of the UI.
            svv.ui.viewer.date.text(panoData.getProperty('captureDate').format('MMM YYYY'));
        }

        return panoData;
    }

    /**
     * Moves the buttons on the bottom-right of the GSV image to the top layer so they are clickable.
     * @private
     */
    #makeLinksClickable() {
        let bottomLinks = $('.gm-style-cc');
        if (!this.#bottomLinksClickable && bottomLinks.length > 3) {
            this.#bottomLinksClickable = true;
            bottomLinks[0].remove(); // Remove GSV keyboard shortcuts link.
            svv.ui.viewer.controlLayer.append($(bottomLinks[1]).parent().parent()); // Makes remaining links clickable.
        }

        google.maps.event.removeListener(this.#linksListener);
    }

    /**
     * Renders a label onto the screen using a PanoMarker.
     * @param {Label} currentLabel The label to render.
     */
    renderPanoMarker(currentLabel) {
        const url = currentLabel.getIconUrl();
        const labelPov = currentLabel.getOriginalPov();

        // Set to user's POV when labeling if on desktop. If on mobile, center the label on the screen.
        if (isMobile()) {
            svv.panoViewer.setPov(labelPov);
        } else {
            svv.panoViewer.setPov({
                heading: currentLabel.getAuditProperty('heading'),
                pitch: currentLabel.getAuditProperty('pitch'),
                zoom: currentLabel.getAuditProperty('zoom')
            });
        }

        // If the active viewer changed (primary ↔ Pannellum switch), discard the old marker so a new one is created
        // bound to the correct viewer's POV-tracking callbacks.
        if (this.labelMarker && this.#markerViewer !== svv.panoViewer) {
            this.labelMarker.removeMarker();
            this.labelMarker = null;
        }

        if (!this.labelMarker) {
            const markerLayer = document.getElementById('view-control-layer');
            this.labelMarker = new PanoMarker({
                id: 'validate-pano-marker',
                markerContainer: markerLayer,
                panoViewer: svv.panoViewer,
                position: { heading: labelPov.heading, pitch: labelPov.pitch },
                icon: url,
                size: { width: svv.labelRadius * 2 + 2, height: svv.labelRadius * 2 + 2 },
                zIndex: 2
            });
            this.#markerViewer = svv.panoViewer;
        } else {
            this.labelMarker.setPosition({ heading: labelPov.heading, pitch: labelPov.pitch });
            this.labelMarker.setIcon(url);
        }
        this.#updateMarkerAiIndicator(currentLabel.getAuditProperty('aiGenerated'));
    }

    /**
     * Sets the panorama. Tries the primary viewer first; falls back to Pannellum if there's a backup image available.
     * @param {string} panoId The ID for the panorama that we want to move to.
     * @param {{url: string, metadata: object}|null} backupImage Self-hosted pano data from the backend, or null.
     * @returns {Promise<PanoData|undefined>}
     */
    async setPanorama(panoId, backupImage = null) {
        this.setProperty('panoLoaded', false);

        // Try the primary viewer first.
        try {
            const panoData = await this.#primaryViewer.setPano(panoId);
            this.#teardownPannellum();
            this.#setPanoCallback(panoData);
            this.setProperty('panoLoaded', true);
            svv.tracker.push('PanoId_Changed');
            return panoData;
        } catch (_) {
            // Primary viewer failed — try Pannellum if we have local pano data.
            if (backupImage) {
                try {
                    const panoData = await this.#showPannellumPano(backupImage);
                    this.#setPanoCallback(panoData);
                    this.setProperty('panoLoaded', true);
                    svv.tracker.push('PanoId_Changed');
                    return panoData;
                } catch (err) {
                    console.error('PannellumViewer failed to load for Validate:', err);
                }
            }
        }

        // Both viewers failed; pano remains in broken state.
        this.setProperty('panoLoaded', false);
    }

    /**
     * Shows the primary viewer canvas and hides the Pannellum canvas; resets svv.panoViewer to the primary viewer.
     * @private
     */
    #teardownPannellum() {
        this.#pannellumCanvas.style.display = 'none';
        this.#panoCanvas.style.display = '';
        svv.panoViewer = this.#primaryViewer;
        svv.panoViewer.resize();
        svv.tracker.push('Viewer_Primary');
    }

    /**
     * Shows the Pannellum viewer for the given pano. On the first call, creates a PannellumViewer; on subsequent
     * calls, reuses it via loadPano() to avoid recreating the WebGL context. Sets svv.panoViewer to the Pannellum
     * viewer so the rest of the codebase (setPov, getPov, markers) uses the correct viewer.
     * @param {{url: string, metadata: object}} backupImage
     * @returns {Promise<PanoData>}
     * @private
     */
    async #showPannellumPano(backupImage) {
        this.#panoCanvas.style.display = 'none';
        this.#pannellumCanvas.style.display = '';

        const metadata = backupImage.metadata;
        // Use a neutral POV here; renderPanoMarker will setPov to the correct heading immediately after.
        const neutralPov = { heading: metadata.cameraHeading || 0, pitch: 0, zoom: 1 };

        if (this.#pannellumViewer) {
            await this.#pannellumViewer.loadPano(metadata.panoId, metadata, neutralPov);
        } else {
            this.#pannellumViewer = await PannellumViewer.create(this.#pannellumCanvas, {
                panoMetadata: metadata,
                startPanoId: metadata.panoId,
                startHeading: neutralPov.heading,
                startPitch: neutralPov.pitch,
                startZoom: neutralPov.zoom
            });
        }
        svv.panoViewer = this.#pannellumViewer;
        svv.tracker.push('Viewer_Pannellum');
        return svv.panoViewer.currPanoData;
    }

    /**
     * Adds or removes the AI badge on the validation marker.
     * @param showIndicator  True to show the AI badge, false to remove it.
     * @private
     */
    #updateMarkerAiIndicator(showIndicator) {
        const markerEl = this.labelMarker.marker_;
        let existingIndicator = markerEl.querySelector('.ai-icon-marker-validate');

        if (showIndicator) {
            if (!existingIndicator) {
                existingIndicator = AiLabelIndicator(['ai-icon-marker-validate']);
                markerEl.appendChild(existingIndicator);
                const $indicator = ensureAiTooltip(existingIndicator);
                $(markerEl).on('mouseenter', () => $indicator.tooltip('show'));
                $(markerEl).on('mouseleave', () => $indicator.tooltip('hide'));
            }
        } else if (existingIndicator) {
            $(existingIndicator).tooltip('destroy');
            existingIndicator.remove();
        }
    }

    /**
     * Sets the zoom level for this panorama.
     * @param zoom  Desired zoom level for this panorama. In general, values in {1.1, 2.1, 3.1}
     * @returns {void}
     */
    setZoom(zoom) {
        const currPov = svv.panoViewer.getPov();
        currPov.zoom = zoom;
        svv.panoViewer.setPov(currPov);
    }

    /**
     * Sets the size of the panorama and panorama holder depending on the size of the mobile phone.
     * @private
     */
    #sizePano() {
        let panoHolderElem = document.getElementById('svv-panorama-holder');
        let controlLayerElem = document.getElementById('view-control-layer');
        let panoOutlineElem = document.getElementById('svv-panorama-outline');
        let heightOffset = panoHolderElem.getBoundingClientRect().top;
        const h = window.innerHeight - heightOffset - 10;
        const w = window.innerWidth - 10;
        const outlineH = h + 10;
        const outlineW = w + 10;
        const left = 0;
        this.#panoCanvas.style.height = h + 'px';
        this.#pannellumCanvas.style.height = h + 'px';
        panoHolderElem.style.height = h + 'px';
        controlLayerElem.style.height = h + 'px';
        panoOutlineElem.style.height = outlineH + 'px';
        this.#panoCanvas.style.width = w + 'px';
        this.#pannellumCanvas.style.width = w + 'px';
        panoHolderElem.style.width = w + 'px';
        controlLayerElem.style.width = w + 'px';
        panoOutlineElem.style.width = outlineW + 'px';
        this.#panoCanvas.style.left = left + 'px';
        panoHolderElem.style.left = left + 'px';
        controlLayerElem.style.left = left + 'px';
        panoOutlineElem.style.left = left + 'px';
    }

    /**
     * Factory function that sets up the panorama viewer.
     * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize
     * @param {string} viewerAccessToken An access token used to request images for the pano viewer
     * @param {string} startPanoId The ID of the panorama to load first
     * @param {{url: string, metadata: object}|null} startBackupImage Self-hosted backup for the first pano, or null.
     * @returns {Promise<PanoManager>} The panoManager instance, with the first pano already loaded.
     */
    static async create(panoViewerType, viewerAccessToken, startPanoId, startBackupImage = null) {
        const newPanoManager = new PanoManager();
        await newPanoManager.#init(panoViewerType, viewerAccessToken, startPanoId, startBackupImage);
        return newPanoManager;
    }
}
