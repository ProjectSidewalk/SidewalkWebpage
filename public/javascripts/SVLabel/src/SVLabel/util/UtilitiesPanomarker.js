/** @namespace */
var util = util || {};
util.panomarker = {};

/**
 * 3D projection related functions
 *
 * These functions are for positioning the markers when the view is panned
 * The library used is adpated from: https://martinmatysiak.de/blog/view/panomarker/en
 * The math used is from:
 * http://stackoverflow.com/questions/21591462/get-heading-and-pitch-from-pixels-on-street-view/21753165?noredirect=1#comment72346716_21753165
 */

function get3dFov (zoom) {
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
 * This method returns the pov of a point on the canvas based on panorama's POV
 * and the canvas coordinate
 *
 * @param canvasX
 * @param canvasY
 * @param pov
 * @returns {{heading: number, pitch: number, zoom: Number}}
 */
function calculatePointPov (canvasX, canvasY, pov) {
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
    var width = svl.canvasWidth;
    var height = svl.canvasHeight;

    var h0 = heading * PI / 180.0;
    var p0 = pitch * PI / 180.0;

    var f = 0.5 * width / tan(0.5 * fov);

    var x0 = f * cos(p0) * sin(h0);
    var y0 = f * cos(p0) * cos(h0);
    var z0 = f * sin(p0);

    var du = canvasX - width / 2;
    var dv = height / 2 - canvasY;

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
function calculatePointPovFromImageCoordinate (imageX, imageY, pov) {
    var heading, pitch,
        zoom = parseInt(pov.zoom, 10);

    var zoomFactor = svl.zoomFactor[zoom];
    var svImageWidth = svl.svImageWidth * zoomFactor;
    var svImageHeight = svl.svImageHeight * zoomFactor;

    imageX = imageX * zoomFactor;
    imageY = imageY * zoomFactor;

    heading = parseInt((imageX / svImageWidth) * 360, 10) % 360;
    pitch = parseInt((imageY / (svImageHeight/2)) * 90 , 10);

    return {
        heading: parseInt(heading, 10),
        pitch: parseInt(pitch, 10),
        zoom: zoom
    };
}
util.panomarker.calculatePointPovFromImageCoordinate = calculatePointPovFromImageCoordinate;

/**
 * Calculate Image Coordinate
 * This method returns the GSV image coordinate from the original pov of the label
 *
 * @param pov
 * @returns {{x: (number|*), y: (number|*)}}
 */
function calculateImageCoordinateFromPointPov (pov) {
    var heading = pov.heading,
        pitch = pov.pitch,
        zoom = pov.zoom;

    var imageX, imageY;
    var zoomFactor = svl.zoomFactor[zoom];

    var svImageWidth = svl.svImageWidth * zoomFactor;
    var svImageHeight = svl.svImageHeight * zoomFactor;

    imageX = (svImageWidth * (heading / 360) + ((svImageWidth / 360) / 2)) / zoomFactor;
    imageY = ((svImageHeight / 2) * (pitch / 90)) / zoomFactor;

    return {
        x: imageX,
        y: imageY
    };
}
util.panomarker.calculateImageCoordinateFromPointPov = calculateImageCoordinateFromPointPov;

/**
 * 0 for image y-axis is at *3328*! So the top-left corner of the image is (0, 3328).
 *
 * @param imageX
 * @param imageY
 * @param currentPov
 */
function imageCoordinateToCanvasCoordinate(imageX, imageY, currentPov) {

    // var canvasX = (ix - svl.svImageWidth * pov.heading / 360) * zoomFactor / svl.alpha_x + svl.canvasWidth / 2;
    // var canvasY = (iy - svl.svImageHeight * pov.pitch / 180) * zoomFactor / svl.alpha_y + svl.canvasHeight / 2;

    var povChange = svl.map.getPovChangeStatus();
    povChange["status"] = true;

    var canvasCoordinate;
    var origPointPov = calculatePointPovFromImageCoordinate(imageX, imageY, currentPov);
    canvasCoordinate = getCanvasCoordinate (canvasCoordinate, origPointPov, currentPov);
    povChange["status"] = false;

    return {x: canvasCoordinate.x, y: canvasCoordinate.y};
}
util.panomarker.imageCoordinateToCanvasCoordinate = imageCoordinateToCanvasCoordinate;

/**
 * This function maps canvas coordinate to image coordinate
 * @param canvasX
 * @param canvasY
 * @param pov
 * @returns {{x: number, y: number}}
 */
function canvasCoordinateToImageCoordinate (canvasX, canvasY, pov) {

    // Old calculation
    // var zoomFactor = svl.zoomFactor[pov.zoom];
    // var x = svl.svImageWidth * pov.heading / 360 + (svl.alpha_x * (canvasX - (svl.canvasWidth / 2)) / zoomFactor);
    // var y = (svl.svImageHeight / 2) * pov.pitch / 90 + (svl.alpha_y * (canvasY - (svl.canvasHeight / 2)) / zoomFactor);

    var svImageWidth = svl.svImageWidth;
    var pointPOV = calculatePointPov(canvasX, canvasY, pov);
    var svImageCoord = calculateImageCoordinateFromPointPov(pointPOV);

    if (svImageCoord.x < 0) {
        svImageCoord.x = svImageCoord.x + svImageWidth;
    }

    return { x: svImageCoord.x, y: svImageCoord.y };
}
util.panomarker.canvasCoordinateToImageCoordinate = canvasCoordinateToImageCoordinate;

/***
 * Get canvas coordinates of points from the POV
 * @return {Object} Top and Left offsets for the given viewport that point to
 *     the desired point-of-view.
 */
function povToPixel3DOffset(targetPov, currentPov, zoom, viewport) {

    // Gather required variables and convert to radians where necessary
    var width = viewport.offsetWidth;
    var height = viewport.offsetHeight;
    var target = {
        left: width / 2,
        top: height / 2
    };

    var DEG_TO_RAD = Math.PI / 180.0;
    var fov = get3dFov(zoom) * DEG_TO_RAD;
    var h0 = currentPov.heading * DEG_TO_RAD;
    var p0 = currentPov.pitch * DEG_TO_RAD;
    var h = targetPov.heading * DEG_TO_RAD;
    var p = targetPov.pitch * DEG_TO_RAD;

    // f = focal length = distance of current POV to image plane
    var f = (width / 2) / Math.tan(fov / 2);

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
 * This function takes current pov of the Street View as a parameter and returns a canvas coordinate of a point
 * when the pov is changed.
 * If the pov is not changed, then the passed canvas Coordinate is returned
 * @param canvasCoord
 * @param origPov
 * @param canvasCoord
 * @param origPov
 * @param pov
 * @returns {{x, y}}
 */
function getCanvasCoordinate (canvasCoord, origPov, pov) {

    var povChange = svl.map.getPovChangeStatus(),
        povChangeStatus = povChange["status"];
    console.log("pov change status from pano utility function: " + povChangeStatus)

    if (canvasCoord == undefined){
        canvasCoord = {x: undefined, y: undefined};
    }

    if (povChangeStatus){
        var currentPov = pov,
            targetPov = origPov;
        var zoom = currentPov.zoom;
        var viewport = document.getElementById('pano');

        // Calculate the position according to the viewport. Even though the marker
        // doesn't sit directly underneath the panorama container, we pass it on as
        // the viewport because it has the actual viewport dimensions.
        var offset = povToPixel3DOffset(targetPov, currentPov, zoom, viewport);

        if (offset !== null) {
            canvasCoord.x = offset.left; // - origCoord.x;
            canvasCoord.y = offset.top; //- origCoord.y;

        } else {
            // If offset is null, the marker is "behind" the camera,
            // therefore we position the marker outside of the viewport
            var pointWidth = 3; //TODO: Get from Point class
            canvasCoord.x = -(9999 + pointWidth);
            canvasCoord.y = 0;
        }
    }
    return canvasCoord;
}
util.panomarker.getCanvasCoordinate = getCanvasCoordinate;

