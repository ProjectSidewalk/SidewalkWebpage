var svl = svl || {};

/**
 * A Label module.
 * @param pathIn
 * @param params
 * @returns {*}
 * @constructor
 * @memberof svl
 */
function Label (pathIn, params) {
    var self = {
        className: 'Label'
    };

    var path;
    var goolgeMarker;

    var properties = {
        temporary_label_id: null,
        canvasWidth: undefined,
        canvasHeight: undefined,
        canvasDistortionAlphaX: undefined,
        canvasDistortionAlphaY: undefined,
        distanceThreshold: 100,
        labelerId : 'DefaultValue',
        labelId: 'DefaultValue',
        labelType: undefined,
        labelDescription: undefined,
        labelFillStyle: undefined,
        panoId: undefined,
        panoramaLat: undefined,
        panoramaLng: undefined,
        panoramaHeading: undefined,
        panoramaPitch: undefined,
        panoramaZoom: undefined,
        photographerHeading: undefined,
        photographerPitch: undefined,
        svImageWidth: undefined,
        svImageHeight: undefined,
        svMode: undefined,
        tagHeight: 20,
        tagWidth: 1,
        tagX: -1,
        tagY: -1
    };

    var status = {
        'deleted' : false,
        'tagVisibility' : 'visible',
        'visibility' : 'visible'
    };

    var lock = {
        tagVisibility: false,
        visibility : false
    };

//    function assemble () {
//        return {
//            properties: properties,
//            status: status,
//            path: path.assemble(),
//        }
//    }
//
//    self.assemble = assemble;

    //
    // Private functions
    //
    function init (param, pathIn) {
        try {
            if (!pathIn) {
                var errMsg = 'The passed "path" is empty.';
                throw errMsg;
            } else {
                path = pathIn;
            }

            for (attrName in properties) {
                properties[attrName] = param[attrName];
            }

            // If the labelType is a "Stop Sign", do not show a tag
            // as a user has to select which type of a stop sign it is
            // (e.g. One-leg, Two-leg, etc)
            // if (properties.labelProperties.labelType === "StopSign") {
            if (false) {
                status.tagVisibility = 'hidden';
            }

            // Set belongs to of the path.
            path.setBelongsTo(self);

            goolgeMarker = renderOnMap();
            return true;
        } catch (e) {
            console.error(self.className, ':', 'Error initializing the Label object.', e);
            return false;
        }

    }

    function renderTag(ctx) {
        // This function renders a tag on a canvas to show a property of the label
        if (arguments.length !== 3) {
            return false;
        }
        var boundingBox = path.getBoundingBox();

        // Prepare a label message
        var msg = properties.labelDescription;
        var messages = msg.split('\n');

        if (properties.labelerId !== 'DefaultValue') {
            messages.push('Labeler: ' + properties.labelerId);
        }

        ctx.font = '10.5pt Calibri';
        var height = properties.tagHeight * messages.length;
        var width = -1;
        for (var i = 0; i < messages.length; i += 1) {
            var w = ctx.measureText(messages[i]).width + 5;
            if (width < w) {
                width = w;
            }
        }
        properties.tagWidth = width;

        var tagX;
        var tagY;
        ctx.save();
        ctx.lineWidth = 3.5;
        ctx.fillStyle = 'rgba(255,255,255,1)';
        ctx.strokeStyle = 'rgba(255,255,255,1)';
        ctx.beginPath();
        var connectorX = 15;
        if (connectorX > boundingBox.width) {
            connectorX = boundingBox.width - 1;
        }

        if (boundingBox.x < 5) {
            tagX = 5;
        } else {
            tagX = boundingBox.x;
        }

        if (boundingBox.y + boundingBox.height < 400) {
            ctx.moveTo(tagX + connectorX, boundingBox.y + boundingBox.height);
            ctx.lineTo(tagX + connectorX, boundingBox.y + boundingBox.height + 10);
            ctx.stroke();
            ctx.closePath();
            ctx.restore();
            tagY = boundingBox.y + boundingBox.height + 10;
        } else {
            ctx.moveTo(tagX + connectorX, boundingBox.y);
            ctx.lineTo(tagX + connectorX, boundingBox.y - 10);
            ctx.stroke();
            ctx.closePath();
            ctx.restore();
            // tagX = boundingBox.x;
            tagY = boundingBox.y - height - 20;
        }


        var r = 3;
        var paddingLeft = 16;
        var paddingRight = 30;
        var paddingBottom = 10;

        // Set rendering properties
        ctx.save();
        ctx.lineCap = 'square';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // point.getProperty('fillStyleInnerCircle');
        ctx.strokeStyle = 'rgba(255,255,255,1)'; // point.getProperty('strokeStyleOuterCircle');
        //point.getProperty('lineWidthOuterCircle');

        // Draw a tag
        ctx.beginPath();
        ctx.moveTo(tagX, tagY);
        ctx.lineTo(tagX + width + paddingLeft + paddingRight, tagY);
        ctx.lineTo(tagX + width + paddingLeft + paddingRight, tagY + height + paddingBottom);
        ctx.lineTo(tagX, tagY + height + paddingBottom);
        ctx.lineTo(tagX, tagY);
//        ctx.moveTo(tagX, tagY - r);
//        ctx.lineTo(tagX + width - r, tagY - r);
//        ctx.arc(tagX + width, tagY, r, 3 * Math.PI / 2, 0, false); // Corner
//        ctx.lineTo(tagX + width + r, tagY + height - r);
//        ctx.arc(tagX + width, tagY + height, r, 0, Math.PI / 2, false); // Corner
//        ctx.lineTo(tagX + r, tagY + height + r);
//        ctx.arc(tagX, tagY + height, r, Math.PI / 2, Math.PI, false); // Corner
//        ctx.lineTo(tagX - r, tagY); // Corner

        ctx.fill();
        ctx.stroke()
        ctx.closePath();
        ctx.restore();

        // Render an icon and a message
        ctx.save();
        ctx.fillStyle = '#000';
        var labelType = properties.labelType;
        var iconImagePath = getLabelIconImagePath()[labelType].iconImagePath;
        var imageObj;
        var imageHeight;
        var imageWidth;
        var imageX;
        var imageY;
        imageObj = new Image();
        imageHeight = imageWidth = 25;
        imageX =  tagX + 5;
        imageY = tagY + 2;

        //imageObj.onload = function () {

        ///            };
        // ctx.globalAlpha = 0.5;
        imageObj.src = iconImagePath;
        ctx.drawImage(imageObj, imageX, imageY, imageHeight, imageWidth);

        for (var i = 0; i < messages.length; i += 1) {
            ctx.fillText(messages[i], tagX + paddingLeft + 20, tagY + 20 + 20 * i);
        }
        // ctx.fillText(msg, tagX, tagY + 17);
        ctx.restore();

        return;
    }

    function showDelete() {
        if (status.tagVisibility !== 'hidden') {
            var boundingBox = path.getBoundingBox();
            var x = boundingBox.x + boundingBox.width - 20;
            var y = boundingBox.y;

            // Show a delete button
            var $divHolderLabelDeleteIcon = $("#Holder_LabelDeleteIcon");
            $divHolderLabelDeleteIcon.css({
                'visibility': 'visible',
                'left' : x, // + width - 5,
                'top' : y
            });
        }
    }

    function toOffset() {
        var imageCoordinates = path.getImageCoordinates();
        var lat = properties.panoramaLat;
        var pc = svl.pointCloud.getPointCloud(properties.panoId);
        if (pc) {
            var minDx = 1000;
            var minDy = 1000;
            var minDz = 1000;
            for (var i = 0; i < imageCoordinates.length; i++) {
                var p = svl.util.scaleImageCoordinate(imageCoordinates[i].x, imageCoordinates[i].y, 1 / 26);
                var idx = 3 * (Math.ceil(p.x) + 512 * Math.ceil(p.y));
                var dx = pc.pointCloud[idx];
                var dy = pc.pointCloud[idx + 1];
                var dz = pc.pointCloud[idx + 2];
                var r = dx * dx + dy * dy;
                var minR = minDx * minDx + minDy + minDy;

                if (r < minR) {
                    minDx = dx;
                    minDy = dy;
                    minDz = dz;
                }
            }
            return {dx: minDx, dy: minDy, dz: minDz};
        }
    }

    /**
     * Get the label latlng position
     * @returns {lat: labelLat, lng: labelLng}
     */
    function toLatLng() {
        var imageCoordinates = path.getImageCoordinates();
        var lat = properties.panoramaLat;
        var pc = svl.pointCloud.getPointCloud(properties.panoId);
        if (pc) {
            var minDx = 1000;
            var minDy = 1000;
            var delta;
            for (var i = 0; i < imageCoordinates.length; i ++) {
                var p = svl.util.scaleImageCoordinate(imageCoordinates[i].x, imageCoordinates[i].y, 1/26);
                var idx = 3 * (Math.ceil(p.x) + 512 * Math.ceil(p.y));
                var dx = pc.pointCloud[idx];
                var dy = pc.pointCloud[idx + 1];
                var r = dx * dx + dy * dy;
                var minR = minDx * minDx + minDy + minDy;

                if ( r < minR) {
                    minDx = dx;
                    minDy = dy;

                }
            }
            delta = svl.util.math.latlngOffset(properties.panoramaLat, dx, dy);

            return {lat: properties.panoramaLat + delta.dlat, lng: properties.panoramaLng + delta.dlng};
        } else {
            return null;
        }
    }
    ////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////

    self.blink = function (numberOfBlinks, fade) {
        // Blink (highlight and fade) the color of this label. If fade is true, turn the label into gray;
        if (!numberOfBlinks) {
            numberOfBlinks = 3;
        } else if (numberOfBlinks < 0) {
            numberOfBlinks = 0;
        }
        var interval;
        var highlighted = true;
        var path = self.getPath();
        var points = path.getPoints();

        var i;
        var len = points.length;

        var fillStyle = 'rgba(200,200,200,0.1)';
        var fillStyleHighlight = path.getFillStyle();

        interval = setInterval(function () {
            if (numberOfBlinks > 0) {
                if (highlighted) {
                    highlighted = false;
                    path.setFillStyle(fillStyle);
                    for (i = 0; i < len; i++) {
                        points[i].setFillStyle(fillStyle);
                    }
                    svl.canvas.clear().render2();
                } else {
                    highlighted = true;
                    path.setFillStyle(fillStyleHighlight);
                    for (i = 0; i < len; i++) {
                        points[i].setFillStyle(fillStyleHighlight);
                    }
                    svl.canvas.clear().render2();
                    numberOfBlinks -= 1;
                }
            } else {
                if (fade) {
                    path.setFillStyle(fillStyle);
                    for (i = 0; i < len; i++) {
                        points[i].setFillStyle(fillStyle);
                    }
                    svl.canvas.clear().render2();
                }

                self.setAlpha(0.05);
                svl.canvas.clear().render2();
                window.clearInterval(interval);
            }
        }, 500);

        return this;
    };

    self.fadeFillStyle = function (mode) {
        // This method turn the associated Path and Points into gray.
        var path = self.getPath();
        var points = path.getPoints()
        var i = 0;
        var len = points.length;
        var fillStyle = undefined;

        if (!mode) {
            mode = 'default';
        }

        if (mode === 'gray') {
            fillStyle = 'rgba(200,200,200,0.5)';
        } else {
            // fillStyle = path.getFillStyle();
            // fillStyle = svl.util.color.changeDarknessRGBA(fillStyle, 0.9);
            // fillStyle = svl.util.color.changeAlphaRGBA(fillStyle, 0.1);
            fillStyle = 'rgba(255,165,0,0.8)';
        }
        path.setFillStyle(fillStyle);
        for (; i < len; i++) {
            points[i].setFillStyle(fillStyle);
        }
        return this;
    };

    self.getBoundingBox = function (pov) {
        // This method returns the boudning box of the label's outline.
        var path = self.getPath();
        return path.getBoundingBox(pov);
    };

    self.getCoordinate = function () {
        // This function returns the coordinate of a point.
        if (path && path.points.length > 0) {
            var pov = path.getPOV();
            return $.extend(true, {}, path.points[0].getCanvasCoordinate(pov));
        }
        return path;
    };

    self.getGSVImageCoordinate = function () {
        // This function return the coordinate of a point in the GSV image coordinate.
        if (path && path.points.length > 0) {
            return path.points[0].getGSVImageCoordinate();
        }
    };

    self.getImageCoordinates = function () {
        // This function returns
        if (path) {
            return path.getImageCoordinates();
        }
        return false;
    };

    self.getLabelId = function () {
        // This function returns labelId property
        return properties.labelId;
    };

    self.getLabelType = function () {
        // This function returns labelType property
        return properties.labelType;
    };

    self.getPath = function (reference) {
        // This function returns the coordinate of a point.
        // If reference is true, return a reference to the path instead of a copy of the path
        if (path) {
            if (reference) {
                return path;
            } else {
                return $.extend(true, {}, path);
            }
        }
        return false;
    };

    self.getPoint = function () {
        // This function returns the coordinate of the first point in the path.
        if (path && path.points.length > 0) {
            return path.points[0];
        }
        return path;
    };

    self.getPoints = function (reference) {
        // This function returns the point objects that constitute the path
        // If reference is set to true, return the reference to the points
        if (path) {
            return path.getPoints(reference);
        } else {
            return false;
        }
    };

    self.getLabelPov = function () {
        // Return the pov of this label
        var heading;//  = parseInt(properties.panoramaHeading, 10);
        var pitch = parseInt(properties.panoramaPitch, 10);
        var zoom = parseInt(properties.panoramaZoom, 10);

        var points = self.getPoints();
        var svImageXs = points.map(function(point) {return point.svImageCoordinate.x;});

        if (svImageXs.max() - svImageXs.min() > (svl.svImageWidth / 2)) {
            svImageXs = svImageXs.map(function (x) {
                if (x < (svl.svImageWidth / 2)) {
                    x += svl.svImageWidth;
                }
                return x;
            })
            var labelSvImageX = parseInt(svImageXs.mean(), 10) % svl.svImageWidth;
        } else {
            var labelSvImageX = parseInt(svImageXs.mean(), 10);
        }
        heading = parseInt((labelSvImageX / svl.svImageWidth) * 360, 10) % 360;

        return {
            heading: parseInt(heading, 10),
            pitch: pitch,
            zoom: zoom
        };
    };


    /**
     * Return the deep copy of the properties object
     * @returns {*}
     */
    function getProperties () { return $.extend(true, {}, properties); }


    function getProperty (key) {
        if (!(key in properties)) throw "KeyError";
        return properties[key];
    }

    function getStatus (key) { return status[key]; }

    function getVisibility () { return status.visibility; }

    /**
     * Set a label property
     * @param key
     * @param value
     * @returns {*}
     */
    function setProperty (key, value) {
        if (!(key in properties)) return false;
        properties[key] = value;
        return this;
    }

    self.getstatus = getStatus;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    self.getVisibility = getVisibility;

    self.fill = function (fill) {
        // This method changes the fill color of the path and points that constitute the path.
        var path = self.getPath();
        var points = path.getPoints()
        var i = 0;
        var len = points.length;

        path.setFillStyle(fill);
        for (; i < len; i++) {
            points[i].setFillStyle(fill);
        }
        return this;
    };

    /**
     * This method changes the fill color of the path and points to orange.
     */
    function highlight () { return self.fill('rgba(255,165,0,0.8)'); }
    function isDeleted () { return status.deleted; }

    self.highlight = highlight;
    self.isDeleted = isDeleted;


    self.isOn = function (x, y) {
        // This function checks if a path is under a cursor
        if (status.deleted ||
            status.visibility === 'hidden') {
            return false;
        }

        var result = path.isOn(x, y);
        if (result) {
            return result;
        } else {
            return false;
            //
            //var margin = 20;
            //if (properties.tagX - margin < x &&
            //    properties.tagX + properties.tagWidth + margin > x &&
            //    properties.tagY - margin < y &&
            //    properties.tagY + properties.tagHeight + margin > y) {
            //    // The mouse cursor is on the tag.
            //    return this;
            //} else {
            //    return false;
            //}
        }
    };



    /**
     * This method returns the visibility of this label.
     * @returns {boolean}
     */
    function isVisible () { return status.visibility === 'visible'; }
    self.isVisible = isVisible;

    function lockTagVisibility () {
        lock.tagVisibility = true;
        return this;
    }
    self.lockTagVisibility = lockTagVisibility;


    self.lockVisibility = function () {
        lock.visibility = true;
        return this;
    };


    self.overlap = function (label, mode) {
        // This method calculates the area overlap between this label and another label passed as an argument.
        if (!mode) {
            mode = "boundingbox";
        }

        if (mode !== "boundingbox") {
            throw self.className + ": " + mobede + " is not a valid option.";
        }
        var path1 = self.getPath();
        var path2 = label.getPath();

        return path1.overlap(path2, mode);
    };

    self.removePath = function () {
        // This function removes the path and points in the path.
        path.removePoints();
        path = undefined;
    };


    /**
     * This method renders this label on a canvas.
     * @param ctx
     * @param pov
     * @param evaluationMode
     * @returns {self}
     */
    self.render = function (ctx, pov, evaluationMode) {
        if (!evaluationMode) {
            evaluationMode = false;
        }
        if (!status.deleted) {
            if (status.visibility === 'visible') {
                // Render a tag
                // Get a text to render (e.g, attribute type), and
                // canvas coordinate to render the tag.
                if(status.tagVisibility === 'visible') {
                    var labelType =  properties.labelDescription;

                    if (!evaluationMode) {
                        renderTag(ctx);
                        path.renderBoundingBox(ctx);
                        showDelete();
                        //showDelete(path);
                    }
                }

                // Render a path
                path.render2(ctx, pov);
            } else if (false) {
                // Render labels that are not in the current panorama but are close enough.
                // Get the label'svar latLng = toLatLng();
                var currLat = svl.panorama.location.latLng.lat(),
                    currLng = svl.panorama.location.latLng.lng();
                var d = svl.util.math.haversine(currLat, currLng, latLng.lat, latLng.lng);

                var offset = toOffset();


                if (d < properties.distanceThreshold) {

                    var dPosition = svl.util.math.latlngInverseOffset(currLat, currLat - latLng.lat, currLng - latLng.lng);
                    //var dx = dPosition.dx;
                    //var dy = dPosition.dy;
                    //var dz = 0;


                    var dx = offset.dx - dPosition.dx;
                    var dy = offset.dy - dPosition.dy;
                    var dz = offset.dz;


                    //
                    //console.debug("Debug");
                    var idx = svl.pointCloud.search(svl.panorama.pano, {x: dx, y: dy, z: dz});
                    var ix = idx / 3 % 512;
                    var iy = (idx / 3 - ix) / 512;
                    var imageCoordinateX = ix * 26;
                    var imageCoordinateY = 3328 - iy * 26;
                    var canvasPoint = svl.misc.imageCoordinateToCanvasCoordinate(imageCoordinateX, imageCoordinateY, pov);

                    console.log(canvasPoint);
                    ctx.save();
                    ctx.strokeStyle = 'rgba(255,255,255,1)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(canvasPoint.x, canvasPoint.y, 10, 2 * Math.PI, 0, true);
                    ctx.closePath();
                    ctx.stroke();
                    ctx.fillStyle = path.getProperty('fillStyle'); // changeAlphaRGBA(properties.fillStyleInnerCircle, 0.5);
                    ctx.fill();
                    ctx.restore();

                    //new Point(tempPath[i].x, tempPath[i].y, pov, pointParameters)
                    //new Label(new Path(), params)
                }
            }
        }
        return this;
    };

    /**
     * This method renders a marker on a map.
     * @returns {google.maps.Marker}
     */
    function renderOnMap () {
        //var latlng = toLatLng();
        var lat = path.points[0].getProperty("lat"), lng = path.points[0].getProperty("lng"),
            latlng = {lat: lat, lng: lng};
        var googleLatLng = new google.maps.LatLng(latlng.lat, latlng.lng);

        var image = {
            url: svl.rootDirectory + "img/icons/Sidewalk/Icon_CurbRamp.png",
            size: new google.maps.Size(20, 20),
            origin: new google.maps.Point(latlng.lat, latlng.lng)

        };
        return new google.maps.Marker({
            position: googleLatLng,
            map: svl.map.getMap(),
            title: "Hi!",
            icon: svl.rootDirectory + "img/icons/Sidewalk/Icon_CurbRampSmall.png"
        });
    }
    self.renderOnMap = renderOnMap;

    self.resetFillStyle = function () {
        // This method turn the fill color of associated Path and Points into their original color.
        var path = self.getPath();
        var points = path.getPoints()
        var i = 0;
        var len = points.length;
        path.resetFillStyle();
        for (; i < len; i++) {
            points[i].resetFillStyle();
        }
        return this;
    };

    self.resetTagCoordinate = function () {
        // This function sets properties.tag.x and properties.tag.y to 0
        properties.tagX = 0;
        properties.tagY = 0;
        return this;
    };

    self.setAlpha = function (alpha) {
        // This method changes the alpha channel of the fill color of the path and points that constitute the path.
        var path = self.getPath();
        var points = path.getPoints()
        var i = 0;
        var len = points.length;
        var fill = path.getFillStyle();

        fill = svl.util.color.changeAlphaRGBA(fill, 0.3);

        path.setFillStyle(fill);
        for (; i < len; i++) {
            points[i].setFillStyle(fill);
        }
        return this;
    };

    self.setIconPath = function (iconPath) {
        // This function sets the icon path of the point this label holds.
        if (path && path.points[0]) {
            var point = path.points[0];
            point.setIconPath(iconPath);
            return this;
        }
        return false;
    };


    self.setLabelerId = function (labelerIdIn) {
        properties.labelerId = labelerIdIn;
        return this;
    };


    self.setStatus = function (key, value) {
        if (key in status) {
            if (key === 'visibility' &&
                (value === 'visible' || value === 'hidden')) {
                // status[key] = value;
                self.setVisibility(value);
            } else if (key === 'tagVisibility' &&
                (value === 'visible' || value === 'hidden')) {
                self.setTagVisibility(value);
            } else if (key === 'deleted' && typeof value === 'boolean') {
                status[key] = value;
            }
        }
    };


    self.setTagVisibility = function (visibility) {
        if (!lock.tagVisibility) {
            if (visibility === 'visible' ||
                visibility === 'hidden') {
                status['tagVisibility'] = visibility;
            }
        }
        return this;
    };


    self.setSubLabelDescription = function (labelType) {
        // This function sets the sub label type of this label.
        // E.g. for a bus stop there are StopSign_OneLeg
        var labelDescriptions = getLabelDescriptions();
        var labelDescription = labelDescriptions[labelType].text;
        properties.labelProperties.subLabelDescription = labelDescription;
        return this;
    };


    self.setVisibility = function (visibility) {
        if (!lock.visibility) {
            status.visibility = visibility;
        }
        return this;
    };


    self.setVisibilityBasedOnLocation = function (visibility, panoId) {
        if (!status.deleted) {
            if (panoId === properties.panoId) {
                // self.setStatus('visibility', visibility);
                self.setVisibility(visibility);
            } else {
                visibility = visibility === 'visible' ? 'hidden' : 'visible';
                // self.setStatus('visibility', visibility);
                self.setVisibility(visibility);
            }
        }
        return this;
    };


    self.setVisibilityBasedOnLabelerId = function (visibility, labelerIds, included) {
        // if included is true and properties.labelerId is in labelerIds, then set this
        // label's visibility to the passed visibility
        if (included === undefined) {
            if (labelerIds.indexOf(properties.labelerId) !== -1) {
                self.unlockVisibility().setVisibility(visibility).lockVisibility();
            } else {
                visibility = visibility === 'visible' ? 'hidden' : 'visible';
                self.unlockVisibility().setVisibility(visibility).lockVisibility();
            }
        } else {
            if (included) {
                if (labelerIds.indexOf(properties.labelerId) !== -1) {
                    self.unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            } else {
                if (labelerIds.indexOf(properties.labelerId) === -1) {
                    self.unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            }
        }

        return this;
    };


    self.setVisibilityBasedOnLabelerIdAndLabelTypes = function (visibility, tables, included) {
        var i;
        var tablesLen = tables.length;
        var matched = false;

        for (i = 0; i < tablesLen; i += 1) {
            if (tables[i].userIds.indexOf(properties.labelerId) !== -1) {
                if (tables[i].labelTypesToRender.indexOf(properties.labelProperties.labelType) !== -1) {
                    matched = true;
                }
            }
        }
        if (included === undefined) {
            if (matched) {
                self.unlockVisibility().setVisibility(visibility).lockVisibility();
            } else {
                visibility = visibility === 'visible' ? 'hidden' : 'visible';
                self.unlockVisibility().setVisibility(visibility).lockVisibility();
            }
        } else {
            if (included) {
                if (matched) {
                    self.unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            } else {
                if (!matched) {
                    self.unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            }
        }
    };


    self.unlockTagVisibility = function () {
        lock.tagVisibility = false;
        return this;
    };


    self.unlockVisibility = function () {
        lock.visibility = false;
        return this;
    };


    self.toLatLng = toLatLng;

    if (!init(params, pathIn)) {
        return false;
    }
    return self;
}
