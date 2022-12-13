/**
 * Todo. Separate the UI component and the logic component
 * @param canvas
 * @param mapService
 * @param canvas
 * @param mapService
 * @param tracker
 * @param uiZoomControl
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ZoomControl (canvas, mapService, tracker, uiZoomControl) {
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
        blinkInterval;


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
     * Blink the zoom in and zoom-out buttons
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            uiZoomControl.zoomIn.toggleClass("highlight-50");
            uiZoomControl.zoomOut.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Blink the zoom in button
     */
    function blinkZoomIn () {
        stopBlinking();
        zoomBlink.isBlinking = true;
        blinkInterval = window.setInterval(function () {
            uiZoomControl.zoomIn.toggleClass("highlight-100");
        }, 500);
    }

    /**
     * Blink the zoom out button
     */
    function blinkZoomOut () {
        stopBlinking();
        zoomBlink.isBlinking = true;
        blinkInterval = window.setInterval(function () {
            uiZoomControl.zoomOut.toggleClass("highlight-100");
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
     * This is a callback function for zoom-in button. This function increments a sv zoom level.
     */
    function _handleZoomInButtonClick () {
        if (tracker)  tracker.push('Click_ZoomIn');

        var pov = mapService.getPov();

        if (pov.zoom < properties.maxZoomLevel && zoomBlink.isBlinking === false) {
          svl.zoomShortcutAlert.zoomClicked();
        }

        if (!status.disableZoomIn) {
            var povChange = mapService.getPovChangeStatus();

            setZoom(pov.zoom + 1);
            povChange["status"] = true;
            canvas.clear();
            canvas.render();
            $(document).trigger('ZoomIn');
        }
    }

    /**
     * This is a callback function for zoom-out button. This function decrements a sv zoom level.
     */
    function _handleZoomOutButtonClick () {
        if (tracker) tracker.push('Click_ZoomOut');

        var pov = mapService.getPov();

        if (pov.zoom > properties.minZoomLevel && zoomBlink.isBlinking === false) {
          svl.zoomShortcutAlert.zoomClicked();
        }

        if (!status.disableZoomOut) {
            var povChange = mapService.getPovChangeStatus();
            setZoom(pov.zoom - 1);
            povChange["status"] = true;
            canvas.clear();
            canvas.render();
            $(document).trigger('ZoomOut');
        }
    }

    /**
     * These functions are called when the keyboard shortcut for zoomIn/Out is used.
     */

    /** Zoom in */
    function zoomIn () {
        if (!status.disableZoomIn) {

            var povChange = mapService.getPovChangeStatus();
            var pov = mapService.getPov();

            setZoom(pov.zoom + 1);
            povChange["status"] = true;
            canvas.clear();
            canvas.render();
            $(document).trigger('ZoomIn');
            return this;
        } else {
            return false;
        }
    }

    /** Zoom out */
    function zoomOut () {
        // This method is called from outside this class to zoom out from a GSV image.
        if (!status.disableZoomOut) {

            var povChange = mapService.getPovChangeStatus();
            var pov = mapService.getPov();

            setZoom(pov.zoom - 1);
            povChange["status"] = true;
            canvas.clear();
            canvas.render();
            $(document).trigger('ZoomOut');
            return this;
        } else {
            return false;
        }
    }

    /**
     * This method sets the zoom level of the Street View.
     */
    function setZoom (zoomLevelIn) {
        if (typeof zoomLevelIn !== "number") { return false; }

        // Set the zoom level and change the panorama properties.
        var zoomLevel = undefined;
        zoomLevelIn = parseInt(zoomLevelIn);
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
        mapService.setZoom(zoomLevel);
        var i,
            labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;
        for (i = 0; i < labelLen; i += 1) {
            labels[i].setTagVisibility('hidden');
            labels[i].resetTagCoordinate();
        }
        svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
        svl.canvas.clear();
        svl.canvas.render();
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

            uiZoomControl.zoomIn.removeClass("highlight-100");
            uiZoomControl.zoomOut.removeClass("highlight-100");
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
        var pov = mapService.getPov();

        if (pov && uiZoomControl) {
            var zoom = pov.zoom;
            // Change opacity
            if (zoom >= properties.maxZoomLevel) {
                uiZoomControl.zoomIn.css('opacity', 0.5);
                uiZoomControl.zoomOut.css('opacity', 1);
            } else if (zoom <= properties.minZoomLevel) {
                uiZoomControl.zoomIn.css('opacity', 1);
                uiZoomControl.zoomOut.css('opacity', 0.5);
            } else {
                uiZoomControl.zoomIn.css('opacity', 1);
                uiZoomControl.zoomOut.css('opacity', 1);
            }
        }

        // If zoom in and out are disabled, fade them out anyway.
        if (status.disableZoomIn) { uiZoomControl.zoomIn.css('opacity', 0.5); }
        if (status.disableZoomOut) { uiZoomControl.zoomOut.css('opacity', 0.5); }
        return this;
    }

    self.blink = blink;
    self.blinkZoomIn = blinkZoomIn;
    self.blinkZoomOut = blinkZoomOut;
    self.disableZoomIn = disableZoomIn;
    self.disableZoomOut = disableZoomOut;
    self.enableZoomIn = enableZoomIn;
    self.enableZoomOut = enableZoomOut;
    self.getStatus = getStatus;
    self.getProperties = getProperty; // Todo. Change getProperties to getProperty.
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
    return self;
}
