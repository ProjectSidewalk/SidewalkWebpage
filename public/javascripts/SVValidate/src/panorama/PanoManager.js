/**
 * Holds the list of labels to be validated, and distributes them to the panoramas that are on the page. Fetches labels
 * from the backend and converts them into Labels that can be placed onto the Panorama.
 *
 * @param panoViewerType The type of pano viewer to initialize
 * @param viewerAccessToken An access token used to request images for the pano viewer
 * @returns {PanoManager}
 * @constructor
 */
async function PanoManager (panoViewerType, viewerAccessToken) {
    let properties = {
        prevSetPanoTimestamp: new Date(), // TODO I think that this is just used to estimate if the pano loaded (we give it 500 ms), but we should use promises.
    };

    let panoCanvas = document.getElementById('svv-panorama');
    let bottomLinksClickable = false;
    let linksListener = null;

    let self = this;

    /**
     * Initializes panoViewer on the validate page.
     * @private
     */
    async function _init() {
        // Load the pano viewer.
        const panoOptions = {
            accessToken: viewerAccessToken,
            linksControl: false
        };

        svv.panoViewer = await panoViewerType.create(panoCanvas, panoOptions);
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
            _sizePano();
        }

        // TODO we probably need to do this for any viewer type...
        if (panoViewerType === GsvViewer && !isMobile()) {
            linksListener = svv.panoViewer.panorama.addListener('links_changed', _makeLinksClickable);
        }

        // TODO instead of renderCurrentLabel, maybe we just pass in a panoId to start? Or that's just passed to the panoViewer?
        // await renderCurrentLabel(currentLabel);
    }

    /**
     * Gets a specific property from the PanoManager.
     * @param key   Property name.
     * @returns     Value associated with this property or null.
     */
    function getProperty(key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Sets a property for the PanoManager.
     * @param key   Name of property
     * @param value Value of property.
     * @returns {setProperty}
     */
    function setProperty(key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Returns the underlying PanoMarker object.
     * @returns {PanoMarker}
     */
    function getPanomarker() {
        return self.labelMarker;
    }

    /**
     * Saves historic pano metadata and updates the date text field on the pano in pano viewer.
     * @param {PanoData} panoData The PanoData extracted from the PanoViewer when loading the pano
     * @private
     */
    function _setPanoCallback(panoData) {
        const panoId = panoData.getProperty('panoId');

        // Store the returned pano metadata.
        svv.panoStore.addPanoMetadata(panoId, panoData);

        if (!isMobile()) {
            // Add the capture date of the image to the bottom-right corner of the UI.
            svv.ui.viewer.date.text(panoData.getProperty('captureDate').format('MMM YYYY'));

            // Remove Keyboard shortcuts link and make Terms of Use & Report a problem links clickable.
            // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2546
            // Uses setTimeout because it usually hasn't quite loaded yet.
            // if (!bottomLinksClickable) {
            //     setTimeout(function() {
            //         try {
            //             $('.gm-style-cc')[0].remove();
            //             $("#view-control-layer").append($($('.gm-style-cc')[0]).parent().parent());
            //             bottomLinksClickable = true;
            //         } catch (e) {
            //             bottomLinksClickable = false;
            //         }
            //     }, 100);
            // }
        }
    }

    /**
     * Moves the buttons on the bottom-right of the GSV image to the top layer so they are clickable.
     * @private
     */
    const _makeLinksClickable = function() {
        let bottomLinks = $('.gm-style-cc');
        if (!bottomLinksClickable && bottomLinks.length > 3) {
            bottomLinksClickable = true;
            bottomLinks[0].remove(); // Remove GSV keyboard shortcuts link.
            $("#view-control-layer").append($(bottomLinks[1]).parent().parent()); // Makes remaining links clickable.
        }

        google.maps.event.removeListener(linksListener);
    }

    /**
     * Renders a label onto the screen using a Panomarker.
     * @returns {renderPanoMarker}
     */
    function renderPanoMarker(currentLabel) {
        let url = currentLabel.getIconUrl();
        let pov = currentLabel.getOriginalPov();

        // Set to user's POV when labeling if on desktop. If on mobile, center the label on the screen.
        if (isMobile()) {
            svv.panoViewer.setPov(pov);
        } else {
            svv.panoViewer.setPov({
                heading: currentLabel.getAuditProperty('heading'),
                pitch: currentLabel.getAuditProperty('pitch'),
                zoom: currentLabel.getAuditProperty('zoom')
            });
        }

        if (!self.labelMarker) {
            let markerLayer = isMobile() ? document.getElementById('view-control-layer-mobile') : document.getElementById('view-control-layer');
            self.labelMarker = new PanoMarker({
                id: "validate-pano-marker",
                markerContainer: markerLayer,
                panoViewer: svv.panoViewer,
                position: { heading: pov.heading, pitch: pov.pitch },
                icon: url,
                size: { width: currentLabel.getRadius() * 2 + 2, height: currentLabel.getRadius() * 2 + 2 },
                zIndex: 2
            });
        } else {
            self.labelMarker.setPosition({ heading: pov.heading, pitch: pov.pitch });
            self.labelMarker.setIcon(url);
        }

        return this;
    }

    /**
     * Sets the panorama ID. Adds a callback function that will record pano metadata and update the date text field.
     * @param panoId    String representation of the Panorama ID
     */
    async function setPanorama(panoId) {
        return svv.panoViewer.setPano(panoId).then(_setPanoCallback).then(() => {
        // return svv.panoViewer.setLocation({ lat: 47.47149597503096, lng: 8.30860179865082 }).then(_setPanoCallback).then(() => {
        // return svv.panoViewer.setPano('d039ceb9-7926-6a1f-2685-0ecc2d3cd181').then(_setPanoCallback).then(() => {
            setProperty("prevSetPanoTimestamp", new Date());
            svv.tracker.push('PanoId_Changed');
        });
    }

    /**
     * Sets the zoom level for this panorama.
     * @param zoom  Desired zoom level for this panorama. In general, values in {1.1, 2.1, 3.1}
     */
    function setZoom(zoom) {
        const currPov = svv.panoViewer.getPov();
        currPov.zoom = zoom;
        svv.panoViewer.setPov(currPov);
    }

    /**
     * Sets the size of the panorama and panorama holder depending on the size of the mobile phone.
     * @private
     */
    function _sizePano() {
        let heightOffset = document.getElementById("svv-panorama-holder").getBoundingClientRect().top;
        let h = window.innerHeight - heightOffset - 10;
        let w = window.innerWidth - 10;
        let outline_h = h + 10;
        let outline_w = w + 10;
        let left = 0;
        document.getElementById("svv-panorama").style.height = h + "px";
        document.getElementById("svv-panorama-holder").style.height = h + "px";
        document.getElementById("svv-panorama-outline").style.height = outline_h + "px";
        document.getElementById("svv-panorama").style.width = w + "px";
        document.getElementById("svv-panorama-holder").style.width = w + "px";
        document.getElementById("svv-panorama-outline").style.width = outline_w + "px";
        document.getElementById("svv-panorama").style.left = left + "px";
        document.getElementById("svv-panorama-holder").style.left = left + "px";
        document.getElementById("svv-panorama-outline").style.left = left + "px";
    }

    self.getProperty = getProperty;
    self.setProperty = setProperty;
    self.setPanorama = setPanorama;
    self.getPanomarker = getPanomarker;
    self.renderPanoMarker = renderPanoMarker;
    self.setZoom = setZoom;

    await _init();

    return this;
}
