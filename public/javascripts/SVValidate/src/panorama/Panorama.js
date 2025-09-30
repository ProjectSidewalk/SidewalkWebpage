/**
 * Creates and controls the Google Street View panorama that is used in the validation interfaces. Uses Panomarkers to
 * place labels on the Panorama.
 * @param label Initial label to load onto the panorama.
 * @constructor
 */
async function Panorama (label) {
    let currentLabel = label;
    let lastLabel = {};
    let panorama = undefined;
    let properties = {
        panoId: undefined,
        prevPanoId: undefined,
        prevSetPanoTimestamp: new Date(),
        validationTimestamp: new Date()
    };

    let panoCanvas = document.getElementById('svv-panorama');

    let self = this;
    let bottomLinksClickable = false;

    /**
     * Initializes a Google StreetView Panorama and renders a label onto the screen.
     * @private
     */
    async function _init() {
        svv.panoViewer = await GsvViewer.create(panoCanvas);
        panorama = svv.panoViewer.panorama;
        panorama.addListener('pov_changed', _handlerPovChange); // TODO will be easy to migrate this to pano viewer class
        if (isMobile()) {
            sizePano();
        }

        setLabel(currentLabel);
    }

    /**
     * Returns the label object for the label that is loaded on this panorama.
     * @returns {Label}
     */
    function getCurrentLabel() {
        return currentLabel;
    }

    /**
     * Returns the underlying PanoMarker object.
     * @returns {PanoMarker}
     */
    function getPanomarker() {
        return self.labelMarker;
    }

    /**
     * Gets a specific property from this Panorama.
     * @param key   Property name.
     * @returns     Value associated with this property or null.
     */
    function getProperty(key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Gets the previous validated label from this Panorama.
     * @returns     Last validated label from this mission.
     */
    function getLastLabel() {
        return self.lastLabel;
    }

    /**
     * Sets the previous label variable to a new label.
     * @param newLastLabel Last validated label from this mission.
     */
    function setLastLabel(newLastLabel) {
        self.lastLabel = newLastLabel;
    }

    /**
     * Logs when a pano has changed, saves pano metadata, and updated the date text field on the pano.
     * @param data The pano data returned from the StreetViewService
     * @private
     */
    function _setPanoCallback(data) {
        let panoData = data.data;
        svv.tracker.push('PanoId_Changed');

        // Save the current panorama's history.
        var panoHist = {};
        panoHist.curr_pano_id = panorama.getPano();
        panoHist.pano_history_saved = new Date();
        panoHist.history = panoData.time.map((oldPano) => {
            return { pano_id: oldPano.pano, date: moment(oldPano.Gw).format('YYYY-MM') };
        });
        svv.panoramaContainer.addPanoHistory(panoHist);
        if (!isMobile()) {
            document.getElementById("svv-panorama-date").innerText = moment(panoData.imageDate).format('MMM YYYY');
            // Remove Keyboard shortcuts link and make Terms of Use & Report a problem links clickable.
            // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2546
            // Uses setTimeout because it usually hasn't quite loaded yet.
            if (!bottomLinksClickable) {
                setTimeout(function() {
                    try {
                        $('.gm-style-cc')[0].remove();
                        $("#view-control-layer").append($($('.gm-style-cc')[0]).parent().parent());
                        bottomLinksClickable = true;
                    } catch (e) {
                        bottomLinksClickable = false;
                    }
                }, 100);
            }
        }
    }

    /**
     * Logs panning interactions.
     * @private
     */
    function _handlerPovChange() {
        if (svv.tracker && svv.panorama) {
            svv.tracker.push('POV_Changed');
        }
    }

    /**
     * Renders a label onto the screen using a Panomarker.
     * @returns {renderLabel}
     */
    function renderLabel() {
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
            let controlLayer = isMobile() ? document.getElementById("view-control-layer-mobile") : document.getElementById("view-control-layer");
            self.labelMarker = new PanoMarker({
                id: "validate-pano-marker",
                markerContainer: controlLayer,
                container: panoCanvas,
                pano: panorama,
                position: { heading: pov.heading, pitch: pov.pitch },
                icon: url,
                size: new google.maps.Size(currentLabel.getRadius() * 2 + 2, currentLabel.getRadius() * 2 + 2),
                anchor: new google.maps.Point(currentLabel.getRadius(), currentLabel.getRadius()),
                zIndex: 2
            });
        } else {
            self.labelMarker.setPano(panorama, panoCanvas);
            self.labelMarker.setPosition({
                heading: pov.heading,
                pitch: pov.pitch
            });
            self.labelMarker.setIcon(url);
        }

        return this;
    }

    /**
     * Sets the panorama ID. Adds a callback function that will record pano metadata and update the date text field.
     * @param panoId    String representation of the Panorama ID
     */
    function setPanorama(panoId) {
        setProperty("panoId", panoId);
        svv.panoViewer.setPano(panoId).then(_setPanoCallback)
        setProperty("prevSetPanoTimestamp", new Date());
        return this;
    }

    /**
     * Sets the label on the panorama to be some label.
     * @param label {Label} Label to be displayed on the panorama.
     */
    function setLabel(label) {
        lastLabel = currentLabel;
        currentLabel = label;
        currentLabel.setProperty('startTimestamp', new Date());
        svv.statusField.updateLabelText(currentLabel.getAuditProperty('labelType'));
        svv.statusExample.updateLabelImage(currentLabel.getAuditProperty('labelType'));
        setPanorama(label.getAuditProperty('gsvPanoramaId'));
        svv.labelDescriptionBox.setDescription(label);
        if (svv.expertValidate) svv.rightMenu.resetMenu(label);
        if (svv.adminVersion) svv.statusField.updateAdminInfo(currentLabel);
        renderLabel();
    }

    /**
     * Sets a property for this panorama.
     * @param key   Name of property
     * @param value Value of property.
     * @returns {setProperty}
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Sets the zoom level for this panorama.
     * @param zoom  Desired zoom level for this panorama. In general, values in {1.1, 2.1, 3.1}
     */
    function setZoom (zoom) {
        const currPov = svv.panoViewer.getPov();
        currPov.zoom = zoom;
        svv.panoViewer.setPov(currPov);
    }

    /**
     * Skips the current label on this panorama and fetches a new label for validation.
     */
    function skipLabel () {
        svv.panoramaContainer.fetchNewLabel(currentLabel.getAuditProperty('labelId'));
    }

    /**
     * Goes back to the last label for validation.
     */
    function undoLabel() {
        setLabel(lastLabel);
        lastLabel = undefined;
        svv.panoramaContainer.setProperty('progress', svv.panoramaContainer.getProperty('progress') - 1);
    }

    /**
     * Sets the size of the panorama and panorama holder depending on the size of the mobile phone.
     */
    function sizePano() {
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

    /**
     * Hides the current label on this panorama.
     */
    function hideLabel() {
        self.labelMarker.setVisible(false);
    }

    /**
     * Shows the current label on this panorama.
     */
    function showLabel() {
        self.labelMarker.setVisible(true);
    }

    await _init();

    self.getCurrentLabel = getCurrentLabel;
    self.getProperty = getProperty;
    self.getLastLabel = getLastLabel;
    self.setLastLabel = setLastLabel;
    self.getPanomarker = getPanomarker;
    self.renderLabel = renderLabel;
    self.setLabel = setLabel;
    self.setPanorama = setPanorama;
    self.setProperty = setProperty;
    self.setZoom = setZoom;
    self.skipLabel = skipLabel;
    self.hideLabel = hideLabel;
    self.showLabel = showLabel;
    self.undoLabel = undoLabel;

    return this;
}
