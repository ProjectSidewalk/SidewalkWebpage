/**
 * Holds Panomarker/Panorama calculations. 
 * These functions are borrowed from the PanoMarker script.
 * 
 * @returns {GalleryPanoUtilities}
 * @constructor
 */
function GalleryPanoUtilities () {
    let self = this;

    /**
     * Returns image paths corresponding to each label type.
     * 
     * @param {*} category Specified label type.
     */
    function getIconImagePaths(category) {
        let imagePaths = {
            CurbRamp: {
                id: 'CurbRamp',
                iconImagePath : sg.rootDirectory + 'img/cursors/Cursor_CurbRamp.png'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                iconImagePath : sg.rootDirectory + 'img/cursors/Cursor_NoCurbRamp.png'
            },
            Obstacle: {
                id: 'Obstacle',
                iconImagePath: sg.rootDirectory + 'img/cursors/Cursor_Obstacle.png'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                iconImagePath: sg.rootDirectory + 'img/cursors/Cursor_SurfaceProblem.png'
            },
            Other: {
                id: 'Other',
                iconImagePath: sg.rootDirectory + 'img/cursors/Cursor_Other.png'
            },
            Occlusion: {
                id: 'Occlusion',
                iconImagePath: sg.rootDirectory + 'img/cursors/Cursor_Other.png'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                iconImagePath: sg.rootDirectory + 'img/cursors/Cursor_NoSidewalk.png'
            },
            Void: {
                id: 'Void',
                iconImagePath : null
            }
        };

        return category ? imagePaths[category] : imagePaths;
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
        let width = canvasWidth;
        let height = canvasHeight;

        // Corrects width and height for mobile phones
        if (isMobile()) {
            width = window.innerWidth;
            height = window.innerHeight;
        }

        let target = {
            left: width / 2,
            top: height / 2
        };

        let DEG_TO_RAD = Math.PI / 180.0;
        let fov = _get3dFov(zoom) * DEG_TO_RAD;
        let h0 = currentPov.heading * DEG_TO_RAD;
        let p0 = currentPov.pitch * DEG_TO_RAD;
        let h = targetPov.heading * DEG_TO_RAD;
        let p = targetPov.pitch * DEG_TO_RAD;

        // f = focal length = distance of current POV to image plane
        let f = (width / 2) / Math.tan(fov / 2);

        // our coordinate system: camera at (0,0,0), heading = pitch = 0 at (0,f,0)
        // calculate 3d coordinates of viewport center and target
        let cos_p = Math.cos(p);
        let sin_p = Math.sin(p);

        let cos_h = Math.cos(h);
        let sin_h = Math.sin(h);

        let x = f * cos_p * sin_h;
        let y = f * cos_p * cos_h;
        let z = f * sin_p;

        let cos_p0 = Math.cos(p0);
        let sin_p0 = Math.sin(p0);

        let cos_h0 = Math.cos(h0);
        let sin_h0 = Math.sin(h0);

        let x0 = f * cos_p0 * sin_h0;
        let y0 = f * cos_p0 * cos_h0;
        let z0 = f * sin_p0;

        let nDotD = x0 * x + y0 * y + z0 * z;
        let nDotC = x0 * x0 + y0 * y0 + z0 * z0;

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
        let t = nDotC / nDotD;

        // Sanity check: it doesn't make sense to scale the vector in a negative
        // direction. In fact, it should even be t >= 1.0 since the image plane
        // is always outside the pano sphere (except at the viewport center)
        if (t < 0.0) {
            return null;
        }

        // (tx, ty, tz) are the coordinates of the intersection point between a
        // line through camera and target with the image plane
        let tx = t * x;
        let ty = t * y;
        let tz = t * z;

        // u and v are the basis vectors for the image plane
        let vx = -sin_p0 * sin_h0;
        let vy = -sin_p0 * cos_h0;
        let vz = cos_p0;

        let ux = cos_h0;
        let uy = -sin_h0;
        let uz = 0;

        // normalize horiz. basis vector to obtain orthonormal basis
        let ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
        ux /= ul;
        uy /= ul;
        uz /= ul;

        // project the intersection point t onto the basis to obtain offsets in
        // terms of actual pixels in the viewport
        let du = tx * ux + ty * uy + tz * uz;
        let dv = tx * vx + ty * vy + tz * vz;

        // use the calculated pixel offsets
        target.left += du;
        target.top -= dv;

        return target;
    }

    self.getIconImagePaths = getIconImagePaths;
    self.povToPixel3d = povToPixel3d;

    return this;
}
