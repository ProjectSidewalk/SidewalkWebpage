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
    };
    var properties = {
        maxZoomLevel: 3,
        minZoomLevel: 1
    };
    var status = {
        disableZoomIn: false,
        disableZoomOut: false
    };
    var lock = {
        disableZoomIn: false,
        disableZoomOut: false
    };
    var actionStack = [];

    // jQuery dom objects
    var $buttonZoomIn;
    var $buttonZoomOut;

    ////////////////////////////////////////
    // Private Functions
    ////////////////////////////////////////
    function _init (param) {
        // Initialization function

        //if ('domIds' in param) {
        if (svl.ui && svl.ui.zoomControl) {
          $buttonZoomIn = svl.ui.zoomControl.zoomIn;
          $buttonZoomOut = svl.ui.zoomControl.zoomOut;
          // $buttonZoomIn = ('zoomInButton' in param.domIds) ? $(param.domIds.zoomInButton) : undefined;
          // $buttonZoomOut = ('zoomOutButton' in param.domIds) ? $(param.domIds.zoomOutButton) : undefined;
        // }
        //
        //
        // // Attach listeners to buttons
        // if ($buttonZoomIn && $buttonZoomOut) {
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

                var width = svl.canvasWidth;
                var height = svl.canvasHeight;
                var minPitch = svl.map.getProperty('minPitch');
                var maxPitch = svl.map.getProperty('maxPitch');

                var zoomFactor = currentZoomLevel; // This needs to be fixed as it wouldn't work above level 3.
                var deltaHeading = (x - (width / 2)) / width * (90 / zoomFactor); // Ugh. Hard coding.
                var deltaPitch = - (y - (height / 2)) / height * (70 / zoomFactor); // Ugh. Hard coding.

                var pov = {};
                pov.zoom = currentZoomLevel + 1;
                pov.heading = currentPov.heading + deltaHeading;
                pov.pitch = currentPov.pitch + deltaPitch;

                //
                // Adjust the pitch angle.
                var maxPitch = svl.map.getMaxPitch();
                var minPitch = svl.map.getMinPitch();
                if (pov.pitch > maxPitch) {
                    pov.pitch = maxPitch;
                } else if (pov.pitch < minPitch) {
                    pov.pitch = minPitch;
                }

                //
                // Adjust the pitch so it won't exceed max/min pitch.
                svl.panorama.setPov(pov);
                return currentZoomLevel;
            } else {
                return false;
            }
        }
    }

    function setZoom (zoomLevelIn) {
        // This method sets the zoom level of the street view image.
        if (typeof zoomLevelIn !== "number") {
            return false;
        }

        // Cancel drawing when zooming in or out.
        if ('canvas' in svl) {
          svl.canvas.cancelDrawing();
        }

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

    ////////////////////////////////////////
    // Public Functions
    ////////////////////////////////////////
    /**
     * Disables zooming in
     * @method
     * @returns {self}
     */
    self.disableZoomIn = function () {
        // Enable zoom in.
        if (!lock.disableZoomIn) {
            status.disableZoomIn = true;
            if ($buttonZoomIn) {
                $buttonZoomIn.css('opacity', 0.5);
            }
        }
        return this;
    };

    self.disableZoomOut = function () {
        // Enable zoom out.
        if (!lock.disableZoomOut) {
            status.disableZoomOut = true;
            if ($buttonZoomOut) {
                $buttonZoomOut.css('opacity', 0.5);
            }
        }
        return this;
    };

    self.enableZoomIn = function () {
        // Enable zoom in.
        if (!lock.disableZoomIn) {
            status.disableZoomIn = false;
            if ($buttonZoomIn) {
                $buttonZoomIn.css('opacity', 1);
            }
        }
        return this;
    }

    self.enableZoomOut = function () {
        // Enable zoom out.
        if (!lock.disableZoomOut) {
            status.disableZoomOut = false;
            if ($buttonZoomOut) {
                $buttonZoomOut.css('opacity', 1);
            }
        }
        return this;
    };

    self.getLock = function (name) {
        if (name in lock) {
            return lock[name];
        } else {
            var errMsg = 'You cannot access a property "' + name + '".';
            throw errMsg;
        }
    };

    self.getStatus = function (name) {
        if (name in status) {
            return status[name];
        } else {
            var errMsg = 'You cannot access a property "' + name + '".';
            throw errMsg;
        }
    };

    self.getProperties = function (name) {
        if (name in properties) {
            return properties[name];
        } else {
            var errMsg = 'You cannot access a property "' + name + '".';
            throw errMsg;
        }
    };

    self.lockDisableZoomIn = function () {
        // Lock zoom in
        lock.disableZoomIn = true;
        return this;
    };

    self.lockDisableZoomOut = function () {
        // Lock zoom out.
        lock.disableZoomOut = true;
        return this;
    };

    self.updateOpacity = function () {
        var pov = svl.getPOV();

        if (pov) {
            var zoom = pov.zoom;
            //
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

        //
        // If zoom in and out are disabled, fade them out anyway.
        if (status.disableZoomIn) {
            $buttonZoomIn.css('opacity', 0.5);
        }
        if (status.disableZoomOut) {
            $buttonZoomOut.css('opacity', 0.5);
        }


        return this;
    };

    self.pointZoomIn = function (x, y) {
        // This function takes a canvas coordinate (x, y) and pass it to a private method pointZoomIn()
        if (!status.disableZoomIn) {
            return pointZoomIn(x, y);
        } else {
            return false;
        }
    };

    self.setMaxZoomLevel = function (zoomLevel) {
        // This method sets the maximum zoom level that SV can show.
        properties.maxZoomLevel = zoomLevel;
        return this;
    };

    self.setMinZoomLevel = function (zoomLevel) {
        // This method sets the minimum zoom level that SV can show.
        properties.minZoomLevel = zoomLevel;
        return this;
    };

    self.unlockDisableZoomIn = function () {
        // Lock zoom in
        lock.disableZoomIn = false;
        return this;
    };

    self.unlockDisableZoomOut = function () {
        // Lock zoom out.
        lock.disableZoomOut = false;
        return this;
    };

    self.zoomIn = function () {
        // This method is called from outside this object to zoom in to a GSV image.
        if (!status.disableZoomIn) {
            var pov = svl.panorama.getPov();
            setZoom(pov.zoom + 1);
            svl.canvas.clear().render2();
            return this;
        } else {
            return false;
        }
    };

    self.zoomOut = function () {
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
    };

    ////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////
    _init(param);

    return self;
};
