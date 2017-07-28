/**
 * PanoMarker
 * Version 1.0
 *
 * @author kaktus621@gmail.com (Martin Matysiak)
 * @fileoverview A marker that can be placed inside custom StreetView panoramas.
 * Regular markers inside StreetViewPanoramas can only be shown vertically
 * centered and aligned to LatLng coordinates.
 *
 * Custom StreetView panoramas usually do not have any geographical information
 * (e.g. inside views), thus a different method of positioning the marker has to
 * be used. This class takes simple heading and pitch values from the panorama's
 * center in order to move the marker correctly with the user's viewport
 * changes.
 *
 * Since something like that is not supported natively by the Maps API, the
 * marker actually sits on top of the panorama, DOM-wise outside of the
 * actual map but still inside the map container.
 */

/**
 * @license Copyright 2014 — 2015 Martin Matysiak.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * PanoMarkerOptions
 *
 * {google.maps.Point} anchor The point (in pixels) to which objects will snap.
 * {string} className The class name which will be assigned to the
 *    created div node.
 * {HTMLDivElement} container The container holding the panorama.
 * {string} icon URL to an image file that shall be used.
 * {string} id A unique identifier that will be assigned to the
 *    created div-node.
 * {google.maps.StreetViewPanorama} pano Panorama in which to display marker.
 * {google.maps.StreetViewPov} position Marker position.
 * {google.maps.Size} size The size of the marker in pixels.
 * {string} title Rollover text.
 * {boolean} visible If true, the marker is visible.
 * {number} zIndex The marker's z-index.
 */


(function(global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else if (typeof define === 'function' && typeof define.amd === 'object') {
    define(['goog!maps,3,other_params:[sensor=false&libraries=visualization]'],
      factory);
  } else {
    if (typeof google !== 'object' || typeof google.maps !== 'object') {
      throw new Error('PanoMarker requires google maps library');
    }
    global.PanoMarker = factory();
  }
}(typeof window !== 'undefined' ? window : this, function() {

/**
 * Creates a PanoMarker with the options specified. If a panorama is specified,
 * the marker is added to the map upon construction. Note that the position must
 * be set for the marker to display.
 *
 * Important: do not use the inherited method <code>setMap()</code> to change
 * the panorama, but use <code>setPano()</code> instead, otherwise a proper
 * functionality is not guaranteed.
 *
 * @constructor
 * @param {PanoMarkerOptions} opts A set of parameters to customize the marker.
 * @extends google.maps.OverlayView
 */
var PanoMarker = function(opts) {

  // In case no options have been given at all, fallback to {} so that the
  // following won't throw errors.
  opts = opts || {};

  // panorama.getContainer has been deprecated in the Google Maps API. The user
  // now explicity needs to pass in the container for the panorama.
  if (!opts.container) {
    throw 'A panorama container needs to be defined.';
  }

  /** @private @type {HTMLDivElement} */
  this.container_ = opts.container;

  /**
   * Currently only Chrome is rendering panoramas in a 3D sphere. The other
   * browsers are just showing the raw panorama tiles and pan them around.
   *
   * @private
   * @type {function(StreetViewPov, StreetViewPov, number, Element): Object}
   */
  this.povToPixel_ = !!window.chrome ? PanoMarker.povToPixel3d :
      PanoMarker.povToPixel2d;

  /** @private @type {google.maps.Point} */
  this.anchor_ = opts.anchor || new google.maps.Point(16, 16);

  /** @private @type {?string} */
  this.className_ = opts.className || null;

  /** @private @type {boolean} */
  this.clickable_ = opts.clickable || true;

  /** @private @type {?string} */
  this.icon_ = opts.icon || null;

  /** @private @type {?string} */
  this.id_ = opts.id || null;

  /** @private @ŧype {?HTMLDivElement} */
  this.marker_ = null;

  /** @private @type {?google.maps.StreetViewPanorama} */
  this.pano_ = null;

  /** @private @type {number} */
  this.pollId_ = -1;

  /** @private @type {google.maps.StreetViewPov} */
  this.position_ = opts.position || {heading: 0, pitch: 0};

  /** @private @type {Object} */
  this.povListener_ = null;

  /** @private @type {Object} */
  this.zoomListener_ = null;

  /** @private @type {google.maps.Size} */
  this.size_ = opts.size || new google.maps.Size(32, 32);

  /** @private @type {string} */
  this.title_ = opts.title || '';

  /** @private @type {boolean} */
  this.visible_ = (typeof opts.visible === 'boolean') ? opts.visible : true;

  /** @private @type {number} */
  this.zIndex_ = opts.zIndex || 1;

  // At last, call some methods which use the initialized parameters
  this.setPano(opts.pano || null, opts.container);
};

PanoMarker.prototype = new google.maps.OverlayView();


//// Static helper methods for the position calculation ////


/**
 * According to the documentation (goo.gl/WT4B57), the field-of-view angle
 * should precisely follow the curve of the form 180/2^zoom. Unfortunately, this
 * is not the case in practice in the 3D environment. From experiments, the
 * following FOVs seem to be more correct:
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
 * Because of this, we are doing a linear interpolation for zoom values <= 2 and
 * then switch over to an inverse exponential. In practice, the produced
 * values are good enough to result in stable marker positioning, even for
 * intermediate zoom values.
 *
 * @return {number} The (horizontal) field of view angle for the given zoom.
 */
PanoMarker.get3dFov = function(zoom) {
  return zoom <= 2 ?
      126.5 - zoom * 36.75 :  // linear descent
      195.93 / Math.pow(1.92, zoom); // parameters determined experimentally
};


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
 * @param {Element} viewport The current viewport containing the panorama.
 * @return {Object} Top and Left offsets for the given viewport that point to
 *     the desired point-of-view.
 */
PanoMarker.povToPixel3d = function(targetPov, currentPov, zoom, viewport) {

    // Gather required variables and convert to radians where necessary
    var width = viewport.offsetWidth;
    var height = viewport.offsetHeight;
    var target = {
      left: width / 2,
      top: height / 2
    };

    var DEG_TO_RAD = Math.PI / 180.0;
    var fov = PanoMarker.get3dFov(zoom) * DEG_TO_RAD;
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
};


/**
 * Helper function that converts the heading to be in the range [-180,180).
 *
 * @param {number} heading The heading to convert.
 */
PanoMarker.wrapHeading = function(heading) {
  // We shift to the range [0,360) because of the way JS behaves for modulos of
  // negative numbers.
  heading = (heading + 180) % 360;

  // Determine if we have to wrap around
  if (heading < 0) {
    heading += 360;
  }

  return heading - 180;
};


/**
 * A simpler version of povToPixel2d which does not have to do the spherical
 * projection because the raw StreetView tiles are just panned around when the
 * user changes the viewport position.
 *
 * @param {StreetViewPov} targetPov The point-of-view whose coordinates are
 *     requested.
 * @param {StreetViewPov} currentPov POV of the viewport center.
 * @param {number} zoom The current zoom level.
 * @param {Element} viewport The current viewport containing the panorama.
 * @return {Object} Top and Left offsets for the given viewport that point to
 *     the desired point-of-view.
 */
PanoMarker.povToPixel2d = function(targetPov, currentPov, zoom, viewport) {
    // Gather required variables
    var width = viewport.offsetWidth;
    var height = viewport.offsetHeight;
    var target = {
      left: width / 2,
      top: height / 2
    };

    // In the 2D environment, the FOV follows the documented curve.
    var hfov = 180 / Math.pow(2, zoom);
    var vfov = hfov * (height / width);
    var dh = PanoMarker.wrapHeading(targetPov.heading - currentPov.heading);
    var dv = targetPov.pitch - currentPov.pitch;

    target.left += dh / hfov * width;
    target.top -= dv / vfov * height;
    return target;
};


//// Implementations for abstract methods inherited from g.m.OverlayView ////


/** @override */
PanoMarker.prototype.onAdd = function() {
  if (!!this.marker_) {
    // Sometimes the maps API does trigger onAdd correctly. We have to prevent
    // duplicate execution of the following code by checking if the marker node
    // has already been created.
    return;
  }

  var marker = document.createElement('div');

  // Basic style attributes for every marker
  marker.style.position = 'absolute';
  marker.style.cursor = 'pointer';
  marker.style.width = this.size_.width + 'px';
  marker.style.height = this.size_.height + 'px';
  marker.style.display = this.visible_ ? 'block' : 'none';
  marker.style.zIndex = this.zIndex_;

  // Set other css attributes based on the given parameters
  if (this.id_) { marker.id = this.id_; }
  if (this.className_) { marker.className = this.className_; }
  if (this.title_) { marker.title = this.title_; }
  if (this.icon_) { marker.style.backgroundImage = 'url(' + this.icon_ + ')'; }

  // If neither icon, class nor id is specified, assign the basic google maps
  // marker image to the marker (otherwise it will be invisble)
  if (!(this.id_ || this.className_ || this.icon_)) {
    marker.style.backgroundImage = 'url(https://www.google.com/intl/en_us/' +
        'mapfiles/ms/micons/red-dot.png)';
  }

  this.marker_ = marker;

  this.getPanes().overlayMouseTarget.appendChild(marker);

  // Attach to some global events
  window.addEventListener('resize', this.draw.bind(this));
  this.povListener_ = google.maps.event.addListener(this.getMap(),
      'pov_changed', this.draw.bind(this));
  this.zoomListener_ = google.maps.event.addListener(this.getMap(),
      'zoom_changed', this.draw.bind(this));

  var eventName = 'click';

  // Make clicks possible
  if (window.PointerEvent) {
    eventName = 'pointerdown';
  } else if (window.MSPointerEvent) {
    eventName = 'MSPointerDown';
  }

  marker.addEventListener(eventName, this.onClick.bind(this), false);

  this.draw();

  // Fire 'add' event once the marker has been created.
  google.maps.event.trigger(this, 'add', this.marker_);
};


/** @override */
PanoMarker.prototype.draw = function() {
  if (!this.pano_) {
    return;
  }

  // Calculate the position according to the viewport. Even though the marker
  // doesn't sit directly underneath the panorama container, we pass it on as
  // the viewport because it has the actual viewport dimensions.
  var offset = this.povToPixel_(this.position_,
      this.pano_.getPov(),
      typeof this.pano_.getZoom() !== 'undefined' ? this.pano_.getZoom() : 1,
      this.container_);

  if (offset !== null) {
    this.marker_.style.left = (offset.left - this.anchor_.x) + 'px';
    this.marker_.style.top = (offset.top - this.anchor_.y) + 'px';
  } else {
    // If offset is null, the marker is "behind" the camera,
    // therefore we position the marker outside of the viewport
    this.marker_.style.left = -(9999 + this.size_.width) + 'px';
    this.marker_.style.top = '0';
  }
};


/** @param {Object} event The event object. */
PanoMarker.prototype.onClick = function(event) {
  if (this.clickable_) {
    google.maps.event.trigger(this, 'click');
  }

  // don't let the event bubble up
  event.cancelBubble = true;
  if (event.stopPropagation) { event.stopPropagation(); }
};


/** @override */
PanoMarker.prototype.onRemove = function() {
  if (!this.marker_) {
    // Similar to onAdd, we have to prevent duplicate onRemoves as well.
    return;
  }

  google.maps.event.removeListener(this.povListener_);
  google.maps.event.removeListener(this.zoomListener_);
  this.marker_.parentNode.removeChild(this.marker_);
  this.marker_ = null;

  // Fire 'remove' event once the marker has been destroyed.
  google.maps.event.trigger(this, 'remove');
};


//// Getter to be roughly equivalent to the regular google.maps.Marker ////


/** @return {google.maps.Point} The marker's anchor. */
PanoMarker.prototype.getAnchor = function() { return this.anchor_; };


/** @return {string} The className or null if not set upon marker creation. */
PanoMarker.prototype.getClassName = function() { return this.className_; };


/** @return {boolean} Whether the marker is clickable. */
PanoMarker.prototype.getClickable = function() { return this.clickable_; };


/** @return {string} The current icon, if any. */
PanoMarker.prototype.getIcon = function() { return this.icon_; };


/** @return {string} The identifier or null if not set upon marker creation. */
PanoMarker.prototype.getId = function() { return this.id_; };

/** @return {google.maps.StreetViewPanorama} The current panorama. */
PanoMarker.prototype.getPano = function() { return this.pano_; };


/** @return {google.maps.StreetViewPov} The marker's current position. */
PanoMarker.prototype.getPosition = function() { return this.position_; };


/** @return {google.maps.Size} The marker's size. */
PanoMarker.prototype.getSize = function() { return this.size_; };


/** @return {string} The marker's rollover text. */
PanoMarker.prototype.getTitle = function() { return this.title_; };


/** @return {boolean} Whether the marker is currently visible. */
PanoMarker.prototype.getVisible = function() { return this.visible_; };


/** @return {number} The marker's z-index. */
PanoMarker.prototype.getZIndex = function() { return this.zIndex_; };


//// Setter for the properties mentioned above ////


/** @param {google.maps.Point} anchor The marker's new anchor. */
PanoMarker.prototype.setAnchor = function(anchor) {
  this.anchor_ = anchor;
  this.draw();
};


/** @param {string} className The new className. */
PanoMarker.prototype.setClassName = function(className) {
  this.className_ = className;
  if (!!this.marker_) {
    this.marker_.className = className;
  }
};


/** @param {boolean} clickable Whether the marker shall be clickable. */
PanoMarker.prototype.setClickable = function(clickable) {
  this.clickable_ = clickable;
};


/** @param {?string} icon URL to a new icon, or null in order to remove it. */
PanoMarker.prototype.setIcon = function(icon) {
  this.icon_ = icon;
  if (!!this.marker_) {
    this.marker_.style.backgroundImage = !!icon ? 'url(' + icon + ')' : '';
  }
};


/** @param {string} id The new id. */
PanoMarker.prototype.setId = function(id) {
  this.id_ = id;
  if (!!this.marker_) {
    this.marker_.id = id;
  }
};


/**
 * It turns out OverlayViews can be used with StreetViewPanoramas as well.
 * However, we have to fire onAdd and onRemove calls manually as they are not
 * triggered automatically for some reason if the object given to setMap is a
 * StreetViewPanorama.
 *
 * @param {google.maps.StreetViewPanorama} pano The panorama in which to show
 *    the marker.
 * @param {HTMLDivElement} container The container holding the panorama.
 */
PanoMarker.prototype.setPano = function(pano, container) {
  // In contrast to regular OverlayViews, we are disallowing the usage on
  // regular maps
  if (!!pano && !(pano instanceof google.maps.StreetViewPanorama)) {
    throw 'PanoMarker only works inside a StreetViewPanorama.';
  }

  // Remove the marker if it previously was on a panorama
  if (!!this.pano_) {
    this.onRemove();
  }

  // Call method from superclass
  this.setMap(pano);
  this.pano_ = pano;
  this.container_ = container;

  // Fire the onAdd Event manually as soon as the pano is ready
  if (!!pano) {
    var promiseFn = function(resolve) {
      // Poll for panes to become available
      var pollCallback = function() {
        if (!!this.getPanes()) {
          window.clearInterval(this.pollId_);
          this.onAdd();
          if (resolve) { resolve(this); }
        }
      };

      this.pollId_ = window.setInterval(pollCallback.bind(this), 10);
    };

    // Best case, the promiseFn can be wrapped in a Promise so the consumer knows when the pano is set
    // Otherwise just call the function immediately
    if (typeof Promise !== 'undefined') {
      return new Promise(promiseFn.bind(this));
    } else {
      promiseFn.call(this);
    }
  }
};


/** @param {google.maps.StreetViewPov} position The desired position. */
PanoMarker.prototype.setPosition = function(position) {
  this.position_ = position;
  this.draw();
};


/** @param {google.maps.Size} size The new size. */
PanoMarker.prototype.setSize = function(size) {
  this.size_ = size;
  if (!!this.marker_) {
    this.marker_.style.width = size.width + 'px';
    this.marker_.style.height = size.height + 'px';
    this.draw();
  }
};


/** @param {string} title The new rollover text. */
PanoMarker.prototype.setTitle = function(title) {
  this.title_ = title;
  if (!!this.marker_) {
    this.marker_.title = title;
  }
};


/** @param {boolean} show Whether the marker shall be visible. */
PanoMarker.prototype.setVisible = function(show) {
  this.visible_ = show;
  if (!!this.marker_) {
    this.marker_.style.display = show ? 'block' : 'none';
  }
};


/** @param {number} zIndex The new z-index. */
PanoMarker.prototype.setZIndex = function(zIndex) {
  this.zIndex_ = zIndex;
  if (!!this.marker_) {
    this.marker_.style.zIndex = zIndex;
  }
};

return PanoMarker;
}));
