/**
 * A Label module.
 * @param pathIn
 * @param params
 * @returns {*}
 * @constructor
 * @memberof svl
 */
function Label (svl, pathIn, params) {
    var self = { className: 'Label' };

    var path, googleMarker;

    var properties = {
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
        tagY: -1,
        severity: null,
        temporary_label_id: null,
        temporaryProblem: null,
        description: null
    };

    var status = {
        deleted : false,
        tagVisibility : 'visible',
        visibility : 'visible'
    };

    var lock = {
        tagVisibility: false,
        visibility : false
    };

    function _init (param, pathIn) {
            if (!pathIn) {
                throw 'The passed "path" is empty.';
            } else {
                path = pathIn;
            }

            for (var attrName in param) {
                properties[attrName] = param[attrName];
            }

            // Set belongs to of the path.
            path.setBelongsTo(self);

            if (param && param.labelType && typeof google != "undefined" && google && google.maps) {
                googleMarker = createGoogleMapsMarker(param.labelType);
                googleMarker.setMap(svl.map.getMap());
            }
    }

    /**
     * Blink (highlight and fade) the color of this label. If fade is true, turn the label into gray.
     * @param numberOfBlinks
     * @param fade
     * @returns {blink}
     */
    function blink (numberOfBlinks, fade) {
        if (!numberOfBlinks) {
            numberOfBlinks = 3;
        } else if (numberOfBlinks < 0) {
            numberOfBlinks = 0;
        }
        var interval;
        var highlighted = true;
        var path = getPath();
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

                setAlpha(0.05);
                svl.canvas.clear().render2();
                window.clearInterval(interval);
            }
        }, 500);

        return this;
    }

    /**
     * This method creates a Google Maps marker.
     * https://developers.google.com/maps/documentation/javascript/markers
     * https://developers.google.com/maps/documentation/javascript/examples/marker-remove
     * @returns {google.maps.Marker}
     */
    function createGoogleMapsMarker (labelType) {
        if (typeof google != "undefined") {
            var latlng = toLatLng();

            if (latlng) {
                var googleLatLng = new google.maps.LatLng(latlng.lat, latlng.lng);
            } else {
                // Estimate the latlng point from the camera position and the heading angle when the point cloud data is not available.
                var cameraLat = getProperty("panoramaLat");
                var cameraLng = getProperty("panoramaLng");
                var cameraHeading = util.math.toRadians(getProperty("panoramaHeading"));
                var dx = 10 * Math.sin(cameraHeading);
                var dy = 10 * Math.cos(cameraHeading);
                var dLatLng = util.math.latlngOffset(cameraLat, dx, dy);
                var googleLatLng = new google.maps.LatLng(cameraLat + dLatLng.dlat, cameraLng + dLatLng.dlng);  // Todo
            }

            var imagePaths = util.misc.getIconImagePaths(),
                url = imagePaths[labelType].googleMapsIconImagePath;

            return new google.maps.Marker({
                position: googleLatLng,
                map: svl.map.getMap(),
                title: "Hi!",
                icon: url,
                size: new google.maps.Size(20, 20)
            });
        }
    }

    /**
     * This method turn the associated Path and Points into gray.
     * @param mode
     * @returns {fadeFillStyle}
     */
    function fadeFillStyle (mode) {
        var path = getPath(),
            points = path.getPoints(),
            len = points.length, fillStyle;

        if (!mode) { mode = 'default'; }

        fillStyle = mode == 'gray' ? 'rgba(200,200,200,0.5)' : 'rgba(255,165,0,0.8)';
        path.setFillStyle(fillStyle);
        for (var i = 0; i < len; i++) {
            points[i].setFillStyle(fillStyle);
        }
        return this;
    }

    /**
     * This method changes the fill color of the path and points that constitute the path.
     * @param fillColor
     * @returns {fill}
     */
    function fill (fillColor) {
        var path = getPath(), points = path.getPoints(), len = points.length;
        path.setFillStyle(fillColor);
        for (var i = 0; i < len; i++) { points[i].setFillStyle(fillColor); }
        return this;
    }

    /**
     * This method returns the boudning box of the label's outline.
     * @param pov
     * @returns {*}
     */
    function getBoundingBox (pov) {
        var boundingBox = path.getBoundingBox(pov);
        return boundingBox;
    }

    /**
     * This function returns the coordinate of a point.
     * @returns {*}
     */
    function getCoordinate () {
        if (path && path.points.length > 0) {
            var pov = svl.map.getPov();
            return $.extend(true, {}, path.points[0].getCanvasCoordinate(pov));
        }
        return path;
    }

    /**
     * This function return the coordinate of a point in the GSV image coordinate.
     * @returns {*}
     */
    function getGSVImageCoordinate () {
        if (path && path.points.length > 0) {
            return path.points[0].getGSVImageCoordinate();
        }
    }

    /**
     * Get image coordinates of the child path
     * @returns {*}
     */
    function getImageCoordinates () {
        return path ? path.getImageCoordinates() : false;
    }

    /**
     * This function returns labelId property
     * @returns {string}
     */
    function getLabelId () {
        return properties.labelId;
    }

    /**
     * This function returns labelType property
     * @returns {*}
     */
    function getLabelType () { return properties.labelType; }

    /**
     * This function returns the coordinate of a point.
     * If reference is true, return a reference to the path instead of a copy of the path
     * @param reference
     * @returns {*}
     */
    function getPath (reference) {
        if (path) {
            return reference ? path : $.extend(true, {}, path);
        }
        return false;
    }

    /**
     * This function returns the coordinate of the first point in the path.
     * @returns {*}
     */
    function getPoint () { return (path && path.points.length > 0) ? path.points[0] : path; }

    /**
     * This function returns the point objects that constitute the path
     * If reference is set to true, return the reference to the points
     * @param reference
     * @returns {*}
     */
    function getPoints (reference) { return path ? path.getPoints(reference) : false; }

    /**
     * This method returns the pov of this label
     * @returns {{heading: Number, pitch: Number, zoom: Number}}
     */
    function getLabelPov () {
        var heading, pitch = parseInt(properties.panoramaPitch, 10),
            zoom = parseInt(properties.panoramaZoom, 10),
            points = getPoints(),
            svImageXs = points.map(function(point) { return point.svImageCoordinate.x; }),
            labelSvImageX;

        if (svImageXs.max() - svImageXs.min() > (svl.svImageWidth / 2)) {
            svImageXs = svImageXs.map(function (x) {
                if (x < (svl.svImageWidth / 2)) {
                    x += svl.svImageWidth;
                }
                return x;
            });
            labelSvImageX = parseInt(svImageXs.mean(), 10) % svl.svImageWidth;
        } else {
            labelSvImageX = parseInt(svImageXs.mean(), 10);
        }
        heading = parseInt((labelSvImageX / svl.svImageWidth) * 360, 10) % 360;

        return {
            heading: parseInt(heading, 10),
            pitch: pitch,
            zoom: zoom
        };
    }

    /**
     * Return the deep copy of the properties object,
     * so the caller can only modify properties from
     * setProperties() (which I have not implemented.)
     * JavaScript Deepcopy
     * http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-a-javascript-object
     */
    function getProperties () { return $.extend(true, {}, properties); }

    /**
     * Get a property
     * @param propName
     * @returns {boolean}
     */
    function getProperty (propName) { return (propName in properties) ? properties[propName] : false; }

    /**
     * Get a status
     * @param key
     * @returns {*}
     */
    function getStatus (key) {
        return status[key];
    }

    function getVisibility () { return status.visibility; }

    /**
     * This method changes the fill color of the path and points to orange.
     */
    function highlight () { return fill('rgba(255,165,0,0.8)'); }

    /**
     * Check if the label is deleted
     * @returns {boolean}
     */
    function isDeleted () { return status.deleted; }


    /**
     * Check if a path is under a cursor
     * @param x
     * @param y
     * @returns {boolean}
     */
    function isOn (x, y) {
        if (status.deleted || status.visibility === 'hidden') {  return false; }
        var result = path.isOn(x, y);
        return result ? result : false;
    }

    /**
     * This method returns the visibility of this label.
     * @returns {boolean}
     */
    function isVisible () {
        return status.visibility === 'visible';
    }

    /**
     * Lock tag visibility
     * @returns {lockTagVisibility}
     */
    function lockTagVisibility () {
        lock.tagVisibility = true;
        return this;
    }

    /**
     * Lock visibility
     * @returns {lockVisibility}
     */
    function lockVisibility () {
        lock.visibility = true;
        return this;
    }

    /**
     * This method calculates the area overlap between this label and another label passed as an argument.
     * @param label
     * @param mode
     * @returns {*|number}
     */
    function overlap (label, mode) {
        if (!mode) mode = "boundingbox";
        if (mode !== "boundingbox") { throw self.className + ": " + mobede + " is not a valid option."; }
        var path1 = getPath(),
            path2 = label.getPath();
        return path1.overlap(path2, mode);
    }

    /**
     * Remove the label (it does not actually remove, but hides the label and set its status to 'deleted').
     */
    function remove () {
        setStatus('deleted', true);
        setStatus('visibility', 'hidden');
    }

    /**
     * This function removes the path and points in the path.
     */
    function removePath () {
        path.removePoints();
        path = undefined;
    }

    /**
     * This method renders this label on a canvas.
     * @param ctx
     * @param pov
     * @param evaluationMode
     * @returns {self}
     */
    function render (ctx, pov, evaluationMode) {
        if (!evaluationMode) {
            evaluationMode = false;
        }
        if (!status.deleted) {
            if (status.visibility === 'visible') {

                // Render a tag
                // Get a text to render (e.g, attribute type), and
                // canvas coordinate to render the tag.
                if(status.tagVisibility == 'visible') {
                    renderTag(ctx);
                    // path.renderBoundingBox(ctx);
                    showDelete();
                }

                // Render a path
                path.render2(ctx, pov);

            } else if (false) {
                // TAG: OLD IMAGE COORDINATE USED
                // Render labels that are not in the current panorama but are close enough.
                // Get the label'svar latLng = toLatLng();
                var currLat = svl.panorama.location.latLng.lat(),
                    currLng = svl.panorama.location.latLng.lng();
                var d = util.math.haversine(currLat, currLng, latLng.lat, latLng.lng);
                var offset = toOffset();

                if (d < properties.distanceThreshold) {
                    var dPosition = util.math.latlngInverseOffset(currLat, currLat - latLng.lat, currLng - latLng.lng);

                    var dx = offset.dx - dPosition.dx;
                    var dy = offset.dy - dPosition.dy;
                    var dz = offset.dz;

                    var idx = svl.pointCloud.search(svl.panorama.pano, {x: dx, y: dy, z: dz});
                    var ix = idx / 3 % 512;
                    var iy = (idx / 3 - ix) / 512;
                    var imageCoordinateX = ix * 26;
                    var imageCoordinateY = 3328 - iy * 26;
                    var canvasPoint = util.panomarker.imageCoordinateToCanvasCoordinate(imageCoordinateX, imageCoordinateY, pov);

                    //console.log(canvasPoint);
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
                }
            }
        }

        // Show a label on the google maps pane.
        if (!isDeleted()) {
            if (googleMarker && !googleMarker.map) {
                googleMarker.setMap(svl.map.getMap());
            }
        } else {
            if (googleMarker && googleMarker.map) {
                googleMarker.setMap(null);
            }
        }
        return this;
    }

    /**
     * This function renders a tag on a canvas to show a property of the label
     * @param ctx
     * @returns {boolean}
     */
    function renderTag(ctx) {
        if ('contextMenu' in svl && svl.contextMenu.isOpen()) { return false; }

        var labelCoordinate = getCoordinate(),
            cornerRadius = 3,
            i, w, height, width,
            msg = properties.labelDescription,
            messages = msg.split('\n'),
            padding = { left: 12, right: 5, bottom: 0, top: 18};

        if (properties.labelerId !== 'DefaultValue') { messages.push('Labeler: ' + properties.labelerId); }

        // Set rendering properties and draw a tag
        ctx.save();
        ctx.font = '10.5pt Calibri';
        height = properties.tagHeight * messages.length;
        width = -1;
        for (i = 0; i < messages.length; i += 1) {
            w = ctx.measureText(messages[i]).width + 5;
            if (width < w) { width = w; }
        }
        properties.tagWidth = width;

        ctx.lineCap = 'square';
        ctx.lineWidth = 2;
        ctx.fillStyle = util.color.changeAlphaRGBA(util.misc.getLabelColors(getProperty('labelType')), 0.9);
        ctx.strokeStyle = 'rgba(255,255,255,1)';

        // Tag background
        ctx.beginPath();
        ctx.moveTo(labelCoordinate.x + cornerRadius, labelCoordinate.y);
        ctx.lineTo(labelCoordinate.x + width + padding.left + padding.right - cornerRadius, labelCoordinate.y);
        ctx.arc(labelCoordinate.x + width + padding.left + padding.right, labelCoordinate.y + cornerRadius, cornerRadius, 3 * Math.PI / 2, 0, false); // Corner
        ctx.lineTo(labelCoordinate.x + width + padding.left + padding.right + cornerRadius, labelCoordinate.y + height + padding.bottom);
        ctx.arc(labelCoordinate.x + width + padding.left + padding.right, labelCoordinate.y + height + cornerRadius, cornerRadius, 0, Math.PI / 2, false); // Corner
        ctx.lineTo(labelCoordinate.x + cornerRadius, labelCoordinate.y + height + 2 * cornerRadius);
        ctx.arc(labelCoordinate.x + cornerRadius, labelCoordinate.y + height + cornerRadius, cornerRadius, Math.PI / 2, Math.PI, false);
        ctx.lineTo(labelCoordinate.x, labelCoordinate.y + cornerRadius);
        ctx.fill();
        ctx.stroke();
        ctx.closePath();

        // Tag text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(messages[0], labelCoordinate.x + padding.left, labelCoordinate.y + padding.top);
        ctx.restore();
    }

    /**
     * This method turn the fill color of associated Path and Points into their original color.
     * @returns {resetFillStyle}
     */
    function resetFillStyle () {
        var path = getPath(), points = path.getPoints(),
            i, len = points.length;
        path.resetFillStyle();
        for (i = 0; i < len; i++) {
            points[i].resetFillStyle();
        }
        return this;
    }

    /**
     * This function sets properties.tag.x and properties.tag.y to 0
     * @returns {resetTagCoordinate}
     */
    function resetTagCoordinate () {
        properties.tagX = 0;
        properties.tagY = 0;
        return this;
    }

    /**
     * This method changes the alpha channel of the fill color of the path and points that constitute the path.
     * @param alpha
     * @returns {setAlpha}
     */
    function setAlpha (alpha) {
        var path = getPath(),
            points = path.getPoints(),
            len = points.length,
            fillColor = path.getFill();
        alpha = alpha ? alpha : 0.3;
        fillColor = util.color.changeAlphaRGBA(fillColor, alpha);
        path.setFillStyle(fillColor);
        for (var i = 0; i < len; i++) {
            points[i].setFillStyle(fillColor);
        }
        return this;
    }

    /**
     * This function sets the icon path of the point this label holds.
     * @param iconPath
     * @returns {*}
     */
    function setIconPath (iconPath) {
        if (path && path.points[0]) {
            var point = path.points[0];
            point.setIconPath(iconPath);
            return this;
        }
        return false;
    }

    /**
     * Set the labeler id
     * @param labelerIdIn
     * @returns {setLabelerId}
     */
    function setLabelerId (labelerIdIn) {
        properties.labelerId = labelerIdIn;
        return this;
    }

    /**
     * Sets a property
     * @param key
     * @param value
     * @returns {setProperty}
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Set status
     * @param key
     * @param value
     */
    function setStatus (key, value) {
        if (key in status) {
            if (key === 'visibility' && (value === 'visible' || value === 'hidden')) {
                setVisibility(value);
            } else if (key === 'tagVisibility' && (value === 'visible' || value === 'hidden')) {
                setTagVisibility(value);
            } else if (key === 'deleted' && typeof value === 'boolean') {
                status[key] = value;
            }
        }
    }

    /**
     * Set the visibility of the tag
     * @param visibility {string} visible or hidden
     * @returns {setTagVisibility}
     */
    function setTagVisibility (visibility) {
        if (!lock.tagVisibility) {
            if (visibility === 'visible' || visibility === 'hidden') {
                status['tagVisibility'] = visibility;
            }
        }
        return this;
    }

    /**
     * This function sets the sub label type of this label. E.g. for a bus stop there are StopSign_OneLeg
     * @param labelType
     * @returns {setSubLabelDescription}
     */
    function setSubLabelDescription (labelType) {
        var labelDescriptions = util.misc.getLabelDescriptions();
        properties.labelProperties.subLabelDescription = labelDescriptions[labelType].text;
        return this;
    }

    /**
     * Set this label's visibility to the passed visibility
     * @param visibility
     * @param labelerIds
     * @param included
     * @returns {setVisibilityBasedOnLabelerId}
     */
    function setVisibilityBasedOnLabelerId (visibility, labelerIds, included) {
        if (included === undefined) {
            if (labelerIds.indexOf(properties.labelerId) !== -1) {
                unlockVisibility().setVisibility(visibility).lockVisibility();
            } else {
                visibility = visibility === 'visible' ? 'hidden' : 'visible';
                unlockVisibility().setVisibility(visibility).lockVisibility();
            }
        } else {
            if (included) {
                if (labelerIds.indexOf(properties.labelerId) !== -1) {
                    unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            } else {
                if (labelerIds.indexOf(properties.labelerId) === -1) {
                    unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            }
        }

        return this;
    }

    /**
     * Set the visibility of the label
     * @param visibility
     * @returns {setVisibility}
     */
    function setVisibility (visibility) {
        if (!lock.visibility) { status.visibility = visibility; }
        return this;
    }

    /**
     * Set visibility of labels
     * @param visibility
     * @param panoId
     * @returns {setVisibilityBasedOnLocation}
     */
    function setVisibilityBasedOnLocation (visibility, panoramaId) {
        if (!status.deleted) {
            if (panoramaId === properties.panoId) {
                setVisibility(visibility);
            } else {
                visibility = visibility == 'visible' ? 'hidden' : 'visible';
                setVisibility(visibility);
            }
        }
        return this;
    }

    /**
     *
     * @param visibility
     * @param tables
     * @param included
     */
    function setVisibilityBasedOnLabelerIdAndLabelTypes (visibility, tables, included) {
        var tablesLen = tables.length, matched = false;

        for (var i = 0; i < tablesLen; i += 1) {
            if (tables[i].userIds.indexOf(properties.labelerId) !== -1) {
                if (tables[i].labelTypesToRender.indexOf(properties.labelProperties.labelType) !== -1) {
                    matched = true;
                }
            }
        }
        if (included === undefined) {
            if (matched) {
                unlockVisibility().setVisibility(visibility).lockVisibility();
            } else {
                visibility = visibility === 'visible' ? 'hidden' : 'visible';
                unlockVisibility().setVisibility(visibility).lockVisibility();
            }
        } else {
            if (included) {
                if (matched) {
                    unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            } else {
                if (!matched) {
                    unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            }
        }
    }

    /**
     * Show the delete button
     */
    function showDelete() {
        if (status.tagVisibility !== 'hidden') {
            var boundingBox = path.getBoundingBox(),
                x = boundingBox.x + boundingBox.width - 20,
                y = boundingBox.y;

            // Show a delete button
            $("#delete-icon-holder").css({
                visibility: 'visible',
                left : x + 25, // + width - 5,
                top : y - 20
            });
        }
    }

    /**
     * Calculate the offset to the label
     * @returns {{dx: number, dy: number, dz: number}}
     */
    function toOffset() {
        var imageCoordinates = path.getImageCoordinates(),
            pc = svl.pointCloud.getPointCloud(properties.panoId);
        if (pc) {
            var minDx = 1000, minDy = 1000, minDz = 1000,
                i, p, idx, dx, dy, dz, r, minR;
            for (i = 0; i < imageCoordinates.length; i++) {
                p = util.scaleImageCoordinate(imageCoordinates[i].x, imageCoordinates[i].y, 1 / 26);
                idx = 3 * (Math.ceil(p.x) + 512 * Math.ceil(p.y));
                dx = pc.pointCloud[idx];
                dy = pc.pointCloud[idx + 1];
                dz = pc.pointCloud[idx + 2];
                r = dx * dx + dy * dy;
                minR = minDx * minDx + minDy + minDy;

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
     * @returns {labelLatLng}
     */
    function toLatLng() {
        if (!properties.labelLat) {
            var imageCoordinates = path.getImageCoordinates(),
                pc = svl.pointCloud.getPointCloud(properties.panoId);
            if (pc) {
                var minDx = 1000, minDy = 1000, i, delta, latlng,
                    p, idx, dx, dy, r, minR;
                for (i = 0; i < imageCoordinates.length; i ++) {
                    p = util.scaleImageCoordinate(imageCoordinates[i].x, imageCoordinates[i].y, 1/26);
                    idx = 3 * (Math.ceil(p.x) + 512 * Math.ceil(p.y));
                    dx = pc.pointCloud[idx];
                    dy = pc.pointCloud[idx + 1];
                    r = dx * dx + dy * dy;
                    minR = minDx * minDx + minDy + minDy;

                    if (r < minR) {
                        minDx = dx;
                        minDy = dy;
                    }
                }
                delta = util.math.latlngOffset(properties.panoramaLat, dx, dy);
                latlng = {lat: properties.panoramaLat + delta.dlat, lng: properties.panoramaLng + delta.dlng};
                setProperty('labelLat', latlng.lat);
                setProperty('labelLng', latlng.lng);
                return latlng;
            } else {
                return null;
            }
        } else {
            return { lat: getProperty('labelLat'), lng: getProperty('labelLng') };  // Return the cached value
        }

    }

    /**
     * Unlock status.visibility
     * @returns {unlockVisibility}
     */
    function unlockVisibility () {
        lock.visibility = false;
        return this;
    }

    /**
     * Unlock status.tagVisibility
     * @returns {unlockTagVisibility}
     */
    function unlockTagVisibility () {
        lock.tagVisibility = false;
        return this;
    }

    self.resetFillStyle = resetFillStyle;
    self.blink = blink;
    self.fadeFillStyle = fadeFillStyle;
    self.getBoundingBox = getBoundingBox;
    self.getGSVImageCoordinate = getGSVImageCoordinate;
    self.getImageCoordinates = getImageCoordinates;
    self.getLabelId = getLabelId;
    self.getLabelType = getLabelType;
    self.getPath = getPath;
    self.getPoint = getPoint;
    self.getPoints = getPoints;
    self.getLabelPov = getLabelPov;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.getstatus = getStatus;
    self.getVisibility = getVisibility;
    self.fill = fill;
    self.isDeleted = isDeleted;
    self.isOn = isOn;
    self.isVisible = isVisible;
    self.highlight = highlight;
    self.lockTagVisibility = lockTagVisibility;
    self.lockVisibility = lockVisibility;
    self.overlap = overlap;
    self.removePath = removePath;
    self.render = render;
    self.remove = remove;
    self.resetTagCoordinate = resetTagCoordinate;
    self.setAlpha = setAlpha;
    self.setIconPath = setIconPath;
    self.setLabelerId = setLabelerId;
    self.setProperty = setProperty;
    self.setStatus = setStatus;
    self.setTagVisibility = setTagVisibility;
    self.setSubLabelDescription = setSubLabelDescription;
    self.setVisibility = setVisibility;
    self.setVisibilityBasedOnLocation = setVisibilityBasedOnLocation;
    self.setVisibilityBasedOnLabelerId = setVisibilityBasedOnLabelerId;
    self.setVisibilityBasedOnLabelerIdAndLabelTypes = setVisibilityBasedOnLabelerIdAndLabelTypes;
    self.unlockTagVisibility = unlockTagVisibility;
    self.unlockVisibility = unlockVisibility;
    self.toLatLng = toLatLng;

    _init(params, pathIn);
    return self;
}
