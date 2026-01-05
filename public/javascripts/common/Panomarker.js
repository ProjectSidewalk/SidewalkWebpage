/**
 * Source:
 * https://github.com/marmat/google-maps-api-addons/blob/master/panomarker/src/panomarker.js
 *
 * PanoMarker
 * Version 1.1
 *
 * @author kaktus621@gmail.com (Martin Matysiak)
 *         michaelssaugstad@gmail.com (Mikey Saugstad) - Updated Dec 2025 to use generic Panorama viewer (not just GSV).
 * @fileoverview A marker that can be placed inside custom StreetView panoramas.
 * Regular markers inside StreetViewPanoramas can only be shown vertically centered and aligned to LatLng coordinates.
 *
 * Custom StreetView panoramas usually do not have any geographical information (e.g. inside views), thus a different
 * method of positioning the marker has to be used. This class takes simple heading and pitch values from the panorama's
 * center in order to move the marker correctly with the user's viewport changes.
 *
 * Since something like that is not supported natively by the Maps API, the marker actually sits on top of the panorama,
 * DOM-wise outside of the actual map but still inside the map container.
 */

/**
 * @license Copyright 2014 — 2015 Martin Matysiak.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
 * an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations under the License.
 */

/**
 * PanoMarkerOptions
 *
 */

let PanoMarker = null;
// TODO does this no longer need to be an async function since we're not waiting for the Google library anymore?
window.getPanoMarkerClass = async function() {
    if (window.PanoMarker) return window.PanoMarker;

    window.PanoMarker = class {
        /**
         * Creates a PanoMarker with the options specified. If a panorama is specified, the marker is added to the map
         * upon construction. Note that the position must be set for the marker to display.
         *
         * @constructor
         * @param {Object} opts A set of parameters to customize the marker.
         * @param {PanoViewer} opts.panoViewer Panorama viewer on which to display marker.
         * @param {HTMLDivElement} opts.markerContainer The container holding the markers.
         * @param {string} [opts.className] The class name which will be assigned to the created div node.
         * @param {string} [opts.icon] URL to an image file that shall be used.
         * @param {string} [opts.id] A unique identifier that will be assigned to the created div-node.
         * @param {{heading: number, pitch: number}} [opts.position] Marker position on the panorama.
         * @param {{width: number, height: number}} [opts.size] The size of the marker in pixels.
         * @param {string} [opts.title] Hover tooltip.
         * @param {boolean} [opts.visible=true] If true, the marker is visible.
         * @param {number} [opts.zIndex=1] The marker's z-index.
         */
        constructor(opts) {
            // In case no options have been given at all, fallback to {} so that the following won't throw errors.
            opts = opts || {};

            if (!opts.panoViewer) throw 'A panorama viewer needs to be defined.';
            if (!opts.markerContainer) throw 'A panorama markerContainer needs to be defined.';

            /** @private @type {HTMLDivElement} */
            this.markerContainer_ = opts.markerContainer;

            // TODO this is set using setPanoViewer at the end. But I don't think we want to do it that way anyway.
            /** @private @type {PanoViewer} */
            this.panoViewer_ = null;

            /** @private @type {?string} */
            this.className_ = opts.className || null;

            /** @private @type {?string} */
            this.icon_ = opts.icon || null;

            /** @private @type {?string} */
            this.id_ = opts.id || null;

            /** @private @ŧype {?HTMLDivElement} */
            this.marker_ = null;

            /** @private @type {?Object} */
            this.position_ = opts.position || { heading: 0, pitch: 0 };

            /** @private @type {?Object} */
            this.povListener_ = null;

            /** @private @type {Object} */
            this.zoomListener_ = null;

            /** @private @type {Object} */
            this.size_ = opts.size || { width: 32, height: 32 };

            /** @private @type {string} */
            this.title_ = opts.title || '';

            /** @private @type {boolean} */
            this.visible_ = (typeof opts.visible === 'boolean') ? opts.visible : true;

            /** @private @type {number} */
            this.zIndex_ = opts.zIndex || 1;

            /** @private @type {boolean} */
            this.toggleDescription_ = false;

            /**
             * New code (April 17, 2019) -- modified by Aileen
             * Source: https://github.com/marmat/google-maps-api-addons/issues/36#issuecomment-342774699
             * @private
             * @type {function({heading: number, pitch: number, zoom: number}, {heading: number, pitch: number, zoom: number}, number, Element): Object}
             */
            this.povToPixel_ = window.PanoMarker.povToPixel2d;
            let pixelCanvas = document.createElement("canvas");
            if (pixelCanvas && (pixelCanvas.getContext("experimental-webgl") || pixelCanvas.getContext("webgl"))) {
                this.povToPixel_ = window.PanoMarker.povToPixel3d;
            }

            // At last, call some methods which use the initialized parameters.
            this.setPanoViewer(opts.panoViewer || null, opts.markerContainer);
        }

        // Static helper methods for the position calculation //

        /**
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
         * @return {number} The (horizontal) field of view angle for the given zoom.
         */
        static get3dFov = function(zoom) {
            return zoom <= 2 ?
                126.5 - zoom * 36.75 :  // linear descent
                195.93 / Math.pow(1.92, zoom); // parameters determined experimentally
        };

        /**
         * Given the current POV, this method calculates the Pixel coordinates on the given viewport for the desired
         * POV. All credit for the math this method goes to user3146587 on StackOverflow: http://goo.gl/0GGKi6
         *
         * My own approach to explain what is being done here (including figures!) can be found at
         * http://martinmatysiak.de/blog/view/panomarker
         *
         * @param {{heading: number, pitch: number, zoom: number}} targetPov The POV whose coordinates are requested.
         * @param {{heading: number, pitch: number, zoom: number}} currentPov POV of the viewport center.
         * @param {HTMLDivElement} viewport The current viewport containing the panorama.
         * @return {Object} Top and Left offsets for the given viewport that point to the desired point-of-view.
         */
        static povToPixel3d = function(targetPov, currentPov, viewport) {
            // Gather required variables and convert to radians where necessary.
            const width = viewport.offsetWidth;
            const height = viewport.offsetHeight;

            let target = {
                left: width / 2,
                top: height / 2
            };

            const DEG_TO_RAD = Math.PI / 180.0;
            const fov = window.PanoMarker.get3dFov(currentPov.zoom) * DEG_TO_RAD;
            const h0 = currentPov.heading * DEG_TO_RAD;
            const p0 = currentPov.pitch * DEG_TO_RAD;
            const h = targetPov.heading * DEG_TO_RAD;
            const p = targetPov.pitch * DEG_TO_RAD;

            // f = focal length = distance of current POV to image plane
            const f = (width / 2) / Math.tan(fov / 2);

            // our coordinate system: camera at (0,0,0), heading = pitch = 0 at (0,f,0)
            // calculate 3d coordinates of viewport center and target
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

            // Sanity check: the vectors shouldn't be perpendicular because the line from camera through target would
            // never intersect with the image plane.
            if (Math.abs(nDotD) < 1e-6) {
                return null;
            }

            // t is the scale to use for the target vector such that its end touches the image plane. It's equal to
            // 1/cos(theta) == (distance from camera to image plane through target) / (distance from camera to target == f)
            const t = nDotC / nDotD;

            // Sanity check: it doesn't make sense to scale the vector in a negative direction. In fact, it should even
            // be t >= 1.0 since the image plane is always outside the pano sphere (except at the viewport center).
            if (t < 0.0) {
                return null;
            }

            // (tx, ty, tz) are the coordinates of the intersection point between a line through camera and target with
            // the image plane.
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

            // Normalize horiz. basis vector to obtain orthonormal basis.
            const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
            ux /= ul;
            uy /= ul;
            uz /= ul;

            // Project the intersection point t onto the basis to obtain offsets in terms of actual pixels in viewport.
            const du = tx * ux + ty * uy + tz * uz;
            const dv = tx * vx + ty * vy + tz * vz;

            // use the calculated pixel offsets
            target.left += du;
            target.top -= dv;
            return target;
        };


        /**
         * Helper function that converts the heading to be in the range [-180,180).
         *
         * @param {number} heading The heading to convert.
         */
        static wrapHeading = function(heading) {
            // We shift to the range [0,360) because of the way JS behaves for modulos of negative numbers.
            heading = (heading + 180) % 360;

            // Determine if we have to wrap around.
            if (heading < 0) {
                heading += 360;
            }

            return heading - 180;
        };


        /**
         * A simpler version of povToPixel3d which does not have to do the spherical projection because the raw
         * StreetView tiles are just panned around when the user changes the viewport position.
         *
         * @param {{heading: number, pitch: number, zoom: number}} targetPov The POV whose coordinates are requested.
         * @param {{heading: number, pitch: number, zoom: number}} currentPov POV of the viewport center.
         * @param {HTMLDivElement} viewport The current viewport containing the panorama.
         * @return {Object} Top and Left offsets for the given viewport that point to the desired point-of-view.
         */
        static povToPixel2d = function(targetPov, currentPov, viewport) {
            // Gather required variables.
            const width = viewport.offsetWidth;
            const height = viewport.offsetHeight;

            let target = {
                left: width / 2,
                top: height / 2
            };

            // In the 2D environment, the FOV follows the documented curve.
            const hfov = 180 / Math.pow(2, currentPov.zoom);
            const vfov = hfov * (height / width);
            const dh = window.PanoMarker.wrapHeading(targetPov.heading - currentPov.heading);
            const dv = targetPov.pitch - currentPov.pitch;

            target.left += dh / hfov * width;
            target.top -= dv / vfov * height;
            return target;
        };

        /**
         * Sets up a marker and then calls draw().
         */
        onAdd = function() {
            if (!!this.marker_) {
                // Sometimes the maps API does trigger onAdd correctly. We have to prevent duplicate execution of the
                // following code by checking if the marker node has already been created.
                return;
            }

            let marker = document.createElement('div');
            marker.classList.add('icon-outline');

            // Basic style attributes for every marker.
            marker.style.position = 'absolute';
            marker.style.cursor = 'inherit';    // To keep the mouseover icon open hand. See: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1393
            marker.style.width = this.size_.width + 'px';
            marker.style.height = this.size_.height + 'px';
            marker.style.display = this.visible_ ? 'block' : 'none';
            marker.style.zIndex = this.zIndex_;

            // Set other CSS attributes based on the given parameters.
            if (this.id_) { marker.id = this.id_; }
            if (this.className_) { marker.className = this.className_; }
            if (this.title_) { marker.title = this.title_; }
            if (this.icon_) { marker.style.backgroundImage = 'url(' + this.icon_ + ')'; }

            // If neither icon, class nor id is specified, assign the basic Google Maps marker image to the marker.
            if (!(this.id_ || this.className_ || this.icon_)) {
                marker.style.backgroundImage = 'url(https://www.google.com/intl/en_us/mapfiles/ms/micons/red-dot.png)';
            }

            this.marker_ = marker;
            this.markerContainer_.appendChild(marker);

            // Attach to some global events.
            window.addEventListener('resize', this.draw.bind(this));
            this.panoViewer_.addListener('pov_changed', this.draw.bind(this));

            // If this is a validation label, we want to add mouse-hovering event for popped up hide/show label.
            if (this.id_ === "validate-pano-marker") {
                if (isMobile()) {
                    marker.addEventListener('touchstart', function () {
                        let labelDescriptionBox = $("#label-description-box");
                        let desBox = labelDescriptionBox[0];
                        if (!this.toggleDescription_) {
                            desBox.style.right = (svv.canvasWidth - parseFloat(marker.style.left) - (parseFloat(marker.style.width) / 2)) + 'px';
                            desBox.style.top = (parseFloat(marker.style.top) + (parseFloat(marker.style.height) / 2)) + 'px';
                            desBox.style.zIndex = 2;
                            desBox.style.visibility = 'visible';
                            this.toggleDescription_ = true;
                        } else {
                            desBox.style.visibility = 'hidden';
                            this.toggleDescription_ = false;
                        }
                    }.bind(this), false);
                } else {
                    marker.addEventListener("mouseover", function () {
                        svv.labelVisibilityControl.showTagsAndDeleteButton();
                    });

                    marker.addEventListener("mouseout", function () {
                        svv.labelVisibilityControl.hideTagsAndDeleteButton();
                    });
                }
            }

            this.draw();

            // Fire 'add' event once the marker has been created.
            // TODO We don't use these events anywhere. Should probably remove this and use Promises instead.
            // google.maps.event.trigger(this, 'add', this.marker_);
        };

        /**
         * Draws the marker on the canvas.
         */
        draw = function() {
            if (!this.panoViewer_) {
                return;
            }

            if (this.toggleDescription_) {
                let labelDescriptionBox = $("#label-description-box");
                let desBox = labelDescriptionBox[0];
                desBox.style.visibility = 'hidden';
                this.toggleDescription_ = false;
            }

            // Calculate the position according to the viewport. Even though the marker doesn't sit directly underneath
            // the panorama container, we pass it on as the viewport because it has the actual viewport dimensions.
            const offset = this.povToPixel_(this.position_, this.panoViewer_.getPov(), this.markerContainer_);
            if (this.marker_) {
                if (offset !== null) {
                    this.marker_.style.left = (offset.left - this.size_.width / 2) + 'px';
                    this.marker_.style.top = (offset.top - this.size_.height / 2) + 'px';
                } else {
                    // If offset is null, marker is "behind" the camera, so we position the marker outside the viewport.
                    this.marker_.style.left = -(9999 + this.size_.width) + 'px';
                    this.marker_.style.top = '0';
                }
            }
        };

        /**
         * Removes the marker and its listeners.
         */
        onRemove = function() {
            if (!this.marker_) {
                // Similar to onAdd, we have to prevent duplicate onRemoves as well.
                return;
            }

            // TODO these should use PanoViewer.removeListener().
            google.maps.event.removeListener(this.povListener_);
            google.maps.event.removeListener(this.zoomListener_);
            this.marker_.parentNode.removeChild(this.marker_);
            this.marker_ = null;

            // Fire 'remove' event once the marker has been destroyed.
            // TODO We don't use these events anywhere. Should probably remove this and use Promises instead.
            google.maps.event.trigger(this, 'remove');
        }


        // Getter to be roughly equivalent to the regular google.maps.Marker //

        /** @return {string} The className or null if not set upon marker creation. */
        getClassName = function() { return this.className_; };

        /** @return {string} The current icon, if any. */
        getIcon = function() { return this.icon_; };

        /** @return {string} The identifier or null if not set upon marker creation. */
        getId = function() { return this.id_; };

        /** @return {PanoViewer} The current PanoViewer. */
        getPanoViewer = function() { return this.panoViewer_; };

        /** @return {{heading: number, pitch: number}} The marker's location on the panorama. */
        getPosition = function() { return this.position_; };

        /** {{width: number, height: number}} size The new size of the marker in pixels. */
        getSize = function() { return this.size_; };

        /** @return {string} The marker's rollover text. */
        getTitle = function() { return this.title_; };

        /** @return {boolean} Whether the marker is currently visible. */
        getVisible = function() { return this.visible_; };

        /** @return {number} The marker's z-index. */
        getZIndex = function() { return this.zIndex_; };


        // Setter for the properties mentioned above //

        /** @param {string} className The new className. */
        setClassName = function(className) {
            this.className_ = className;
            if (!!this.marker_) {
                this.marker_.className = className;
            }
        };

        /** @param {?string} icon URL to a new icon, or null in order to remove it. */
        setIcon = function(icon) {
            this.icon_ = icon;
            if (!!this.marker_) {
                this.marker_.style.backgroundImage = !!icon ? 'url(' + icon + ')' : '';
            }
        };

        /** @param {string} id The new id. */
        setId = function(id) {
            this.id_ = id;
            if (!!this.marker_) {
                this.marker_.id = id;
            }
        };

        /**
         * Remove the marker, update the viewer and container, and then add the marker.
         *
         * TODO we probably don't need to do a whole remove and add, do we? Can we just set the viewer and call draw?
         *
         * @param {PanoViewer} panoViewer The panorama in which to show the marker.
         * @param {HTMLDivElement} markerContainer The container holding the markers.
         */
        setPanoViewer = function(panoViewer, markerContainer) {
            // Remove the marker if it previously was on a panorama.
            if (!!this.panoViewer_) {
                this.onRemove();
            }

            this.panoViewer_ = panoViewer;
            this.markerContainer_ = markerContainer;

            if (!!panoViewer) {
                this.onAdd();
            }
        };

        /** @param {{heading: number, pitch: number}} position The desired location for the marker on the pano. */
        setPosition = function(position) {
            this.position_ = position;
            this.draw();
        };

        /** @param {{width: number, height: number}} size The new size of the marker in pixels. */
        setSize = function(size) {
            this.size_ = size;
            if (!!this.marker_) {
                this.marker_.style.width = size.width + 'px';
                this.marker_.style.height = size.height + 'px';
                this.draw();
            }
        };

        /** @param {string} title The new rollover text. */
        setTitle = function(title) {
            this.title_ = title;
            if (!!this.marker_) {
                this.marker_.title = title;
            }
        };

        /** @param {boolean} show Whether the marker shall be visible. */
        setVisible = function(show) {
            this.visible_ = show;
            if (!!this.marker_) {
                this.marker_.style.display = show ? 'block' : 'none';
            }
        };

        /** @param {number} zIndex The new z-index. */
        setZIndex = function(zIndex) {
            this.zIndex_ = zIndex;
            if (!!this.marker_) {
                this.marker_.style.zIndex = zIndex;
            }
        };
    };

    return window.PanoMarker;
}
