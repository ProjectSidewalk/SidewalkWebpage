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
            originalPov : undefined,
            panoramaPov : undefined
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
        severity: undefined,
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
        self.panoramaPov = {
            heading: pov.heading,
            pitch: pov.pitch,
            zoom: pov.zoom
        };

        // Calculate the POV of the label
        var pointPOV;
        if (!jQuery.isEmptyObject(pov)){
            pointPOV = calculatePointPov(x, y, pov);
        }
        else {
            pointPOV = pov;
        }

        self.pov = {
            heading : pointPOV.heading,
            pitch : pointPOV.pitch,
            zoom : pointPOV.zoom
        };

        self.originalPov = {
            heading: pointPOV.heading,
            pitch: pointPOV.pitch,
            zoom: pointPOV.zoom
        };

        // Convert a canvas coordinate (x, y) into a sv image coordinate
        // Note, svImageCoordinate.x varies from 0 to svImageWidth and
        // svImageCoordinate.y varies from -(svImageHeight/2) to svImageHeight/2.

        var svImageWidth = svl.svImageWidth;
        // var svImageHeight = svl.svImageHeight;

        // Adjust the zoom level
        /* old calculation
        var zoom = pov.zoom;
        var zoomFactor = svl.zoomFactor[zoom];
        self.svImageCoordinate = {};
        self.svImageCoordinate.x = svImageWidth * pov.heading / 360 + (svl.alpha_x * (x - (svl.canvasWidth / 2)) / zoomFactor);
        self.svImageCoordinate.y = (svImageHeight / 2) * pov.pitch / 90 + (svl.alpha_y * (y - (svl.canvasHeight / 2)) / zoomFactor);
        // svImageCoordinate.x could be negative, so adjust it.
        if (self.svImageCoordinate.x < 0) {
            self.svImageCoordinate.x = self.svImageCoordinate.x + svImageWidth;
        }
        */

        var svImageCoord = util.panomarker.calculateImageCoordinateFromPointPov(self.originalPov);

        if (svImageCoord.x < 0) {
            svImageCoord.x = svImageCoord.x + svImageWidth;
        }
        self.svImageCoordinate = svImageCoord;

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

    function getPOV () {
        return $.extend(true, {}, self.pov);
    }

    /** Get the initial pov */
    function getOriginalPov(){
        return $.extend(true, {}, self.originalPov);
    }

    /** Returns an object directly above this object. */
    function getParent () { return belongsTo ? belongsTo : null; }

    /**
     * Get the fill style.
     * @returns {*}
     */
    function getFillStyle () { return  getFill(); }

    function getCanvasCoordinate () { return $.extend(true, {}, self.canvasCoordinate); }

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

    function calculateCanvasCoordinate(pov){
        var canvasCoord = getCanvasCoordinate();
        var origPov = getOriginalPov();
        self.canvasCoordinate =  util.panomarker.getCanvasCoordinate(canvasCoord, origPov, pov);
        return self.canvasCoordinate;
    }

    function calculatePointPov(x, y, pov){
        return util.panomarker.calculatePointPov(x, y, pov);
    }

    /**
     * Renders label and severity icons onto the main screen
     * @param pov
     * @param ctx
     */
    function render (pov, ctx) {
        if (status.visibility === 'visible') {
            var coord = calculateCanvasCoordinate(pov),
                x = coord.x,
                y = coord.y,
                r = properties.radiusInnerCircle;

            // Update the new pov of the label
            if (coord.x < 0){
                self.pov = {};
            }
            else {
                self.pov = calculatePointPov(coord.x, coord.y, pov);
            }

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

            // Only create a severity icon if there's an option for marking severity
            if (properties.iconType != 'NoSidewalk' && properties.iconType != 'Occlusion') {
                showSeverity(pov, ctx);
            }
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
     * This function sets a single property
     * @param key       Property value to be changed
     * @param value     New value for property field
     */
    function setProperty (key, value) {
        properties[key] = value;
        console.log('Key: ' + key + ' Value: ' + value);
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
    self.calculateCanvasCoordinate = calculateCanvasCoordinate;
    self.getCanvasX = getCanvasX;
    self.getCanvasY = getCanvasY;
    self.getCanvasCoordinate = getCanvasCoordinate;
    self.getPOV = getPOV;
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

    /**
     * Shows the severity of the label
     */
    function showSeverity(pov, ctx) {
        // if (status.tagVisibility !== 'hidden') {
        var coord = calculateCanvasCoordinate(pov),
            x = coord.x,
            y = coord.y;

        // console.log('x: ' + x + ' y: ' + y);
        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = 'rgb(60, 60, 60, 0.9)';
        ctx.ellipse(x - 14, y - 10.5, 10, 10, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.closePath();
        ctx.beginPath();
        ctx.fillStyle = 'rgb(255, 255, 255)';
        ctx.font = "12px Open Sans";

        if (properties.severity == undefined) {
            ctx.fillText('!', x - 16.5, y - 7.5);
        } else {
            ctx.fillText(properties.severity, x - 16.5, y - 7.5);
        }

        ctx.closePath();
        ctx.restore();

        // document.getElementById("severity-icon").style.visibility = 'visible';
        // document.getElementById("severity-icon").style.left = "100px";
        // document.getElementById("severity-icon").style.top = "100px";

        // if (properties.severity) {
        //    document.getElementById("severity-icon").innerHTML = properties.severity;
        // } else {
        //    document.getElementById("severity-icon").innerHTML = "!";
        //}

        // $("severity-icon").css({
        //    visibility: 'visible',
        //    left: "100px",
        //    top: "100px",
        // })
        // console.log('show severity');
        // console.log('severity: ' + self.getProperties.severity);

        // }
    }


    // Todo. Deprecated method. Get rid of this later.
    self.resetProperties = self.setProperties;

    _init(x, y, pov, params);

    return self;
}
