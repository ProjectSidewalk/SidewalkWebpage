/**
 * A Label module.
 *
 * @memberof svl
 */
class Label {
  className = 'Label'; // Read by Canvas.js for type dispatch (`item.className === 'Label'`).

  #googleMarker;

  // Parameters determined from a series of linear regressions. Here links to the analysis and relevant GitHub issues:
  // https://github.com/ProjectSidewalk/label-latlng-estimation/blob/master/scripts/label-latlng-estimation.md#results
  // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2374
  // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2362
  static #LATLNG_ESTIMATION_PARAMS = {
    1: {
      headingIntercept: -51.2401711,
      headingCanvasXSlope: 0.1443374,
      distanceIntercept: 18.6051843,
      distancePanoYSlope: 0.0138947,
      distanceCanvasYSlope: 0.0011023,
    },
    2: {
      headingIntercept: -27.5267447,
      headingCanvasXSlope: 0.0784357,
      distanceIntercept: 20.8794248,
      distancePanoYSlope: 0.0184087,
      distanceCanvasYSlope: 0.0022135,
    },
    3: {
      headingIntercept: -13.5675945,
      headingCanvasXSlope: 0.0396061,
      distanceIntercept: 25.2472682,
      distancePanoYSlope: 0.0264216,
      distanceCanvasYSlope: 0.0011071,
    },
  };

  #properties = {
    labelId: 'DefaultValue',
    auditTaskId: undefined,
    missionId: undefined,
    labelType: undefined,
    originalCanvasXY: undefined,
    currCanvasXY: undefined,
    panoXY: undefined,
    originalPov: undefined,
    povOfLabelIfCentered: undefined,
    labelLat: undefined,
    labelLng: undefined,
    latLngComputationMethod: undefined,
    panoId: undefined,
    panoLat: undefined,
    panoLng: undefined,
    cameraHeading: undefined,
    panoWidth: undefined,
    panoHeight: undefined,
    tagIds: [],
    severity: null,
    tutorial: null,
    tutorialLabelNumber: undefined,
    temporaryLabelId: null,
    description: null,
    crop: undefined,
  };

  #status = {
    deleted: false,
    hoverInfoVisibility: 'visible',
    visibility: 'visible',
  };

  #hoverInfoProperties;

  /**
   * @param {Object} params - Initial label property values (only keys present in #properties are copied).
   */
  constructor(params) {
    this.#hoverInfoProperties = util.misc.getSeverityDescription();

    for (const attrName in params) {
      if (Object.hasOwn(params, attrName) && Object.hasOwn(this.#properties, attrName)) {
        this.#properties[attrName] = params[attrName];
      }
    }

    // Save pano data and calculate pano_x/y if the label is new.
    if (this.#properties.panoXY === undefined) {
      const panoData = svl.panoStore.getPanoData(this.#properties.panoId).getProperties();

      this.#properties.panoWidth = panoData.width;
      this.#properties.panoHeight = panoData.height;
      this.#properties.cameraHeading = panoData.cameraHeading;
      this.#properties.panoLat = panoData.lat;
      this.#properties.panoLng = panoData.lng;
      this.#properties.panoXY = util.pano.povToPanoCoord(
        this.#properties.povOfLabelIfCentered, this.#properties.cameraHeading,
        this.#properties.panoWidth, this.#properties.panoHeight,
      );
    }

    // Create the marker on the minimap.
    const latlng = this.toLatLng();
    this.#googleMarker = Label.createMinimapMarker(this.#properties.labelType, latlng);
    this.#googleMarker.map = svl.minimap.getMap();
    // Click the marker to return to this label's pano (#2561). gmpClickable (set in createMinimapMarker) is what makes
    // the AdvancedMarkerElement emit gmp-click.
    this.#googleMarker.addListener('gmp-click', () => this.#returnToLabelFromMinimap());
  }

  /**
   * Returns to this label's pano and faces it so the user can review or re-mark it (#2561). Ignored during onboarding
   * or if the label isn't from the current mission (returning across missions would desync the map's active task).
   */
  #returnToLabelFromMinimap() {
    if (svl.isOnboarding()) return;
    const currMissionId = svl.missionContainer.getCurrentMission().getProperty('missionId');
    if (this.#properties.missionId !== currMissionId) return;

    svl.tracker.push('Click_MinimapLabelMarker', {
      labelId: this.#properties.labelId,
      panoId: this.#properties.panoId,
    });
    svl.navigationService.returnToPano(this.#properties.panoId, this.#properties.povOfLabelIfCentered);
  }

  // Some functions for easy access to commonly accessed properties.
  getLabelId() {
    return this.#properties.labelId;
  }

  getLabelType() {
    return this.#properties.labelType;
  }

  getPanoId() {
    return this.#properties.panoId;
  }

  /**
   * Returns the coordinate of the label.
   * @returns {{x: number, y: number}}
   */
  getCanvasXY() {
    return this.#properties.currCanvasXY;
  }

  /**
   * Returns a deep copy of the properties object, so callers can't mutate the label's internal state directly.
   * @returns {Object}
   */
  getProperties() {
    return structuredClone(this.#properties);
  }

  getProperty(propName) {
    return (propName in this.#properties) ? this.#properties[propName] : false;
  }

  setProperty(key, value) {
    this.#properties[key] = value;
  }

  getStatus(key) {
    return this.#status[key];
  }

  isDeleted() {
    return this.#status.deleted;
  }

  isVisible() {
    return this.#status.visibility === 'visible';
  }

  setVisibility(visibility) {
    this.#status.visibility = visibility;
  }

  /**
   * Set status. Deals with special cases for the various status values that have a limited set of values.
   * @param {string} key
   * @param {*} value
   */
  setStatus(key, value) {
    if (key in this.#status) {
      if (key === 'visibility' && (value === 'visible' || value === 'hidden')) {
        this.setVisibility(value);
      } else if (key === 'hoverInfoVisibility' && (value === 'visible' || value === 'hidden')) {
        this.setHoverInfoVisibility(value);
      } else if (key === 'deleted' && typeof value === 'boolean') {
        this.#status[key] = value;
      } else if (key === 'severity') {
        this.#status[key] = value;
      }
    }
  }

  /**
   * Set the visibility of the hover info.
   * @param {string} visibility - 'visible' or 'hidden'.
   * @returns {Label} this, for chaining.
   */
  setHoverInfoVisibility(visibility) {
    if (visibility === 'visible' || visibility === 'hidden') {
      this.#status.hoverInfoVisibility = visibility;
    }
    return this;
  }

  getHoverInfoVisibility() {
    return this.#status.hoverInfoVisibility;
  }

  /**
   * Check if this label is under the cursor.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isOn(x, y) {
    const margin = svl.LABEL_ICON_RADIUS / 2 + 2;
    return !this.#status.deleted
      && this.#status.visibility === 'visible'
      && this.#properties.currCanvasXY
      && x < this.#properties.currCanvasXY.x + margin
      && x > this.#properties.currCanvasXY.x - margin
      && y < this.#properties.currCanvasXY.y + margin
      && y > this.#properties.currCanvasXY.y - margin;
  }

  /**
   * Remove the label (it does not actually remove, but hides the label and set its status to 'deleted').
   */
  remove() {
    this.setStatus('deleted', true);
    this.setStatus('visibility', 'hidden');
  }

  /**
   * Renders this label on a canvas.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} pov
   * @returns {Label} this.
   */
  render(ctx, pov) {
    if (!this.#status.deleted && this.#status.visibility === 'visible') {
      if (this.#status.hoverInfoVisibility === 'visible') {
        // Show the hover info tooltip and delete button.
        this.#updateHoverInfo();
        this.#showDeleteButton();
      }

      // Update the coordinates of the label on the canvas.
      this.#properties.currCanvasXY = util.pano.centeredPovToCanvasCoord(
        this.#properties.povOfLabelIfCentered, pov,
        util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT, svl.LABEL_ICON_RADIUS,
      );

      // Draw the label icon if it's in the visible part of the pano.
      if (this.#properties.currCanvasXY) {
        Label.renderLabelIcon(
          ctx, this.#properties.labelType, this.#properties.currCanvasXY.x, this.#properties.currCanvasXY.y,
        );

        // Only render severity warning if there's a severity option.
        if (util.misc.labelTypeHasSeverity(this.#properties.labelType) && this.#properties.severity === null) {
          this.#showSeverityAlert(ctx);
        }
      }
    }

    // Show the label on the Google Maps pane.
    if (!this.isDeleted()) {
      if (this.#googleMarker && !this.#googleMarker.map) {
        this.#googleMarker.map = svl.minimap.getMap();
      }
    } else if (this.#googleMarker && this.#googleMarker.map) {
      this.#googleMarker.map = null;
    }
    return this;
  }

  /**
   * Shows the hover info tooltip next to this label, displaying its type and severity.
   *
   * The tooltip is a single shared DOM element positioned in on-screen pixels, so the label's logical canvas
   * coordinate is scaled to the displayed pano size (see util.exploreDisplayScale).
   */
  #updateHoverInfo() {
    // Don't show the hover tooltip while the context menu is open or before the label has a canvas position.
    if (('contextMenu' in svl && svl.contextMenu.isOpen()) || !this.#properties.currCanvasXY) {
      this.#hideHoverInfo();
      return;
    }

    const labelType = this.#properties.labelType;
    const hasSeverity = util.misc.labelTypeHasSeverity(labelType);

    svl.ui.canvas.hoverInfoType.text(
      i18next.t(`common:${util.camelToKebab(labelType)}`).replace('&shy;', ''),
    );
    svl.ui.canvas.hoverInfoHolder.css('background-color', util.misc.getLabelColors(labelType));

    // Severity row: hidden for label types without severity; otherwise show the rating (or a prompt to rate).
    if (hasSeverity) {
      if (this.#properties.severity !== null) {
        svl.ui.canvas.hoverInfoSeverityText.text(this.#hoverInfoProperties[this.#properties.severity].message);
        svl.ui.canvas.hoverInfoSeverityIcon
          .attr('src', util.misc.getSmileyIconPath(this.#properties.severity, labelType, true))
          .css('display', '');
      } else {
        svl.ui.canvas.hoverInfoSeverityText.text(i18next.t('center-ui.context-menu.severity'));
        svl.ui.canvas.hoverInfoSeverityIcon.css('display', 'none');
      }
      svl.ui.canvas.hoverInfoSeverity.css('display', 'flex');
    } else {
      svl.ui.canvas.hoverInfoSeverity.css('display', 'none');
    }

    // Position the tooltip to the right of the label icon, or to the left if there isn't room on the right.
    const coord = this.getCanvasXY();
    const scale = util.exploreDisplayScale();
    const holder = svl.ui.canvas.hoverInfoHolder;
    const centerX = coord.x * scale;
    const centerY = coord.y * scale;
    const radius = svl.LABEL_ICON_RADIUS * scale;
    const gap = 14; // On-screen pixels between the icon and the tooltip.

    let left = centerX + radius + gap;
    if (left + holder.outerWidth() > util.EXPLORE_CANVAS_WIDTH * scale) {
      left = centerX - radius - gap - holder.outerWidth();
    }
    holder.css({
      visibility: 'visible',
      left,
      top: centerY - holder.outerHeight() / 2,
    });
  }

  /**
   * Hides the shared hover info tooltip.
   */
  #hideHoverInfo() {
    svl.ui.canvas.hoverInfoHolder.css('visibility', 'hidden');
  }

  #showDeleteButton() {
    if (this.#status.hoverInfoVisibility !== 'hidden') {
      const holder = svl.ui.canvas.deleteIconHolder;

      // Hide if the label is not on the canvas.
      const coord = this.getCanvasXY();
      if (!coord) {
        holder.css('visibility', 'hidden');
        return;
      }

      // Place the button at the upper-right of the label. Hide if it doesn't fit.
      const scale = util.exploreDisplayScale();
      const gap = 5 * scale;
      const left = coord.x * scale + gap;
      const top = coord.y * scale - 25 * scale;
      if (left + holder.outerWidth() > util.EXPLORE_CANVAS_WIDTH * scale || top < 0) {
        holder.css('visibility', 'hidden');
        return;
      }
      holder.css({ visibility: 'visible', left, top });
    }
  }

  /**
   * Renders a question mark if a label has an unmarked severity.
   * @param {CanvasRenderingContext2D} ctx - Rendering tool for severity (2D context).
   */
  #showSeverityAlert(ctx) {
    const x = this.#properties.currCanvasXY.x;
    const y = this.#properties.currCanvasXY.y;

    // Draws circle.
    ctx.beginPath();
    ctx.fillStyle = 'rgb(160, 45, 50, 0.9)';
    ctx.ellipse(x - 15, y - 10.5, 8, 8, 0, 0, 2 * Math.PI);
    ctx.fill();
    ctx.closePath();

    // Draws text.
    ctx.beginPath();

    // Canvas fonts can't resolve CSS variables, so the design system's --font-primary stack is read from :root.
    // No --ui-scale here: this canvas keeps its fixed logical size and is scaled up by the browser.
    ctx.font = `400 12px ${getComputedStyle(document.documentElement).getPropertyValue('--font-primary')}`;
    ctx.fillStyle = 'rgb(255, 255, 255)';
    ctx.fillText('?', x - 17.5, y - 6);
    ctx.closePath();
  }

  /**
   * Get the label's estimated latlng position.
   * @returns {{lat: number, lng: number, latLngComputationMethod: string}}
   */
  toLatLng() {
    if (!this.#properties.labelLat) {
      // Estimate the latlng point from the camera position and the heading when point cloud data isn't available.
      const panoLat = this.getProperty('panoLat');
      const panoLng = this.getProperty('panoLng');
      const heading = this.getProperty('originalPov').heading;
      const canvasX = this.getProperty('originalCanvasXY').x;
      const canvasY = this.getProperty('originalCanvasXY').y;
      const panoY = this.getProperty('panoXY').y;
      const panoHeight = this.getProperty('panoHeight');

      // Estimate heading diff and distance from pano using output from a regression analysis.
      // https://github.com/ProjectSidewalk/label-latlng-estimation/blob/master/scripts/label-latlng-estimation.md#results
      // Note that the regression analysis was done when our zoom levels were discrete integers. We now allow zoom
      // to be noninteger, so we're doing a linear interpolation between the params at the two zoom levels.
      const minZoom = Math.min(svl.zoomControl.getProperty('minZoomLevel'));
      const maxZoom = Math.min(svl.zoomControl.getProperty('maxZoomLevel'));
      const zoom = Math.min(maxZoom, Math.max(minZoom, this.getProperty('originalPov').zoom));

      const floor = Label.#LATLNG_ESTIMATION_PARAMS[Math.floor(zoom)];
      const ceiling = Label.#LATLNG_ESTIMATION_PARAMS[Math.ceil(zoom)];
      const t = zoom - Math.floor(zoom); // 0 when floor === ceiling.

      const headingIntercept = util.math.lerp(floor.headingIntercept, ceiling.headingIntercept, t);
      const headingCanvasXSlope = util.math.lerp(floor.headingCanvasXSlope, ceiling.headingCanvasXSlope, t);
      const distanceIntercept = util.math.lerp(floor.distanceIntercept, ceiling.distanceIntercept, t);
      const distancePanoYSlope = util.math.lerp(floor.distancePanoYSlope, ceiling.distancePanoYSlope, t);
      const distanceCanvasYSlope = util.math.lerp(floor.distanceCanvasYSlope, ceiling.distanceCanvasYSlope, t);

      const estHeadingDiff = headingIntercept + headingCanvasXSlope * canvasX;
      const estDistanceFromPanoKm = Math.max(0,
        distanceIntercept + distancePanoYSlope * (panoHeight / 2 - panoY) + distanceCanvasYSlope * canvasY,
      ) / 1000.0;
      const estHeading = heading + estHeadingDiff;
      const startPoint = turf.point([panoLng, panoLat]);

      // Use the pano location, distance from pano estimate, and heading estimate, calculate label location.
      const destination = turf.destination(startPoint, estDistanceFromPanoKm, estHeading, { units: 'kilometers' });
      const latlng = {
        lat: destination.geometry.coordinates[1],
        lng: destination.geometry.coordinates[0],
        latLngComputationMethod: 'approximation2',
      };
      this.setProperty('labelLat', latlng.lat);
      this.setProperty('labelLng', latlng.lng);
      this.setProperty('latLngComputationMethod', latlng.latLngComputationMethod);
      return latlng;
    } else {
      // Return the cached value.
      return {
        lat: this.getProperty('labelLat'),
        lng: this.getProperty('labelLng'),
        latLngComputationMethod: this.getProperty('latLngComputationMethod'),
      };
    }
  }

  /**
   * Save a screenshot of the image named crop_<labelId>.png. The crops are stored in subdirs /<city-id>/<label-type>.
   * @param {number} labelId
   * @param {number} retryAttempt - Current retry attempt if image hasn't been saved yet.
   */
  updateLabelIdAndUploadCrop(labelId, retryAttempt) {
    // Retry if crop isn't available yet.
    if (!this.getProperty('crop')) {
      if (isNaN(retryAttempt)) retryAttempt = 0;
      if (retryAttempt < 1) {
        console.log('No crop found to upload, retrying in 3 seconds.');
        setTimeout(() => {
          this.updateLabelIdAndUploadCrop(labelId, retryAttempt + 1);
        }, 3000);
      } else {
        console.log(`No crop found to upload after ${retryAttempt + 1} attempts.`);
      }
      return;
    }

    // Upload the crop to the server with filename crop_<labelId>.png.
    this.setProperty('labelId', labelId);
    const cropData = {
      label_id: labelId,
      label_type: this.getProperty('labelType'),
      b64: this.getProperty('crop'),
    };
    fetch('saveImage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(cropData),
    }).then(() => {
      this.setProperty('crop', null); // Remove reference to crop to save memory.
    }).catch((err) => console.error(err));
  }

  /**
   * Preloads and caches every label-type icon. renderLabelIcon draws only from this cache, so warming it up front
   * lets the icon, its outline, and any overlay drawn after it (e.g. the severity "?" alert) paint together in the
   * right order — a lazily-loaded icon would instead paint asynchronously, on top of those overlays.
   * @returns {Promise} Resolves once all icons have loaded (or failed) so callers can render with the cache warm.
   */
  static preloadIcons() {
    const iconPaths = util.misc.getIconImagePaths();
    const loads = Object.keys(iconPaths).map((labelType) => {
      const iconPath = iconPaths[labelType].iconImagePath;
      if (!iconPath || window.labelIconCache[iconPath]) return Promise.resolve();
      return new Promise((resolve) => {
        const imageObj = new Image();
        imageObj.onload = function () {
          window.labelIconCache[iconPath] = imageObj;
          resolve();
        };
        imageObj.onerror = function () {
          resolve();
        }; // Don't let one missing icon block the rest.
        imageObj.src = iconPath;
      });
    });
    return Promise.all(loads);
  }

  /**
   * Draws a label icon and its circular outline. The icon comes from the cache warmed by Label.preloadIcons; the
   * outline is drawn after it so the ring sits on top of the icon's edge. Also draws tutorial example labels.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} labelType
   * @param {number} x
   * @param {number} y
   */
  static renderLabelIcon(ctx, labelType, x, y) {
    const size = 2 * svl.LABEL_ICON_RADIUS - 3;
    const icon = window.labelIconCache[util.misc.getIconImagePaths(labelType).iconImagePath];
    if (icon) ctx.drawImage(icon, x - svl.LABEL_ICON_RADIUS + 2, y - svl.LABEL_ICON_RADIUS + 2, size, size);

    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(x, y, 15.3, 0, 2 * Math.PI);
    ctx.strokeStyle = 'black';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 16.2, 0, 2 * Math.PI);
    ctx.strokeStyle = 'white';
    ctx.stroke();
  }

  /**
   * Creates the marker shown for this label on the minimap using Google Maps AdvancedMarkerElement.
   * @param {string} labelType
   * @param {{lat: number, lng: number}} latLng
   * @returns {google.maps.marker.AdvancedMarkerElement}
   */
  static createMinimapMarker(labelType, latLng) {
    const content = document.createElement('img');
    // Use the scalable SVG icon so the marker stays crisp at any scale; sizing is set in .minimap-label-icon.
    content.src = util.misc.getIconImagePaths()[labelType].scalableIconImagePath;
    content.className = 'minimap-label-icon';
    // AdvancedMarkerElement anchors content by its bottom-center; shift it down half its height to center it.
    content.style.transform = 'translateY(50%)';
    return new google.maps.marker.AdvancedMarkerElement({
      position: new google.maps.LatLng(latLng.lat, latLng.lng),
      map: svl.minimap.getMap(),
      content,
      // Interactive so it emits gmp-click; the click handler is wired in the Label constructor (#2561).
      gmpClickable: true,
    });
  }
}

// Set up a global cache for icon images.
if (!window.labelIconCache) {
  window.labelIconCache = {};
}
