/**
 *
 * @param x
 * @param y
 * @param pov
 * @param params
 * @returns {{className: string, svImageCoordinate: undefined, canvasCoordinate: undefined, originalCanvasCoordinate: undefined, pov: undefined, originalPov: undefined}}
 * @constructor
 */
function Point (svl, x, y, pov, params) {
    'use strict';

    if(params.fillStyle==undefined){
        params.fillStyle = 'rgba(255,255,255,0.5)';
    }
    var self = {
            className : 'Point',
            svImageCoordinate : undefined,
            canvasCoordinate : undefined,
            originalCanvasCoordinate : undefined,
            pov : undefined,
            originalPov : undefined
        };
    var belongsTo;
    var properties = {
        fillStyleInnerCircle: params.fillStyle,
        lineWidthOuterCircle: 2,
        iconImagePath: undefined,
        originalFillStyleInnerCircle: undefined,
        originalStrokeStyleOuterCircle: undefined,
        radiusInnerCircle: 4,
        radiusOuterCircle: 5,
        strokeStyleOuterCircle: 'rgba(255,255,255,1)',
        storedInDatabase: false
    };
    var unnessesaryProperties = ['originalFillStyleInnerCircle', 'originalStrokeStyleOuterCircle'];
    var status = {
            'deleted' : false,
            'visibility' : 'visible',
            'visibilityIcon' : 'visible'
    };

    function _init (x, y, pov, params) {
        // Convert a canvas coordinate (x, y) into a sv image coordinate
        // Note, svImageCoordinate.x varies from 0 to svImageWidth and
        // svImageCoordinate.y varies from -(svImageHeight/2) to svImageHeight/2.
        
        // Adjust the zoom level
        var zoom = pov.zoom;
        var zoomFactor = svl.zoomFactor[zoom];
        var svImageHeight = svl.svImageHeight;
        var svImageWidth = svl.svImageWidth;
        self.svImageCoordinate = {};
        self.svImageCoordinate.x = svImageWidth * pov.heading / 360 + (svl.alpha_x * (x - (svl.canvasWidth / 2)) / zoomFactor);
        self.svImageCoordinate.y = (svImageHeight / 2) * pov.pitch / 90 + (svl.alpha_y * (y - (svl.canvasHeight / 2)) / zoomFactor);
        // svImageCoordinate.x could be negative, so adjust it.
        if (self.svImageCoordinate.x < 0) {
            self.svImageCoordinate.x = self.svImageCoordinate.x + svImageWidth;
        }
        // Keep the original canvas coordinate and
        // canvas pov just in case.
        self.canvasCoordinate = {
            x : x,
            y : y
        };
        self.originalCanvasCoordinate = {
            x : x,
            y : y
        };

        // var pointPOV = calculatePointPov(pov);
        var pointPOV = pov;
        self.pov = {
            heading : pointPOV.heading,
            pitch : pointPOV.pitch,
            zoom : pointPOV.zoom
        };
        self.originalPov = {
            heading : pointPOV.heading,
            pitch : pointPOV.pitch,
            zoom : pointPOV.zoom
        };

        // Set properties
        for (var propName in properties) {
            // It is ok if iconImagePath is not specified
            if(propName === "iconImagePath") {
                if (params.iconImagePath) {
                    properties.iconImagePath = params.iconImagePath;
                } else {
                    continue;
                }
            }

            if (propName in params) {
                properties[propName] = params[propName];
            } else {
                // See if this property must be set.
                if (unnessesaryProperties.indexOf(propName) === -1) {
                    // throw self.className + ': "' + propName + '" is not defined.';
                }
            }
        }

        properties.originalFillStyleInnerCircle = properties.fillStyleInnerCircle;
        properties.originalStrokeStyleOuterCircle = properties.strokeStyleOuterCircle;
        return true;
    }


    /** Deprecated */
    function _init2 () { return true; }

    /** Get x canvas coordinate */
    function getCanvasX () { return self.canvasCoordinate.x; }

    /** Get y canvas coordinate */
    function getCanvasY () { return self.canvasCoordinate.y; }

    /** return the fill color of this point */
    function getFill () { return properties.fillStyleInnerCircle; }

    /** Get POV
     * This method returns the pov of this label
     * @returns {{heading: Number, pitch: Number, zoom: Number}}
     */

    /* OLD
    function getPOV () {
        return pov;
    }*/

    /** Get POV
     * This method returns the pov of this label based on panorama's POV
     * @returns {{heading: Number, pitch: Number, zoom: Number}}
     */
    function calculatePointPov (pov) {
        var heading, pitch = parseInt(pov.pitch, 10),
            zoom = parseInt(pov.zoom, 10),
            svImage = getGSVImageCoordinate(),
            svImageX = svImage.x;

        heading = parseInt((parseInt(svImageX, 10) / svl.svImageWidth) * 360, 10) % 360;

        return {
            heading: parseInt(heading, 10),
            pitch: pitch,
            zoom: zoom
        };
    }

    /** Returns an object directly above this object. */
    function getParent () { return belongsTo ? belongsTo : null; }

    /**
     * Add this into its own utility
     * Details in PanoMarker.js
     */

    function get3dFov (zoom) {
        return zoom <= 2 ?
        126.5 - zoom * 36.75 :  // linear descent
        195.93 / Math.pow(1.92, zoom); // parameters determined experimentally
    }

    /***
     * Get canvas coordinates of points for a specific POV
     * @param original canvas coordinate of the point
     */
    // function povToCanvasCoordinate(origCanvasCoord, targetPov) {
    //
    //     var povChangeStatus = povChange["status"];
    //
    //     var canvasCoord = origCanvasCoord;
    //     if (povChangeStatus){
    //         var currentPov = povChange["prevPov"],
    //             targetPov = povChange["currPov"];
    //         var zoom = currentPov.zoom;
    //
    //         var viewport = document.getElementById('pano');
    //
    //
    //         // Calculate the position according to the viewport. Even though the marker
    //         // doesn't sit directly underneath the panorama container, we pass it on as
    //         // the viewport because it has the actual viewport dimensions.
    //         var offset = povToPixel3DOffset(targetPov, currentPov, zoom, viewport);
    //
    //         if (offset !== null) {
    //             canvasCoord.x = offset.left - origCanvasCoord.x;
    //             canvasCoord.y = offset.top - origCanvasCoord.y;
    //         } else {
    //             // If offset is null, the marker is "behind" the camera,
    //             // therefore we position the marker outside of the viewport
    //             var pointWidth = 3; //TODO: Get from Point class
    //             canvasCoord.x = -(9999 + pointWidth);
    //             canvasCoord.y = 0;
    //         }
    //         povChange["status"] = false;
    //     }
    //     else{
    //         //TODO: Determine how to directly use the targetPOV for giving the coordinate values
    //         // Check if there exists such as case through testing
    //         // Display error message for this case
    //         console.log("We got a direct targetPOV when the previous one is unavailable. Returning orig canvas coordinate");
    //     }
    //     return canvasCoord;
    //
    // }

    /***
     * Get canvas coordinates of points from the POV
     * @return {Object} Top and Left offsets for the given viewport that point to
     *     the desired point-of-view.
     */
    function povToPixel3DOffset(targetPov, currentPov, zoom, viewport) {

        // Gather required variables and convert to radians where necessary
        var width = viewport.offsetWidth;
        var height = viewport.offsetHeight;
        var target = {
            left: width / 2,
            top: height / 2
        };

        var DEG_TO_RAD = Math.PI / 180.0;
        var fov = PanoMarker.get3dFov(zoom) * DEG_TO_RAD;
        var h0 = currentPov.heading * DEG_TO_RAD;
        var p0 = currentPov.pitch * DEG_TO_RAD;
        var h = targetPov.heading * DEG_TO_RAD;
        var p = targetPov.pitch * DEG_TO_RAD;

        // f = focal length = distance of current POV to image plane
        var f = (width / 2) / Math.tan(fov / 2);

        // our coordinate system: camera at (0,0,0), heading = pitch = 0 at (0,f,0)
        // calculate 3d coordinates of viewport center and target
        var cos_p = Math.cos(p);
        var sin_p = Math.sin(p);

        var cos_h = Math.cos(h);
        var sin_h = Math.sin(h);

        var x = f * cos_p * sin_h;
        var y = f * cos_p * cos_h;
        var z = f * sin_p;

        var cos_p0 = Math.cos(p0);
        var sin_p0 = Math.sin(p0);

        var cos_h0 = Math.cos(h0);
        var sin_h0 = Math.sin(h0);

        var x0 = f * cos_p0 * sin_h0;
        var y0 = f * cos_p0 * cos_h0;
        var z0 = f * sin_p0;

        var nDotD = x0 * x + y0 * y + z0 * z;
        var nDotC = x0 * x0 + y0 * y0 + z0 * z0;

        // nDotD == |targetVec| * |currentVec| * cos(theta)
        // nDotC == |currentVec| * |currentVec| * 1
        // Note: |currentVec| == |targetVec| == f

        // Sanity check: the vectors shouldn't be perpendicular because the line
        // from camera through target would never intersect with the image plane
        if (Math.abs(nDotD) < 1e-6) {
            return null;
        }

        // t is the scale to use for the target vector such that its end
        // touches the image plane. It's equal to 1/cos(theta) ==
        //     (distance from camera to image plane through target) /
        //     (distance from camera to target == f)
        var t = nDotC / nDotD;

        // Sanity check: it doesn't make sense to scale the vector in a negative
        // direction. In fact, it should even be t >= 1.0 since the image plane
        // is always outside the pano sphere (except at the viewport center)
        if (t < 0.0) {
            return null;
        }

        // (tx, ty, tz) are the coordinates of the intersection point between a
        // line through camera and target with the image plane
        var tx = t * x;
        var ty = t * y;
        var tz = t * z;

        // u and v are the basis vectors for the image plane
        var vx = -sin_p0 * sin_h0;
        var vy = -sin_p0 * cos_h0;
        var vz = cos_p0;

        var ux = cos_h0;
        var uy = -sin_h0;
        var uz = 0;

        // normalize horiz. basis vector to obtain orthonormal basis
        var ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
        ux /= ul;
        uy /= ul;
        uz /= ul;

        // project the intersection point t onto the basis to obtain offsets in
        // terms of actual pixels in the viewport
        var du = tx * ux + ty * uy + tz * uz;
        var dv = tx * vx + ty * vy + tz * vz;

        // use the calculated pixel offsets
        target.left += du;
        target.top -= dv;
        return target;
    }




    /**
     * This function takes current pov of the Street View as a parameter and returns a canvas coordinate of a point.
     * @param pov
     * @returns {{x, y}}
     */
    function getCanvasCoordinate (pov) {
        // self.canvasCoordinate = svl.gsvImageCoordinate2CanvasCoordinate(self.svImageCoordinate.x, self.svImageCoordinate.y, pov);
        // return svl.gsvImageCoordinate2CanvasCoordinate(self.svImageCoordinate.x, self.svImageCoordinate.y, pov);
        var origCoord = $.extend(true, {}, self.originalCanvasCoordinate);
        var origPov = $.extend(true, {}, self.originalPov);

        var povChange = svl.map.getPovChangeStatus();
        var povChangeStatus = povChange["status"];

        if (povChangeStatus){
            var currentPov = pov,
                targetPov = origPov;
            var zoom = currentPov.zoom;

            var viewport = document.getElementById('pano');

            // Calculate the position according to the viewport. Even though the marker
            // doesn't sit directly underneath the panorama container, we pass it on as
            // the viewport because it has the actual viewport dimensions.
            var offset = povToPixel3DOffset(targetPov, currentPov, zoom, viewport);

            if (offset !== null) {
                self.canvasCoordinate.x = offset.left - origCoord.x;
                self.canvasCoordinate.y = offset.top - origCoord.y;
            } else {
                // If offset is null, the marker is "behind" the camera,
                // therefore we position the marker outside of the viewport
                var pointWidth = 3; //TODO: Get from Point class
                self.canvasCoordinate.x = -(9999 + pointWidth);
                self.canvasCoordinate.y = 0;
                console.log("Behind Camera");
            }
            console.log("CalculatedRendererPt at: " + self.canvasCoordinate.x + ", " + self.canvasCoordinate.y);
            povChange["status"] = false;
        }
        /*
        else{
            //TODO: Determine how to directly use the targetPOV for giving the coordinate values
            // Check if there exists such as case through testing
            // Display error message for this case
            console.log("We got a direct targetPOV when the previous one is unavailable. Returning orig canvas coordinate");
        }*/

        // self.canvasCoordinate = svl.map.povToCanvasCoordinate($.extend(true, {}, self.originalCanvasCoordinate), pov);
        return self.canvasCoordinate;
    }

    /**
     * Get the fill style.
     * @returns {*}
     */
    function getFillStyle () { return  getFill(); }

    function getGSVImageCoordinate () { return $.extend(true, {}, self.svImageCoordinate); }

    function getProperty (name) { return (name in properties) ? properties[name] : null; }

    function getProperties () { return $.extend(true, {}, properties); }

    function isOn (x, y) {
        var margin = properties.radiusOuterCircle / 2 + 3;
        if (x < self.canvasCoordinate.x + margin &&
            x > self.canvasCoordinate.x - margin &&
            y < self.canvasCoordinate.y + margin &&
            y > self.canvasCoordinate.y - margin) {
            return this;
        } else {
            return false;
        }
    }

    /**
     * Renders this point
     * @param pov
     * @param ctx
     */
    function render (pov, ctx) {
        if (status.visibility === 'visible') {
            var coord = self.getCanvasCoordinate(pov),
                x = coord.x,
                y = coord.y,
                r = properties.radiusInnerCircle;

            console.log("Rendering at: " + x + ", " + y);

            ctx.save();
            ctx.strokeStyle = properties.strokeStyleOuterCircle;
            ctx.lineWidth = properties.lineWidthOuterCircle;
            ctx.beginPath();
            ctx.arc(x, y, properties.radiusOuterCircle, 2 * Math.PI, 0, true);
            ctx.closePath();
            ctx.stroke();
            ctx.fillStyle = properties.fillStyleInnerCircle; // changeAlphaRGBA(properties.fillStyleInnerCircle, 0.5);
            ctx.beginPath();
            ctx.arc(x, y, properties.radiusInnerCircle, 2 * Math.PI, 0, true);
            ctx.closePath();
            ctx.fill();

            // Render an icon
            var imagePath = getProperty("iconImagePath");
            if (imagePath) {
                var imageObj, imageHeight, imageWidth, imageX, imageY;
                imageObj = new Image();
                imageHeight = imageWidth = 2 * r - 3;
                imageX =  x - r + 2;
                imageY = y - r + 2;

                //ctx.globalAlpha = 0.5;
                imageObj.src = imagePath;

                try {
                    ctx.drawImage(imageObj, imageX, imageY, imageHeight, imageWidth);
                } catch (e) {
                    // console.debug(e);
                }

                //ctx.drawImage(imageObj, imageX, imageY, imageHeight, imageWidth);
            }
            ctx.restore();
        }
    }

    /**
     * This method reverts the fillStyle property to its original value
     * @returns {resetFillStyle}
     */
    function resetFillStyle () {
        properties.fillStyleInnerCircle = properties.originalFillStyleInnerCircle;
        return this;
    }

    /**
     * Set the svImageCoordinate
     * @param coord
     * @returns {self}
     */
    function resetSVImageCoordinate (coord) {
        self.svImageCoordinate = coord;
        self.canvasCoordinate = {x : 0, y: 0};
        return this;
    }

    /**
     * This method resets the strokeStyle to its original value
     * @returns {self}
     */
    function resetStrokeStyle () {
        properties.strokeStyleOuterCircle = properties.originalStrokeStyleOuterCircle;
        return this;
    }

    /**
     * This function sets which object (Path)
     * @param obj
     * @returns {self}
     */
    function setBelongsTo (obj) {
        belongsTo = obj;
        return this;
    }

    /**
     * This method sets the fill style of inner circle to the specified value
     * @param value
     * @returns {self}
     */
    function setFillStyle (value) {
        properties.fillStyleInnerCircle = value;
        return this;
    }

    function setIconPath (iconPath) {
        properties.iconImagePath = iconPath;
        return this;
    }

    /**
     * this method sets the photographerHeading and photographerPitch
     * @param heading
     * @param pitch
     * @returns {self}
     */
    function setPhotographerPov (heading, pitch) {
        properties.photographerHeading = heading;
        properties.photographerPitch = pitch;
        return this;
    }

    /**
     * This function resets all the properties specified in params.
     * @param params
     * @returns {self}
     */
    function setProperties (params) {
        for (var key in params) {
            if (key in properties) {
                properties[key] = params[key];
            }
        }

        if ('originalCanvasCoordinate' in params) {
            self.originalCanvasCoordinate = params.originalCanvasCoordinate;
        }

        //
        // Set pov parameters
        self.pov = self.pov || {};
        if ('pov' in params) { self.pov = params.pov; }
        if ('heading' in params) { self.pov.heading = params.heading; }
        if ('pitch' in params) { self.pov.pitch = params.pitch; }
        if ('zoom' in params) { self.pov.zoom = params.zoom; }

        // Set original pov parameters
        self.originalPov = self.originalPov || {};
        if ('originalHeading' in params) { self.originalPov.heading = params.originalHeading; }
        if ('originalPitch' in params) { self.originalPov.pitch = params.originalPitch; }
        if ('originalZoom' in params) { self.originalPov.zoom = params.originalZoom; }

        if (!properties.originalFillStyleInnerCircle) {
            properties.originalFillStyleInnerCircle = properties.fillStyleInnerCircle;
        }
        if (!properties.originalStrokeStyleOuterCircle) {
            properties.originalStrokeStyleOuterCircle = properties.strokeStyleOuterCircle;
        }
        return this;
    }

    function setStrokeStyle (val) {
        // This method sets the strokeStyle of an outer circle to val
        properties.strokeStyleOuterCircle = val;
        return this;
    }

    self.belongsTo = getParent;
    self.getPOV = calculatePointPov;
    self.getCanvasCoordinate = getCanvasCoordinate;
    self.getCanvasX = getCanvasX;
    self.getCanvasY = getCanvasY;
    self.getFill = getFill;
    self.getFillStyle = getFillStyle;
    self.getGSVImageCoordinate = getGSVImageCoordinate;
    self.getProperty = getProperty;
    self.getProperties = getProperties;
    self.isOn = isOn;
    self.render = render;
    self.resetFillStyle = resetFillStyle;
    self.resetSVImageCoordinate = resetSVImageCoordinate;
    self.resetStrokeStyle = resetStrokeStyle;
    self.setBelongsTo = setBelongsTo;
    self.setFillStyle = setFillStyle;
    self.setIconPath = setIconPath;
    self.setPhotographerPov = setPhotographerPov;
    self.setProperties = setProperties;
    self.setStrokeStyle = setStrokeStyle;
    self.setVisibility = setVisibility;

    function setVisibility (visibility) {
        // This method sets the visibility of a path (and points that cons
        if (visibility === 'visible' || visibility === 'hidden') {
            status.visibility = visibility;
        }
        return this;
    }

    // Todo. Deprecated method. Get rid of this later.
    self.resetProperties = self.setProperties;

    _init(x, y, pov, params);

    return self;
}
