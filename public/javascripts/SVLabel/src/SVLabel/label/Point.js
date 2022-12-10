/**
 *
 * @param svl
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
        iconImagePath: undefined,
        originalFillStyleInnerCircle: undefined,
        radiusInnerCircle: 17,
        radiusOuterCircle: 14
    };
    var status = {
            'deleted' : false,
            'visibility' : 'visible',
            'visibilityIcon' : 'visible'
    };

    function _init (x, y, pov, params) {
        // Keep the original canvas coordinate and canvas pov just in case.
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

        if (params.originalPov) {
            self.originalPov = params.originalPov;
        } else {
            self.originalPov = {
                heading: pointPOV.heading,
                pitch: pointPOV.pitch,
                zoom: pointPOV.zoom
            };
        }

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
            }
        }

        properties.originalFillStyleInnerCircle = properties.fillStyleInnerCircle;
        return true;
    }

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

    function getProperty (name) { return (name in properties) ? properties[name] : null; }

    function getProperties () { return $.extend(true, {}, properties); }

    function calculatePointPov(x, y, pov){
        return util.panomarker.calculatePointPov(x, y, pov);
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

    function setVisibility(visibility) {
        // This method sets the visibility of a path (and points that cons
        if (visibility === 'visible' || visibility === 'hidden') {
            status.visibility = visibility;
        }
        return this;
    }

    self.belongsTo = getParent;
    self.getCanvasX = getCanvasX;
    self.getCanvasY = getCanvasY;
    self.getCanvasCoordinate = getCanvasCoordinate;
    self.getPOV = getPOV;
    self.getOriginalPov = getOriginalPov;
    self.getFill = getFill;
    self.getFillStyle = getFillStyle;
    self.getProperty = getProperty;
    self.getProperties = getProperties;
    self.resetFillStyle = resetFillStyle;
    self.resetSVImageCoordinate = resetSVImageCoordinate;
    self.setBelongsTo = setBelongsTo;
    self.setFillStyle = setFillStyle;
    self.setIconPath = setIconPath;
    self.setPhotographerPov = setPhotographerPov;
    self.setVisibility = setVisibility;

    _init(x, y, pov, params);
    return self;
}
