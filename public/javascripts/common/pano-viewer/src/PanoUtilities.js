/** @namespace */
var util = util || {};
util.pano = {};

/**
 * sgn( a ) is +1 if a >= 0 else -1.
 *
 * @param {number} x The number whose sign we're checking
 * @returns {number} 1 if positive or 0, -1 if negative
 */
util.pano.sgn = (x) => x >= 0 ? 1 : -1;

/**
 * Converts a GSV zoom level (we use the same in our system) to a horizontal field of view.
 *
 * TODO Maybe we should decide on our own zoom levels rather than using Google's.
 *
 * According to the documentation (goo.gl/WT4B57), the field-of-view angle should precisely follow the curve of
 * the form 180/2^zoom. Unfortunately, this is not the case in practice in the 3D environment. From experiments,
 * the following FOVs seem to be more correct:
 *
 *        Zoom | best FOV | documented FOV
 *       ------+----------+----------------
 *          0  | 126.5    | 180
 *          1  | 90       | 90
 *          2  | 53       | 45
 *          3  | 28       | 22.5
 *          4  | 14.25    | 11.25
 *          5  | 7.25     | not specified
 *
 * Because of this, we are doing a linear interpolation for zoom values <= 2 and then switch over to an inverse
 * exponential. In practice, the produced values are good enough to result in stable marker positioning, even
 * for intermediate zoom values.
 *
 * @param {number} zoom The zoom level according to GSV
 * @return {number} The (horizontal) field of view angle for the given zoom
 */
util.pano.zoomToFov = (zoom) => {
    return zoom <= 2 ?
        126.5 - zoom * 36.75 :  // Linear descent.
        195.93 / Math.pow(1.92, zoom); // Parameters determined experimentally.
};

/**
 * Calculates the zoom level from a given horizontal field of view. This is the inverse of zoomToFov().
 *
 * TODO Maybe we should decide on our own zoom levels rather than using Google's.
 *
 * @param {number} fov - The field of view angle in degrees.
 * @returns {number} The corresponding zoom level.
 */
util.pano.fovToZoom = (fov) => {
    // The transition point is at zoom = 2, where fov = 126.5 - 2 * 36.75 = 53
    const transitionFov = 53;

    if (fov >= transitionFov) {
        // Reverse of: fov = 126.5 - zoom * 36.75. Solving for zoom: zoom = (126.5 - fov) / 36.75
        return (126.5 - fov) / 36.75;
    } else {
        // Reverse of: fov = 195.93 / Math.pow(1.92, zoom)
        // Solving for zoom: 1.92^zoom = 195.93 / fov
        // Taking log: zoom * log(1.92) = log(195.93 / fov)
        // Therefore: zoom = log(195.93 / fov) / log(1.92)
        return Math.log(195.93 / fov) / Math.log(1.92);
    }
};

/**
 * Returns the panorama's pov if this label were centered using pano XY coordinates.
 *
 * @param {number} panoX The x-coordinate within the panorama image
 * @param {number} panoY The y-coordinate within the panorama image
 * @param {number} panoWidth The width of the panorama image
 * @param {number} panoHeight The height of the panorama image
 * @returns {{heading: number, pitch: number}}
 */
util.pano.panoCoordToPov = (panoX, panoY, panoWidth, panoHeight) => {
    return {
        heading: (panoX / panoWidth) * 360 % 360,
        pitch: (panoY / (panoHeight / 2) * 90)
    };
};

/**
 * Returns the XY coordinate on the panorama of the center point of the given pov.
 *
 * @param {{heading: number, pitch: number}} pov The point of view within the panorama to use; heading wrt true north
 * @param {number} cameraHeading The heading of the camera (center of the pano) with respect to true north
 * @param {number} panoWidth The width of the panorama
 * @param {number} panoHeight The height of the panorama
 * @returns {{x: number, y: number}} The XY coordinate on the full panoramic image
 */
util.pano.povToPanoCoord = (pov, cameraHeading, panoWidth, panoHeight) => {
    const panoY = panoHeight / 2 - (panoHeight / 2) * (pov.pitch / 90);

    // The cameraHeading represents the center of the image. Subtract 180 to find the heading where panoX = 0.
    let headingPixelZero = cameraHeading - 180;

    // Both headings are between -180 and 180, convert to 0 to 360 to make math easier.
    const heading = (pov.heading + 360) % 360;
    headingPixelZero = (headingPixelZero + 360) % 360;

    // We then find the difference between the label's heading and the heading where panoX = 0.
    // Divide by 360, multiply by the pano width, and that's your panoX!
    let panoX = panoWidth * (heading - headingPixelZero) / 360;
    if (panoX < 0) panoX += panoWidth;

    return { x: panoX, y: panoY };
};

/**
 * Returns the centered pov of a point on the canvas based on panorama's POV and the canvas coordinate.
 *
 * @param {{heading: number, pitch: number, zoom: number}} pov The POV within the panorama to use wrt true north
 * @param {number} canvasX X-coordinate of the point of interest
 * @param {number} canvasY Y-coordinate of the point of interest
 * @param {number} canvasWidth Width of the canvas
 * @param {number} canvasHeight Height of the canvas
 * @returns {{heading: number, pitch: number, zoom: number}} POV of the pano if centered on the given point
 */
util.pano.canvasCoordToCenteredPov = (pov, canvasX, canvasY, canvasWidth, canvasHeight) => {
    const fov = util.pano.zoomToFov(pov.zoom) * Math.PI / 180.0;

    const h0 = pov.heading * Math.PI / 180.0;
    const p0 = pov.pitch * Math.PI / 180.0;

    const f = 0.5 * canvasWidth / Math.tan(0.5 * fov);

    const x0 = f * Math.cos(p0) * Math.sin(h0);
    const y0 = f * Math.cos(p0) * Math.cos(h0);
    const z0 = f * Math.sin(p0);

    const du = canvasX - canvasWidth / 2;
    const dv = canvasHeight / 2 - canvasY;

    const ux = util.pano.sgn(Math.cos(p0)) * Math.cos(h0);
    const uy = -util.pano.sgn(Math.cos(p0)) * Math.sin(h0);
    const uz = 0;

    const vx = -Math.sin(p0) * Math.sin(h0);
    const vy = -Math.sin(p0) * Math.cos(h0);
    const vz = Math.cos(p0);

    const x = x0 + du * ux + dv * vx;
    const y = y0 + du * uy + dv * vy;
    const z = z0 + du * uz + dv * vz;

    const R = Math.sqrt(x * x + y * y + z * z);
    const h = Math.atan2(x, y);
    const p = Math.asin(z / R);

    return {
        heading: h * 180.0 / Math.PI,
        pitch: p * 180.0 / Math.PI,
        zoom: pov.zoom
    };
};

/**
 * For a point centered at `centeredPov`, compute canvas XY coordinates at `newPov`.
 *
 * The math is described here: http://martinmatysiak.de/blog/view/panomarker.
 *
 * @param {{heading: number, pitch: number}} centeredPov Translating the center point at this POV to newPov
 * @param {{heading: number, pitch: number, zoom: number}} newPov The POV within the panorama to use wrt true north
 * @param {number} canvasWidth Width of the canvas
 * @param {number} canvasHeight Height of the canvas
 * @param {number} margin The extra pixels around canvas width/height where we don't return null, usually label radius
 * @returns {{x: number, y: number}|null} Canvas coordinates for the point at `newPov`; null if not on the canvas
 */
util.pano.centeredPovToCanvasCoord = (centeredPov, newPov, canvasWidth, canvasHeight, margin) => {
    // Gather required variables and convert to radians where necessary.
    const DEG_TO_RAD = Math.PI / 180.0;
    const fov = util.pano.zoomToFov(newPov.zoom) * DEG_TO_RAD;
    const h0 = newPov.heading * DEG_TO_RAD;
    const p0 = newPov.pitch * DEG_TO_RAD;
    const h = centeredPov.heading * DEG_TO_RAD;
    const p = centeredPov.pitch * DEG_TO_RAD;

    // f = focal length = distance of current POV to image plane.
    const f = (canvasWidth / 2) / Math.tan(fov / 2);

    // Our coordinate system: camera at (0,0,0), heading = pitch = 0 at (0,f,0).
    // Calculate 3d coordinates of viewport center and target.
    const cos_p = Math.cos(p);
    const sin_p = Math.sin(p);

    const cos_h = Math.cos(h);
    const sin_h = Math.sin(h);

    const x = f * cos_p * sin_h;
    const y = f * cos_p * cos_h;
    const z = f * sin_p;

    const cos_p0 = Math.cos(p0);
    const sin_p0 = Math.sin(p0);

    const cos_h0 = Math.cos(h0);
    const sin_h0 = Math.sin(h0);

    const x0 = f * cos_p0 * sin_h0;
    const y0 = f * cos_p0 * cos_h0;
    const z0 = f * sin_p0;

    const nDotD = x0 * x + y0 * y + z0 * z;
    const nDotC = x0 * x0 + y0 * y0 + z0 * z0;

    // nDotD == |targetVec| * |currentVec| * cos(theta)
    // nDotC == |currentVec| * |currentVec| * 1
    // Note: |currentVec| == |targetVec| == f

    // Sanity check: the vectors shouldn't be perpendicular because the line from camera through target would never
    // intersect with the image plane.
    if (Math.abs(nDotD) < 1e-6) {
        return null;
    }

    // t is the scale to use for the target vector such that its end touches the image plane. It's equal to
    // 1/cos(theta) == (distance from camera to image plane through target) / (distance from camera to target == f).
    const t = nDotC / nDotD;

    // Sanity check: it doesn't make sense to scale the vector in a negative direction. In fact, it should even be
    // t >= 1.0 since the image plane is always outside the pano sphere (except at the viewport center).
    if (t < 0.0) {
        return null;
    }

    // (tx, ty, tz) are the coords of the intersection point b/w a line through camera and target with the image plane.
    const tx = t * x;
    const ty = t * y;
    const tz = t * z;

    // u and v are the basis vectors for the image plane.
    const vx = -sin_p0 * sin_h0;
    const vy = -sin_p0 * cos_h0;
    const vz = cos_p0;

    let ux = cos_h0;
    let uy = -sin_h0;
    let uz = 0;

    // Normalize horizontal basis vector to obtain orthonormal basis.
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    ux /= ul;
    uy /= ul;
    uz /= ul;

    // Project the intersection point t onto the basis to obtain offsets in terms of actual pixels in the viewport.
    const du = tx * ux + ty * uy + tz * uz;
    const dv = tx * vx + ty * vy + tz * vz;

    // Use the calculated pixel offsets. Return null if not in the viewport.
    const targetX = canvasWidth / 2 + du;
    const targetY = canvasHeight / 2 - dv;
    if (targetX > -margin && targetX < canvasWidth + margin && targetY > -margin && targetY < canvasHeight + margin) {
        return { x: targetX, y: targetY };
    } else {
        return null;
    }
};

/**
 * Helper function that converts the heading to be in the range [-180,180).
 *
 * @param {number} heading The heading to convert.
 * @return {number} The heading converted to the range [-180,180).
 */
util.pano.wrapHeading = (heading) => {
    // We shift to the range [0,360) because of the way JS behaves for modulos of negative numbers.
    heading = (heading + 180) % 360;

    // Determine if we have to wrap around.
    if (heading < 0) heading += 360;

    return heading - 180;
};

/**
 * A simpler version of centeredPovToCanvasCoord which does not have to do the spherical projection because the raw
 * StreetView tiles are just panned around when the user changes the viewport position.
 * TODO not sure if this is used anymore.
 *
 * @param {{heading: number, pitch: number}} centeredPov Translating the center point at this POV to newPov
 * @param {{heading: number, pitch: number, zoom: number}} newPov The POV within the panorama to use wrt true north
 * @param {number} canvasWidth Width of the canvas
 * @param {number} canvasHeight Height of the canvas
 * @param {number} margin The extra pixels around canvas width/height where we don't return null, usually label radius
 * @returns {{x: number, y: number}|null} Canvas coordinates for the point at `newPov`; null if not on the canvas
 */
util.pano.centeredPovToCanvasCoord2d = function(centeredPov, newPov, canvasWidth, canvasHeight, margin) {
    // In the 2D environment, the FOV follows the documented curve.
    const hfov = 180 / Math.pow(2, newPov.zoom);
    const vfov = hfov * (canvasHeight / canvasWidth);
    const dh = PanoMarker.wrapHeading(centeredPov.heading - newPov.heading);
    const dv = centeredPov.pitch - newPov.pitch;

    // Use the calculated pixel offsets. Return null if not in the viewport.
    const targetX = canvasWidth / 2 + (dh / hfov * canvasWidth);
    const targetY = canvasHeight / 2 - (dv / vfov * canvasHeight);
    if (targetX > -margin && targetX < canvasWidth + margin && targetY > -margin && targetY < canvasHeight + margin) {
        return { x: targetX, y: targetY };
    } else {
        return null;
    }
};
