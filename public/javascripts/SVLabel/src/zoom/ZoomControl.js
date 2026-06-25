/**
 * Todo. Separate the UI component and the logic component
 * @param canvas
 * @param tracker
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ZoomControl (canvas, tracker) {
    const uiZoomControl = {
        zoomIn: $("#zoom-in-button"),
        zoomOut: $("#zoom-out-button")
    };

    var self = { 'className' : 'ZoomControl' },
        properties = {
            maxZoomLevel: 3,
            minZoomLevel: 1
        },
        status = {
            disableZoomIn: false,
            disableZoomOut: true
        },
        lock = {
            disableZoomIn: false,
            disableZoomOut: false
        },
        zoomBlink = {
          isBlinking: false
        },
        blinkInterval,
        wheelTrackTimeout;

    // Scroll wheel / trackpad zoom tuning.
    const ZOOM_WHEEL_SENSITIVITY = 0.0015;


    /**
     * Get the zoom in UI control
     */
    function getZoomInUI () {
        return uiZoomControl.zoomIn;
    }

    /**
     * Get the zoom out UI control
     */
    function getZoomOutUI () {
        return uiZoomControl.zoomOut;
    }

    /**
     * Blink the zoom in button
     */
    function blinkZoomIn () {
        stopBlinking();
        zoomBlink.isBlinking = true;
        blinkInterval = window.setInterval(function () {
            uiZoomControl.zoomIn.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Blink the zoom out button
     */
    function blinkZoomOut () {
        stopBlinking();
        zoomBlink.isBlinking = true;
        blinkInterval = window.setInterval(function () {
            uiZoomControl.zoomOut.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Disables zooming in
     * @method
     * @returns {self}
     */
    function disableZoomIn () {
        if (!lock.disableZoomIn) {
            status.disableZoomIn = true;
            if (uiZoomControl) {
                uiZoomControl.zoomIn.addClass('disabled');
            }
        }
        return this;
    }

    /**
     * Disables zoom out
     */
    function disableZoomOut () {
        if (!lock.disableZoomOut) {
            status.disableZoomOut = true;
            if (uiZoomControl) {
                uiZoomControl.zoomOut.addClass('disabled');
            }
        }
        return this;
    }

    /**
     * Enable zoom in
     */
    function enableZoomIn () {
        if (!lock.disableZoomIn) {
            status.disableZoomIn = false;
            if (uiZoomControl) {
                uiZoomControl.zoomIn.removeClass('disabled');
            }
        }
        return this;
    }

    /**
     * Enable zoom out
     */
    function enableZoomOut () {
        if (!lock.disableZoomOut) {
            status.disableZoomOut = false;
            if (uiZoomControl) {
                uiZoomControl.zoomOut.removeClass('disabled');
            }
        }
        return this;
    }

    /**
     * Get status
     * @param name
     * @returns {*}
     */
    function getStatus (name) {
        if (name in status) {
            return status[name];
        } else {
            throw 'You cannot access a property "' + name + '".';
        }
    }

    /** Get a property.*/
    function getProperty (name) {
        if (name in properties) {
            return properties[name];
        } else {
            throw 'You cannot access a property "' + name + '".';
        }
    }

    /** Lock zoom in */
    function lockDisableZoomIn () {
        lock.disableZoomIn = true;
        return this;
    }

    /** Lock zoom out */
    function lockDisableZoomOut () {
        lock.disableZoomOut = true;
        return this;
    }

    /**
     * This is a callback function for zoom-in button. This function increments a pano zoom level.
     */
    function _handleZoomInButtonClick () {
        if (tracker)  tracker.push('Click_ZoomIn');

        var pov = svl.panoViewer.getPov();

        if (pov.zoom < properties.maxZoomLevel && zoomBlink.isBlinking === false) {
          svl.zoomShortcutAlert.zoomClicked();
        }

        if (!status.disableZoomIn) {
            setZoom(pov.zoom + 1);
            canvas.clear().render();
            $(document).trigger('ZoomIn');
        }
    }

    /**
     * This is a callback function for zoom-out button. This function decrements a pano zoom level.
     */
    function _handleZoomOutButtonClick () {
        if (tracker) tracker.push('Click_ZoomOut');

        const pov = svl.panoViewer.getPov();
        if (pov.zoom > properties.minZoomLevel && zoomBlink.isBlinking === false) {
          svl.zoomShortcutAlert.zoomClicked();
        }

        if (!status.disableZoomOut) {
            setZoom(pov.zoom - 1);
            canvas.clear().render();
            $(document).trigger('ZoomOut');
        }
    }

    /**
     * Callback for the scroll wheel / trackpad over the pano.
     * @param e jQuery wheel event
     */
    function _handleZoomWheel(e) {
        // Prevent the page from scrolling while zooming the pano.
        e.preventDefault();

        // Scrolling up (negative deltaY) zooms in; scrolling down zooms out.
        const zoomDelta = -e.originalEvent.deltaY * ZOOM_WHEEL_SENSITIVITY;

        // Honor the disable locks (e.g. onboarding) and skip no-op zooms at the min/max.
        if (zoomDelta > 0 && status.disableZoomIn) return;
        if (zoomDelta < 0 && status.disableZoomOut) return;

        setZoom(svl.panoViewer.getPov().zoom + zoomDelta);

        // Log scroll zooming, but debounce so a single gesture doesn't flood the tracker.
        if (tracker) {
            window.clearTimeout(wheelTrackTimeout);
            wheelTrackTimeout = window.setTimeout(() => {
                tracker.push(zoomDelta > 0 ? 'Scroll_ZoomIn' : 'Scroll_ZoomOut');
            }, 250);
        }
    }

    /**
     * These functions are called when the keyboard shortcut for zoomIn/Out is used.
     */

    /** Zoom in */
    function zoomIn () {
        if (!status.disableZoomIn) {
            const pov = svl.panoViewer.getPov();
            setZoom(pov.zoom + 1);
            canvas.clear().render();
            $(document).trigger('ZoomIn');
            return this;
        } else {
            return false;
        }
    }

    /** Zoom out */
    function zoomOut () {
        // This method is called from outside this class to zoom out from a pano.
        if (!status.disableZoomOut) {
            const pov = svl.panoViewer.getPov();
            setZoom(pov.zoom - 1);
            canvas.clear().render();
            $(document).trigger('ZoomOut');
            return this;
        } else {
            return false;
        }
    }

    /**
     * This method sets the zoom level of the Street View.
     */
    function setZoom(zoomLevelIn) {
        if (typeof zoomLevelIn !== "number") { return false; }

        // Set the zoom level and change the panorama properties.
        let zoomLevel = undefined;
        if (zoomLevelIn <= properties.minZoomLevel) {
            zoomLevel = properties.minZoomLevel;
            enableZoomIn();
            disableZoomOut();
        } else if (zoomLevelIn >= properties.maxZoomLevel) {
            zoomLevel = properties.maxZoomLevel;
            disableZoomIn();
            enableZoomOut();
        } else {
            zoomLevel = zoomLevelIn;
            enableZoomIn();
            enableZoomOut();
        }
        svl.panoManager.setZoom(zoomLevel);
        const labels = svl.labelContainer.getCanvasLabels();
        for (let i = 0; i < labels.length; i += 1) {
            labels[i].setHoverInfoVisibility('hidden');
        }
        svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
        svl.canvas.clear().render();
        return zoomLevel;
    }

    /**
     * Stop blinking the zoom-in and zoom-out buttons
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        zoomBlink.isBlinking = false;
        if (uiZoomControl) {
            uiZoomControl.zoomIn.removeClass("highlight-50");
            uiZoomControl.zoomOut.removeClass("highlight-50");
        }
    }



    /**
     * This method sets the maximum zoom level.
     */
    function setMaxZoomLevel (zoomLevel) {
        properties.maxZoomLevel = zoomLevel;
        return this;
    }

    /** This method sets the minimum zoom level. */
    function setMinZoomLevel (zoomLevel) {
        properties.minZoomLevel = zoomLevel;
        return this;
    }

    /** Lock zoom in */
    function unlockDisableZoomIn () {
        lock.disableZoomIn = false;
        return this;
    }

    /** Lock zoom out */
    function unlockDisableZoomOut () {
        lock.disableZoomOut = false;
        return this;
    }

    /**
     * Change the opacity of zoom buttons
     * @returns {updateOpacity}
     */
    function updateOpacity () {
        const pov = svl.panoViewer.getPov();

        if (pov && uiZoomControl) {
            const zoom = pov.zoom;
            // Disable the zoom-in button at max zoom and the zoom-out button at min zoom.
            uiZoomControl.zoomIn.toggleClass('disabled', zoom >= properties.maxZoomLevel || status.disableZoomIn);
            uiZoomControl.zoomOut.toggleClass('disabled', zoom <= properties.minZoomLevel || status.disableZoomOut);
        }
        return this;
    }

    self.blinkZoomIn = blinkZoomIn;
    self.blinkZoomOut = blinkZoomOut;
    self.disableZoomIn = disableZoomIn;
    self.disableZoomOut = disableZoomOut;
    self.enableZoomIn = enableZoomIn;
    self.enableZoomOut = enableZoomOut;
    self.getStatus = getStatus;
    self.getProperty = getProperty;
    self.getZoomInUI = getZoomInUI;
    self.getZoomOutUI = getZoomOutUI;
    self.lockDisableZoomIn = lockDisableZoomIn;
    self.lockDisableZoomOut = lockDisableZoomOut;
    self.stopBlinking = stopBlinking;
    self.updateOpacity = updateOpacity;
    self.setMaxZoomLevel = setMaxZoomLevel;
    self.setMinZoomLevel = setMinZoomLevel;
    self.unlockDisableZoomIn = unlockDisableZoomIn;
    self.unlockDisableZoomOut = unlockDisableZoomOut;
    self.zoomIn = zoomIn;
    self.zoomOut = zoomOut;

    uiZoomControl.zoomIn.bind('click', _handleZoomInButtonClick);
    uiZoomControl.zoomOut.bind('click', _handleZoomOutButtonClick);
    svl.ui.streetview.viewControlLayer.bind('wheel', _handleZoomWheel);
    return self;
}
