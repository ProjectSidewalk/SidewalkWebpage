/**
 * A Label module.
 *
 * @memberof svl
 */
class Label {
  className = 'Label'; // Read by Canvas.js for type dispatch (`item.className === 'Label'`).

  #googleMarker;

  // Which era of the user's work this label belongs to on the minimap: 'current' (this mission), 'prior' (an earlier
  // mission in this region), or 'outdated' (placed on imagery that has since been replaced, #4945). See minimapEra.
  /** @type {'current'|'prior'|'outdated'} */
  #minimapEra = 'current';

  // True while the "My earlier labels" legend toggle hides this label's minimap marker. Kept apart from the deleted /
  // visibility status so render() can't put the marker back on the map the next time the pano is drawn.
  #minimapSuppressed = false;

  // Size the label-type icons are rasterized to before being drawn (see preloadIcons). The label canvas renders at
  // its on-screen size times the device pixel ratio, so the icon tops out around 76 device pixels on a HiDPI
  // display (util.LABEL_ICON_MAX_SCREEN_DIAMETER at devicePixelRatio 2); rasterizing below that is what left the
  // icon looking soft. Kept well above that ceiling so the raster is always downscaled, never stretched.
  static #ICON_RASTER_SIZE = 128;

  // On-screen size of the labeling cursor, in CSS px. Canvas.js centers its hotspot on this. This bitmap does not
  // scale with the tool, so it is also the ceiling a placed icon may grow to — see util.labelIconRadius (#4838).
  static CURSOR_ICON_SIZE = 38;

  static #cursorUrlCache = new Map();

  // Resolves when this label's crop reaches the server; null until a submission hands us an id. See cropUploaded().
  #cropUpload = null;

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
    fromOutdatedImagery: false,
  };

  #status = {
    deleted: false,
    hoverInfoVisibility: 'visible',
    visibility: 'visible',
  };

  /**
   * @param {object} params - Initial label property values (only keys present in #properties are copied).
   */
  constructor(params) {
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

    // Create the marker on the minimap, styled for the era it belongs to (#4945).
    const latlng = this.toLatLng();
    this.#minimapEra = Label.minimapEra(this.#properties, Label.#currentMissionId());
    this.#googleMarker = Label.createMinimapMarker(this.#properties.labelType, latlng, this.#minimapEra);
    this.#googleMarker.map = svl.minimap.getMap();
    // Click the marker to return to this label's pano (#2561). gmpClickable (set per era in styleMinimapMarker) is what
    // makes the AdvancedMarkerElement emit gmp-click, so only a current-era marker ever does.
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

  /** The current mission's id, or null before a mission is loaded (and in unit tests without a mission container). */
  static #currentMissionId() {
    const mission = svl.missionContainer?.getCurrentMission?.();
    return mission ? mission.getProperty('missionId') : null;
  }

  /**
   * Classifies a label for the minimap (#4945): the current mission's labels are the user's live work; labels from
   * an earlier mission in the region are an earlier pass; labels whose audit task is flagged outdated_imagery were
   * placed on imagery that has since been replaced, so during a re-audit they are the previous era's record.
   *
   * Era is keyed on mission rather than audit task because that is the boundary the user experiences (the
   * mission-complete modal), and it matches the rule the marker click already uses: only current-mission labels can
   * be returned to. The mission test comes first: a label placed in the mission the user is on right now is live work
   * even if its audit task has since been flagged outdated_imagery (a mission spans several tasks, so one can be
   * flagged mid-mission by the nightly freshness sync). A label with no mission id, or with no mission loaded to
   * compare against, is never 'prior', so nothing is dimmed by accident; only the imagery flag can dim it.
   *
   * @param {{missionId?: number, fromOutdatedImagery?: boolean}} props - The label's properties.
   * @param {?number} currentMissionId - The mission the user is on, or null if unknown.
   * @returns {'current'|'prior'|'outdated'}
   */
  static minimapEra(props, currentMissionId) {
    const { missionId } = props;
    const known = (id) => id !== null && id !== undefined;
    const bothKnown = known(currentMissionId) && known(missionId);
    if (bothKnown && missionId === currentMissionId) return 'current';
    if (props.fromOutdatedImagery) return 'outdated';
    if (bothKnown) return 'prior';
    return 'current';
  }

  getMinimapEra() {
    return this.#minimapEra;
  }

  /**
   * Re-derives the era against the mission now current and restyles the marker. Called when the mission changes: the
   * labels just placed become the previous pass, and a resumed mission's labels come back as current work. Whether the
   * marker is on the map is the legend toggle's call (LabelContainer.refreshMinimapEras re-applies it after this).
   */
  refreshMinimapEra() {
    const era = Label.minimapEra(this.#properties, Label.#currentMissionId());
    if (era === this.#minimapEra) return;
    this.#minimapEra = era;
    if (this.#googleMarker) {
      Label.styleMinimapMarker(this.#googleMarker, this.#properties.labelType, era);
    }
  }

  /**
   * Hides or shows this label's minimap marker for the "My earlier labels" legend toggle. Only the marker: the label
   * itself stays live, is still drawn on its pano, and still counts.
   * @param {boolean} suppressed
   */
  setMinimapMarkerSuppressed(suppressed) {
    this.#minimapSuppressed = suppressed;
    if (!this.#googleMarker) return;
    if (suppressed) {
      this.#googleMarker.map = null;
    } else if (!this.isDeleted() && !this.#googleMarker.map) {
      // Only when off the map: the toggle re-applies to every label at each mission change, and re-assigning the map
      // to a marker already on it would re-attach it for nothing.
      this.#googleMarker.map = svl.minimap.getMap();
    }
  }

  isMinimapMarkerSuppressed() {
    return this.#minimapSuppressed;
  }

  /** @returns {google.maps.marker.AdvancedMarkerElement} This label's minimap marker. */
  getMinimapMarker() {
    return this.#googleMarker;
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
   * @returns {object}
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
    // Sized to the drawn icon rather than derived from its radius, which used to leave the target smaller than the
    // icon under it. See util.labelHitMargin.
    const margin = svl.LABEL_HIT_MARGIN;
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
   * @param {object} pov
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
        // Fade the icon while its dialog is open. The marker sits exactly on the feature being rated, so fading it
        // lets the user see that feature while they rate it; the dialog's tail still marks the spot. ContextMenu's
        // show()/hide() re-render the canvas so this toggles the moment the dialog opens or closes.
        const dialogTarget = svl.contextMenu?.isOpen() && svl.contextMenu.getTargetLabel() === this;
        if (dialogTarget) {
          ctx.save();
          ctx.globalAlpha = 0.3;
        }
        Label.renderLabelIcon(
          ctx, this.#properties.labelType, this.#properties.currCanvasXY.x, this.#properties.currCanvasXY.y,
        );

        // Only render severity warning if there's a severity option.
        if (util.misc.labelTypeHasSeverity(this.#properties.labelType) && this.#properties.severity === null) {
          this.#showSeverityAlert(ctx);
        }
        if (dialogTarget) ctx.restore();
      }
    }

    // Show the label on the Google Maps pane, unless the legend toggle has hidden earlier labels' markers.
    if (!this.isDeleted() && !this.#minimapSuppressed) {
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
   * plus its Delete/Edit action buttons. The populate itself lives in the shared LabelCardView (#4730); what stays
   * here is everything Explore-specific — the context-menu guard, the card's mode classes, and the anchoring.
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
    svl.labelCardView.render({
      labelType: this.#properties.labelType,
      severity: this.#properties.severity,
      tagNames: this.#getTagNames(),
      description: this.#properties.description,
    });

    // Occlusion labels have no context menu, so the card isn't a click target and the Edit button is hidden.
    ui.hoverCard.toggleClass('label-hover-card--static', this.#properties.labelType === 'Occlusion');
    // The tutorial's delete lock hides the Delete button.
    ui.hoverCard.toggleClass('label-hover-card--no-delete', Boolean(svl.canvas.getStatus('disableLabelDelete')));
    // Aims the share control at this label (and hides it for labels that can never have a public URL).
    svl.canvas.pointShareAtLabel(this);

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
   * Renders a question mark if a label has an unmarked severity.
   * @param {CanvasRenderingContext2D} ctx - Rendering tool for severity (2D context).
   */
  #showSeverityAlert(ctx) {
    const x = this.#properties.currCanvasXY.x;
    const y = this.#properties.currCanvasXY.y;
    // Canvas resolves neither CSS variables nor --ui-scale, so the design tokens are read off :root. (No scaling
    // wanted here regardless: this canvas keeps its fixed logical size and is scaled up by the browser.)
    const rootStyle = getComputedStyle(document.documentElement);
    // The badge's placement and size are authored against the base icon radius, so they scale with the icon and it
    // stays pinned to the icon's upper-left however the icon is sized (#4838).
    const k = util.labelIconScale(svl.LABEL_ICON_RADIUS);

    // Draws circle. The same --color-error-200 the hover card's unrated chip uses, so the "?" on the canvas and the
    // "?" on the card that describes it are one mark in two places rather than two different reds (#4731).
    ctx.beginPath();
    // Trimmed: a custom property's value keeps the whitespace after the colon, and an unparseable fillStyle is
    // silently ignored rather than throwing — the circle would just keep whatever color was set last.
    ctx.fillStyle = rootStyle.getPropertyValue('--color-error-200').trim();
    ctx.ellipse(x - 15 * k, y - 10.5 * k, 8 * k, 8 * k, 0, 0, 2 * Math.PI);
    ctx.fill();
    ctx.closePath();

    // Draws text.
    ctx.beginPath();
    ctx.font = `400 ${12 * k}px ${rootStyle.getPropertyValue('--font-primary')}`;
    ctx.fillStyle = 'rgb(255, 255, 255)';
    ctx.fillText('?', x - 17.5 * k, y - 6 * k);
    ctx.closePath();
  }

  /**
   * Get the label's estimated latlng position.
   *
   * The bearing to the label is exact projection geometry (its centered POV), and the distance below the horizon comes
   * from flat-ground cotangent geometry with a linear tail near the horizon — the same computation as the server's
   * PanoDataService.toLatLng, with the constants injected from the backend (svl.latLngEstimation) so the two can't
   * drift. Both depend only on the label's angular position, so the estimate is independent of both the pano's
   * resolution and the label's type.
   *
   * The camera height and blend angle are fitted values, not tuning knobs — PanoDataService.LatLngEstimation is where
   * they live and where their derivation is documented, and the research behind them (held-out splits, the falsified
   * alternatives, the reports) is in https://github.com/ProjectSidewalk/label-latlng-estimation. The in-repo summary,
   * including the parity fixture this must keep reproducing, is docs/label-latlng-estimation.md.
   *
   * @returns {{lat: number, lng: number, latLngComputationMethod: string}}
   */
  toLatLng() {
    if (!this.#properties.labelLat) {
      // Estimate the latlng point from the pano position and the label's bearing and depression angle when point
      // cloud data isn't available.
      const params = svl.latLngEstimation;
      const pov = this.getProperty('povOfLabelIfCentered');
      const depressionDeg = -pov.pitch;
      const heightM = params.cameraHeightM;
      const blendRad = params.blendDeg * Math.PI / 180;

      let estDistanceM;
      if (depressionDeg >= params.blendDeg) {
        estDistanceM = heightM / Math.tan(depressionDeg * Math.PI / 180);
      } else {
        // The tail's slope is the cotangent's derivative at the blend angle, so value and slope match at the handoff.
        // Above the horizon the answer is the horizon's, keeping the estimate bounded for any input.
        const tailM = heightM / Math.tan(blendRad)
          + heightM * (Math.PI / 180) / (Math.sin(blendRad) ** 2) * (params.blendDeg - Math.max(depressionDeg, 0));
        estDistanceM = Math.min(tailM, params.maxDistanceM);
      }

      const startPoint = turf.point([this.getProperty('panoLng'), this.getProperty('panoLat')]);
      const destination = turf.destination(startPoint, estDistanceM / 1000, pov.heading, { units: 'kilometers' });
      const latlng = {
        lat: destination.geometry.coordinates[1],
        lng: destination.geometry.coordinates[0],
        latLngComputationMethod: 'approximation3',
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
   * Records the label's official id from the server and saves a screenshot named crop_<labelId>.png. The crops are
   * stored in subdirs /<city-id>/<label-type>.
   *
   * The id is set straight away rather than only on the path where a crop exists: it is what the rest of the app
   * keys off (the share permalink, most obviously), and it is known and correct whether or not the canvas has
   * finished producing a crop to go with it.
   *
   * @param {number} labelId
   * @returns {Promise<void>} Resolves once the crop has been uploaded, or given up on.
   */
  updateLabelIdAndUploadCrop(labelId) {
    this.setProperty('labelId', labelId);
    this.#cropUpload = this.#uploadCrop(labelId);
    return this.#cropUpload;
  }

  /**
   * Resolves once this label's crop has reached the server, or immediately if no upload was ever started.
   *
   * Sharing waits on this. /label/:id/image falls back to a fetched Street View still — or the branded placeholder —
   * when no crop is on disk, and caches whatever it built there permanently, so a link handed out in the seconds
   * before the crop lands would keep the wrong preview for good.
   *
   * @returns {Promise<void>}
   */
  cropUploaded() {
    return this.#cropUpload ?? Promise.resolve();
  }

  /**
   * Uploads the crop, retrying once if the canvas hasn't produced it yet.
   * @param {number} labelId
   * @returns {Promise<void>}
   */
  async #uploadCrop(labelId) {
    if (!this.getProperty('crop')) {
      console.log('No crop found to upload, retrying in 3 seconds.');
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (!this.getProperty('crop')) {
        console.log('No crop found to upload after 2 attempts.');
        return;
      }
    }

    // Upload the crop to the server with filename crop_<labelId>.png.
    const cropData = {
      label_id: labelId,
      label_type: this.getProperty('labelType'),
      b64: this.getProperty('crop'),
    };
    await fetch('saveImage', {
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
    const loads = Object.keys(iconPaths).map(/** @returns {Promise<void>} */ (labelType) => {
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
    const radius = svl.LABEL_ICON_RADIUS;
    const halfIcon = util.labelIconHalfExtent(radius);
    const size = 2 * halfIcon;
    const icon = window.labelIconCache[util.misc.getIconImagePaths(labelType).iconImagePath];
    if (icon) ctx.drawImage(icon, x - radius + 2, y - radius + 2, size, size);

    // The rings are a hairline straddling the icon's edge, so they're offsets from the drawn icon rather than the
    // fixed 15.3/16.2 they used to be — the icon's size moves with the UI scale now, and stops moving once the cap
    // engages (#4838). The offsets and the stroke scale with it too: left absolute, the outline would read about
    // 47% heavier against a capped icon than against a full-size one.
    const k = util.labelIconScale(radius);
    ctx.lineWidth = 0.7 * k;
    ctx.beginPath();
    ctx.arc(x, y, halfIcon - 0.2 * k, 0, 2 * Math.PI);
    ctx.strokeStyle = 'black';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, halfIcon + 0.7 * k, 0, 2 * Math.PI);
    ctx.strokeStyle = 'white';
    ctx.stroke();
  }

  /**
   * The minimap marker's accessible name for a label of the given type and era. Earlier eras say so, and drop the
   * "click to review" affordance, because the click only returns to current-mission labels (#2561).
   * @param {string} labelType
   * @param {'current'|'prior'|'outdated'} era
   * @returns {string}
   */
  static minimapMarkerTitle(labelType, era) {
    const labelTypeName = i18next.t(`common:${util.camelToKebab(labelType)}`).replaceAll('&shy;', '');
    const key = {
      current: 'audit:right-ui.minimap.label-marker-title',
      prior: 'audit:right-ui.minimap.label-marker-title-prior',
      outdated: 'audit:right-ui.minimap.label-marker-title-outdated',
    }[era];
    return i18next.t(key, { labelType: labelTypeName });
  }

  /**
   * Applies an era's look and behavior to a minimap marker: the CSS class that dims earlier passes
   * (.minimap-label-icon--prior / --outdated), the matching accessible name and hover title, whether it is clickable,
   * and its z-order.
   *
   * Only a current-era marker is clickable, because the click only returns to current-mission labels (#2561). Google
   * makes a clickable AdvancedMarkerElement a keyboard-focusable control, so leaving earlier markers clickable would
   * add a focus stop per earlier label (hundreds on a re-audit) whose activation does nothing.
   *
   * The z-index puts this pass's markers above earlier ones. It is deliberately low: the forward crumbs (20-30) and
   * the peg (1000) set higher ones, so a label marker never hides the navigation it sits on.
   * @param {google.maps.marker.AdvancedMarkerElement} marker
   * @param {string} labelType
   * @param {'current'|'prior'|'outdated'} era
   */
  static styleMinimapMarker(marker, labelType, era) {
    const content = /** @type {HTMLImageElement} */ (marker.content);
    content.className = era === 'current' ? 'minimap-label-icon' : `minimap-label-icon minimap-label-icon--${era}`;
    content.dataset.era = era;
    const title = Label.minimapMarkerTitle(labelType, era);
    content.alt = title;
    marker.title = title;
    marker.gmpClickable = era === 'current';
    marker.zIndex = era === 'current' ? 2 : 1;
  }

  /**
   * Creates the marker shown for this label on the minimap using Google Maps AdvancedMarkerElement.
   * @param {string} labelType
   * @param {{lat: number, lng: number}} latLng
   * @param {'current'|'prior'|'outdated'} [era='current'] - See minimapEra.
   * @returns {google.maps.marker.AdvancedMarkerElement}
   */
  static createMinimapMarker(labelType, latLng, era = 'current') {
    const content = document.createElement('img');
    // Sizing is set in .minimap-label-icon.
    content.src = util.misc.getIconImagePaths(labelType).iconImagePath;
    // AdvancedMarkerElement anchors content by its bottom-center; shift it down half its height to center it.
    content.style.transform = 'translateY(50%)';
    const marker = new google.maps.marker.AdvancedMarkerElement({
      position: new google.maps.LatLng(latLng.lat, latLng.lng),
      map: svl.minimap.getMap(),
      content,
    });
    // Class (and so sizing), accessible name, clickability and z-order all depend on the era, so they are set in one
    // place that refreshMinimapEra can re-run.
    Label.styleMinimapMarker(marker, labelType, era);
    return marker;
  }
}

// Set up a global cache for icon images.
if (!window.labelIconCache) {
  window.labelIconCache = {};
}
