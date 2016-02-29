var svl = svl || {};

/**
 *
 * @param $ jQuery object
 * @param param Other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ZoomControl ($, param) {
    var self = {
        'className' : 'ZoomControl'
        },
        properties = {
            maxZoomLevel: 3,
            minZoomLevel: 1
        },
        status = {
            disableZoomIn: false,
            disableZoomOut: false
        },
        lock = {
            disableZoomIn: false,
            disableZoomOut: false
        };

    // jQuery dom objects
    var $buttonZoomIn;
    var $buttonZoomOut;

    function _init (param) {
        // Initialization function

        //if ('domIds' in param) {
        if (svl.ui && svl.ui.zoomControl) {
          $buttonZoomIn = svl.ui.zoomControl.zoomIn;
          $buttonZoomOut = svl.ui.zoomControl.zoomOut;

          $buttonZoomIn.bind('click', buttonZoomInClick);
          $buttonZoomOut.bind('click', buttonZoomOutClick);
        }
    }


    function buttonZoomInClick () {
        // This is a callback function for zoom-in button. This function increments a sv zoom level.
        if ('tracker' in svl) {
          svl.tracker.push('Click_ZoomIn');
        }

        if (!status.disableZoomIn) {
            var pov = svl.panorama.getPov();
            setZoom(pov.zoom + 1);
            svl.canvas.clear().render2();
        }
    }

    function buttonZoomOutClick () {
        // This is a callback function for zoom-out button. This function decrements a sv zoom level.
        if ('traker' in svl) {
          svl.tracker.push('Click_ZoomOut');
        }

        if (!status.disableZoomOut) {
            var pov = svl.panorama.getPov();
            setZoom(pov.zoom - 1);
            svl.canvas.clear().render2();
        }
    }

    function pointZoomIn (x, y) {
        // This method takes a (x, y) canvas point and sets a zoom level.
        if (!status.disableZoomIn) {
            // Cancel drawing when zooming in or out.
            if ('canvas' in svl) {
              svl.canvas.cancelDrawing();
            }
            if ('panorama' in svl) {
                var currentPov = svl.panorama.getPov();
                var currentZoomLevel = currentPov.zoom;

                if (currentZoomLevel >= properties.maxZoomLevel) {
                    return false;
                }

                var width = svl.canvasWidth, height = svl.canvasHeight,
                    minPitch = svl.map.getProperty('minPitch'), maxPitch = svl.map.getProperty('maxPitch');

                var zoomFactor = currentZoomLevel; // This needs to be fixed as it wouldn't work above level 3.
                var deltaHeading = (x - (width / 2)) / width * (90 / zoomFactor); // Ugh. Hard coding.
                var deltaPitch = - (y - (height / 2)) / height * (70 / zoomFactor); // Ugh. Hard coding.

                var pov = {};
                pov.zoom = currentZoomLevel + 1;
                pov.heading = currentPov.heading + deltaHeading;
                pov.pitch = currentPov.pitch + deltaPitch;

                // Adjust the pitch angle.
                var maxPitch = svl.map.getMaxPitch();
                var minPitch = svl.map.getMinPitch();
                if (pov.pitch > maxPitch) {
                    pov.pitch = maxPitch;
                } else if (pov.pitch < minPitch) {
                    pov.pitch = minPitch;
                }

                // Adjust the pitch so it won't exceed max/min pitch.
                svl.panorama.setPov(pov);
                return currentZoomLevel;
            } else {
                return false;
            }
        }
    }

    /** This method sets the zoom level of the Street View. */
    function setZoom (zoomLevelIn) {
        if (typeof zoomLevelIn !== "number") { return false; }

        // Cancel drawing when zooming in or out.
        if ('canvas' in svl) { svl.canvas.cancelDrawing(); }

        // Set the zoom level and change the panorama properties.
        var zoomLevel = undefined;
        zoomLevelIn = parseInt(zoomLevelIn);
        if (zoomLevelIn < 1) {
            zoomLevel = 1;
        } else if (zoomLevelIn > properties.maxZoomLevel) {
            zoomLevel = properties.maxZoomLevel;
        } else {
            zoomLevel = zoomLevelIn;
        }
        svl.panorama.setZoom(zoomLevel);
        return zoomLevel;
    }

    /**
     * Disables zooming in
     * @method
     * @returns {self}
     */
    function disableZoomIn () {
        // Enable zoom in.
        if (!lock.disableZoomIn) {
            status.disableZoomIn = true;
            if ($buttonZoomIn) {
                $buttonZoomIn.css('opacity', 0.5);
            }
        }
        return this;
    }

    /** Enable zoom out */
    function disableZoomOut () {
        if (!lock.disableZoomOut) {
            status.disableZoomOut = true;
            if ($buttonZoomOut) {
                $buttonZoomOut.css('opacity', 0.5);
            }
        }
        return this;
    }

    /** Enable zoom in */
    function enableZoomIn () {
        if (!lock.disableZoomIn) {
            status.disableZoomIn = false;
            if ($buttonZoomIn) {
                $buttonZoomIn.css('opacity', 1);
            }
        }
        return this;
    }

    /** Enable zoom out */
    function enableZoomOut () {
        if (!lock.disableZoomOut) {
            status.disableZoomOut = false;
            if ($buttonZoomOut) {
                $buttonZoomOut.css('opacity', 1);
            }
        }
        return this;
    }

    function getLock (name) {
        if (name in lock) {
            return lock[name];
        } else {
            throw 'You cannot access a property "' + name + '".';
        }
    }


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

    function updateOpacity () {
        var pov = svl.getPOV();

        if (pov) {
            var zoom = pov.zoom;
            // Change opacity
            if (zoom >= properties.maxZoomLevel) {
                $buttonZoomIn.css('opacity', 0.5);
                $buttonZoomOut.css('opacity', 1);
            } else if (zoom <= properties.minZoomLevel) {
                $buttonZoomIn.css('opacity', 1);
                $buttonZoomOut.css('opacity', 0.5);
            } else {
                $buttonZoomIn.css('opacity', 1);
                $buttonZoomOut.css('opacity', 1);
            }
        }

        // If zoom in and out are disabled, fade them out anyway.
        if (status.disableZoomIn) { $buttonZoomIn.css('opacity', 0.5); }
        if (status.disableZoomOut) { $buttonZoomOut.css('opacity', 0.5); }
        return this;
    }

    /** This method sets the maximum zoom level. */
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

    /** Zoom in */
    function zoomIn () {
        if (!status.disableZoomIn) {
            var pov = svl.panorama.getPov();
            setZoom(pov.zoom + 1);
            svl.canvas.clear().render2();
            return this;
        } else {
            return false;
        }
    }

    /** Zoom out */
    function zoomOut () {
        // This method is called from outside this class to zoom out from a GSV image.
        if (!status.disableZoomOut) {
            // ViewControl_ZoomOut
            var pov = svl.panorama.getPov();
            setZoom(pov.zoom - 1);
            svl.canvas.clear().render2();
            return this;
        } else {
            return false;
        }
    }

    self.disableZoomIn = disableZoomIn;
    self.disableZoomOut = disableZoomOut;
    self.enableZoomIn = enableZoomIn;
    self.enableZoomOut = enableZoomOut;
    self.getLock = getLock;
    self.getStatus = getStatus;
    self.getProperties = getProperty; // Todo. Change getProperties to getProperty.
    self.lockDisableZoomIn = lockDisableZoomIn;
    self.lockDisableZoomOut = lockDisableZoomOut;
    self.updateOpacity = updateOpacity;
    self.pointZoomIn = pointZoomIn;
    self.setMaxZoomLevel = setMaxZoomLevel;
    self.setMinZoomLevel = setMinZoomLevel;
    self.unlockDisableZoomIn = unlockDisableZoomIn;
    self.unlockDisableZoomOut = unlockDisableZoomOut;
    self.zoomIn = zoomIn;
    self.zoomOut = zoomOut;

    _init(param);

    return self;
}
