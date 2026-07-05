/**
 * Creates the PanoViewer and manages access to it, tracking metadata and drawing labels as PanoMarkers.
 */
class PanoManager {
  /** @type {{panoLoaded: boolean}} */
  #properties = {
    panoLoaded: false,
  };

  /** @type {HTMLElement} The primary viewer's canvas element (GSV/Mapillary/Infra3d). */
  #panoCanvas;

  /** @type {HTMLElement} Sibling canvas for the Pannellum fallback viewer. */
  #pannellumCanvas;

  /** @type {PanoViewer} The primary viewer, always kept alive. */
  #primaryViewer;

  /** @type {PannellumViewer|undefined} Pannellum fallback viewer — lazy-created on first expired pano. */
  #pannellumViewer;

  /** @type {PanoViewer|undefined} Tracks which viewer the current label marker was created for. */
  #markerViewer;

  #bottomLinksClickable = false;
  #linksListener = null;

  /** @type {MutationObserver|null} Watches for Mapillary's attribution container appearing inside the pano canvas. */
  #mapillaryAttributionObserver = null;

  /** @type {{showPrimaryLogo: Function, showSourceLogo: Function}} */
  #logo;

  // Throttle POV-change logging. Dragging the pano (especially via touch on mobile) fires `pov_changed`
  // continuously; logging every one floods the interaction buffer and forces the Tracker's 200-action mid-mission
  // flush every few validations (#2745). Log at most once per interval (with a trailing call so the final POV is
  // still recorded). The throttled logger is created in #init so it has one closure per PanoManager.
  static #POV_LOG_INTERVAL_MS = 500;
  #logPovChange;

  /**
   * Initializes panoViewer on the validate page and loads the first pano.
   *
   * Tries the primary viewer first; if the first pano is expired and a backup image is available, falls back to
   * Pannellum so that a pano is always loaded before this resolves.
   *
   * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize
   * @param {string} viewerAccessToken An access token used to request images for the pano viewer
   * @param {string} startPanoId The ID of the panorama to load first
   * @param {{object}|null} startBackupImage Self-hosted backup for the first pano, or null.
   * @returns {Promise<void>} A Promise that resolves once the first pano has loaded
   */
  async #init(panoViewerType, viewerAccessToken, startPanoId, startBackupImage) {
    // Create the primary viewer without a startPanoId so viewer construction never fails due to an expired pano.
    const panoOptions = {
      accessToken: viewerAccessToken,
      defaultNavigation: false,
      scrollwheel: util.isMobile(),
    };

    this.#panoCanvas = document.getElementById('svv-panorama');

    // Sibling canvas for the Pannellum fallback viewer, hidden until an expired pano needs it.
    this.#pannellumCanvas = document.createElement('div');
    this.#pannellumCanvas.id = 'svv-panorama-pannellum';
    this.#pannellumCanvas.style.cssText
            = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: none;';
    this.#panoCanvas.insertAdjacentElement('afterend', this.#pannellumCanvas);

    this.#primaryViewer = await panoViewerType.create(this.#panoCanvas, panoOptions);
    svv.panoViewer = this.#primaryViewer;

    // Set up the imagery source logo. #showPannellumPano will override it if Pannellum takes over below.
    this.#logo = createPanoViewerLogo(this.#panoCanvas.parentElement, panoViewerType);
    this.#logo.showPrimaryLogo();

    // Load the first pano, falling back to Pannellum if the primary viewer fails.
    try {
      const panoData = await this.#primaryViewer.setPano(startPanoId);
      this.#setPanoCallback(panoData);
    } catch {
      if (startBackupImage) {
        const panoData = await this.#showPannellumPano(startBackupImage);
        this.#setPanoCallback(panoData);
      }
    }

    this.#logPovChange = util.throttle(() => svv.tracker.push('POV_Changed'), PanoManager.#POV_LOG_INTERVAL_MS);
    svv.panoViewer.addListener('pov_changed', () => this.#logPovChange());
    if (util.isMobile()) {
      this.#sizePano();
      svv.panoViewer.resize(); // Necessary for PannellumViewer for correct vertical position of the label.
    }

    if (panoViewerType === GsvViewer && !util.isMobile()) {
      this.#makeGsvAttributionClickable();
      this.#linksListener = this.#primaryViewer.gsvPano
        .addListener('links_changed', this.#makeGsvAttributionClickable.bind(this));
    } else if (panoViewerType === MapillaryViewer && !util.isMobile()) {
      this.#makeMapillaryAttributionClickable();
    }
  }

  /**
   * Gets a specific property from the PanoManager.
   * @param {string} key   Property name.
   * @returns {*} Value associated with this property or null.
   */
  getProperty(key) {
    return key in this.#properties ? this.#properties[key] : null;
  }

  /**
   * Sets a property for the PanoManager.
   * @param {string} key Name of property
   * @param {*} value Value of property
   */
  setProperty(key, value) {
    this.#properties[key] = value;
  }

  /** Returns the viewer_type enum value for the currently active viewer: 'Pannellum' or 'Default'. */
  getActiveViewerName() {
    if (!svv.panoViewer) return '';
    return svv.panoViewer === this.#pannellumViewer ? 'Pannellum' : 'Default';
  }

  /**
   * Returns the underlying PanoMarker object.
   * @returns {PanoMarker}
   */
  getPanoMarker() {
    return this.labelMarker;
  }

  /**
   * Saves historic pano metadata and updates the date text field on the pano in pano viewer.
   * @param {PanoData} panoData The PanoData extracted from the PanoViewer when loading the pano
   * @returns {PanoData}
   * @private
   */
  #setPanoCallback(panoData) {
    // Store the returned pano metadata.
    const panoId = panoData.getPanoId();
    svv.panoStore.addPanoMetadata(panoId, panoData);

    if (!util.isMobile()) {
      // Add the capture date of the image to the bottom-right corner of the UI.
      svv.ui.viewer.date.text(panoData.getProperty('captureDate').format('MMM YYYY'));
    }

    return panoData;
  }

  /**
   * Moves the buttons on the bottom-right of the GSV image to the top layer so they are clickable.
   * @private
   */
  #makeGsvAttributionClickable() {
    const bottomLinks = $('.gm-style-cc');
    if (!this.#bottomLinksClickable && bottomLinks.length > 3) {
      this.#bottomLinksClickable = true;

      // Remove the first child of each remaining .gm-style-cc element because it looks better.
      bottomLinks.each((i, el) => el.firstElementChild && el.firstElementChild.remove());

      bottomLinks[0].remove(); // Remove GSV keyboard shortcuts link.
      svv.ui.viewer.controlLayer.append($(bottomLinks[1]).parent().parent()); // Makes remaining links clickable.
    }

    google.maps.event.removeListener(this.#linksListener);
  }

  /**
   * Moves Mapillary's attribution links (image credit/date/report links) to the top layer so they're clickable.
   *
   * Mapillary renders these inside the pano canvas itself, where the click-handling view-control-layer covers
   * them. We move the container up into that layer instead, the same trick used for the GSV links. Mapillary may
   * re-render its own container back into the pano (e.g. after an image change), so we keep watching for that.
   * @private
   */
  #makeMapillaryAttributionClickable() {
    const tryMove = () => {
      const attributionContainer = this.#panoCanvas.querySelector('.mapillary-attribution-container');
      if (attributionContainer) svv.ui.viewer.controlLayer.append(attributionContainer);
    };
    tryMove(); // Handle the case where Mapillary already rendered the container before we started observing.

    if (this.#mapillaryAttributionObserver) this.#mapillaryAttributionObserver.disconnect();
    this.#mapillaryAttributionObserver = new MutationObserver(tryMove);
    this.#mapillaryAttributionObserver.observe(this.#panoCanvas, { childList: true, subtree: true });
  }

  /**
   * Renders a label onto the screen using a PanoMarker.
   * @param {Label} currentLabel The label to render.
   */
  renderPanoMarker(currentLabel) {
    const url = currentLabel.getIconUrl();
    const labelPov = currentLabel.getOriginalPov();

    // Set to user's POV when labeling if on desktop. If on mobile, center the label on the screen.
    if (util.isMobile()) {
      svv.panoViewer.setPov(labelPov);
    } else {
      svv.panoViewer.setPov({
        heading: currentLabel.getAuditProperty('heading'),
        pitch: currentLabel.getAuditProperty('pitch'),
        zoom: currentLabel.getAuditProperty('zoom'),
      });
    }

    // If the active viewer changed (primary ↔ Pannellum switch), discard the old marker so a new one is created
    // bound to the correct viewer's POV-tracking callbacks.
    if (this.labelMarker && this.#markerViewer !== svv.panoViewer) {
      this.labelMarker.removeMarker();
      this.labelMarker = null;
    }

    if (!this.labelMarker) {
      const markerLayer = document.getElementById('view-control-layer');
      const markerDiameter = Math.round((svv.labelRadius * 2 + 2) * util.uiScale());
      this.labelMarker = new PanoMarker({
        id: 'validate-pano-marker',
        markerContainer: markerLayer,
        panoViewer: svv.panoViewer,
        position: { heading: labelPov.heading, pitch: labelPov.pitch },
        icon: url,
        size: { width: markerDiameter, height: markerDiameter },
        zIndex: 2,
      });
      this.#markerViewer = svv.panoViewer;
    } else {
      this.labelMarker.setPosition({ heading: labelPov.heading, pitch: labelPov.pitch });
      this.labelMarker.setIcon(url);
    }
    this.#updateMarkerAiIndicator(currentLabel.getAuditProperty('aiGenerated'));
  }

  /**
   * Sets the panorama. Tries the primary viewer first; falls back to Pannellum if there's a backup image available.
   * @param {string} panoId The ID for the panorama that we want to move to.
   * @param {{object}|null} backupImage Self-hosted pano data from the backend, or null.
   * @returns {Promise<PanoData|undefined>}
   */
  async setPanorama(panoId, backupImage = null) {
    this.setProperty('panoLoaded', false);

    // Try the primary viewer first.
    try {
      const panoData = await this.#primaryViewer.setPano(panoId);
      this.#teardownPannellum();
      this.#setPanoCallback(panoData);
      this.setProperty('panoLoaded', true);
      svv.tracker.push('PanoId_Changed');
      return panoData;
    } catch {
      // Primary viewer failed — try Pannellum if we have local pano data.
      if (backupImage) {
        try {
          const panoData = await this.#showPannellumPano(backupImage);
          this.#setPanoCallback(panoData);
          this.setProperty('panoLoaded', true);
          svv.tracker.push('PanoId_Changed');
          return panoData;
        } catch (err) {
          console.error('PannellumViewer failed to load for Validate:', err);
        }
      }
    }

    // Both viewers failed; pano remains in broken state.
    this.setProperty('panoLoaded', false);
  }

  /**
   * Shows the primary viewer canvas and hides the Pannellum canvas; resets svv.panoViewer to the primary viewer.
   * @private
   */
  #teardownPannellum() {
    this.#pannellumCanvas.style.display = 'none';
    this.#panoCanvas.style.display = '';
    svv.panoViewer = this.#primaryViewer;
    svv.panoViewer.resize();
    svv.tracker.push('Viewer_Primary');
    this.#logo.showPrimaryLogo();
  }

  /**
   * Shows the Pannellum viewer for the given pano. On the first call, creates a PannellumViewer; on subsequent
   * calls, reuses it via loadPano() to avoid recreating the WebGL context. Sets svv.panoViewer to the Pannellum
   * viewer so the rest of the codebase (setPov, getPov, markers) uses the correct viewer.
   * @param {{object}} backupImage
   * @returns {Promise<PanoData>}
   * @private
   */
  async #showPannellumPano(backupImage) {
    this.#panoCanvas.style.display = 'none';
    this.#pannellumCanvas.style.display = '';

    // Use a neutral POV here; renderPanoMarker will setPov to the correct heading immediately after.
    const neutralPov = { heading: backupImage.cameraHeading || 0, pitch: 0, zoom: 1 };

    if (this.#pannellumViewer) {
      await this.#pannellumViewer.loadPano(backupImage.panoId, backupImage, neutralPov);
    } else {
      this.#pannellumViewer = await PannellumViewer.create(this.#pannellumCanvas, {
        panoMetadata: backupImage,
        startPanoId: backupImage.panoId,
        startHeading: neutralPov.heading,
        startPitch: neutralPov.pitch,
        startZoom: neutralPov.zoom,
      });
    }
    svv.panoViewer = this.#pannellumViewer;
    svv.tracker.push('Viewer_Pannellum');
    this.#logo.showSourceLogo();
    return svv.panoViewer.currPanoData;
  }

  /**
   * Adds or removes the AI badge on the validation marker.
   * @param showIndicator  True to show the AI badge, false to remove it.
   * @private
   */
  #updateMarkerAiIndicator(showIndicator) {
    const markerEl = this.labelMarker.marker_;
    let existingIndicator = markerEl.querySelector('.ai-icon-marker-validate');

    if (showIndicator) {
      if (!existingIndicator) {
        existingIndicator = AiLabelIndicator(['ai-icon-marker-validate']);
        markerEl.appendChild(existingIndicator);
        const $indicator = ensureAiTooltip(existingIndicator);
        // Namespace and clear first: markerEl is reused across labels, so without removing the previous
        // indicator's handlers they'd accumulate (each closing over a now-detached indicator) and leak (#2745).
        $(markerEl).off('mouseenter.aiIndicator mouseleave.aiIndicator')
          .on('mouseenter.aiIndicator', () => $indicator.tooltip('show'))
          .on('mouseleave.aiIndicator', () => $indicator.tooltip('hide'));
      }
    } else if (existingIndicator) {
      $(markerEl).off('mouseenter.aiIndicator mouseleave.aiIndicator');
      $(existingIndicator).tooltip('destroy');
      existingIndicator.remove();
    }
  }

  /**
   * Resizes the label marker to match the given UI scale factor.
   * @param {number} scale The current UI scale factor (see util.applyToolScale).
   */
  setMarkerScale(scale) {
    if (!this.labelMarker) return;
    const markerDiameter = Math.round((svv.labelRadius * 2 + 2) * scale);
    this.labelMarker.setSize({ width: markerDiameter, height: markerDiameter });
  }

  /**
   * Sets the zoom level for this panorama.
   * @param zoom  Desired zoom level for this panorama. In general, values in {1.1, 2.1, 3.1}
   * @returns {void}
   */
  setZoom(zoom) {
    const currPov = svv.panoViewer.getPov();
    currPov.zoom = zoom;
    svv.panoViewer.setPov(currPov);
  }

  /**
   * Sets the size of the panorama and panorama holder depending on the size of the mobile phone.
   * @private
   */
  #sizePano() {
    const panoHolderElem = document.getElementById('svv-panorama-holder');
    const controlLayerElem = document.getElementById('view-control-layer');
    const heightOffset = panoHolderElem.getBoundingClientRect().top;
    const h = window.innerHeight - heightOffset;
    const w = window.innerWidth;
    const left = 0;
    this.#panoCanvas.style.height = `${h}px`;
    this.#pannellumCanvas.style.height = `${h}px`;
    panoHolderElem.style.height = `${h}px`;
    controlLayerElem.style.height = `${h}px`;
    this.#panoCanvas.style.width = `${w}px`;
    this.#pannellumCanvas.style.width = `${w}px`;
    panoHolderElem.style.width = `${w}px`;
    controlLayerElem.style.width = `${w}px`;
    this.#panoCanvas.style.left = `${left}px`;
    panoHolderElem.style.left = `${left}px`;
    controlLayerElem.style.left = `${left}px`;
  }

  /**
   * Factory function that sets up the panorama viewer.
   * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize
   * @param {string} viewerAccessToken An access token used to request images for the pano viewer
   * @param {string} startPanoId The ID of the panorama to load first
   * @param {{object}|null} startBackupImage Self-hosted backup for the first pano, or null.
   * @returns {Promise<PanoManager>} The panoManager instance, with the first pano already loaded.
   */
  static async create(panoViewerType, viewerAccessToken, startPanoId, startBackupImage = null) {
    const newPanoManager = new PanoManager();
    await newPanoManager.#init(panoViewerType, viewerAccessToken, startPanoId, startBackupImage);
    return newPanoManager;
  }
}
