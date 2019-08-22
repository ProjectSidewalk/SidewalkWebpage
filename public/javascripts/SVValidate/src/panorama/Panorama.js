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
        sizePano();
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
        let url = currentLabel.getIconUrl();
        let pos = currentLabel.getPosition();

        if (!self.labelMarker) {
            let controlLayer = document.getElementById("viewControlLayer");
            self.labelMarker = new PanoMarker({
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
        setPanorama(label.getAuditProperty('gsvPanoramaId'), label.getAuditProperty('heading'),
            label.getAuditProperty('pitch'), label.getAuditProperty('zoom'));
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

    function sizePano() {
        console.log("bi")
        if (isMobile()) {
            console.log("hi")
            var h = window.innerHeight - 10;
            var w = window.innerWidth - 10;
            var outline_h = h + 10;
            var outline_w = w + 10;
            var left = 0;
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
    }

    function isMobile() {
        var isMobile = false; //initiate as false
        // device detection
        if (/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|ipad|iris|kindle|Android|Silk|lge |maemo|midp|mmp|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(navigator.userAgent)
            || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(navigator.userAgent.substr(0, 4))) {
            isMobile = true;
        }
        return isMobile;
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
    self.skipLabel = skipLabel;
    self.hideLabel = hideLabel;
    self.showLabel = showLabel;
    self.getPanorama = getPanorama;

    return this;
}
