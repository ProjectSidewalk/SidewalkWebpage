/**
 * Creates and controls the Google StreetView panorama that is used in the validation
 * interface. Uses Panomarkers to place labels onto the Panorama.
 * @param   label   Initial label to load onto the panorama.
 * @constructor
 */
function Panorama (label) {
    var currentLabel = label;
    var panoCanvas = document.getElementById("svv-panorama");
    var panorama = undefined;
    var properties = {
        panoId: undefined,
        prevPanoId: undefined,
        validationTimestamp: new Date().getTime()
    };
    var self = this;

    // Determined manually by matching appearance of labels on the audit page and appearance of
    // labels on the validation page. Zoom is determined by FOV, not by how "close" the user is.
    var zoomLevel = {
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
            panorama.set('scrollwheel', false);
            panorama.set('showRoadLabels', false);
            panorama.set('zoomControl', false);
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
     * Returns the list of labels to validate / to be validated in this mission.
     * @returns {*}
     */
    function getCurrentMissionLabels () {
        return labels;
    }

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
        var position = panorama.getPosition();
        return (position) ? {'lat': position.lat(), 'lng': position.lng()} : null;
    }

    /**
     * Returns the pov of the viewer.
     * @returns {{heading: float, pitch: float, zoom: float}}
     */
    function getPov () {
        var pov = panorama.getPov();

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
     * @private
     */
    function _handlerPanoChange () {
        if (svv.panorama) {
            var panoId = getPanoId();
            if (panoId !== getProperty('panoId')) {
                self.labelMarker.setVisible(false);
            } else {
                self.labelMarker.setVisible(true);
            }

            /**
             * PanoId is sometimes changed twice. This avoids logging duplicate panos.
             */
            if (svv.tracker && panoId !== getProperty('prevPanoId')) {
                setProperty('prevPanoId', panoId);
                svv.tracker.push('PanoId_Changed');
            }
        }
    }

    /**
     * Logs panning interactions.
     * @private
     */
    function _handlerPovChange () {
        if (svv.tracker && svv.panorama) {
            svv.tracker.push('POV_Changed');
        }
    }


    /**
     * Renders a label onto the screen using a Panomarker.
     * @returns {renderLabel}
     */
    function renderLabel() {
        var url = currentLabel.getIconUrl();
        var pos = currentLabel.getPosition();
        var sev = currentLabel.getOriginalProperty('severity');
        var temp = currentLabel.getOriginalProperty('temporary');
        var desc = currentLabel.getOriginalProperty('description');
        var tags = currentLabel.getOriginalProperty('tags');


        if (!self.labelMarker) {
            self.labelMarker = new PanoMarker({
                id: "validate-pano-marker",
                container: panoCanvas,
                pano: panorama,
                position: {heading: pos.heading, pitch: pos.pitch},
                icon: url,
                size: new google.maps.Size(currentLabel.getRadius() * 2, currentLabel.getRadius() * 2),
                anchor: new google.maps.Point(currentLabel.getRadius(), currentLabel.getRadius()),
                severity: sev,
                temporary: temp,
                description: desc,
                tags: tags
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
        currentLabel.setValidationProperty('startTimestamp', new Date().getTime());
        svv.statusField.updateLabelText(currentLabel.getOriginalProperty('labelType'));
        svv.statusExample.updateLabelImage(currentLabel.getOriginalProperty('labelType'));
        setPanorama(label.getOriginalProperty('gsvPanoramaId'), label.getOriginalProperty('heading'),
            label.getOriginalProperty('pitch'), label.getOriginalProperty('zoom'));
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
        svv.panoramaContainer.fetchNewLabel();
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
    self.renderLabel = renderLabel;
    self.setLabel = setLabel;
    self.setPanorama = setPanorama;
    self.setProperty = setProperty;
    self.setZoom = setZoom;
    self.getPanomarker = getPanomarker;
    self.skipLabel = skipLabel;
    self.hideLabel = hideLabel;
    self.showLabel = showLabel;

    return this;
}
