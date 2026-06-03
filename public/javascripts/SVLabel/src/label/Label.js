/**
 * A Label module.
 * @param params
 * @returns {*}
 * @constructor
 * @memberof svl
 */
function Label(params) {
    var self = { className: 'Label' };

    let googleMarker;

    // Parameters determined from a series of linear regressions. Here links to the analysis and relevant GitHub issues:
    // https://github.com/ProjectSidewalk/label-latlng-estimation/blob/master/scripts/label-latlng-estimation.md#results
    // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2374
    // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2362
    const LATLNG_ESTIMATION_PARAMS = {
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

    const properties = {
        labelId: 'DefaultValue',
        auditTaskId: undefined,
        missionId: undefined,
        labelType: undefined,
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
        tutorialLabelNumber: undefined,
        temporaryLabelId: null,
        description: null,
        crop: undefined
    };

    const status = {
        deleted : false,
        hoverInfoVisibility : 'visible',
        visibility : 'visible'
    };

    const hoverInfoProperties = util.misc.getSeverityDescription();

    function _init(param) {
        for (const attrName in param) {
            if (param.hasOwnProperty(attrName) && properties.hasOwnProperty(attrName)) {
                properties[attrName] = param[attrName];
            }
        }

        // Save pano data and calculate pano_x/y if the label is new.
        if (properties.panoXY === undefined) {
            const panoData = svl.panoStore.getPanoData(properties.panoId).getProperties();

            properties.panoWidth = panoData.width;
            properties.panoHeight = panoData.height;
            properties.cameraHeading = panoData.cameraHeading;
            properties.panoLat = panoData.lat;
            properties.panoLng = panoData.lng;
            properties.panoXY = util.pano.povToPanoCoord(
                properties.povOfLabelIfCentered, properties.cameraHeading, properties.panoWidth, properties.panoHeight
            );
        }

        // Create the marker on the minimap.
        const latlng = toLatLng();
        googleMarker = Label.createMinimapMarker(properties.labelType, latlng);
        googleMarker.setMap(svl.minimap.getMap());
    }

    // Some functions for easy access to commonly accessed properties.
    function getLabelId() { return properties.labelId; }
    function getLabelType() { return properties.labelType; }
    function getPanoId () { return properties.panoId; }

    /**
     * Returns the coordinate of the label.
     * @returns { x: number, y: number }
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
    function setHoverInfoVisibility(visibility) {
        if (visibility === 'visible' || visibility === 'hidden') {
            status['hoverInfoVisibility'] = visibility;
        }
        return this;
    }

    function getHoverInfoVisibility() {
        return status.hoverInfoVisibility;
    }

    /**
     * Check if this label is under the cursor.
     * @param x
     * @param y
     * @returns {boolean}
     */
    function isOn(x, y) {
        const margin = svl.LABEL_ICON_RADIUS / 2 + 2;
        return !status.deleted
            && status.visibility === 'visible'
            && properties.currCanvasXY
            && x < properties.currCanvasXY.x + margin
            && x > properties.currCanvasXY.x - margin
            && y < properties.currCanvasXY.y + margin
            && y > properties.currCanvasXY.y - margin;
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
                // Show the hover info tooltip and delete button.
                updateHoverInfo();
                showDeleteButton();
            }

            // Update the coordinates of the label on the canvas.
            properties.currCanvasXY = util.pano.centeredPovToCanvasCoord(
                properties.povOfLabelIfCentered, pov, util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT, svl.LABEL_ICON_RADIUS
            );

            // Draw the label icon if it's in the visible part of the pano.
            if (properties.currCanvasXY) {
                Label.renderLabelIcon(ctx, properties.labelType, properties.currCanvasXY.x, properties.currCanvasXY.y);

                // Only render severity warning if there's a severity option.
                if (util.misc.labelTypeHasSeverity(properties.labelType) && properties.severity === null) {
                    showSeverityAlert(ctx);
                }
            }
        }

        // Show the label on the Google Maps pane.
        if (!isDeleted()) {
            if (googleMarker && !googleMarker.map) {
                googleMarker.setMap(svl.minimap.getMap());
            }
        } else {
            if (googleMarker && googleMarker.map) {
                googleMarker.setMap(null);
            }
        }
        return this;
    }

    /**
     * Shows the hover info tooltip next to this label, displaying its type and severity.
     *
     * The tooltip is a single shared DOM element positioned in on-screen pixels, so the label's logical canvas
     * coordinate is scaled to the displayed pano size (see util.exploreDisplayScale).
     */
    function updateHoverInfo() {
        // Don't show the hover tooltip while the context menu is open or before the label has a canvas position.
        if (('contextMenu' in svl && svl.contextMenu.isOpen()) || !properties.currCanvasXY) {
            hideHoverInfo();
            return;
        }

        const labelType = properties.labelType;
        const hasSeverity = util.misc.labelTypeHasSeverity(labelType);

        svl.ui.canvas.hoverInfoType.text(
            i18next.t('common:' + util.camelToKebab(labelType)).replace('&shy;', '')
        );
        svl.ui.canvas.hoverInfoHolder.css('background-color', util.misc.getLabelColors(labelType));

        // Severity row: hidden for label types without severity; otherwise show the rating (or a prompt to rate).
        if (hasSeverity) {
            if (properties.severity !== null) {
                svl.ui.canvas.hoverInfoSeverityText.text(hoverInfoProperties[properties.severity].message);
                svl.ui.canvas.hoverInfoSeverityIcon
                    .attr('src', util.misc.getSmileyIconPath(properties.severity, labelType, true))
                    .css('display', '');
            } else {
                svl.ui.canvas.hoverInfoSeverityText.text(i18next.t('center-ui.context-menu.severity'));
                svl.ui.canvas.hoverInfoSeverityIcon.css('display', 'none');
            }
            svl.ui.canvas.hoverInfoSeverity.css('display', 'flex');
        } else {
            svl.ui.canvas.hoverInfoSeverity.css('display', 'none');
        }

        // Position the tooltip to the right of the label icon, or to the left if there isn't room on the right.
        const coord = getCanvasXY();
        const scale = util.exploreDisplayScale();
        const holder = svl.ui.canvas.hoverInfoHolder;
        const centerX = coord.x * scale;
        const centerY = coord.y * scale;
        const radius = svl.LABEL_ICON_RADIUS * scale;
        const gap = 4; // On-screen pixels between the icon and the tooltip.

        let left = centerX + radius + gap;
        if (left + holder.outerWidth() > util.EXPLORE_CANVAS_WIDTH * scale) {
            left = centerX - radius - gap - holder.outerWidth();
        }
        holder.css({
            visibility: 'visible',
            left: left,
            top: centerY - holder.outerHeight() / 2
        });
    }

    /**
     * Hides the shared hover info tooltip.
     */
    function hideHoverInfo() {
        svl.ui.canvas.hoverInfoHolder.css('visibility', 'hidden');
    }

    function showDeleteButton() {
        if (status.hoverInfoVisibility !== 'hidden') {
            // coord is in the logical 720x480 frame; scale to on-screen pixels.
            const coord = getCanvasXY();
            const scale = util.exploreDisplayScale();
            svl.ui.canvas.deleteIconHolder.css({
                visibility: 'visible', left: coord.x * scale + 5, top: coord.y * scale - 25
            });
        }
    }

    /**
     * Renders a question mark if a label has an unmarked severity.
     * @param ctx Rendering tool for severity (2D context).
     */
    function showSeverityAlert(ctx) {
        const x = properties.currCanvasXY.x;
        const y = properties.currCanvasXY.y;

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
     * @returns {lat: number, lng: number, computationMethod: string}
     */
    function toLatLng() {
        if (!properties.labelLat) {
            // Estimate the latlng point from the camera position and the heading when point cloud data isn't available.
            const panoLat = getProperty("panoLat");
            const panoLng = getProperty("panoLng");
            const heading = getProperty("originalPov").heading;
            const canvasX = getProperty('originalCanvasXY').x;
            const canvasY = getProperty('originalCanvasXY').y;
            const panoY = getProperty('panoXY').y;
            const panoHeight = getProperty('panoHeight');

            // Estimate heading diff and distance from pano using output from a regression analysis.
            // https://github.com/ProjectSidewalk/label-latlng-estimation/blob/master/scripts/label-latlng-estimation.md#results
            // Note that the regression analysis was done when our zoom levels were discrete integers. We now allow zoom
            // to be noninteger, so we're doing a linear interpolation between the params at the two zoom levels.
            const minZoom = Math.min(svl.zoomControl.getProperty('minZoomLevel'));
            const maxZoom = Math.min(svl.zoomControl.getProperty('maxZoomLevel'));
            const zoom = Math.min(maxZoom, Math.max(minZoom, getProperty("originalPov").zoom));

            const floor = LATLNG_ESTIMATION_PARAMS[Math.floor(zoom)];
            const ceiling = LATLNG_ESTIMATION_PARAMS[Math.ceil(zoom)];
            const t = zoom - Math.floor(zoom); // 0 when floor === ceiling.

            const headingIntercept = util.math.lerp(floor.headingIntercept, ceiling.headingIntercept, t);
            const headingCanvasXSlope = util.math.lerp(floor.headingCanvasXSlope, ceiling.headingCanvasXSlope, t);
            const distanceIntercept = util.math.lerp(floor.distanceIntercept, ceiling.distanceIntercept, t);
            const distancePanoYSlope = util.math.lerp(floor.distancePanoYSlope, ceiling.distancePanoYSlope, t);
            const distanceCanvasYSlope = util.math.lerp(floor.distanceCanvasYSlope, ceiling.distanceCanvasYSlope, t);

            const estHeadingDiff = headingIntercept + headingCanvasXSlope * canvasX;
            const estDistanceFromPanoKm = Math.max(0,
                distanceIntercept + distancePanoYSlope * (panoHeight / 2 - panoY) + distanceCanvasYSlope * canvasY
            ) / 1000.0;
            const estHeading = heading + estHeadingDiff;
            const startPoint = turf.point([panoLng, panoLat]);

            // Use the pano location, distance from pano estimate, and heading estimate, calculate label location.
            const destination = turf.destination(startPoint, estDistanceFromPanoKm, estHeading, { units: 'kilometers' });
            const latlng = {
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

    /**
     * Save a screenshot of the image named crop_<labelId>.png. The crops are stored in subdirs /<city-id>/<label-type>.
     * @param labelId
     * @param retryAttempt {number} Current retry attempt if image hasn't been saved yet.
     */
    function updateLabelIdAndUploadCrop(labelId, retryAttempt) {
        // Retry if crop isn't available yet.
        if (!getProperty('crop')) {
            if (isNaN(retryAttempt)) retryAttempt = 0;
            if (retryAttempt < 1) {
                console.log('No crop found to upload, retrying in 3 seconds.');
                setTimeout(function() {
                    updateLabelIdAndUploadCrop(labelId, retryAttempt + 1);
                }, 3000);
            } else {
                console.log(`No crop found to upload after ${retryAttempt + 1} attempts.`);
            }
            return;
        }

        // Upload the crop to the server with filename crop_<labelId>.png.
        setProperty('labelId', labelId);
        let cropData = {
            name: `crop_${labelId}`,
            label_type: getProperty('labelType'),
            b64: getProperty('crop')
        }
        $.ajax({
            async: true,
            method: 'POST',
            url: "saveImage",
            data: JSON.stringify(cropData),
            contentType: "application/json; charset=UTF-8",
            success: function(data){
                setProperty('crop', null); // Remove reference to crop to save memory.
            }
        });
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
    self.getHoverInfoVisibility = getHoverInfoVisibility;
    self.setVisibility = setVisibility;
    self.toLatLng = toLatLng;
    self.updateLabelIdAndUploadCrop = updateLabelIdAndUploadCrop;

    _init(params);
    return self;
}

// Set up a global cache for icon images.
if (!window.labelIconCache) {
    window.labelIconCache = {};
}

// There is a static rendering method for a label, allowing us to draw labels in the tutorial with no interactions.
Label.renderLabelIcon = function(ctx, labelType, x, y) {
    var imageHeight, imageWidth;
    imageHeight = imageWidth = 2 * svl.LABEL_ICON_RADIUS - 3;
    var imageX = x - svl.LABEL_ICON_RADIUS + 2;
    var imageY = y - svl.LABEL_ICON_RADIUS + 2;
    var iconPath = util.misc.getIconImagePaths(labelType).iconImagePath;

    // Check if we already have this image in cache, then draw the label icon.
    if (window.labelIconCache[iconPath]) {
        ctx.drawImage(window.labelIconCache[iconPath], imageX, imageY, imageHeight, imageWidth);
    } else {
        // Load, cache, and draw the image.
        var imageObj = new Image();
        imageObj.src = iconPath;
        imageObj.onload = function() {
            window.labelIconCache[iconPath] = imageObj;
            ctx.drawImage(imageObj, imageX, imageY, imageHeight, imageWidth);
        };
    }

    // Draws label outline.
    ctx.beginPath();
    ctx.fillStyle = util.misc.getLabelColors()[labelType].fillStyle;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(x, y, 15.3, 0, 2 * Math.PI);
    ctx.strokeStyle = 'black';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 16.2, 0, 2 * Math.PI);
    ctx.strokeStyle = 'white';
    ctx.stroke();
}

/**
 * This method creates a Google Maps marker.
 * https://developers.google.com/maps/documentation/javascript/markers
 * https://developers.google.com/maps/documentation/javascript/examples/marker-remove
 * @param {string} labelType
 * @param {{lat: number, lng: number}} latLng
 * @returns {google.maps.Marker}
 */
Label.createMinimapMarker = function(labelType, latLng) {
    return new google.maps.Marker({
        position: new google.maps.LatLng(latLng.lat, latLng.lng),
        map: svl.minimap.getMap(),
        icon: util.misc.getIconImagePaths()[labelType].minimapIconImagePath
    });
}
