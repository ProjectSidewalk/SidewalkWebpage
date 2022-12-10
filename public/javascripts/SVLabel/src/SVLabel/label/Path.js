/**
 * Path module. A Path instance holds and array of Point instances.
 * @param svl
 * @param points
 * @param params
 * @returns {{className: string, points: undefined}}
 * @constructor
 * @memberof svl
 */
function Path (svl, points, params) {
    var self = { className : 'Path', points : undefined };
    var parent;
    var properties = {
        fillStyle: 'rgba(255,255,255,0.5)',
        lineCap : 'round', // ['butt','round','square']
        lineJoin : 'round', // ['round','bevel','miter']
        lineWidth : '3',
        numPoints: points.length,
        originalFillStyle: 'rgba(255,255,255,0.5)',
        originalStrokeStyle: 'rgba(255,255,255,1)',
        strokeStyle : 'rgba(255,255,255,1)',
        strokeStyle_bg : 'rgba(255,255,255,1)' //potentially delete
    };
    var status = {
        visibility: 'visible'
    };

    function _init(points, params) {
        var lenPoints;
        var i;
        self.points = points;
        lenPoints = points.length;

        // Set belongs to of the points
        for (i = 0; i < lenPoints; i += 1) {
            points[i].setBelongsTo(self);
        }

        if (params) {
            for (var attr in params) {
                if (attr in properties) {
                    properties[attr] = params[attr];
                }
            }
        }
        properties.fillStyle = util.color.changeAlphaRGBA(points[0].getProperty('fillStyleInnerCircle'), 0.5);
        properties.originalFillStyle = properties.fillStyle;
        properties.originalStrokeStyle = properties.strokeStyle;
    }

    /**
     * This method returns the Label object that this path belongs to.
     * @returns {object|null} Label object.
     */
    function belongsTo () {
        return parent ? parent : null;
    }

    /**
     * This function checks if a mouse cursor is on any of a points and return
     * @param povIn
     * @returns {{x: number, y: number, width: number, height: number}}
     */
    function getBoundingBox(povIn) {
        var canvasCoord = belongsTo().getCoordinate();
        var xMin, yMin, width, height;
        xMin = canvasCoord.x;
        yMin = canvasCoord.y;
        width = 0;
        height = 0;

        return { x: xMin, y: yMin, width: width, height: height };
    }

    /**
     * Returns fill color of the path
     * @returns {string}
     */
    function getFill() {
        return properties.fillStyle;
    }

    /**
     * Returns the line width
     * @returns {string}
     */
    function getLineWidth () {
        return properties.lineWidth;
    }

    /**
     * This function returns points.
     */
    function getPoints (reference) {
        if (!reference) {
            reference = false;
        }

        if (reference) {
            // return self.points;
            return points;
        } else {
            // return $.extend(true, [], self.points);
            return $.extend(true, [], points);
        }
    }

    /**
     * This method returns a property
     * @param key The field name of the property
     * @returns {*}
     */
    function getProperty (key) {
        return properties[key];
    }

    /**
     * This method returns the status of the field
     * @param key {string} The field name
     */
    function getStatus (key) {
        return status[key];
    }

    /**
     * This method remove all the points in the list points.
     */
    function removePoints () {
        self.points = undefined;
    }
    
    /**
     * This method changes the value of fillStyle to its original fillStyle value
     * @returns {self}
     */
    function resetFillStyle () {
        properties.fillStyle = properties.originalFillStyle;
        return this;
    }

    /**
     * This method resets the strokeStyle to its original value
     * @returns {self}
     */
    function resetStrokeStyle () {
        properties.strokeStyle = properties.originalStrokeStyle;
        return this;
    }

    /**
     * This method sets the parent object
     * @param obj
     * @returns {setBelongsTo}
     */
    function setBelongsTo (obj) {
        parent = obj;
        return this;
    }

    /**
     * Sets fill color of the path
     * @param fill
     */
    function setFill(fill) {
        if(fill.substring(0,4) == 'rgba'){
            properties.fillStyle = fill;
        } else{
            fill = 'rgba'+fill.substring(3,fill.length-1)+',0.5)';
            properties.fillStyle = fill;
        }
        return this;
    }

    function setFillStyle (fill) {
        // This method sets the fillStyle of the path
        if(fill!=undefined){
            properties.fillStyle = fill;
        }
        return this;
    }

    /**
     * This method sets the line width.
     * @param lineWidth {number} Line width
     * @returns {setLineWidth}
     */
    function setLineWidth (lineWidth) {
        if(!isNaN(lineWidth)){
            properties.lineWidth  = '' + lineWidth;
        }
        return this;
    }

    /**
     * This method sets the strokeStyle of the path
     * @param stroke {string} Stroke style
     * @returns {setStrokeStyle}
     */
    function setStrokeStyle (stroke) {
        properties.strokeStyle = stroke;
        return this;
    }

    /**
     * This method sets the visibility of a path
     * @param visibility {string} Visibility (visible or hidden)
     * @returns {setVisibility}
     */
    function setVisibility (visibility) {
        if (visibility === 'visible' || visibility === 'hidden') status.visibility = visibility;
        return this;
    }

    self.belongsTo = belongsTo;
    self.getBoundingBox = getBoundingBox;
    self.getLineWidth = getLineWidth;
    self.getFill = getFill;
    self.getPoints = getPoints;
    self.getProperty = getProperty;
    self.getStatus = getStatus;
    self.removePoints = removePoints;
    self.resetFillStyle = resetFillStyle;
    self.resetStrokeStyle = resetStrokeStyle;
    self.setFill = setFill;
    self.setBelongsTo = setBelongsTo;
    self.setLineWidth = setLineWidth;
    self.setFillStyle = setFillStyle;
    self.setStrokeStyle = setStrokeStyle;
    self.setVisibility = setVisibility;

    // Initialize
    _init(points, params);

    return self;
}
