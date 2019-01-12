/**
 * Creates and controls the Google StreetView panorama that is used in the validation
 * interface. It also holds a list of labels to be validated and uses the Panomarker API to place
 * labels onto the panorama.
 * @param   labelList   List of Labels to validate.
 * @constructor
 */
function Panorama (labelList) {
    var currentLabel = new Label();
    var init = true;
    var labels = labelList;
    var panoCanvas = document.getElementById("svv-panorama");
    var properties = {
        progress: 0,
        panoId: undefined,
        prevPanoId: undefined,
        validationTimestamp: new Date().getTime()
    };
    var panorama = undefined;

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

        // When initializing, we can directly set the label onto the panorama. Otherwise, we need
        // to trigger a callback function to avoid infinite looping (GSV bug).
        setLabel(labels[getProperty("progress")]);
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
        console.log("Adding listeners...");
        panorama.addListener('pov_changed', _handlerPovChange);
        panorama.addListener('pano_changed', _handlerPanoChange);
        return this;
    }

    /**
     * Uses label metadata to initialize a new label.
     * @param metadata  Metadata for the label.
     * @returns {Label} Label object for this label.
     * @private
     */
    function _createSingleLabel (metadata) {
        var labelMetadata = {
            canvasHeight: metadata.canvas_height,
            canvasWidth: metadata.canvas_width,
            canvasX: metadata.canvas_x,
            canvasY: metadata.canvas_y,
            gsvPanoramaId: metadata.gsv_panorama_id,
            heading: metadata.heading,
            labelId: metadata.label_id,
            labelType: metadata.label_type,
            pitch: metadata.pitch,
            zoom: metadata.zoom
        };
        return new Label(labelMetadata);
    }

    /**
     * Fetches a single label from the database. Missions fetch exactly the number of labels that
     * are needed to complete the mission. When the user clicks skip, need to get more.
     * @param count Number of labels to append to the labels.
     * @private
     */
    function _fetchNewLabel () {
        var labelUrl = "/label/geo/random";
        $.ajax({
            url: labelUrl,
            async: false,
            dataType: 'json',
            success: function (labelMetadata) {
                labels.push(_createSingleLabel(labelMetadata));
            }
        });
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
     * Loads a new label onto the panorama.
     * Assumes there are still labels remaining in the label list.
     */
    function loadNewLabelFromList () {
        setLabel(labels[getProperty('progress')]);
        setProperty('progress', getProperty('progress') + 1);
    }


    /**
     * Renders a label onto the screen using a Panomarker.
     * @returns {renderLabel}
     */
    function renderLabel() {
        var url = currentLabel.getIconUrl();
        var pos = currentLabel.getPosition();

        if (!self.labelMarker) {
            self.labelMarker = new PanoMarker({
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
     * Resets the state of the mission.
     * Called when a new validation mission is loaded, and when we need to get rid of lingering
     * data from the previous validation mission.
     */
    function reset () {
        setProperty('progress', 0);
    }

    /**
     * Creates a list of label objects to be validated from label metadata.
     * Called when a new mission is loaded onto the screen.
     * @param labelList Object containing key-value pairings of (index, labelMetadata)
     */
    function setLabelList (labelList) {
        Object.keys(labelList).map(function(key, index) {
            labelList[key] = _createSingleLabel(labelList[key]);
        });

        labels = labelList;
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

        if (init) {
            panorama.setPano(panoId);
            panorama.set('pov', {heading: heading, pitch: pitch});
            panorama.set('zoom', zoomLevel[zoom]);
            _addListeners();
            init = false;
        } else {

            // Adding in callback function because there are some issues with Google Maps
            // setPano function. Will start to running an infinite loop if panorama does not
            // load in time.
            function changePano() {
                _createNewPanorama();
                _addListeners();
                panorama.setPano(panoId);
                panorama.set('pov', {heading: heading, pitch: pitch});
                panorama.set('zoom', zoomLevel[zoom]);
                renderLabel();
            }
            setTimeout(changePano, 300);
        }
        return this;
    }

    /**
     * Retrieves a label with a given id from the database and adds it to the label list.
     * NOTE: Currently unused, but may be useful later.
     * @param labelId   label_id of the desired label.
     */
    function setLabelWithId (labelId) {
        var labelUrl = "/label/geo/" + labelId;
        $.ajax({
            url: labelUrl,
            async: false,
            dataType: 'json',
            success: function (labelMetadata) {
                var label = _createSingleLabel(labelMetadata);
                labels.push(label);
            }
        });
    }

    /**
     * Sets the label on the panorama to be some label.
     * @param label {Label} Label to be displayed on the panorama.
     */
    function setLabel (label) {
        currentLabel = label;
        currentLabel.setValidationProperty('startTimestamp', new Date().getTime());
        svv.statusField.updateLabelText(currentLabel.getOriginalProperty('labelType'));
        console.log("Setting panorama to be: " + label.getOriginalProperty('gsvPanoramaId'));
        setPanorama(label.getOriginalProperty('gsvPanoramaId'), label.getOriginalProperty('heading'),
            label.getOriginalProperty('pitch'), label.getOriginalProperty('zoom'));
        renderLabel();
    }

    /**
     * Skips the current label on this panorama and fetches a new label for validation.
     */
    function skipLabel () {
        _fetchNewLabel();
        setProperty('progress', getProperty('progress') + 1);
        setLabel(labels[getProperty('progress')]);
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

    _init();

    self.getCurrentLabel = getCurrentLabel;
    self.getCurrentMissionLabels = getCurrentMissionLabels;
    self.getPanoId = getPanoId;
    self.getPosition = getPosition;
    self.getProperty = getProperty;
    self.getPov = getPov;
    self.getZoom = getZoom;
    self.loadNewLabelFromList = loadNewLabelFromList;
    self.renderLabel = renderLabel;
    self.reset = reset;
    self.setPanorama = setPanorama;
    self.setProperty = setProperty;
    self.setLabelList = setLabelList;
    self.setZoom = setZoom;
    self.skipLabel = skipLabel;

    return self;
}
