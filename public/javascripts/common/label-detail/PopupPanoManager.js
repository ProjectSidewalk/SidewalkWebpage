/**
 * PopupPanoManager wraps a PanoViewer for the label popup (LabelPopup.js). It manages init, pano-load + fallback image,
 * label markers, and POV calculations.
 *
 * TODO so much of this code is a copy of code that's elsewhere (SVLabel/SVValidate/Gallery PanoManagers).
 */
class PopupPanoManager {
  // panoViewer always points at the active viewer (primary or Pannellum). Callers should query it through this
  // field so that label markers, POV math, and screenshots all hit the right thing per-label.
  panoViewer = undefined;
  label = undefined;
  activeViewerName = ''; // 'Default' (primary viewer), 'Pannellum', 'StaticApi', or 'StaticCrop'.
  svHolder; // jQuery-wrapped svHolder element.

  #admin;
  #viewerType;
  #viewerAccessToken;
  #buttonHolder;
  #labelMarkers = [];
  #primaryViewer = undefined;   // Always the GSV/Mapillary/Infra3d viewer created at init time.
  #pannellumViewer = undefined; // Only constructed when an expired pano with a self-hosted image is shown.
  #panoCanvas;
  #pannellumCanvas;
  #panoNotAvailable;
  #panoNotAvailableDetails;
  #panoNotAvailableAuditSuggestion;
  #fallbackContainer;
  #fallbackPanzoomWrap;
  #fallbackImage;
  #fallbackMarker;
  #fallbackPanzoom;
  #logo;
  #cropUrl;

  #icons = {
    CurbRamp: '/assets/images/icons/AdminTool_CurbRamp.png',
    NoCurbRamp: '/assets/images/icons/AdminTool_NoCurbRamp.png',
    Obstacle: '/assets/images/icons/AdminTool_Obstacle.png',
    SurfaceProblem: '/assets/images/icons/AdminTool_SurfaceProblem.png',
    Other: '/assets/images/icons/AdminTool_Other.png',
    Occlusion: '/assets/images/icons/AdminTool_Occlusion.png',
    NoSidewalk: '/assets/images/icons/AdminTool_NoSidewalk.png',
    Crosswalk: '/assets/images/icons/AdminTool_Crosswalk.png',
    Signal: '/assets/images/icons/AdminTool_Signal.png',
  };

  /**
   * @param {boolean} admin - Whether the user is an admin (enables pano navigation).
   * @param {typeof PanoViewer} viewerType - The type of pano viewer to initialize.
   * @param {string} viewerAccessToken - Access token for requesting pano viewer images.
   */
  constructor(admin, viewerType, viewerAccessToken) {
    this.#admin = admin;
    this.#viewerType = viewerType;
    this.#viewerAccessToken = viewerAccessToken;
  }

  /**
   * Builds a PopupPanoManager and initializes its pano viewer.
   *
   * Async because the pano viewer must be created before the manager is usable; a constructor cannot be async.
   *
   * @param {Element} svHolder - One single DOM element.
   * @param {Element} buttonHolder - DOM element that holds the validation buttons.
   * @param {boolean} admin
   * @param {typeof PanoViewer} viewerType
   * @param {string} viewerAccessToken
   * @returns {Promise<PopupPanoManager>}
   */
  static async create(svHolder, buttonHolder, admin, viewerType, viewerAccessToken) {
    const manager = new PopupPanoManager(admin, viewerType, viewerAccessToken);
    await manager.#init(svHolder, buttonHolder);
    return manager;
  }

  /**
   * Initializes the panorama and its fallback viewers.
   * @param {Element} svHolder
   * @param {Element} buttonHolder
   */
  async #init(svHolder, buttonHolder) {
    this.#buttonHolder = $(buttonHolder);
    this.svHolder = $(svHolder);
    this.svHolder.addClass('admin-panorama');

    // svHolder's children are absolutely aligned, svHolder's position has to be either absolute or relative
    if (this.svHolder.css('position') !== 'absolute' && this.svHolder.css('position') !== 'relative') {
      this.svHolder.css('position', 'relative');
    }

    // Panorama will be added to panoCanvas. Use 100%/100% so the viewer fills the CSS-driven container
    // rather than locking in whatever pixel dimensions the element happened to measure at init time.
    this.#panoCanvas = $('<div id=\'pano\'>').css({ width: '100%', height: '100%' })[0];

    // Separate container for the Pannellum fallback viewer. Created up-front but only mounted with a Pannellum
    // instance when we hit an expired pano that has a self-hosted copy.
    this.#pannellumCanvas = $('<div id=\'pano-pannellum\'>').css({ width: '100%', height: '100%', display: 'none' })[0];

    this.#panoNotAvailable = $(`<div id='pano-not-avail'>${i18next.t('common:errors.title')}</div>`).css({
      'font-size': '200%',
      'padding-bottom': '15px',
    })[0];

    this.#panoNotAvailableDetails
            = $(`<div id='pano-not-avail-2'>${i18next.t('common:errors.explanation')}</div>`).css({
        'font-size': '85%',
        'padding-bottom': '15px',
      })[0];

    this.#panoNotAvailableAuditSuggestion = $(
      `<div id="pano-not-avail-audit"><a id="explore-street">${i18next.t('common:errors.explore-street')}</div>`,
    ).css({
      'font-size': '85%',
      'padding-bottom': '15px',
    })[0];

    this.#fallbackContainer = $('<div id="pano-fallback-container">').css({
      position: 'relative',
      width: '100%',
      height: '100%',
      display: 'none',
      overflow: 'hidden',
    })[0];
    // The panzoom target — wraps the image. The marker stays OUTSIDE this wrapper so it doesn't scale
    // with the image; instead we reposition it manually whenever panzoom emits a transform event.
    this.#fallbackPanzoomWrap = $('<div id="pano-fallback-pz">').css({
      width: '100%',
      height: '100%',
      cursor: 'grab',
    })[0];
    this.#fallbackImage = $('<img id="pano-fallback-image">').css({
      'width': '100%',
      'height': '100%',
      'object-fit': 'cover',
      'user-select': 'none',
      'pointer-events': 'none',
    })[0];
    this.#fallbackMarker = $('<img id="pano-fallback-marker">').addClass('icon-outline').css({
      'position': 'absolute',
      'width': '20px',
      'height': '20px',
      'transform': 'translate(-50%, -50%)',
      'display': 'none',
      'pointer-events': 'none',
    })[0];
    $(this.#fallbackPanzoomWrap).append(this.#fallbackImage);
    $(this.#fallbackContainer).append(this.#fallbackPanzoomWrap, this.#fallbackMarker);

    this.svHolder.append($(this.#panoCanvas));
    this.svHolder.append($(this.#pannellumCanvas));
    this.svHolder.append($(this.#fallbackContainer));
    this.svHolder.append($(this.#panoNotAvailable));
    this.svHolder.append($(this.#panoNotAvailableDetails));
    this.svHolder.append($(this.#panoNotAvailableAuditSuggestion));

    // Initialize panzoom on the wrapper.
    this.#fallbackPanzoom = panzoom(this.#fallbackPanzoomWrap, {
      minZoom: 1,
      maxZoom: 8,
      bounds: true,
      boundsPadding: 1,
      zoomDoubleClickSpeed: 1, // Disables double-click zoom (it would conflict with the dialog UI).
      disableKeyboardInteraction: true,
    });
    this.#fallbackPanzoom.on('transform', () => this.#updateFallbackMarkerPosition());

    // Load the primary pano viewer (GSV/Mapillary/Infra3d).
    const panoOptions = {
      accessToken: this.#viewerAccessToken,
      scrollwheel: true,
      defaultNavigation: !!this.#admin, // Only allow navigation on admin version, not on normal LabelMap.
    };
    this.#primaryViewer = await this.#viewerType.create(this.#panoCanvas, panoOptions);
    this.panoViewer = this.#primaryViewer;

    this.#logo = createPanoViewerLogo(this.svHolder[0], this.#viewerType);
    this.#logo.showPrimaryLogo();

    this.#primaryViewer.addListener('pano_changed', () => {
      // Only show the label if we're looking at the correct pano.
      for (const marker of this.#labelMarkers) {
        if (marker.panoId === this.#primaryViewer.getPanoId()) {
          marker.marker.setVisible(true);
        } else {
          marker.marker.setVisible(false);
        }
      }
    });
  }

  /**
   * Clears all labels from the panorama.
   */
  clearLabels() {
    for (const marker of this.#labelMarkers) {
      marker.marker.removeMarker();
    }
    this.#labelMarkers = [];
  }

  /**
   * Fetches backup image metadata from the backend for Pannellum fallback.
   * @param {string} panoId
   * @returns {Promise<Object|null>} The metadata, or null if none exists.
   */
  async #fetchBackupImageMetadata(panoId) {
    try {
      const res = await fetch(`/backupImage/${encodeURIComponent(panoId)}/metadata`);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  /**
   * Sets the panorama ID and POV from label metadata. Fallback chain, in order of preference:
   *   1. Live primary viewer (GSV/Mapillary/Infra3d) — skipped if `expired` is set.
   *   2. Self-hosted Pannellum copy from /backupImage/:panoId — used when `backupImage` is provided.
   *   3. Static screenshot at `cropUrl`.
   *   4. "Imagery not available" error message.
   *
   * @param {string} panoId
   * @param {{heading: number, pitch: number, zoom: number}} pov
   * @param {?string} cropUrl - URL for the screenshot fallback image, if available.
   * @param {boolean} [expired=false] - When true, skips the live attempt (imagery known to be expired).
   * @param {?Object} [backupImage=null] - Self-hosted pano metadata; fetched lazily from the backend if null.
   * @returns {Promise<boolean>} Whether live/Pannellum imagery was shown (false if it fell back to a crop/error).
   */
  async setPano(panoId, pov, cropUrl, expired = false, backupImage = null) {
    this.#cropUrl = typeof cropUrl === 'string' ? cropUrl : null;
    this.svHolder.css('visibility', 'hidden'); // Hide until we've finished rendering.
    // Reset fallback zoom/pan so a previous label's manipulation doesn't leak into this one.
    this.#resetFallbackTransform();

    // Step 1: try the live primary viewer, unless we already know the imagery is gone.
    if (!expired) {
      try {
        await this.#primaryViewer.setPano(panoId);
        this.#teardownPannellum();
        this.activeViewerName = 'Default';
        await this.#panoSuccessCallback(pov);
        if (!this.svHolder[0].dataset.closedDuringLoad) this.svHolder.css('visibility', 'visible');
        return true;
      } catch {
        // Primary viewer failed — lazy-fetch backup metadata if caller didn't pre-supply it.
        if (!backupImage) backupImage = await this.#fetchBackupImageMetadata(panoId);
      }
    } else if (!backupImage) {
      // Already known expired and no backup pre-supplied — fetch now before trying Pannellum.
      backupImage = await this.#fetchBackupImageMetadata(panoId);
    }

    // Step 2: try the self-hosted Pannellum copy if we have its metadata.
    if (backupImage) {
      try {
        await this.#showPannellumPano(backupImage, pov);
        this.activeViewerName = 'Pannellum';
        if (!this.svHolder[0].dataset.closedDuringLoad) this.svHolder.css('visibility', 'visible');
        return true;
      } catch (err) {
        console.error('PannellumViewer failed to load; falling back to crop:', err);
        this.#teardownPannellum();
      }
    } else {
      this.#teardownPannellum();
    }

    // Step 3 & 4: hand off to the existing failure callback, which shows the crop if cropUrl is set
    // and a generic "imagery not available" message otherwise.
    this.activeViewerName = 'StaticCrop';
    await this.#panoFailureCallback();
    if (!this.svHolder[0].dataset.closedDuringLoad) this.svHolder.css('visibility', 'visible');
    return false;
  }

  /**
   * Hides the Pannellum canvas and points panoViewer back at the primary viewer.
   */
  #teardownPannellum() {
    $(this.#pannellumCanvas).css('display', 'none');
    this.panoViewer = this.#primaryViewer;
    if (this.#logo) this.#logo.showPrimaryLogo();
  }

  /**
   * Shows the Pannellum viewer for the given pano. Creates the viewer on the first call, then reused on later calls.
   *
   * @param {Object} backupImage
   * @param {{heading: number, pitch: number, zoom: number}} pov
   */
  async #showPannellumPano(backupImage, pov) {
    // Hide primary canvas, fallback image, and any error messages.
    $(this.#panoCanvas).css('display', 'none');
    $(this.#fallbackContainer).css('display', 'none');
    $(this.#panoNotAvailable).css('display', 'none');
    $(this.#panoNotAvailableDetails).css('display', 'none');
    $(this.#panoNotAvailableAuditSuggestion).css('display', 'none');
    this.#buttonHolder.css('display', '');
    $(this.#pannellumCanvas).css('display', 'block');

    if (this.#pannellumViewer) {
      await this.#pannellumViewer.loadPano(backupImage.panoId, backupImage, pov);
    } else {
      this.#pannellumViewer = await PannellumViewer.create(this.#pannellumCanvas, {
        panoMetadata: backupImage,
        startPanoId: backupImage.panoId,
        startHeading: pov.heading,
        startPitch: pov.pitch,
        startZoom: pov.zoom,
      });
    }
    this.panoViewer = this.#pannellumViewer;
    if (this.#logo) this.#logo.showSourceLogo();

    if (this.label) this.renderLabel(this.label);
  }

  /**
   * Refreshes all views for the new pano and saves historic pano metadata.
   * @param {{heading: number, pitch: number, zoom: number}} targetPov - The desired pov to set for the pano.
   * @returns {Promise<void>} Resolves once the pano and label have rendered.
   */
  async #panoSuccessCallback(targetPov) {
    // Show the pano, hide the fallback image and error messages.
    $(this.#panoCanvas).css('display', 'block');
    $(this.#fallbackContainer).css('display', 'none');
    $(this.#panoNotAvailable).css('display', 'none');
    $(this.#panoNotAvailableDetails).css('display', 'none');
    $(this.#panoNotAvailableAuditSuggestion).css('display', 'none');
    this.#buttonHolder.css('display', '');

    // There is a bug that can sometimes cause Google's panos to go black when you load a new one. We can deal with
    // it by triggering a resize event after a short delay. This seems to only be an issue with the label popup, not
    // with Explore/Gallery/Validate. Probably because of how we show/hide the popup.
    return await new Promise((resolve) => {
      setTimeout(() => {
        this.panoViewer.resize();
        this.panoViewer.setPov(targetPov);
        if (this.label) this.renderLabel(this.label);
        resolve();
      }, 250);
    });
  }

  /**
   * Shows an error message (or the crop fallback) if the pano fails to load.
   * @returns {Promise<void>}
   */
  #panoFailureCallback() {
    $(this.#panoCanvas).css('display', 'none');
    if (this.#cropUrl) {
      // Show the screenshot as a fallback instead of the error message.
      $(this.#fallbackImage).attr('src', this.#cropUrl);
      $(this.#fallbackContainer).css('display', 'block');
      // Position the label icon on the fallback image.
      if (this.label && this.#icons[this.label.label_type]) {
        $(this.#fallbackMarker).attr('src', this.#icons[this.label.label_type]).css('display', 'block');
        this.#updateFallbackMarkerPosition();
      } else {
        $(this.#fallbackMarker).css('display', 'none');
      }
      $(this.#panoNotAvailable).css('display', 'none');
      $(this.#panoNotAvailableDetails).css('display', 'none');
      $(this.#panoNotAvailableAuditSuggestion).css('display', 'none');
      this.#buttonHolder.css('display', '');
    } else {
      this.svHolder.css('height', '');
      $(this.#fallbackContainer).css('display', 'none');
      $(this.#panoNotAvailable).text(i18next.t('common:errors.title'));
      $(this.#panoNotAvailable).css('display', 'block');
      $(this.#panoNotAvailableDetails).css('display', 'block');
      if (this.label) $('#explore-street').attr('href', `/explore?streetEdgeId=${this.label.streetEdgeId}`);
      $(this.#panoNotAvailableAuditSuggestion).css('display', 'block');
      this.#buttonHolder.css('display', 'none');
    }
    return Promise.resolve();
  }

  /**
   * @param {Object} label - Plain-object label shape (see renderLabel).
   */
  setLabel(label) {
    this.label = label;
  }

  /**
   * Resets the fallback image's zoom/pan back to the identity transform.
   */
  #resetFallbackTransform() {
    if (!this.#fallbackPanzoom) return;
    this.#fallbackPanzoom.zoomAbs(0, 0, 1);
    this.#fallbackPanzoom.moveTo(0, 0);
  }

  /**
   * Repositions the fallback marker to track the current panzoom transform of the fallback image.
   */
  #updateFallbackMarkerPosition() {
    if (!this.label || !this.#fallbackPanzoom) return;
    if (this.#fallbackMarker.style.display === 'none') return;

    const W = this.#fallbackContainer.clientWidth;
    const H = this.#fallbackContainer.clientHeight;
    if (W === 0 || H === 0) return;

    const t = this.#fallbackPanzoom.getTransform();
    const fracX = this.label.canvasX / this.label.originalCanvasWidth;
    const fracY = this.label.canvasY / this.label.originalCanvasHeight;
    this.#fallbackMarker.style.left = `${t.x + fracX * W * t.scale}px`;
    this.#fallbackMarker.style.top = `${t.y + fracY * H * t.scale}px`;
  }

  /**
   * Renders a PanoMarker (label) onto a Streetview Panorama.
   * @param {Object} label - Plain-object label shape produced by LabelPopup / Admin.Task / Admin.CommentPopup.
   *   Expected fields: labelId, label_type, canvasX, canvasY, originalCanvasWidth, originalCanvasHeight, pov,
   *   streetEdgeId, oldSeverity, newSeverity, oldTags, newTags, aiGenerated.
   */
  renderLabel(label) {
    const pos = util.pano.canvasCoordToCenteredPov(
      label.pov, label.canvasX, label.canvasY, label.originalCanvasWidth, label.originalCanvasHeight,
    );
    // Mount the marker inside whichever canvas is currently visible so it sits over the right viewer.
    const activeCanvas = this.panoViewer === this.#pannellumViewer ? this.#pannellumCanvas : this.#panoCanvas;
    const panoMarker = new PanoMarker({
      markerContainer: activeCanvas,
      panoViewer: this.panoViewer,
      position: { heading: pos.heading, pitch: pos.pitch },
      icon: this.#icons[label.label_type],
      size: { width: 20, height: 20 },
    });
    this.#labelMarkers.push({
      panoId: this.panoViewer.getPanoId(),
      marker: panoMarker,
    });
    if (label.aiGenerated) this.#attachAiIndicatorToMarker(panoMarker);
  }

  /**
   * Adds the AI-generated indicator (and its tooltip) to a marker if it doesn't already have one.
   * @param {PanoMarker} panoMarker
   */
  #attachAiIndicatorToMarker(panoMarker) {
    if (!panoMarker.marker_.querySelector('.admin-ai-icon-marker')) {
      const indicator = AiLabelIndicator(['admin-ai-icon-marker']);
      panoMarker.marker_.appendChild(indicator);
      ensureAiTooltip(indicator);
    }
  }

  /**
   * Calculates heading & position for placing this Label onto the pano from the same POV when the label was placed.
   * @returns {{heading: number, pitch: number}}
   */
  getOriginalPosition() {
    return util.pano.canvasCoordToCenteredPov(this.label.pov, this.label.canvasX, this.label.canvasY,
      this.label.originalCanvasWidth, this.label.originalCanvasHeight);
  }

  /**
   * Returns the pov of the viewer.
   * @returns {{heading: number, pitch: number, zoom: number}}
   */
  getPov() {
    const pov = this.panoViewer.getPov();

    // Adjust heading to be between 0 and 360.
    while (pov.heading < 0) pov.heading += 360;
    while (pov.heading > 360) pov.heading -= 360;

    return pov;
  }
}
