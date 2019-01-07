/**
 * This function holds Panomarker/Panorama calculations. These functions are borrowed from the
 * PanoMarker script.
 * @returns {PanoProperties}
 * @constructor
 */
function PanoProperties () {
    var self = this;

    /**
     * Calculates heading and pitch for a Google Maps marker using (x, y) coordinates
     * From PanoMarker spec
     * @param canvas_x          X coordinate (pixel) of the label
     * @param canvas_y          Y coordinate (pixel) of the label
     * @param canvas_width      Original canvas width
     * @param canvas_height     Original canvas height
     * @param zoom              Original zoom level of the label
     * @param heading           Original heading of the label
     * @param pitch             Original pitch of the label
     * @returns {{heading: float, pitch: float}}
     */
    function getPosition(canvas_x, canvas_y, canvas_width, canvas_height, zoom, heading, pitch) {
        function sgn(x) {
            return x >= 0 ? 1 : -1;
        }

        var PI = Math.PI;
        var cos = Math.cos;
        var sin = Math.sin;
        var tan = Math.tan;
        var sqrt = Math.sqrt;
        var atan2 = Math.atan2;
        var asin = Math.asin;
        var fov = _get3dFov(zoom) * PI / 180.0;
        var width = canvas_width;
        var height = canvas_height;
        var h0 = heading * PI / 180.0;
        var p0 = pitch * PI / 180.0;
        var f = 0.5 * width / tan(0.5 * fov);
        var x0 = f * cos(p0) * sin(h0);
        var y0 = f * cos(p0) * cos(h0);
        var z0 = f * sin(p0);
        var du = (canvas_x) - width / 2;
        var dv = height / 2 - (canvas_y - 5);
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
            pitch: p * 180.0 / PI
        };
    }

    /**
     * From PanoMarker spec
     * @param zoom
     * @returns {number}
     */
    function _get3dFov (zoom) {
        return zoom <= 2 ?
            126.5 - zoom * 36.75 :  // linear descent
            195.93 / Math.pow(1.92, zoom); // parameters determined experimentally
    }

    /**
     * Given the current POV, this method calculates the Pixel coordinates on the
     * given viewport for the desired POV. All credit for the math this method goes
     * to user3146587 on StackOverflow: http://goo.gl/0GGKi6
     *
     * My own approach to explain what is being done here (including figures!) can
     * be found at http://martinmatysiak.de/blog/view/panomarker
     *
     * @param {StreetViewPov} targetPov The point-of-view whose coordinates are
     *     requested.
     * @param {StreetViewPov} currentPov POV of the viewport center.
     * @param {number} zoom The current zoom level.
     * @param {number} Width of the panorama canvas.
     * @param {number} Height of the panorama canvas.
     * @return {Object} Top and Left offsets for the given viewport that point to
     *     the desired point-of-view.
     */
    function povToPixel3d (targetPov, currentPov, zoom, canvasWidth, canvasHeight) {

        // Gather required variables and convert to radians where necessary
        var width = canvasWidth;
        var height = canvasHeight;
        var target = {
            left: width / 2,
            top: height / 2
        };

        var DEG_TO_RAD = Math.PI / 180.0;
        var fov = _get3dFov(zoom) * DEG_TO_RAD;
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

    self.getPosition = getPosition;
    self.povToPixel3d = povToPixel3d;

    return this;
}