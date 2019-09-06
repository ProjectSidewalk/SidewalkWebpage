/**
 * Creates and controls the Google StreetView panorama that is used in the validation
 * interface. Uses Panomarkers to place labels onto the Panorama.
 * @param   label       Initial label to load onto the panorama.
 * @param   id          DOM ID for this Panorama. (i.e., svv-panorama)
 * @constructor
 */
function Panorama (label, id) {
    // abbreviated dates for panorama date overlay
    let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let currentLabel = label;
    let panorama = undefined;
    let properties = {
        canvasId: "svv-panorama-" + id,
        panoId: undefined,
        prevPanoId: undefined,
        prevSetPanoTimestamp: new Date().getTime(),
        validationTimestamp: new Date().getTime()
    };

    let panoCanvas = document.getElementById(properties.canvasId);
    let self = this;
    let streetViewService = new google.maps.StreetViewService();

    // Determined manually by matching appearance of labels on the audit page and appearance of
    // labels on the validation page. Zoom is determined by FOV, not by how "close" the user is.
    let zoomLevel = {
        1: 1.1,
        2: 2.1,
        3: 3.1
    };

    /**
     * Initializes a Google StreetView Panorama and renders a label onto the screen.
     * @private
     */
    function _init () {
        _createNewPanorama();
        if (isMobile()) {
            sizePano();
        }
        _addListeners();
        setLabel(currentLabel);
    }

    /**
     * Initializes a Google StreetView Panorama and disables most UI/Control settings.
     * @private
     */
    function _createNewPanorama () {
        if (typeof google != "undefined") {
            // Set control options
            panorama = new google.maps.StreetViewPanorama(panoCanvas);
            panorama.set('addressControl', false);
            panorama.set('clickToGo', false);
            panorama.set('disableDefaultUI', true);
            panorama.set('keyboardShortcuts', false);
            panorama.set('linksControl', false);
            panorama.set('motionTracking', false);
            panorama.set('motionTrackingControl', false);
            panorama.set('navigationControl', false);
            panorama.set('panControl', false); 
            panorama.set('showRoadLabels', false);
            panorama.set('zoomControl', false);
            if (!isMobile()) {
                panorama.set('scrollwheel', false);
            }    
        } else {
            console.error("No typeof google");
        }
    }

    /**
     * Adds listeners to the panorama to log user interactions.
     * @private
     */
    function _addListeners () {
        panorama.addListener('pov_changed', _handlerPovChange);
        panorama.addListener('pano_changed', _handlerPanoChange);
        if (isMobile()) {
            panorama.addListener('zoom_changed', _handlerZoomChange);
            let screen = document.getElementById(properties.canvasId);
            screen.addEventListener('touchstart', _processTouchstart, false);
            screen.addEventListener('touchend', _processTouchend, false);
        }
        return this;
    }

    /**
     * Returns the label object for the label that is loaded on this panorama
     * @returns {Label}
     */
    function getCurrentLabel () {
        return currentLabel;
    }

    /**
     * Returns the actual StreetView object.
     */
    function getPanorama () {
        return panorama;
    }

    /**
     * Returns the list of labels to validate / to be validated in this mission.
     * @returns {*}
     */
    function getCurrentMissionLabels () {
        return labels;
    }

    /**
     * Returns the underlying panomarker object.
     * @returns {PanoMarker}
     */
    function getPanomarker () {
	return self.labelMarker;
    }

    /**
     * Returns the panorama ID for the current panorama.
     * @returns {google.maps.StreetViewPanorama} Google StreetView Panorama Id
     */
    function getPanoId () {
        return panorama.getPano();
    }

    /**
     * Returns the lat lng of this panorama. Note that sometimes position is null/undefined
     * (probably a bug in GSV), so sometimes this function returns null.
     * @returns {{lat, lng}}
     */
    function getPosition () {
        let position = panorama.getPosition();
        return (position) ? {'lat': position.lat(), 'lng': position.lng()} : null;
    }

    /**
     * Returns the pov of the viewer.
     * @returns {{heading: float, pitch: float, zoom: float}}
     */
    function getPov () {
        let pov = panorama.getPov();

        // Pov can be less than 0. So adjust it.
        while (pov.heading < 0) {
            pov.heading += 360;
        }

        // Pov can be more than 360. Adjust it.
        while (pov.heading > 360) {
            pov.heading -= 360;
        }
        return pov;
    }

    /**
     * Returns the zoom level of this panorama.
     * @returns Zoom level from {1.1, 2.1, 3.1}
     */
    function getZoom () {
        return panorama.getZoom();
    }

    /**
     * Gets a specific property from this Panorama.
     * @param key   Property name.
     * @returns     Value associated with this property or null.
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Logs interactions from panorama changes.
     * Occurs when the user loads a new label onto the screen, or if they use arrow keys to move
     * around. (This is behavior that is automatically enabled by the GSV Panorama).
     * Updates the date text field to match the current panorama's date.
     * @private
     */
    function _handlerPanoChange () {
        if (svv.panorama) {
            let panoId = getPanoId();

            /**
             * PanoId is sometimes changed twice. This avoids logging duplicate panos.
             */
            if (svv.tracker && panoId !== getProperty('prevPanoId')) {
                setProperty('prevPanoId', panoId);
                svv.tracker.push('PanoId_Changed');
            }
        }
        if (!isMobile()) {
            streetViewService.getPanorama({pano: panorama.getPano()},
                function (data, status) {
                    if (status === google.maps.StreetViewStatus.OK) {
                        let date = data.imageDate;
                        let year = date.substring(0, 4);
                        let month = months[parseInt(date.substring(5, 7)) - 1];
                        document.getElementById("svv-panorama-date-" + id).innerText = month + " " + year;
                    }
                    else {
                        console.error("Error retrieving Panoramas: " + status);
                        svl.tracker.push("PanoId_NotFound", {'TargetPanoId': panoramaId});
                    }
                });
        }
    }

    /**
     * Logs zoom interactions on mobile devices. This is only used for mobile devices as
     * they use GSV pinch zoom mechanism.
     * @private
     */
    function _handlerZoomChange () {
        if (svv.tracker && svv.panorama) {
            let currentZoom = panorama.getZoom();
            let zoomChange = currentZoom - self.prevZoomLevel;
            if (zoomChange > 0) {
                svv.tracker.push("Mobile_Pinch_ZoomIn");
            }
            if (zoomChange < 0) {
                svv.tracker.push("Mobile_Pinch_ZoomOut");
            }
            self.prevZoomLevel = currentZoom;
        }
    }

    /**
     * Prevents POV_Changed logs when zooming on mobile device. Its purpose
     * is to separate zooming and pov_changed events on mobile.
     * @private
     */
    function _processTouchstart(e) {
        if (e.touches.length >= 2) {
            self.disablePovChangeLogging = true;
        }
    }

    /**
     * Enables POV_Changed logs after zooming on mobile device.
     * @private
     */
    function _processTouchend(e) {
        self.disablePovChangeLogging = false;
    }
        
    /**
     * Logs panning interactions.
     * @private
     */
    function _handlerPovChange () {
        if (svv.tracker && svv.panorama && !self.disablePovChangeLogging) {
            svv.tracker.push('POV_Changed');
        }
    }


    /**
     * Renders a label onto the screen using a Panomarker.
     * @returns {renderLabel}
     */
    function renderLabel() {
        let url = currentLabel.getIconUrl();
        let pos = currentLabel.getPosition();

        if (!self.labelMarker) {
            let controlLayer = document.getElementById("viewControlLayer");
            self.labelMarker = new PanoMarker({
		id: "validate-pano-marker",
                markerContainer: controlLayer,
                container: panoCanvas,
                pano: panorama,
                position: {heading: pos.heading, pitch: pos.pitch},
                icon: url,
                size: new google.maps.Size(currentLabel.getRadius() * 2, currentLabel.getRadius() * 2),
                anchor: new google.maps.Point(currentLabel.getRadius(), currentLabel.getRadius())
            });
        } else {
            self.labelMarker.setPano(panorama, panoCanvas);
            self.labelMarker.setPosition({
                heading: pos.heading,
                pitch: pos.pitch
            });
            self.labelMarker.setIcon(url);
        }
        return this;
    }

    /**
     * Sets the panorama ID, and heading/pitch/zoom
     * @param panoId    String representation of the Panorama ID
     * @param heading   Photographer heading
     * @param pitch     Photographer pitch
     * @param zoom      Photographer zoom
     */
    function setPanorama (panoId, heading, pitch, zoom) {
        setProperty("panoId", panoId);
        setProperty("prevPanoId", panoId);
        panorama.setPano(panoId);
        setProperty("prevSetPanoTimestamp", new Date().getTime());
        panorama.set('pov', {heading: heading, pitch: pitch});
        panorama.set('zoom', zoomLevel[zoom]);
        renderLabel();
        return this;
    }

    /**
     * Sets the label on the panorama to be some label.
     * @param label {Label} Label to be displayed on the panorama.
     */
    function setLabel (label) { 
        currentLabel = label;
        currentLabel.setProperty('startTimestamp', new Date().getTime());
        svv.statusField.updateLabelText(currentLabel.getAuditProperty('labelType'));
        svv.statusExample.updateLabelImage(currentLabel.getAuditProperty('labelType'));
        if (isMobile()) {
             self.prevZoomLevel = zoomLevel[label.getAuditProperty('zoom')];
        }
        setPanorama(label.getAuditProperty('gsvPanoramaId'), label.getAuditProperty('heading'),
            label.getAuditProperty('pitch'), label.getAuditProperty('zoom'));
        // Only set description box if on /validate and not /rapidValidate.
        if (typeof svv.labelDescriptionBox !== 'undefined') {
            svv.labelDescriptionBox.setDescription(label);
        }
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
        panorama.set('zoom', zoom);
    }

    /**
     * Skips the current label on this panorama and fetches a new label for validation.
     */
    function skipLabel () {
        svv.panoramaContainer.fetchNewLabel(currentLabel.getProperty('labelId'));
    }

    /**
     * Sets the size of the panorama and panorama holder depending on the size of the mobile phone
     */
    function sizePano() {
        let h = window.innerHeight - 10;
        let w = window.innerWidth - 10;
        let outline_h = h + 10
        let outline_w = w + 10;
        let left = 0;
        document.getElementById("svv-panorama-0").style.height = h + "px";
        document.getElementById("svv-panorama-holder").style.height = h + "px";
        document.getElementById("svv-panorama-outline").style.height = outline_h + "px";
        document.getElementById("svv-panorama-0").style.width = w + "px";
        document.getElementById("svv-panorama-holder").style.width = w + "px";
        document.getElementById("svv-panorama-outline").style.width = outline_w + "px";
        document.getElementById("svv-panorama-0").style.left = left + "px";
        document.getElementById("svv-panorama-holder").style.left = left + "px";
        document.getElementById("svv-panorama-outline").style.left = left + "px";
    }

    /**
     * Hides the current label on this panorama.
     */
    function hideLabel () {
        self.labelMarker.setVisible(false);
    }

    /**
     * Shows the current label on this panorama.
     */
    function showLabel () {
        self.labelMarker.setVisible(true);
    }

    _init();

    self.getCurrentLabel = getCurrentLabel;
    self.getCurrentMissionLabels = getCurrentMissionLabels;
    self.getPanoId = getPanoId;
    self.getPosition = getPosition;
    self.getProperty = getProperty;
    self.getPov = getPov;
    self.getZoom = getZoom;
    self.getPanomarker = getPanomarker;
    self.renderLabel = renderLabel;
    self.setLabel = setLabel;
    self.setPanorama = setPanorama;
    self.setProperty = setProperty;
    self.setZoom = setZoom;
    self.skipLabel = skipLabel;
    self.hideLabel = hideLabel;
    self.showLabel = showLabel;
    self.getPanorama = getPanorama;

    return this;
}
