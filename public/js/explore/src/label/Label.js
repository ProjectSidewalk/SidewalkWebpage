/**
 * A Label module.
 *
 * @memberof svl
 */
class Label {
  className = 'Label'; // Read by Canvas.js for type dispatch (`item.className === 'Label'`).

  #googleMarker;

  // Size the label-type icons are rasterized to before being drawn (see preloadIcons). The label canvas renders at
  // its on-screen size times the device pixel ratio, so the ~34px logical icon can land on ~130 device pixels on a
  // wide HiDPI display; rasterizing below that is what left the icon looking soft.
  static #ICON_RASTER_SIZE = 128;

  // On-screen size of the labeling cursor. Canvas.js centers its hotspot on this.
  static CURSOR_ICON_SIZE = 38;

  static #cursorUrlCache = new Map();

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
        this.#updateHoverCard();
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
   * Populates and positions the hover card next to this label, showing its type, severity, tags, and description,
   * plus its Delete/Edit action buttons.
   *
   * The card is a single shared DOM element positioned in on-screen pixels, so the label's logical canvas
   * coordinate is scaled to the displayed pano size (see util.exploreDisplayScale).
   */
  #updateHoverCard() {
    // Don't show the hover card while the context menu is open or before the label has a canvas position.
    if (('contextMenu' in svl && svl.contextMenu.isOpen()) || !this.#properties.currCanvasXY) {
      this.#hideHoverCard();
      return;
    }

    const ui = svl.ui.canvas;
    const labelType = this.#properties.labelType;
    const severity = this.#properties.severity;
    const hasSeverity = util.misc.labelTypeHasSeverity(labelType);

    ui.hoverCardIcon.attr('src', util.misc.getIconImagePaths(labelType).iconImagePath);
    ui.hoverCardType.text(i18next.t(`common:${util.camelToKebab(labelType)}`).replace('&shy;', ''));

    // Severity row for rated labels; the not-rated nudge for unrated ones; neither for types without severity.
    if (hasSeverity && severity !== null) {
      // Positive label types rate quality (Good/Okay/Bad); the rest use the passability phrases, matching the
      // vocabulary of the context menu's rating section.
      const severityText = util.misc.isPositiveLabelType(labelType)
        ? i18next.t(`common:${util.misc.getRatingLevelKeys(labelType)[severity]}`)
        : this.#hoverInfoProperties[severity].message;
      ui.hoverCardSeverityText.text(severityText);
      ui.hoverCardSeverityIcon.attr('src', util.misc.getSmileyIconPath(severity, labelType, true));
      ui.hoverCardSeverity.css('display', 'flex');
    } else {
      ui.hoverCardSeverity.css('display', 'none');
    }
    ui.hoverCardNotRated.css('display', hasSeverity && severity === null ? 'flex' : 'none');

    // Tags, as static (non-interactive) pills — built as DOM nodes with textContent so the tag text stays inert.
    const tagNames = this.#getTagNames();
    if (tagNames.length > 0) {
      ui.hoverCardTags.empty();
      for (const name of tagNames) {
        const pill = document.createElement('span');
        pill.className = 'tag-pill';
        const pillLabel = document.createElement('span');
        pillLabel.className = 'tag-pill__label';
        pillLabel.textContent = name;
        pill.appendChild(pillLabel);
        ui.hoverCardTags.append(pill);
      }
      ui.hoverCardTags.css('display', 'flex');
    } else {
      ui.hoverCardTags.css('display', 'none');
    }

    const description = this.#properties.description;
    if (description) {
      ui.hoverCardDescription.text(Label.#truncate(description, 90));
      ui.hoverCardDescription.css('display', 'inline');
    } else {
      ui.hoverCardDescription.css('display', 'none');
    }

    // Collapse the body entirely when it has nothing to show (e.g. an Occlusion label).
    ui.hoverCardBody.css('display', hasSeverity || tagNames.length > 0 || description ? 'flex' : 'none');

    // Occlusion labels have no context menu, so the card isn't a click target and the Edit button is hidden.
    ui.hoverCard.toggleClass('label-hover-card--static', labelType === 'Occlusion');
    // The tutorial's delete lock hides the Delete button.
    ui.hoverCard.toggleClass('label-hover-card--no-delete', Boolean(svl.canvas.getStatus('disableLabelDelete')));

    // The card and the context menu it opens into share one anchor so the panel expands roughly in place.
    util.anchorPanelToLabel(ui.hoverCard, this.getCanvasXY(), svl.LABEL_ICON_RADIUS);
    ui.hoverCard.css('visibility', 'visible');
  }

  /**
   * Hides the shared hover card.
   */
  #hideHoverCard() {
    svl.ui.canvas.hoverCard.css('visibility', 'hidden');
  }

  /**
   * Returns the localized, plain-text names of this label's tags.
   * @returns {Array<string>}
   */
  #getTagNames() {
    const allTags = 'contextMenu' in svl ? svl.contextMenu.labelTags : null;
    if (!allTags) return [];
    const tagInfo = util.misc.getLabelDescriptions(this.#properties.labelType)?.tagInfo ?? {};
    return this.#properties.tagIds
      .map((tagId) => allTags.find((tag) => tag.tag_id === tagId))
      .filter(Boolean)
      // The localized tag texts embed <tag-underline> keyboard-shortcut markup; the pills show plain text.
      .map((tag) => (tagInfo[tag.tag]?.text ?? tag.tag).replace(/<[^>]*>/g, ''));
  }

  /**
   * Truncates a string to the given length, appending an ellipsis if anything was cut.
   * @param {string} str
   * @param {number} maxLength
   * @returns {string}
   */
  static #truncate(str, maxLength) {
    const chars = [...str]; // Code points, so the cut can't land inside a surrogate pair (e.g. mid-emoji).
    return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join('').trimEnd()}…` : str;
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
   * Rasterizes and caches every label-type icon. renderLabelIcon draws only from this cache, so warming it up front
   * lets the icon, its outline, and any overlay drawn after it (e.g. the severity "?" alert) paint together in the
   * right order — a lazily-loaded icon would instead paint asynchronously, on top of those overlays.
   *
   * Each icon is rasterized once into an offscreen canvas rather than cached as an <img>: the label canvas redraws
   * on every pano move, and re-rasterizing vector art per frame per label is work we can do once instead.
   * @returns {Promise} Resolves once all icons have loaded (or failed) so callers can render with the cache warm.
   */
  static preloadIcons() {
    const iconPaths = util.misc.getIconImagePaths();
    const loads = Object.keys(iconPaths).map((labelType) => {
      const iconPath = iconPaths[labelType].iconImagePath;
      if (!iconPath || window.labelIconCache[iconPath]) return Promise.resolve();
      return new Promise((resolve) => {
        const imageObj = new Image();
        // The icon SVGs carry only a viewBox, so they have no intrinsic size for the browser to rasterize at; the
        // width/height attributes supply one. Without them Firefox refuses to draw the image to a canvas at all.
        imageObj.width = Label.#ICON_RASTER_SIZE;
        imageObj.height = Label.#ICON_RASTER_SIZE;
        imageObj.onload = () => {
          const raster = document.createElement('canvas');
          raster.width = Label.#ICON_RASTER_SIZE;
          raster.height = Label.#ICON_RASTER_SIZE;
          raster.getContext('2d')
            .drawImage(imageObj, 0, 0, Label.#ICON_RASTER_SIZE, Label.#ICON_RASTER_SIZE);
          window.labelIconCache[iconPath] = raster;
          resolve();
        };
        imageObj.onerror = () => resolve(); // Don't let one missing icon block the rest.
        imageObj.src = iconPath;
      });
    });
    return Promise.all(loads);
  }

  /**
   * Returns a label type's icon as a PNG data URL sized for use as a CSS cursor, or null for types without an icon.
   *
   * Cursors can't take an SVG that has no intrinsic size (and Safari takes no SVG cursor at all), so the vector icon
   * is rasterized to the cursor's exact on-screen size. Results are memoized — the labeling cursor is re-applied on
   * every mousemove.
   * @param {string} labelType
   * @returns {?string}
   */
  static getCursorImageUrl(labelType) {
    if (Label.#cursorUrlCache.has(labelType)) return Label.#cursorUrlCache.get(labelType);

    const iconPath = util.misc.getIconImagePaths(labelType)?.iconImagePath;
    if (!iconPath) {
      Label.#cursorUrlCache.set(labelType, null); // Walk mode and anything else with no marker of its own.
      return null;
    }
    // Not rasterized yet (preloadIcons is still in flight) — leave it uncached so the next mousemove retries.
    const icon = window.labelIconCache[iconPath];
    if (!icon) return null;

    const cursor = document.createElement('canvas');
    cursor.width = Label.CURSOR_ICON_SIZE;
    cursor.height = Label.CURSOR_ICON_SIZE;
    const cursorCtx = cursor.getContext('2d');
    cursorCtx.imageSmoothingQuality = 'high'; // The raster is several times the cursor's size; keep the edge clean.
    cursorCtx.drawImage(icon, 0, 0, Label.CURSOR_ICON_SIZE, Label.CURSOR_ICON_SIZE);
    const url = cursor.toDataURL();
    Label.#cursorUrlCache.set(labelType, url);
    return url;
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
    // Sizing is set in .minimap-label-icon.
    content.src = util.misc.getIconImagePaths(labelType).iconImagePath;
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
