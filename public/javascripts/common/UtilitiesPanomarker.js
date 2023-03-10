/** @namespace */
var util = util || {};
util.panomarker = {};

/**
 * 3D projection related functions
 *
 * These functions are for positioning the markers when the view is panned.
 * The library used is adapted from: https://martinmatysiak.de/blog/view/panomarker/en
 * The math used is from:
 * http://stackoverflow.com/questions/21591462/get-heading-and-pitch-from-pixels-on-street-view/21753165?noredirect=1#comment72346716_21753165
 */

function get3dFov(zoom) {
    return zoom <= 2 ?
    126.5 - zoom * 36.75 :  // linear descent
    195.93 / Math.pow(1.92, zoom); // parameters determined experimentally
}

/**
 * sgn( a ) is +1 if a >= 0 else -1.
 * @param x
 * @returns {number}
 */
function sgn(x) {
    return x >= 0 ? 1 : -1;
}

/**
 * This method returns the pov of a point on the canvas based on panorama's POV and the canvas coordinate.
 *
 * @param canvasX
 * @param canvasY
 * @param pov
 * @param canvasWidth
 * @param canvasHeight
 * @returns {{heading: number, pitch: number, zoom: Number}}
 */
function calculatePointPov(pov, canvasX, canvasY, canvasWidth, canvasHeight) {
    var heading = parseInt(pov.heading, 10),
        pitch = parseInt(pov.pitch, 10),
        zoom = parseInt(pov.zoom, 10);

    var PI = Math.PI;
    var cos = Math.cos;
    var sin = Math.sin;
    var tan = Math.tan;
    var sqrt = Math.sqrt;
    var atan2 = Math.atan2;
    var asin = Math.asin;

    var fov = get3dFov(zoom) * PI / 180.0;

    var h0 = heading * PI / 180.0;
    var p0 = pitch * PI / 180.0;

    var f = 0.5 * canvasWidth / tan(0.5 * fov);

    var x0 = f * cos(p0) * sin(h0);
    var y0 = f * cos(p0) * cos(h0);
    var z0 = f * sin(p0);

    var du = canvasX - canvasWidth / 2;
    var dv = canvasHeight / 2 - canvasY;

    var ux = sgn(cos(p0)) * cos(h0);
    var uy = -sgn(cos(p0)) * sin(h0);
    var uz = 0;

    var vx = -sin(p0) * sin(h0);
    var vy = -sin(p0) * cos(h0);
    var vz = cos(p0);

    var x = x0 + du * ux + dv * vx;
    var y = y0 + du * uy + dv * vy;
    var z = z0 + du * uz + dv * vz;

    var R = sqrt(x * x + y * y + z * z);
    var h = atan2(x, y);
    var p = asin(z / R);

    return {
        heading: h * 180.0 / PI,
        pitch: p * 180.0 / PI,
        zoom: zoom
    };
}
util.panomarker.calculatePointPov = calculatePointPov;

/**
 * Calculate POV
 * This method returns the pov of this label based on panorama's POV using
 * panorama image coordinates
 *
 * @param imageX
 * @param imageY
 * @param pov
 * @returns {{heading: Number, pitch: Number, zoom: Number}}
 */
function calculatePointPovFromImageCoordinate(imageX, imageY, pov) {
    var zoom = Math.round(pov.zoom);
    var zoomFactor = svl.ZOOM_FACTOR[zoom];
    var svImageWidth = svl.SV_IMAGE_WIDTH * zoomFactor;
    var svImageHeight = svl.SV_IMAGE_HEIGHT * zoomFactor;

    imageX = imageX * zoomFactor;
    imageY = imageY * zoomFactor;

    var heading = Math.round((imageX / svImageWidth) * 360) % 360;
    var pitch = Math.round((imageY / (svImageHeight/2)) * 90);

    return {
        heading: heading,
        pitch: pitch,
        zoom: zoom
    };
}
util.panomarker.calculatePointPovFromImageCoordinate = calculatePointPovFromImageCoordinate;

/**
 * Calculate Image Coordinate
 * This method returns the GSV image coordinate from the original pov of the label
 *
 * @param pov
 * @param svImageWidth
 * @param svImageHeight
 * @returns {{x: (number|*), y: (number|*)}}
 */
function calculateImageCoordinateFromPointPov(pov, svImageWidth, svImageHeight) {
    var imageX, imageY;
    var zoomFactor = svl.ZOOM_FACTOR[pov.zoom];
    var imageWidth = svImageWidth * zoomFactor;
    var imageHeight = svImageHeight * zoomFactor;

    imageX = (imageWidth * (pov.heading / 360) + ((imageWidth / 360) / 2)) / zoomFactor;
    imageY = ((imageHeight / 2) * (pov.pitch / 90)) / zoomFactor;

    if (imageX < 0) imageX = imageX + svImageWidth;

    return { x: imageX, y: imageY };
}
util.panomarker.calculateImageCoordinateFromPointPov = calculateImageCoordinateFromPointPov;

/**
 * This function maps canvas coordinate to image coordinate
 * @param canvasX
 * @param canvasY
 * @param pov
 * @param canvasWidth
 * @param canvasHeight
 * @param svImageWidth
 * @param svImageHeight
 * @returns {{x: number, y: number}}
 */
function canvasCoordinateToImageCoordinate(pov, canvasX, canvasY, canvasWidth, canvasHeight, svImageWidth, svImageHeight) {

    // Old calculation
    // var zoomFactor = svl.ZOOM_FACTOR[pov.zoom];
    // var x = svl.SV_IMAGE_WIDTH * pov.heading / 360 + (svl.ALPHA_X * (canvasX - (canvasWidth / 2)) / zoomFactor);
    // var y = (svl.SV_IMAGE_HEIGHT / 2) * pov.pitch / 90 + (svl.ALPHA_Y * (canvasY - (canvasWidth / 2)) / zoomFactor);

    var pointPOV = calculatePointPov(pov, canvasX, canvasY, canvasWidth, canvasHeight);
    console.log(pov);
    console.log(pointPOV);
    var svImageCoord = calculateImageCoordinateFromPointPov(pointPOV, svImageWidth, svImageHeight);

    return { x: svImageCoord.x, y: svImageCoord.y };
}
util.panomarker.canvasCoordinateToImageCoordinate = canvasCoordinateToImageCoordinate;

/***
 * Get canvas coordinates of points from the POV
 * @return {Object} Top and Left offsets for the given viewport that point to
 *     the desired point-of-view.
 */
function povToPixel3DOffset(targetPov, currentPov, zoom, canvasWidth, canvasHeight) {

    // Gather required variables and convert to radians where necessary.
    var target = {
        left: canvasWidth / 2,
        top: canvasHeight / 2
    };

    var DEG_TO_RAD = Math.PI / 180.0;
    var fov = get3dFov(zoom) * DEG_TO_RAD;
    var h0 = currentPov.heading * DEG_TO_RAD;
    var p0 = currentPov.pitch * DEG_TO_RAD;
    var h = targetPov.heading * DEG_TO_RAD;
    var p = targetPov.pitch * DEG_TO_RAD;

    // f = focal length = distance of current POV to image plane
    var f = (canvasWidth / 2) / Math.tan(fov / 2);

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
 * Take current POV of the Street View and returns a canvas coordinate of a point given the new POV.
 * @param origPov
 * @param newPov
 * @param canvasWidth
 * @param canvasHeight
 * @param iconWidth
 * @returns {{x, y}}
 */
function getCanvasCoordinate(origPov, newPov, canvasWidth, canvasHeight, iconWidth) {
        var outputCoord = { x: undefined, y: undefined };

        // Calculate the position according to the canvas.
        var offset = povToPixel3DOffset(origPov, newPov, newPov.zoom, canvasWidth, canvasHeight);

        // Set coordinates to null if label is outside the viewport.
        if (offset !== null
            && offset.left > -iconWidth && offset.left < canvasWidth + iconWidth
            && offset.top > -iconWidth && offset.top < canvasHeight + iconWidth) {
            outputCoord.x = offset.left;
            outputCoord.y = offset.top;
        } else {
            outputCoord.x = null;
            outputCoord.y = null;
        }
        return outputCoord;
}
util.panomarker.getCanvasCoordinate = getCanvasCoordinate;
