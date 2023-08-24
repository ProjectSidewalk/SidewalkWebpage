/**
 * A Label module.
 * @param params
 * @returns {*}
 * @constructor
 * @memberof svl
 */
function Label(params) {
    var self = { className: 'Label' };

    var googleMarker;

    // Parameters determined from a series of linear regressions. Here links to the analysis and relevant Github issues:
    // https://github.com/ProjectSidewalk/label-latlng-estimation/blob/master/scripts/label-latlng-estimation.md#results
    // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2374
    // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2362
    var LATLNG_ESTIMATION_PARAMS = {
        1: {
            headingIntercept: -51.2401711,
            headingCanvasXSlope: 0.1443374,
            distanceIntercept: 18.6051843,
            distancePanoYSlope: 0.0138947,
            distanceCanvasYSlope: 0.0011023
        },
        2: {
            headingIntercept: -27.5267447,
            headingCanvasXSlope: 0.0784357,
            distanceIntercept: 20.8794248,
            distancePanoYSlope: 0.0184087,
            distanceCanvasYSlope: 0.0022135
        },
        3: {
            headingIntercept: -13.5675945,
            headingCanvasXSlope: 0.0396061,
            distanceIntercept: 25.2472682,
            distancePanoYSlope: 0.0264216,
            distanceCanvasYSlope: 0.0011071
        }
    };
    var HOVER_INFO_HEIGHT = 20;

    var properties = {
        labelId: 'DefaultValue',
        auditTaskId: undefined,
        missionId: undefined,
        labelType: undefined,
        fillStyle: undefined,
        iconImagePath: undefined,
        originalCanvasXY: undefined,
        currCanvasXY: undefined,
        panoXY: undefined,
        originalPov: undefined,
        povOfLabelIfCentered: undefined,
        labelLat: undefined,
        labelLng: undefined,
        latLngComputationMethod: undefined,
        panoId: undefined,
        panoLat: undefined,
        panoLng: undefined,
        cameraHeading: undefined,
        panoWidth: undefined,
        panoHeight: undefined,
        tagIds: [],
        severity: null,
        tutorial: null,
        temporaryLabelId: null,
        temporaryLabel: false,
        description: null,
        predictionMade: null
    };

    var status = {
        deleted : false,
        hoverInfoVisibility : 'visible',
        visibility : 'visible'
    };

    var hoverInfoProperties = util.misc.getSeverityDescription();

    function _init(param) {
        for (var attrName in param) {
            if (param.hasOwnProperty(attrName) && properties.hasOwnProperty(attrName)) {
                properties[attrName] = param[attrName];
            }
        }

        properties.iconImagePath = util.misc.getIconImagePaths(properties.labelType).iconImagePath;
        properties.fillStyle = util.misc.getLabelColors()[properties.labelType].fillStyle;

        // Save pano data and calculate pano_x/y if the label is new.
        if (properties.panoXY === undefined) {
            var panoData = svl.panoramaContainer.getPanorama(properties.panoId).data();

            properties.panoWidth = panoData.tiles.worldSize.width;
            properties.panoHeight = panoData.tiles.worldSize.height;
            properties.cameraHeading = panoData.tiles.originHeading;
            properties.panoLat = panoData.location.latLng.lat();
            properties.panoLng = panoData.location.latLng.lng();
            properties.panoXY = util.panomarker.calculatePanoXYFromPov(
                properties.povOfLabelIfCentered, properties.cameraHeading, properties.panoWidth, properties.panoHeight
            );
        }

        // Create the marker on the minimap.
        if (typeof google !== "undefined" && google && google.maps) {
            googleMarker = createMinimapMarker(properties.labelType);
            googleMarker.setMap(svl.map.getMap());
        }
    }

    /**
     * This method creates a Google Maps marker.
     * https://developers.google.com/maps/documentation/javascript/markers
     * https://developers.google.com/maps/documentation/javascript/examples/marker-remove
     * @returns {google.maps.Marker}
     */
    function createMinimapMarker(labelType) {
        if (typeof google !== "undefined") {
            var latlng = toLatLng();
            var googleLatLng = new google.maps.LatLng(latlng.lat, latlng.lng);

            var imagePaths = util.misc.getIconImagePaths(),
                url = imagePaths[labelType].minimapIconImagePath;

            return new google.maps.Marker({
                position: googleLatLng,
                map: svl.map.getMap(),
                title: "Hi!",
                icon: url,
                size: new google.maps.Size(20, 20)
            });
        }
    }

    // Some functions for easy access to commonly accessed properties.
    function getLabelId() { return properties.labelId; }
    function getLabelType() { return properties.labelType; }
    function getPanoId () { return properties.panoId; }

    /**
     * Returns the coordinate of the label.
     * @returns { x: Number, y: Number }
     */
    function getCanvasXY() {
        return properties.currCanvasXY;
    }

    /**
     * Return deep copy of properties obj, so one can only modify props from setProperties() (not yet implemented).
     * http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-a-javascript-object
     */
    function getProperties() { return $.extend(true, {}, properties); }

    function getProperty(propName) { return (propName in properties) ? properties[propName] : false; }

    function setProperty(key, value) { properties[key] = value; }

    function getStatus(key) { return status[key]; }
    function isDeleted() { return status.deleted; }
    function isVisible() { return status.visibility === 'visible'; }
    function setVisibility(visibility) { status.visibility = visibility; }

    /**
     * Set status. Deals with special cases for the various status values that have a limited set of values.
     * @param key
     * @param value
     */
    function setStatus (key, value) {
        if (key in status) {
            if (key === 'visibility' && (value === 'visible' || value === 'hidden')) {
                setVisibility(value);
            } else if (key === 'hoverInfoVisibility' && (value === 'visible' || value === 'hidden')) {
                setHoverInfoVisibility(value);
            } else if (key === 'deleted' && typeof value === 'boolean') {
                status[key] = value;
            } else if (key === 'severity') {
                status[key] = value;
            }
        }
    }

    /**
     * Set the visibility of the hover info.
     * @param visibility {string} visible or hidden
     * @returns {setHoverInfoVisibility}
     */
    function setHoverInfoVisibility (visibility) {
        if (visibility === 'visible' || visibility === 'hidden') {
            status['hoverInfoVisibility'] = visibility;
        }
        return this;
    }

    /**
     * Check if this label is under the cursor.
     * @param x
     * @param y
     * @returns {boolean}
     */
    function isOn(x, y) {
        var margin = svl.LABEL_ICON_RADIUS / 2 + 2;
        return !status.deleted &&
            status.visibility === 'visible' &&
            x < properties.currCanvasXY.x + margin &&
            x > properties.currCanvasXY.x - margin &&
            y < properties.currCanvasXY.y + margin &&
            y > properties.currCanvasXY.y - margin;
    }

    /**
     * Remove the label (it does not actually remove, but hides the label and set its status to 'deleted').
     */
    function remove() {
        setStatus('deleted', true);
        setStatus('visibility', 'hidden');
    }

    /**
     * Renders this label on a canvas.
     * @param ctx
     * @param pov
     * @returns {self}
     */
    function render(ctx, pov) {
        if (!status.deleted && status.visibility === 'visible') {
            if (status.hoverInfoVisibility === 'visible') {
                // Render hover info and delete button.
                renderHoverInfo(ctx);
                showDeleteButton();
            }

            // Update the coordinates of the label on the canvas.
            if (svl.map.getPovChangeStatus()) {
                properties.currCanvasXY = util.panomarker.getCanvasCoordinate(
                    properties.povOfLabelIfCentered, pov, util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT, svl.LABEL_ICON_RADIUS
                );
            }

            if (properties.currCanvasXY.x > 0 && properties.currCanvasXY.y > 0) {
                // Draw the label icon.
                var imageObj, imageHeight, imageWidth, imageX, imageY;
                imageObj = new Image();
                imageHeight = imageWidth = 2 * svl.LABEL_ICON_RADIUS - 3;
                imageX =  properties.currCanvasXY.x - svl.LABEL_ICON_RADIUS + 2;
                imageY = properties.currCanvasXY.y - svl.LABEL_ICON_RADIUS + 2;
                imageObj.src = getProperty('iconImagePath');
                try {
                    ctx.drawImage(imageObj, imageX, imageY, imageHeight, imageWidth);
                } catch (e) {
                    console.debug(e);
                }

                // Draws label outline.
                ctx.beginPath();
                ctx.fillStyle = getProperty('fillStyle');
                ctx.lineWidth = 0.7;
                ctx.beginPath();
                ctx.arc(properties.currCanvasXY.x, properties.currCanvasXY.y, 15.3, 0, 2 * Math.PI);
                ctx.strokeStyle = 'black';
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(properties.currCanvasXY.x, properties.currCanvasXY.y, 16.2, 0, 2 * Math.PI);
                ctx.strokeStyle = 'white';
                ctx.stroke();

                // Only render severity warning if there's a severity option.
                if (!['Occlusion', 'Signal'].includes(properties.labelType) && properties.severity === null) {
                    showSeverityAlert(ctx);
                }
            }
        }

        // Show the label on the Google Maps pane.
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
     * Renders hover info on a canvas to show an overview of the label info.
     * @param ctx
     * @returns {boolean}
     */
    function renderHoverInfo(ctx) {
        if ('contextMenu' in svl && svl.contextMenu.isOpen()) {
            return false;
        }

        // labelCoordinate represents the upper left corner of the hover info.
        var labelCoordinate = getCanvasXY(),
            cornerRadius = 3,
            hasSeverity = (properties.labelType !== 'Occlusion' && properties.labelType !== 'Signal'),
            width = 0,
            labelRows = 1,
            severityImage = new Image(),
            severitySVGElement,
            severityMessage = i18next.t('center-ui.context-menu.severity'),
            msg = i18next.t('common:' + util.camelToKebab(properties.labelType)),
            messages = msg.split('\n'),
            padding = { left: 12, right: 5, bottom: 0, top: 18 };

        if (hasSeverity) {
            labelRows = 2;
            if (properties.severity !== null) {
                severitySVGElement = $(`.severity-icon.template.severity-${properties.severity}`).clone().removeClass('template').find('svg');
                severityImage.src = 'data:image/svg+xml; charset=utf8, ' + encodeURIComponent($(severitySVGElement).prop('outerHTML'));
                severityMessage = hoverInfoProperties[properties.severity].message;
            }
        }

        // Set rendering properties and draw the hover info.
        ctx.font = '13px Open Sans';
        var height = HOVER_INFO_HEIGHT * labelRows;

        for (var i = 0; i < messages.length; i += 1) {
            // Width of the hover info is determined by the width of the longest row.
            var firstRow = ctx.measureText(messages[i]).width;
            var secondRow = -1;

            // Do additional adjustments on the width to make room for smiley icon.
            if (hasSeverity) {
                secondRow = ctx.measureText(severityMessage).width;
                if (severitySVGElement !== undefined) {
                    if (firstRow - secondRow > 0 && firstRow - secondRow < 15) {
                        width += 15 - firstRow + secondRow;
                    } else if (firstRow - secondRow < 0) {
                        width += 20;
                    }
                }
            }

            width += Math.max(firstRow, secondRow) + 5;
        }

        ctx.lineCap = 'square';
        ctx.lineWidth = 2;
        ctx.fillStyle = util.misc.getLabelColors(getProperty('labelType'));
        ctx.strokeStyle = 'rgba(255,255,255,1)';


        // Hover info background.
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

        // Hover info text and image.
        ctx.fillStyle = '#ffffff';
        ctx.fillText(messages[0], labelCoordinate.x + padding.left, labelCoordinate.y + padding.top);
        if (hasSeverity) {
            ctx.fillText(severityMessage, labelCoordinate.x + padding.left, labelCoordinate.y + HOVER_INFO_HEIGHT + padding.top);
            if (properties.severity !== null) {
                ctx.drawImage(severityImage, labelCoordinate.x + padding.left +
                    ctx.measureText(severityMessage).width + 5, labelCoordinate.y + 25, 16, 16);
            }
        }
    }

    function showDeleteButton() {
        if (status.hoverInfoVisibility !== 'hidden') {
            var coord = getCanvasXY();
            svl.ui.canvas.deleteIconHolder.css({ visibility: 'visible', left : coord.x + 5, top : coord.y - 20 });
        }
    }

    /**
     * Renders a question mark if a label has an unmarked severity.
     * @param ctx Rendering tool for severity (2D context).
     */
    function showSeverityAlert(ctx) {
        var x = properties.currCanvasXY.x;
        var y = properties.currCanvasXY.y;

        // Draws circle.
        ctx.beginPath();
        ctx.fillStyle = 'rgb(160, 45, 50, 0.9)';
        ctx.ellipse(x - 15, y - 10.5, 8, 8, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.closePath();

        // Draws text.
        ctx.beginPath();
        ctx.font = "12px Open Sans";
        ctx.fillStyle = 'rgb(255, 255, 255)';
        ctx.fillText('?', x - 17.5, y - 6);
        ctx.closePath();
    }

    /**
     * Get the label's estimated latlng position.
     * @returns {lat: Number, lng: Number, computationMethod: String}
     */
    function toLatLng() {
        if (!properties.labelLat) {
            // Estimate the latlng point from the camera position and the heading when point cloud data isn't available.
            var panoLat = getProperty("panoLat");
            var panoLng = getProperty("panoLng");
            var panoHeading = getProperty("originalPov").heading;
            var zoom = Math.round(getProperty("originalPov").zoom); // Need to round specifically for Safari.
            var canvasX = getProperty('originalCanvasXY').x;
            var canvasY = getProperty('originalCanvasXY').y;
            var panoY = getProperty('panoXY').y;
            var panoHeight = getProperty('panoHeight');
            // Estimate heading diff and distance from pano using output from a regression analysis.
            // https://github.com/ProjectSidewalk/label-latlng-estimation/blob/master/scripts/label-latlng-estimation.md#results
            var estHeadingDiff =
                LATLNG_ESTIMATION_PARAMS[zoom].headingIntercept +
                LATLNG_ESTIMATION_PARAMS[zoom].headingCanvasXSlope * canvasX;
            var estDistanceFromPanoKm = Math.max(0,
                LATLNG_ESTIMATION_PARAMS[zoom].distanceIntercept +
                LATLNG_ESTIMATION_PARAMS[zoom].distancePanoYSlope * (panoHeight / 2 - panoY) +
                LATLNG_ESTIMATION_PARAMS[zoom].distanceCanvasYSlope * canvasY
            ) / 1000.0;
            var estHeading = panoHeading + estHeadingDiff;
            var startPoint = turf.point([panoLng, panoLat]);

            // Use the pano location, distance from pano estimate, and heading estimate, calculate label location.
            var destination = turf.destination(startPoint, estDistanceFromPanoKm, estHeading, { units: 'kilometers' });
            var latlng = {
                lat: destination.geometry.coordinates[1],
                lng: destination.geometry.coordinates[0],
                latLngComputationMethod: 'approximation2'
            };
            setProperty('labelLat', latlng.lat);
            setProperty('labelLng', latlng.lng);
            setProperty('latLngComputationMethod', latlng.latLngComputationMethod);
            return latlng;
        } else {
            // Return the cached value.
            return {
                lat: getProperty('labelLat'),
                lng: getProperty('labelLng'),
                latLngComputationMethod: getProperty('latLngComputationMethod')
            };
        }

    }

    self.getCanvasXY = getCanvasXY;
    self.getLabelId = getLabelId;
    self.getLabelType = getLabelType;
    self.getPanoId = getPanoId;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.getstatus = getStatus;
    self.isDeleted = isDeleted;
    self.isOn = isOn;
    self.isVisible = isVisible;
    self.render = render;
    self.remove = remove;
    self.setProperty = setProperty;
    self.setStatus = setStatus;
    self.setHoverInfoVisibility = setHoverInfoVisibility;
    self.setVisibility = setVisibility;
    self.toLatLng = toLatLng;

    _init(params);
    return self;
}
