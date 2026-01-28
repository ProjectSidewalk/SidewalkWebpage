/**
 * Source: https://github.com/marmat/google-maps-api-addons/blob/master/panomarker/src/panomarker.js
 *
 * PanoMarker
 * Version 2.0
 *
 * @author kaktus621@gmail.com (Martin Matysiak)
 * @author michaelssaugstad@gmail.com (Mikey Saugstad) - Updated Dec 2025 to use generic Panorama viewer (not just GSV).
 * @fileoverview A marker that can be placed inside custom StreetView panoramas.
 *
 * This class takes simple heading and pitch values from the panorama's center in order to move the marker correctly
 * with the user's viewport changes. The marker actually sits on top of the panorama DOM-wise.
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
class PanoMarker {
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
        if (!opts.panoViewer) throw 'A panorama viewer needs to be defined.';
        if (!opts.markerContainer) throw 'A panorama markerContainer needs to be defined.';

        /** @private @type {HTMLDivElement} */
        this.markerContainer_ = opts.markerContainer;

        /** @private @type {PanoViewer} */
        this.panoViewer_ = opts.panoViewer;

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
         * @type {function({heading: number, pitch: number}, {heading: number, pitch: number, zoom: number}, number, number, number): {x: number, y: number}}
         */
        this.povToPixel_ = util.pano.centeredPovToCanvasCoord2d;
        let pixelCanvas = document.createElement("canvas");
        if (pixelCanvas && (pixelCanvas.getContext("experimental-webgl") || pixelCanvas.getContext("webgl"))) {
            this.povToPixel_ = util.pano.centeredPovToCanvasCoord;
        }

        // At last, call some methods which use the initialized parameters.
        this.createMarker();
    }

    /**
     * Sets up a marker and then calls draw().
     */
    createMarker = function() {
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
                        desBox.style.right = (svv.canvasWidth() - parseFloat(marker.style.left) - (parseFloat(marker.style.width) / 2)) + 'px';
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
    };

    /**
     * Removes the marker.
     */
    removeMarker = function() {
        this.marker_.parentNode.removeChild(this.marker_);
        this.marker_ = null;
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
        if (this.marker_) {
            const coords = this.povToPixel_(
                this.position_, this.panoViewer_.getPov(), this.markerContainer_.offsetWidth,
                this.markerContainer_.offsetHeight, this.size_.width
            );
            if (coords !== null) {
                this.marker_.style.left = (coords.x - this.size_.width / 2) + 'px';
                this.marker_.style.top = (coords.y - this.size_.height / 2) + 'px';
            } else {
                // If coords is null, marker is "behind" the camera, so we position the marker outside the viewport.
                this.marker_.style.left = -(9999 + this.size_.width) + 'px';
                this.marker_.style.top = '0';
            }
        }
    };


    // Getter to be roughly equivalent to the regular google.maps.Marker. //

    /** @return {string} The className or null if not set upon marker creation. */
    getClassName = function() { return this.className_; };

    /** @return {string} The current icon, if any. */
    getIcon = function() { return this.icon_; };

    /** @return {string} The identifier or null if not set upon marker creation. */
    getId = function() { return this.id_; };

    /** @return {PanoViewer} The current PanoViewer. */
    getPanoViewer = function() { return this.panoViewer_; };

    /** @return {PanoViewer} The current PanoViewer. */
    getMarkerContainer = function() { return this.markerContainer_; };

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


    // Setter for the properties mentioned above. //

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

    /** @param {PanoViewer} panoViewer The panorama in which to show the marker. */
    setPanoViewer = function(panoViewer) {
        this.panoViewer_ = panoViewer;
    };

    /** @param {HTMLDivElement} markerContainer The container holding the markers. */
    setMarkerContainer = function(markerContainer) {
        this.markerContainer_ = markerContainer;
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
}
