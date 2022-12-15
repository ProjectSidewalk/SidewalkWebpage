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
            distanceSvImageYSlope: 0.0138947,
            distanceCanvasYSlope: 0.0011023
        },
        2: {
            headingIntercept: -27.5267447,
            headingCanvasXSlope: 0.0784357,
            distanceIntercept: 20.8794248,
            distanceSvImageYSlope: 0.0184087,
            distanceCanvasYSlope: 0.0022135
        },
        3: {
            headingIntercept: -13.5675945,
            headingCanvasXSlope: 0.0396061,
            distanceIntercept: 25.2472682,
            distanceSvImageYSlope: 0.0264216,
            distanceCanvasYSlope: 0.0011071
        }
    };
    var RADIUS_INNER_CIRCLE = 17;
    var RADIUS_OUTER_CIRCLE = 14;
    var TAG_HEIGHT = 20;

    // TODO rename some things...
    // canvasCoordinate -> currentCanvasCoordinate
    // pov -> ???
    // originalPov -> povToCenterLabel ??
    // panoramaHeading, panoramaPitch, panoramaZoom -> povOfPanoWhenLabeled
    // I think the originalPov is actually just the same as panoramaHeading, panoramaPitch, panoramaZoom..?
    var properties = {
        canvasWidth: undefined,
        canvasHeight: undefined,
        canvasDistortionAlphaX: undefined,
        canvasDistortionAlphaY: undefined,
        labelId: 'DefaultValue',
        auditTaskId: undefined,
        missionId: undefined,
        labelType: undefined,
        labelDescription: undefined,
        iconImagePath: undefined,
        originalCanvasCoordinate: undefined,
        canvasCoordinate: undefined,
        svImageCoordinate: undefined,
        pov: undefined,
        originalPov: undefined,
        labelLat: undefined,
        labelLng: undefined,
        latLngComputationMethod: undefined,
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
        tagIds: [],
        severity: null,
        tutorial: null,
        temporaryLabelId: null,
        temporaryLabel: false,
        description: null
    };

    var status = {
        deleted : false,
        tagVisibility : 'visible',
        visibility : 'visible'
    };

    var tagProperties = util.misc.getSeverityDescription();

    function _init(param) {
        for (var attrName in param) {
            properties[attrName] = param[attrName];
        }

        properties.iconImagePath = util.misc.getIconImagePaths(properties.labelType).iconImagePath;
        properties.fillStyle = util.misc.getLabelColors()[properties.labelType].fillStyle;


        properties.pov = {
            heading : param.pov.heading,
            pitch : param.pov.pitch,
            zoom : param.pov.zoom
        };
        if (!param.originalPov) {
            properties.originalPov = {
                heading: param.pov.heading,
                pitch: param.pov.pitch,
                zoom: param.pov.zoom
            };
        }

        // If we haven't determined the sv_image_x/y and image dim yet, fetch the pano metadata and update.
        if (properties.svImageCoordinate === undefined) {
            svl.panoramaContainer.fetchPanoramaMetaData(properties.panoId, function() {
                var panoData = svl.panoramaContainer.getPanorama(properties.panoId).data();

                properties.svImageWidth = panoData.tiles.worldSize.width;
                properties.svImageHeight = panoData.tiles.worldSize.height;

                var svCoord = util.panomarker.calculateImageCoordinateFromPointPov(properties.originalPov, properties.svImageWidth, properties.svImageHeight);
                if (svCoord.x < 0) svCoord.x = svCoord.x + properties.svImageWidth;
                properties.svImageCoordinate = svCoord;

                if (typeof google !== "undefined" && google && google.maps) {
                    googleMarker = createMinimapMarker(properties.labelType);
                    googleMarker.setMap(svl.map.getMap());
                }
            });
        } else {
            // If the sv_image_x/y were already calculated, then we can just create the marker on the minimap.
            if (typeof google !== "undefined" && google && google.maps) {
                googleMarker = createMinimapMarker(properties.labelType);
                googleMarker.setMap(svl.map.getMap());
            }
        }
    }

    /**
     * This method creates a Google Maps marker.
     * https://developers.google.com/maps/documentation/javascript/markers
     * https://developers.google.com/maps/documentation/javascript/examples/marker-remove
     * @returns {google.maps.Marker}
     */
    function createMinimapMarker (labelType) {
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

    /**
     * This function returns the coordinate the label.
     * @returns {*}
     */
    function getCoordinate() {
        return properties.canvasCoordinate;
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
     * This function returns panoId property
     * @returns {*}
     */
    function getPanoId () { return properties.panoId; }

    /**
     * Return deep copy of properties obj, so one can only modify props from setProperties() (not yet implemented).
     * JavaScript Deepcopy
     * http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-a-javascript-object
     */
    function getProperties () { return $.extend(true, {}, properties); }

    /**
     * Get a property
     * @param propName
     */
    function getProperty(propName) { return (propName in properties) ? properties[propName] : false; }

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
     * Check if the label is deleted
     * @returns {boolean}
     */
    function isDeleted () { return status.deleted; }


    /**
     * Check if a label is under a cursor
     * @param x
     * @param y
     * @returns {boolean}
     */
    function isOn (x, y) {
        if (status.deleted || status.visibility === 'hidden') {  return false; }
        var margin = RADIUS_OUTER_CIRCLE / 2 + 3;
        if (x < properties.canvasCoordinate.x + margin &&
            x > properties.canvasCoordinate.x - margin &&
            y < properties.canvasCoordinate.y + margin &&
            y > properties.canvasCoordinate.y - margin) {
            return this;
        } else {
            return false;
        }
    }

    /**
     * This method returns the visibility of this label.
     * @returns {boolean}
     */
    function isVisible () {
        return status.visibility === 'visible';
    }

    /**
     * Remove the label (it does not actually remove, but hides the label and set its status to 'deleted').
     */
    function remove () {
        setStatus('deleted', true);
        setStatus('visibility', 'hidden');
    }

    /**
     * This method renders this label on a canvas.
     * @param ctx
     * @param pov
     * @returns {self}
     */
    function render(ctx, pov) {
        if (!status.deleted && status.visibility === 'visible') {
            // Render a tag -- triggered by mouse hover event.
            // Get a text to render (e.g, attribute type), and canvas coordinate to render the tag.
            if (status.tagVisibility === 'visible') {
                renderTag(ctx);
                showDelete();
            }


            // Find current pov of the label and update it.
            // TODO maybe 'originalPov' should be renamed to 'previousPov' and it should update..?
            // var canvasCoord = getProperty('originalCanvasCoordinate');
            // var canvasCoord = { x: getProperty('originalCanvasCoordinate').x, y: getProperty('originalCanvasCoordinate').y };
            var canvasCoord = properties.canvasCoordinate;
            canvasCoord =  util.panomarker.getCanvasCoordinate(canvasCoord, properties.originalPov, pov);
            properties.canvasCoordinate = canvasCoord;

            if (canvasCoord.x < 0) {
                properties.pov = {};
            }
            else {
                properties.pov = util.panomarker.calculatePointPov(canvasCoord.x, canvasCoord.y, pov);
            }

            // Draw the label type icon.
            var imageObj, imageHeight, imageWidth, imageX, imageY;
            imageObj = new Image();
            imageHeight = imageWidth = 2 * RADIUS_INNER_CIRCLE - 3;
            imageX =  canvasCoord.x - RADIUS_INNER_CIRCLE + 2;
            imageY = canvasCoord.y - RADIUS_INNER_CIRCLE + 2;

            imageObj.src = getProperty('iconImagePath');

            try {
                ctx.drawImage(imageObj, imageX, imageY, imageHeight, imageWidth);
            } catch (e) {
                console.debug(e);
            }
            ctx.restore();

            // Draws label outline.
            ctx.save();
            ctx.beginPath();
            ctx.fillStyle = getProperty('fillStyle');
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.arc(getCoordinate().x, getCoordinate().y, 15.3, 0, 2 * Math.PI);
            ctx.strokeStyle = 'black';
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(getCoordinate().x, getCoordinate().y, 16.2, 0, 2 * Math.PI);
            ctx.strokeStyle = 'white';
            ctx.stroke();

            // Only render severity warning if there's a severity option.
            if (properties.labelType !== 'Occlusion' && properties.labelType !== 'Signal') {
                if (properties.severity === null) {
                    showSeverityAlert(ctx);
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
     * This function renders a tag on a canvas to show a property of the label.
     *
     * NOTE "tag" here means the box that is shown when hovering over a label. This doesn't refer to tags for a label.
     * @param ctx
     * @returns {boolean}
     */
    function renderTag(ctx) {
        if ('contextMenu' in svl && svl.contextMenu.isOpen()) {
            return false;
        }

        // labelCoordinate represents the upper left corner of the tag.
        var labelCoordinate = getCoordinate(),
            cornerRadius = 3,
            hasSeverity = (properties.labelType !== 'Occlusion' && properties.labelType !== 'Signal'),
            i, height,
            width = 0,
            labelRows = 1,
            severityImage = new Image(),
            severityImagePath = undefined,
            severityMessage = i18next.t('center-ui.context-menu.severity'),
            msg = i18next.t(util.camelToKebab(properties.labelType) + '-description'),
            messages = msg.split('\n'),
            padding = { left: 12, right: 5, bottom: 0, top: 18 };

        if (hasSeverity) {
            labelRows = 2;
            if (properties.severity !== null) {
                severityImagePath = tagProperties[properties.severity].severityImage;
                severityImage.src = severityImagePath;
                severityMessage = tagProperties[properties.severity].message;
            }
        }

        // Set rendering properties and draw a tag.
        ctx.save();
        ctx.font = '13px Open Sans';

        height = TAG_HEIGHT * labelRows;

        for (i = 0; i < messages.length; i += 1) {
            // Width of the tag is determined by the width of the longest row.
            var firstRow = ctx.measureText(messages[i]).width;
            var secondRow = -1;

            // Do additional adjustments on tag width to make room for smiley icon.
            if (hasSeverity) {
                secondRow = ctx.measureText(severityMessage).width;
                if (severityImagePath != undefined) {
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

        // Tag text and image
        ctx.fillStyle = '#ffffff';
        ctx.fillText(messages[0], labelCoordinate.x + padding.left, labelCoordinate.y + padding.top);
        if (hasSeverity) {
            ctx.fillText(severityMessage, labelCoordinate.x + padding.left, labelCoordinate.y + TAG_HEIGHT + padding.top);
            if (properties.severity !== null) {
              ctx.drawImage(severityImage, labelCoordinate.x + padding.left + ctx.measureText(severityMessage).width + 5, labelCoordinate.y + 25, 16, 16);
            }
        }

        ctx.restore();
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
            } else if (key === 'severity') {
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
        if (visibility === 'visible' || visibility === 'hidden') {
            status['tagVisibility'] = visibility;
        }
        return this;
    }

    /**
     * Set the visibility of the label
     * @param visibility
     * @returns {setVisibility}
     */
    function setVisibility (visibility) {
        status.visibility = visibility;
        return this;
    }

    /**
     * Set visibility of labels
     * @param visibility
     * @param panoramaId
     * @returns {setVisibilityBasedOnLocation}
     */
    function setVisibilityBasedOnLocation (visibility, panoramaId) {
        if (!status.deleted) {
            if (panoramaId === properties.panoId) {
                setVisibility(visibility);
            } else {
                visibility = visibility === 'visible' ? 'hidden' : 'visible';
                setVisibility(visibility);
            }
        }
        return this;
    }

    /**
     * Show the delete button
     */
    function showDelete() {
        if (status.tagVisibility !== 'hidden') {
            var coord = getCoordinate();
            $("#delete-icon-holder").css({
                visibility: 'visible',
                left : coord.x + 5,
                top : coord.y - 20
            });
        }
    }

    /**
     * Renders a question mark if a label has an unmarked severity
     * @param ctx   Rendering tool for severity (2D context)
     */
    function showSeverityAlert(ctx) {
        var labelCoordinate = getCoordinate();
        var x = labelCoordinate.x;
        var y = labelCoordinate.y;

        // Draws circle
        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = 'rgb(160, 45, 50, 0.9)';
        ctx.ellipse(x - 15, y - 10.5, 8, 8, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.closePath();

        // Draws text
        ctx.beginPath();
        ctx.font = "12px Open Sans";
        ctx.fillStyle = 'rgb(255, 255, 255)';
        ctx.fillText('?', x - 17.5, y - 6);
        ctx.closePath();
        ctx.restore();
    }

    /**
     * Get the label latlng position
     * @returns {labelLatLng}
     */
    function toLatLng() {
        if (!properties.labelLat) {
            // Estimate the latlng point from the camera position and the heading angle when the point cloud data is not available.
            var panoLat = getProperty("panoramaLat");
            var panoLng = getProperty("panoramaLng");
            var panoHeading = getProperty("panoramaHeading");
            var zoom = getProperty("panoramaZoom");
            var canvasX = getProperty('originalCanvasCoordinate').x;
            var canvasY = getProperty('originalCanvasCoordinate').y;
            var svImageY = getProperty('svImageCoordinate').y;

            // Estimate heading diff and distance from pano using output from a regression analysis.
            // https://github.com/ProjectSidewalk/label-latlng-estimation/blob/master/scripts/label-latlng-estimation.md#results
            var estHeadingDiff =
                LATLNG_ESTIMATION_PARAMS[zoom].headingIntercept +
                LATLNG_ESTIMATION_PARAMS[zoom].headingCanvasXSlope * canvasX;
            var estDistanceFromPanoKm = Math.max(0,
                LATLNG_ESTIMATION_PARAMS[zoom].distanceIntercept +
                LATLNG_ESTIMATION_PARAMS[zoom].distanceSvImageYSlope * svImageY +
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

    self.getCoordinate = getCoordinate;
    self.getLabelId = getLabelId;
    self.getLabelType = getLabelType;
    self.getPanoId = getPanoId;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.getstatus = getStatus;
    self.getVisibility = getVisibility;
    self.isDeleted = isDeleted;
    self.isOn = isOn;
    self.isVisible = isVisible;
    self.render = render;
    self.remove = remove;
    self.setProperty = setProperty;
    self.setStatus = setStatus;
    self.setTagVisibility = setTagVisibility;
    self.setVisibility = setVisibility;
    self.setVisibilityBasedOnLocation = setVisibilityBasedOnLocation;
    self.toLatLng = toLatLng;

    _init(params);
    return self;
}
