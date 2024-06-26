/**
 * Creates and controls the Google StreetView panorama that is used in the validation
 * interface. Uses Panomarkers to place labels onto the Panorama.
 * @param label Initial label to load onto the panorama.
 * @constructor
 */
function Panorama (label) {
    let currentLabel = label;
    let lastLabel = {};
    let panorama = undefined;
    let properties = {
        canvasId: 'svv-panorama',
        panoId: undefined,
        prevPanoId: undefined,
        prevSetPanoTimestamp: new Date().getTime(),
        validationTimestamp: new Date().getTime()
    };

    let panoCanvas = document.getElementById(properties.canvasId);
    let self = this;
    let streetViewService = new google.maps.StreetViewService();
    let bottomLinksClickable = false;

    /**
     * Initializes a Google StreetView Panorama and renders a label onto the screen.
     * @private
     */
    function _init() {
        _createNewPanorama();
        if (isMobile()) {
            sizePano();
        }
        _addListeners();

        // Issue: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2468
        // This line of code is here to fix the bug when zooming with ctr +/-, the screen turns black.
        // We are updating the pano POV slightly to simulate an update the gets rid of the black pano.
        $(window).on('resize', function() {
            let pov = panorama.getPov();
            pov.heading -= .01;
            pov.pitch -= .01;
            panorama.setPov(pov);
        });
        setLabel(currentLabel);
    }

    /**
     * Initializes a Google StreetView Panorama and disables most UI/Control settings.
     * @private
     */
    function _createNewPanorama() {
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
    function _addListeners() {
        panorama.addListener('pov_changed', _handlerPovChange);
        panorama.addListener('pano_changed', _handlerPanoChange);
        return this;
    }

    /**
     * Returns the label object for the label that is loaded on this panorama
     * @returns {Label}
     */
    function getCurrentLabel() {
        return currentLabel;
    }

    /**
     * Returns the actual StreetView object.
     */
    function getPanorama() {
        return panorama;
    }

    /**
     * Returns the list of labels to validate / to be validated in this mission.
     * @returns {*}
     */
    function getCurrentMissionLabels() {
        return labels;
    }

    /**
     * Returns the underlying panomarker object.
     * @returns {PanoMarker}
     */
    function getPanomarker() {
        return self.labelMarker;
    }

    /**
     * Returns the panorama ID for the current panorama.
     * @returns {google.maps.StreetViewPanorama} Google StreetView Panorama Id
     */
    function getPanoId() {
        return panorama.getPano();
    }

    /**
     * Returns the lat lng of this panorama. Note that sometimes position is null/undefined
     * (probably a bug in GSV), so sometimes this function returns null.
     * @returns {{lat, lng}}
     */
    function getPosition() {
        let position = panorama.getPosition();
        return (position) ? {'lat': position.lat(), 'lng': position.lng()} : null;
    }

    /**
     * Returns the pov of the viewer.
     * @returns {{heading: float, pitch: float, zoom: float}}
     */
    function getPov() {
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
     * Logs interactions from panorama changes.
     * Occurs when the user loads a new label onto the screen, or if they use arrow keys to move
     * around. (This is behavior that is automatically enabled by the GSV Panorama).
     * Updates the date text field to match the current panorama's date.
     * @private
     */
    function _handlerPanoChange() {
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
        streetViewService.getPanorama({ pano: panorama.getPano() },
            function (data, status) {
                if (status === google.maps.StreetViewStatus.OK) {
                    // Connect the GSV to the minimap if it's not already connected.
                    if (!svv.ui.minimap.getStreetView() || !svv.ui.minimap.getStreetView().visible) {
                        svv.ui.minimap.setStreetView(panorama);
                    }

                    // Set the location of the minimap to the current panorama.
                    svv.ui.minimap.setCenter(data.location.latLng);

                    // Save the current panorama's history.
                    var panoHist = {};
                    panoHist.curr_pano_id = panorama.getPano();
                    panoHist.pano_history_saved = new Date().getTime();
                    panoHist.history = data.time.map((oldPano) => {
                        return { pano_id: oldPano.pano, date: moment(oldPano.Gw).format('YYYY-MM') };
                    });
                    svv.panoramaContainer.addPanoHistory(panoHist);
                    if (!isMobile()) {
                        document.getElementById("svv-panorama-date").innerText = moment(data.imageDate).format('MMM YYYY');
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
                } else {
                    console.error("Error retrieving Panoramas: " + status);
                    svv.tracker.push("PanoId_NotFound", {'TargetPanoId': panoramaId});
                }
        });

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
        let pos = currentLabel.getPosition();

        // Set to user's POV when labeling if on desktop. If on mobile, center the label on the screen.
        if (isMobile()) {
            panorama.set('pov', pos);
        } else {
            panorama.set('pov', {
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
                position: { heading: pos.heading, pitch: pos.pitch },
                icon: url,
                size: new google.maps.Size(currentLabel.getRadius() * 2 + 2, currentLabel.getRadius() * 2 + 2),
                anchor: new google.maps.Point(currentLabel.getRadius(), currentLabel.getRadius()),
                zIndex: 2
            });
        } else {
            self.labelMarker.setPano(panorama, panoCanvas);
            self.labelMarker.setPosition({
                heading: pos.heading,
                pitch: pos.pitch
            });
            self.labelMarker.setIcon(url);
        }

        // Render the label on the minimap.
        let newMarker = new google.maps.Marker({
            map: svv.ui.minimap,
            position: new google.maps.LatLng(currentLabel.getAuditProperty('lat'), currentLabel.getAuditProperty('lng')),
            title: currentLabel.getAuditProperty('labelId').toString(),
            size: new google.maps.Size(10, 10),
            icon: `/assets/javascripts/SVLabel/img/icons/${currentLabel.getAuditProperty('labelType')}_tiny.png`
        });
        return this;
    }

    /**
     * Sets the panorama ID.
     * @param panoId    String representation of the Panorama ID
     * @param heading   Photographer heading
     * @param pitch     Photographer pitch
     * @param zoom      Photographer zoom
     */
    function setPanorama(panoId) {
        setProperty("panoId", panoId);
        setProperty("prevPanoId", panoId);
        panorama.setPano(panoId);
        setProperty("prevSetPanoTimestamp", new Date().getTime());
        return this;
    }

    /**
     * Sets the label on the panorama to be some label.
     * @param label {Label} Label to be displayed on the panorama.
     */
    function setLabel(label) {
        lastLabel = currentLabel;
        currentLabel = label;
        currentLabel.setProperty('startTimestamp', new Date().getTime());
        svv.statusField.updateLabelText(currentLabel.getAuditProperty('labelType'));
        svv.statusExample.updateLabelImage(currentLabel.getAuditProperty('labelType'));
        setPanorama(label.getAuditProperty('gsvPanoramaId'));
        svv.labelDescriptionBox.setDescription(label);
        if (svv.newValidateBeta) svv.rightMenu.resetMenu(label);
        if (svv.adminVersion) svv.statusField.updateAdminInfo();
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

    _init();

    self.getCurrentLabel = getCurrentLabel;
    self.getCurrentMissionLabels = getCurrentMissionLabels;
    self.getPanoId = getPanoId;
    self.getPosition = getPosition;
    self.getProperty = getProperty;
    self.getPov = getPov;
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
    self.getPanorama = getPanorama;
    self.undoLabel = undoLabel;

    return this;
}
