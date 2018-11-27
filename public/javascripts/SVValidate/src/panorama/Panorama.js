/**
 * This function creates/controls the Google StreetView panorama that is used in the validation
 * interface. It uses the Panomarker API to place labels onto the panorama.
 * @constructor
 */
function Panorama() {
    var currentLabel = new Label();
    var init = true;
    var panoCanvas = document.getElementById("svv-panorama");
    var properties = {};
    var panorama = undefined;
    var zoomLevel = {
        1: 1.1,
        2: 2.1,
        3: 3.1
    };

    /**
     * Initalizes a Google StreetView Panorama and disables most UI/Control settings.
     * @private
     */
    function _init() {
        if (typeof google != "undefined") {
            // Set control options
            panorama = new google.maps.StreetViewPanorama(panoCanvas);
            panorama.set('addressControl', false);
            panorama.set('clickToGo', false);
            panorama.set('disableDefaultUI', true);
            panorama.set('linksControl', false);
            panorama.set('navigationControl', false);
            panorama.set('panControl', false);
            panorama.set('zoomControl', false);
            panorama.set('keyboardShortcuts', false);
            panorama.set('motionTracking', false);
            panorama.set('motionTrackingControl', false);
            panorama.set('showRoadLabels', false);
        } else {
            console.error("No typeof google");
        }

        // Sets to a random label
        if (init) {
            setLabel();
        }
    }

    /**
     * Returns the label object for the label that is loaded on this panorama
     * @returns {Label}
     */
    function getCurrentLabel() {
        return currentLabel;
    }

    /**
     * Returns the panorama ID for the current panorama.
     * @returns {String} Google StreetView Panorama Id
     */
    function getPanoId() {
        return panorama.getPano();
    }

    /**
     * Returns the lat lng of the panorama.
     * @returns {{lat, lng}}
     */
    function getPosition() {
        var position = panorama.getPosition();
        return { 'lat' : position.lat(), 'lng' : position.lng() };
    }

    /**
     * Returns the pov of the viewer.
     * @returns {{heading: float, pitch: float, zoom: float}}
     */
    function getPov() {
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

    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Sets label properties from metadata
     * @param labelMetadata JSON with label data
     * @private
     */
    function _handleData(labelMetadata) {
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

    /**
     * Sets the panorama ID, and heading/pitch/zoom
     * @param panoId    String representation of the Panorama ID
     * @param heading   Photographer heading
     * @param pitch     Photographer pitch
     * @param zoom      Photographer zoom
     */
    function setPanorama(panoId, heading, pitch, zoom) {
        setProperty("panoId", panoId);
        if (init) {
            panorama.setPano(panoId);
            panorama.set('pov', {heading: heading, pitch: pitch});
            /* TODO: See if we need to adjust the zoom level */
            panorama.set('zoom', zoomLevel[zoom]);
            init = false;
        } else {
            if (self.labelMarker) {
                self.labelMarker.onRemove();
            }

            // Adding in callback function because there are some issues with Google Maps
            // setPano function. Will start to running an infinite loop if panorama does not
            // load in time.
            function changePano() {
                _init();
                panorama.setPano(panoId);
                panorama.set('pov', {heading: heading, pitch: pitch});
                panorama.set('zoom', zoomLevel[zoom]);
                renderLabel();
            }
            setTimeout(changePano, 100);
        }
        return this;
    }

    /**
     * Retrieves a label with a given id from the database.
     * @param labelId   label_id of the desired label.
     */
    function setLabel(labelId) {
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
     * Retrieves a random label from the database.
     */
    function setLabel() {
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

    function setProperty(key, value) {
        properties[key] = value;
        return this;
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

        self.labelMarker = new PanoMarker ({
            container: panoCanvas,
            pano: panorama,
            position: {heading: pos.heading, pitch: pos.pitch},
            icon: url,
            size: new google.maps.Size(20, 20),
            anchor: new google.maps.Point(10, 10)
        });
        return this;
    }

    _init();

    self.getCurrentLabel = getCurrentLabel;
    self.getPanoId = getPanoId;
    self.getPosition = getPosition;
    self.getProperty = getProperty;
    self.getPov = getPov;
    self.renderLabel = renderLabel;
    self.setLabel = setLabel;
    self.setPanorama = setPanorama;
    self.setProperty = setProperty;

    return self;
}