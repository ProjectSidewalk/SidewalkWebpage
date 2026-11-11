/**
 * Source: https://github.com/marmat/google-maps-api-addons/blob/master/panomarker/src/panomarker.js
 *
 * PanoMarker
 * Version 2.0
 *
 * @author kaktus621@gmail.com (Martin Matysiak)
 * @author michaelssaugstad@gmail.com (Mikey Saugstad) - Updated Dec 2025 to use generic Panorama viewer (not just GSV).
 * @file A marker that can be placed inside custom StreetView panoramas.
 *
 * This class takes simple heading and pitch values from the panorama's center in order to move the marker correctly
 * with the user's viewport changes. The marker actually sits on top of the panorama DOM-wise.
 */

import { util } from './utilities.js';
import './pano-viewer/panoUtilities.js';
/** @typedef {import('./pano-viewer/PanoViewer.js').PanoViewer} PanoViewer */

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
export class PanoMarker {
  /**
   * Creates a PanoMarker and adds it to the given container right away.
   *
   * @param {object} opts - A set of parameters to customize the marker.
   * @param {PanoViewer} opts.panoViewer - Panorama viewer on which to display marker.
   * @param {HTMLElement} opts.markerContainer - The container holding the markers.
   * @param {string} [opts.icon] - URL to an image file that shall be used.
   * @param {string} [opts.id] - A unique identifier that will be assigned to the created div-node.
   * @param {{heading: number, pitch: number}} opts.position - Marker position on the panorama.
   * @param {{width: number, height: number}} opts.size - The size of the marker in pixels.
   * @param {number} [opts.zIndex=1] - The marker's z-index.
   * @param {() => void} [opts.onDraw] - Called after every draw, for anything anchored to the marker's position.
   */
  constructor(opts) {
    /** @type {HTMLElement} */
    this.markerContainer_ = opts.markerContainer;

    /** @type {PanoViewer} */
    this.panoViewer_ = opts.panoViewer;

    /** @type {?(() => void)} */
    this.onDraw_ = opts.onDraw || null;

    /** @type {?HTMLDivElement} */
    this.marker_ = null;

    /** @type {{heading: number, pitch: number}} */
    this.position_ = opts.position;

    /** @type {{width: number, height: number}} */
    this.size_ = opts.size;

    /**
     * New code (April 17, 2019) -- modified by Aileen
     * Source: https://github.com/marmat/google-maps-api-addons/issues/36#issuecomment-342774699
     * @private
     * @type {(
     *   centeredPov: {heading: number, pitch: number},
     *   newPov: {heading: number, pitch: number, zoom: number},
     *   canvasWidth: number, canvasHeight: number, margin: number, hFov?: number
     * ) => {x: number, y: number}|null}
     */
    this.povToPixel_ = util.pano.centeredPovToCanvasCoord2d;
    const pixelCanvas = document.createElement('canvas');
    if (pixelCanvas.getContext('experimental-webgl') || pixelCanvas.getContext('webgl')) {
      this.povToPixel_ = util.pano.centeredPovToCanvasCoord;
    }

    this.createMarker(opts.zIndex || 1, opts.id, opts.icon);
  }

  /**
   * Sets up a marker and then calls draw().
   * @param {number} zIndex - The marker's z-index.
   * @param {string} [id] - The id to give the marker element.
   * @param {string} [icon] - URL of the marker's icon.
   */
  createMarker = function (zIndex, id, icon) {
    const marker = document.createElement('div');
    marker.classList.add('icon-outline', 'label-marker');

    // Basic style attributes for every marker.
    marker.style.position = 'absolute';
    // To keep the mouseover icon open hand. See: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1393
    marker.style.cursor = 'inherit';
    marker.style.width = `${this.size_.width}px`;
    marker.style.height = `${this.size_.height}px`;
    // Markers are square, so width is the diameter. Published so decorations can size themselves off the marker
    // instead of hardcoding px that only look right at one of its sizes (e.g. main.css's .label-marker-pulse halo,
    // where Validate's marker is 22px on desktop but 52px on mobile).
    marker.style.setProperty('--marker-diameter', `${this.size_.width}px`);
    marker.style.display = 'block';
    marker.style.zIndex = String(zIndex);

    if (id) marker.id = id;
    // --label-icon rather than the element's own background, so hiding the label can crossfade just the icon
    // (.label-marker::before) while the ring around it stays to mark the spot.
    if (icon) marker.style.setProperty('--label-icon', `url(${icon})`);

    this.marker_ = marker;
    this.markerContainer_.appendChild(marker);

    // Attach to some global events. Keep a single bound reference (and the viewer it was registered on) so
    // removeMarker can detach both listeners — otherwise each recreated marker leaks a window + pov_changed
    // handler that keeps re-running draw() on a dead marker. See issue #4231.
    this.boundDraw_ = this.draw.bind(this);
    this.listenerViewer_ = this.panoViewer_;
    window.addEventListener('resize', this.boundDraw_);
    this.listenerViewer_.addListener('pov_changed', this.boundDraw_);

    this.draw();
  };

  /**
   * Removes the marker.
   */
  removeMarker = function () {
    // Detach the listeners registered in createMarker, by reference, so they don't accumulate (#4231).
    window.removeEventListener('resize', this.boundDraw_);
    this.listenerViewer_.removeListener('pov_changed', this.boundDraw_);
    this.marker_.parentNode.removeChild(this.marker_);
    this.marker_ = null;
  };

  /**
   * Draws the marker on the canvas.
   */
  draw = function () {
    // A viewer loops over a copy of its pov listeners, awaiting each, so one removed partway through still gets called.
    if (!this.marker_) return;
    // Calculate the position according to the viewport. Even though the marker doesn't sit directly underneath
    // the panorama container, we pass it on as the viewport because it has the actual viewport dimensions.
    const pov = this.panoViewer_.getPov();
    const width = this.markerContainer_.offsetWidth;
    const height = this.markerContainer_.offsetHeight;
    // The fov the viewer renders for this container's shape, not the zoom curve alone: GSV clamps its vertical
    // field on a tall or wide viewport (#5083), and a marker projected with the curve would sit off its feature.
    const coords = this.povToPixel_(
      this.position_, pov, width, height, this.size_.width,
      util.pano.renderedHFov(pov.zoom, width / height, this.panoViewer_.getViewerType?.()),
    );
    if (coords !== null) {
      this.marker_.style.left = `${coords.x - this.size_.width / 2}px`;
      this.marker_.style.top = `${coords.y - this.size_.height / 2}px`;
    } else {
      // If coords is null, marker is "behind" the camera, so we position the marker outside the viewport.
      this.marker_.style.left = `${-(9999 + this.size_.width)}px`;
      this.marker_.style.top = '0';
    }

    this.onDraw_?.();
  };

  /** @param {string} icon - URL to a new icon. */
  setIcon = function (icon) {
    this.marker_.style.setProperty('--label-icon', `url(${icon})`);
  };

  /** @param {{heading: number, pitch: number}} position - The desired location for the marker on the pano. */
  setPosition = function (position) {
    this.position_ = position;
    this.draw();
  };

  /** @param {{width: number, height: number}} size - The new size of the marker in pixels. */
  setSize = function (size) {
    this.size_ = size;
    this.marker_.style.width = `${size.width}px`;
    this.marker_.style.height = `${size.height}px`;
    this.marker_.style.setProperty('--marker-diameter', `${size.width}px`);
    this.draw();
  };

  /** @param {boolean} show - Whether the marker shall be visible. */
  setVisible = function (show) {
    this.marker_.style.display = show ? 'block' : 'none';
  };
}
