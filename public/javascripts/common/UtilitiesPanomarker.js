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
    126.5 - zoom * 36.75 :  // Linear descent.
    195.93 / Math.pow(1.92, zoom); // Parameters determined experimentally.
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
 * Returns the centered pov of a point on the canvas based on panorama's POV and the canvas coordinate.
 *
 * @param canvasX
 * @param canvasY
 * @param pov
 * @param canvasWidth
 * @param canvasHeight
 * @returns {{heading: number, pitch: number, zoom: Number}}
 */
function calculatePovIfCentered(pov, canvasX, canvasY, canvasWidth, canvasHeight) {
    var PI = Math.PI;
    var cos = Math.cos;
    var sin = Math.sin;
    var tan = Math.tan;
    var sqrt = Math.sqrt;
    var atan2 = Math.atan2;
    var asin = Math.asin;

    var fov = get3dFov(pov.zoom) * PI / 180.0;

    var h0 = pov.heading * PI / 180.0;
    var p0 = pov.pitch * PI / 180.0;

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
        zoom: pov.zoom
    };
}
util.panomarker.calculatePovIfCentered = calculatePovIfCentered;

/**
 * Returns the pov of this label if it were centered based on panorama's POV using panorama XY coordinates.
 *
 * @param panoX
 * @param panoY
 * @param panoWidth
 * @param panoHeight
 * @returns {{heading: Number, pitch: Number}}
 */
function calculatePovFromPanoXY(panoX, panoY, panoWidth, panoHeight) {
    return {
        heading: (panoX / panoWidth) * 360 % 360,
        pitch: (panoY / (panoHeight / 2) * 90)
    };
}
util.panomarker.calculatePovFromPanoXY = calculatePovFromPanoXY;

/**
 * Returns the GSV XY coordinate from the original pov of the label if it was centered.
 *
 * @param pov
 * @param cameraHeading
 * @param panoWidth
 * @param panoHeight
 * @returns {{x: (number|*), y: (number|*)}}
 */
function calculatePanoXYFromPov(pov, cameraHeading, panoWidth, panoHeight) {
    var panoY = panoHeight / 2 - (panoHeight / 2) * (pov.pitch / 90);

    // The cameraHeading represents the center of the image. Subtract 180 to find the heading where panoX = 0.
    var headingPixelZero = cameraHeading - 180;

    // Both headings are between -180 and 180, convert to 0 to 360 to make math easier.
    var heading = (pov.heading + 360) % 360;
    headingPixelZero = (headingPixelZero + 360) % 360;

    // We then find the difference between the label's heading and the heading where panoX = 0.
    // Divide by 360, multiply by the pano width, and that's your panoX!
    var panoX = panoWidth * (heading - headingPixelZero) / 360;
    if (panoX < 0) panoX += panoWidth;

    return { x: panoX, y: panoY };
}
util.panomarker.calculatePanoXYFromPov = calculatePanoXYFromPov;

/**
 * This function maps canvas coordinates to XY coordinates on the pano.
 * @param canvasX
 * @param canvasY
 * @param pov
 * @param canvasWidth
 * @param canvasHeight
 * @param cameraHeading
 * @param panoWidth
 * @param panoHeight
 * @returns {{x: number, y: number}}
 */
function canvasXYToPanoXY(pov, canvasX, canvasY, canvasWidth, canvasHeight, cameraHeading, panoWidth, panoHeight) {
    var centeredPOV = calculatePovIfCentered(pov, canvasX, canvasY, canvasWidth, canvasHeight);
    var panoXY = calculatePanoXYFromPov(centeredPOV, cameraHeading, panoWidth, panoHeight);
    return { x: panoXY.x, y: panoXY.y };
}
util.panomarker.canvasXYToPanoXY = canvasXYToPanoXY;

/***
 * For a point centered at `povIfCentered`, compute canvas XY coordinates at `currentPov`.
 * @return {Object} Top and Left offsets for the given viewport that point to the desired point-of-view.
 */
function povToPixel3DOffset(povIfCentered, currentPov, canvasWidth, canvasHeight) {
    // Gather required variables and convert to radians where necessary.
    var target = {
        left: canvasWidth / 2,
        top: canvasHeight / 2
    };

    var DEG_TO_RAD = Math.PI / 180.0;
    var fov = get3dFov(currentPov.zoom) * DEG_TO_RAD;
    var h0 = currentPov.heading * DEG_TO_RAD;
    var p0 = currentPov.pitch * DEG_TO_RAD;
    var h = povIfCentered.heading * DEG_TO_RAD;
    var p = povIfCentered.pitch * DEG_TO_RAD;

    // f = focal length = distance of current POV to image plane.
    var f = (canvasWidth / 2) / Math.tan(fov / 2);

    // Our coordinate system: camera at (0,0,0), heading = pitch = 0 at (0,f,0).
    // Calculate 3d coordinates of viewport center and target.
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
    // from camera through target would never intersect with the image plane.
    if (Math.abs(nDotD) < 1e-6) {
        return null;
    }

    // t is the scale to use for the target vector such that its end
    // touches the image plane. It's equal to 1/cos(theta) ==
    //     (distance from camera to image plane through target) /
    //     (distance from camera to target == f)
    var t = nDotC / nDotD;

    // Sanity check: it doesn't make sense to scale the vector in a negative direction. In fact, it should even be
    // t >= 1.0 since the image plane is always outside the pano sphere (except at the viewport center).
    if (t < 0.0) {
        return null;
    }

    // (tx, ty, tz) are the coordinates of the intersection point between a
    // line through camera and target with the image plane.
    var tx = t * x;
    var ty = t * y;
    var tz = t * z;

    // u and v are the basis vectors for the image plane.
    var vx = -sin_p0 * sin_h0;
    var vy = -sin_p0 * cos_h0;
    var vz = cos_p0;

    var ux = cos_h0;
    var uy = -sin_h0;
    var uz = 0;

    // Normalize horiz. basis vector to obtain orthonormal basis.
    var ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    ux /= ul;
    uy /= ul;
    uz /= ul;

    // Project the intersection point t onto the basis to obtain offsets in terms of actual pixels in the viewport.
    var du = tx * ux + ty * uy + tz * uz;
    var dv = tx * vx + ty * vy + tz * vz;

    // Use the calculated pixel offsets.
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
        var offset = povToPixel3DOffset(origPov, newPov, canvasWidth, canvasHeight);

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
