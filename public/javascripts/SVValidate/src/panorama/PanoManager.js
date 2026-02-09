/**
 * Creates the PanoViewer and manages access to it, tracking metadata and drawing labels as PanoMarkers.
 */
class PanoManager {
    /** @type {{panoLoaded: boolean}} */
    #properties = {
        panoLoaded: false
    };

    /** @type {HTMLElement} */
    #panoCanvas;

    #bottomLinksClickable = false;
    #linksListener = null;

    /**
     * Initializes panoViewer on the validate page.
     * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize
     * @param {string} viewerAccessToken An access token used to request images for the pano viewer
     * @param {string} startPanoId The ID of the panorama to load first
     * @returns {Promise<void>} A Promise that resolves once the PanoViewer has loaded with the first pano
     */
    async #init(panoViewerType, viewerAccessToken, startPanoId) {
        // Load the pano viewer.
        const panoOptions = {
            accessToken: viewerAccessToken,
            startPanoId: startPanoId,
            scrollwheel: isMobile()
        };

        this.#panoCanvas = document.getElementById('svv-panorama');
        svv.panoViewer = await panoViewerType.create(this.#panoCanvas, panoOptions);
        if (svv.panoViewer.currPanoData) this.#setPanoCallback(svv.panoViewer.currPanoData);
        if (panoViewerType === GsvViewer) {
            $('#imagery-source-logo-holder').hide();
        } else if (panoViewerType === MapillaryViewer) {
            $('#imagery-source-logo').attr('src', '/assets/images/logos/mapillary-logo-white.png');
            $('#imagery-source-logo-holder').css        ('padding-left', '5px');
        } else if (panoViewerType === Infra3dViewer) {
            $('#imagery-source-logo').attr('src', '/assets/images/logos/infra3d-logo.svg');
        }

        svv.panoViewer.addListener('pov_changed', () => svv.tracker.push('POV_Changed'));
        if (isMobile()) {
            this.#sizePano();
        }

        // TODO we probably need to do this for any viewer type...
        if (panoViewerType === GsvViewer && !isMobile()) {
            this.#linksListener = svv.panoViewer.panorama.addListener('links_changed', this.#makeLinksClickable.bind(this));
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
            $('#view-control-layer').append($(bottomLinks[1]).parent().parent()); // Makes remaining links clickable.
        }

        google.maps.event.removeListener(this.#linksListener);
    }

    /**
     * Renders a label onto the screen using a PanoMarker.
     * @returns {renderPanoMarker}
     */
    renderPanoMarker(currentLabel) {
        let url = currentLabel.getIconUrl();
        let labelPov = currentLabel.getOriginalPov();

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

        if (!this.labelMarker) {
            let markerLayer = isMobile() ? document.getElementById('view-control-layer-mobile') : document.getElementById('view-control-layer');
            this.labelMarker = new PanoMarker({
                id: 'validate-pano-marker',
                markerContainer: markerLayer,
                panoViewer: svv.panoViewer,
                position: { heading: labelPov.heading, pitch: labelPov.pitch },
                icon: url,
                size: { width: svv.labelRadius * 2 + 2, height: svv.labelRadius * 2 + 2 },
                zIndex: 2
            });
        } else {
            this.labelMarker.setPosition({ heading: labelPov.heading, pitch: labelPov.pitch });
            this.labelMarker.setIcon(url);
        }
        this.#updateMarkerAiIndicator(currentLabel.getAuditProperty('aiGenerated'));
    }

    /**
     * Sets the panorama ID. Adds a callback function that will record pano metadata and update the date text field.
     * @param {string} panoId The ID for the panorama that we want to move to
     * @returns {Promise<PanoData>}
     */
    async setPanorama(panoId) {
        this.setProperty('panoLoaded', false);
        return svv.panoViewer.setPano(panoId).then(this.#setPanoCallback).then((panoData) => {
            this.setProperty('panoLoaded', true);
            svv.tracker.push('PanoId_Changed');
            return panoData;
        });
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
        let controlLayerElem = document.getElementById('view-control-layer-mobile');
        let panoOutlineElem = document.getElementById('svv-panorama-outline');
        let heightOffset = panoHolderElem.getBoundingClientRect().top;
        const h = window.innerHeight - heightOffset - 10;
        const w = window.innerWidth - 10;
        const outlineH = h + 10;
        const outlineW = w + 10;
        const left = 0;
        this.#panoCanvas.style.height = h + 'px';
        panoHolderElem.style.height = h + 'px';
        controlLayerElem.style.height = h + 'px';
        panoOutlineElem.style.height = outlineH + 'px';
        this.#panoCanvas.style.width = w + 'px';
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
     * @returns {Promise<PanoManager>} The panoManager instance.
     */
    static async create(panoViewerType, viewerAccessToken, startPanoId) {
        const newPanoManager = new PanoManager();
        await newPanoManager.#init(panoViewerType, viewerAccessToken, startPanoId);
        return newPanoManager;
    }
}
