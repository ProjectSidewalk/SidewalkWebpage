/**
 * This function creates/controls the Google StreetView panorama that is used in the validation
 * interface. It uses the Panomarker API to place labels onto the panorama.
 * @param   labelList   String of labels to validate.
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
        prevPanoId: undefined
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
     * Initalizes a Google StreetView Panorama and disables most UI/Control settings.
     * @private
     */
    function _init () {
        _createNewPanorama();

        // When initializing, we can directly set the label onto the panorama. Otherwise, we need
        // to trigger a callback function to avoid infinite looping (GSV bug).
        setLabel(labels[getProperty("progress")]);
    }

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
     * This function adds listeners to the panorama.
     * @private
     */
    function _addListeners () {
        console.log("Adding listeners...");
        panorama.addListener('pov_changed', handlerPovChange);
        panorama.addListener('pano_changed', handlerPanoChange);
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

    /**
     * Returns the panorama ID for the current panorama.
     * @returns {google.maps.StreetViewPanorama} Google StreetView Panorama Id
     */
    function getPanoId () {
        return panorama.getPano();
    }

    /**
     * Returns the lat lng of the panorama.
     * @returns {{lat, lng}}
     */
    function getPosition () {
        var position = panorama.getPosition();
        return { 'lat' : position.lat(), 'lng' : position.lng() };
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
     *
     * @returns {*}
     */
    function getZoom () {
        return panorama.getZoom();
    }

    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Sets label properties from metadata
     * @param labelMetadata JSON with label data
     * @private
     */
    function _handleData (labelMetadata) {
        // console.log("[Panorama.js] Label ID: " + labelMetadata['label_id']);
        setPanorama(labelMetadata['gsv_panorama_id'], labelMetadata['heading'],
                labelMetadata['pitch'], labelMetadata['zoom']);

        svv.statusField.updateLabelText(labelMetadata['label_type']);
        currentLabel.setProperty('canvasHeight', labelMetadata['canvas_height']);
        currentLabel.setProperty('canvasWidth', labelMetadata['canvas_width']);
        currentLabel.setProperty('canvasX', labelMetadata['canvas_x']);
        currentLabel.setProperty('canvasY', labelMetadata['canvas_y']);
        currentLabel.setProperty('heading', labelMetadata['heading']);
        currentLabel.setProperty('labelId', labelMetadata['label_id']);
        currentLabel.setProperty('labelType', labelMetadata['label_type']);
        currentLabel.setProperty('pitch', labelMetadata['pitch']);
        currentLabel.setProperty('startTimestamp', new Date().getTime());
        currentLabel.setProperty('zoom', labelMetadata['zoom']);
        return currentLabel;
    }

    function handlerPovChange () {
        if (svv.tracker && svv.panorama) {
            svv.tracker.push('POV_Changed');
        }
    }

    function handlerPanoChange () {
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
     * Loads a new label onto the panorama.
     * Assumes there are still labels remaining in the label list.
     */
    function loadNewLabelFromList () {
        var progress = labels[getProperty('progress')];

        // NOTE: 3 is arbitrary.
        // If we are going to run out of labels soon, fetch some more (in case the user decides to
        // skip a label)
        if (labels.length - progress < 3) {
            console.log("Need to add more labels! Only " + (labels.length - progress) + " labels remaining.");
            // var newLabels = fetchNewLabels(3);
            // append newLabels to labelList
        }
        setLabel(labels[getProperty('progress')]);
        setProperty('progress', getProperty('progress') + 1);
    }

    /**
     * Creates an object of labels to be validated.
     * @param labelList Object containing key-value pairings of (index, labelMetadata)
     */
    function setLabelList (labelList) {
        Object.keys(labelList).map(function(key, index) {
            var labelMetadata = {
                canvasHeight: labelList[key].canvas_height,
                canvasWidth: labelList[key].canvas_width,
                canvasX: labelList[key].canvas_x,
                canvasY: labelList[key].canvas_y,
                gsvPanoramaId: labelList[key].gsv_panorama_id,
                heading: labelList[key].heading,
                labelId: labelList[key].label_id,
                labelType: labelList[key].label_type,
                pitch: labelList[key].pitch,
                zoom: labelList[key].zoom
            };
            labelList[key] = new Label(labelMetadata);
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
            init = false;
        } else {

            // Adding in callback function because there are some issues with Google Maps
            // setPano function. Will start to running an infinite loop if panorama does not
            // load in time.
            function changePano() {
                _createNewPanorama();
                panorama.setPano(panoId);
                panorama.set('pov', {heading: heading, pitch: pitch});
                panorama.set('zoom', zoomLevel[zoom]);
                renderLabel();
            }
            setTimeout(changePano, 300);
        }
        // _addListeners();
        return this;
    }

    /**
     * Retrieves a label with a given id from the database.
     * @param labelId   label_id of the desired label.
     */
    function setLabelWithId (labelId) {
        var labelUrl = "/label/geo/" + labelId;
        $.ajax({
            url: labelUrl,
            async: false,
            dataType: 'json',
            success: function (labelMetadata) {
                _handleData(labelMetadata);
            }
        });
        renderLabel();
    }

    /**
     * Sets the label on the panorama to be some label.
     * @param label {Label} Label to be displayed on the panorama.
     */
    function setLabel (label) {
        currentLabel = label;
        currentLabel.setProperty('startTimestamp', new Date().getTime());
        console.log("Setting panorama to be: " + label.getProperty('gsvPanoramaId'));
        setPanorama(label.getProperty('gsvPanoramaId'), label.getProperty('heading'),
            label.getProperty('pitch'), label.getProperty('zoom'));
        renderLabel();
    }

    /**
     * Retrieves a random label from the database.
     */
    function setRandomLabel () {
        var labelUrl = "/label/geo/random";
        $.ajax({
            url: labelUrl,
            async: false,
            dataType: 'json',
            success: function (labelMetadata) {
                _handleData(labelMetadata);
            }
        });
        renderLabel();
        return this;
    }

    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    function setZoom (zoom) {
        panorama.set('zoom', zoom);
    }

    /**
     * Renders a label onto the screen using a Panomarker.
     * @returns {renderLabel}
     */
    function renderLabel() {
        var url = currentLabel.getIconUrl();
        var pos = svv.util.properties.panorama.getPosition(currentLabel.getProperty('canvasX'), currentLabel.getProperty('canvasY'),
            currentLabel.getProperty('canvasWidth'), currentLabel.getProperty('canvasHeight'),
            currentLabel.getProperty('zoom'), currentLabel.getProperty('heading'), currentLabel.getProperty('pitch'));

        if (!self.labelMarker) {
            self.labelMarker = new PanoMarker({
                container: panoCanvas,
                pano: panorama,
                position: {heading: pos.heading, pitch: pos.pitch},
                icon: url,
                size: new google.maps.Size(20, 20),
                anchor: new google.maps.Point(10, 10)
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
    self.setRandomLabel = setRandomLabel;
    self.setPanorama = setPanorama;
    self.setProperty = setProperty;
    self.setLabelList = setLabelList;
    self.setZoom = setZoom;

    return self;
}