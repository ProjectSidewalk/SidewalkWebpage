/**
 * This function holds Panomarker/Panorama calculations
 * @returns {PanoProperties}
 * @constructor
 */
function PanoProperties () {
    var self = this;

    /**
     * Calculates heading and pitch for a Google Maps marker using (x, y) coordinates
     * From PanoMarker spec
     * @param canvas_x          X coordinate (pixel) for currentLabel
     * @param canvas_y          Y coordinate (pixel) for currentLabel
     * @param canvas_width      Original canvas width
     * @param canvas_height     Original canvas height
     * @param zoom              Original zoom level of currentLabel
     * @param heading           Original heading of currentLabel
     * @param pitch             Original pitch of currentLabel
     * @returns {{heading: number, pitch: number}}
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
     * From panomarker spec
     * @param zoom
     * @returns {number}
     */
    function _get3dFov (zoom) {
        return zoom <= 2 ?
            126.5 - zoom * 36.75 :  // linear descent
            195.93 / Math.pow(1.92, zoom); // parameters determined experimentally
    }

    self.getPosition = getPosition;

    return this;
}