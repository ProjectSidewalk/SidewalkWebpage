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
  // The GSV/Mapillary/Infra3d viewer. Built on the first setPano() that needs it, not at init (#5128): Google bills
  // every StreetViewPanorama constructed, visible or not, and most visits to a hosting page never open a label.
  #primaryViewer = undefined;
  #primaryViewerCreation = null; // In-flight #ensureViewer() promise, so concurrent setPano() calls share one build.
  #pannellumViewer = undefined;  // Only constructed when an expired pano with a self-hosted image is shown.
  #panoCanvas;
  #pannellumCanvas;
  #panoNotAvailable;
  #fallbackContainer;
  #fallbackPanzoomWrap;
  #fallbackImage;
  #fallbackMarker;
  #fallbackPanzoom;
  #logo;
  #cropUrl;
  #labelsHidden = false;

  /**
   * A label type's canonical marker icon, from util.misc's central label-type registry.
   * @param {string} labelType
   * @returns {?string} The icon URL, or null for types without one.
   */
  #iconFor(labelType) {
    return util.misc.getIconImagePaths(labelType)?.iconImagePath ?? null;
  }

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
   * Builds a PopupPanoManager and its DOM. The pano viewer itself is created by the first setPano() (#5128).
   *
   * @param {Element} svHolder - One single DOM element.
   * @param {Element} buttonHolder - DOM element that holds the validation buttons.
   * @param {boolean} admin
   * @param {typeof PanoViewer} viewerType
   * @param {string} viewerAccessToken
   * @returns {Promise<PopupPanoManager>}
   */
  static create(svHolder, buttonHolder, admin, viewerType, viewerAccessToken) {
    const manager = new PopupPanoManager(admin, viewerType, viewerAccessToken);
    manager.#init(svHolder, buttonHolder);
    // A promise, matching the provider viewers' create() factories that hosts await the same way.
    return Promise.resolve(manager);
  }

  /**
   * Builds the pano canvas, the fallback viewers' DOM, and the provider logo, and schedules the free part of the
   * viewer's load. Nothing here talks to the imagery provider.
   * @param {Element} svHolder
   * @param {Element} buttonHolder
   */
  #init(svHolder, buttonHolder) {
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

    // No-imagery / expired-label panel (#4483): a branded logo, one concise line, and a button CTA. Absolutely fills
    // svHolder (kept position:relative above) and centers its content; styled via .pano-not-avail in label-detail.css.
    this.#panoNotAvailable = $(`<div id="pano-not-avail" class="pano-not-avail">
        <img class="pano-not-avail__logo" alt=""
             src="${util.assetPath('images/logos/ProjectSidewalkLogo_NoText_WheelchairCircleCentered_100x100.png')}">
        <p class="pano-not-avail__msg">${i18next.t('common:errors.title')}</p>
        <a id="explore-street" class="pano-not-avail__cta"
           href="#">${i18next.t('common:errors.explore-street')}<span aria-hidden="true">→</span></a>
      </div>`)[0];

    this.#fallbackContainer = $('<div id="pano-fallback-container">').css({
      position: 'relative',
      width: '100%',
      height: '100%',
      display: 'none',
      overflow: 'hidden',
    })[0];
    // The panzoom target — wraps the image. The marker stays OUTSIDE this wrapper so it doesn't scale
    // with the image; instead we reposition it manually whenever panzoom emits a transform event.
    // Cursor comes from CSS (#pano-fallback-pz grab/grabbing) — an inline cursor here would override the
    // :active grabbing state.
    this.#fallbackPanzoomWrap = $('<div id="pano-fallback-pz">').css({
      width: '100%',
      height: '100%',
    })[0];
    this.#fallbackImage = $('<img id="pano-fallback-image">').css({
      'width': '100%',
      'height': '100%',
      'object-fit': 'cover',
      'user-select': 'none',
      'pointer-events': 'none',
    })[0];
    // A div, not an img, so it wears the shared .label-marker styles — including the hidden state, which fades an
    // icon drawn by ::before and so can't reach into an <img> (#2477).
    this.#fallbackMarker = $('<div id="pano-fallback-marker">').addClass('icon-outline label-marker').css({
      'position': 'absolute',
      'width': '28px',
      'height': '28px',
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

    this.#logo = createPanoViewerLogo(this.svHolder[0], this.#viewerType);
    this.#logo.showPrimaryLogo();

    // Pre-pay the viewer library's download (free) so the first open only pays for the viewer itself. Idle-timed so
    // it never competes with the host page's own load; a failure here just means the first open downloads it.
    util.afterLoadIdle(() => {
      this.#viewerType.preloadLibrary().catch((err) => console.warn('Pano viewer library preload failed:', err));
    });
  }

  /**
   * Returns the primary viewer, building it on the first call. Concurrent callers share the one in-flight build;
   * a failed build is forgotten so the next label tries again rather than leaving the popup imagery-less for the
   * rest of the page's life (a transient quota or network error shouldn't be permanent).
   *
   * Only called from setPano(), which every host reaches after it has shown the popup, so the canvas is laid out —
   * Mapillary measures its container at init and needs that.
   *
   * @returns {Promise<PanoViewer>} The primary viewer.
   */
  #ensureViewer() {
    if (this.#primaryViewer) return Promise.resolve(this.#primaryViewer);
    if (!this.#primaryViewerCreation) {
      const panoOptions = {
        accessToken: this.#viewerAccessToken,
        scrollwheel: true,
        defaultNavigation: !!this.#admin, // Only allow navigation on admin version, not on normal LabelMap.
      };
      this.#primaryViewerCreation = this.#viewerType.create(this.#panoCanvas, panoOptions)
        .then((viewer) => {
          this.#primaryViewer = viewer;
          this.panoViewer = viewer;
          viewer.addListener('pano_changed', () => {
            // Only show the label if we're looking at the correct pano.
            for (const marker of this.#labelMarkers) {
              marker.marker.setVisible(marker.panoId === viewer.getPanoId());
            }
          });
          return viewer;
        })
        .finally(() => {
          this.#primaryViewerCreation = null;
        });
    }
    return this.#primaryViewerCreation;
  }

  /**
   * Starts building the primary viewer now, if it doesn't exist yet, so that work overlaps the label's metadata
   * fetch instead of queueing behind it. Call once the host has shown the popup and knows a label is coming: this is
   * the billable step, so it must not run for a visitor who merely loaded the page. Never rejects — setPano() makes
   * the real attempt and owns the fallback.
   */
  warmUp() {
    this.#ensureViewer().catch(() => {});
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
   * @returns {Promise<boolean>} Whether a viewable image of the label was shown — live/Pannellum imagery or the
   *                             static crop (step 1–3). Only `false` for step 4, the "imagery not available" panel.
   */
  async setPano(panoId, pov, cropUrl, expired = false, backupImage = null) {
    this.#cropUrl = typeof cropUrl === 'string' ? cropUrl : null;
    this.svHolder.css('visibility', 'hidden'); // Hide until we've finished rendering.
    // Reset fallback zoom/pan so a previous label's manipulation doesn't leak into this one.
    this.#resetFallbackTransform();

    // Step 1: try the live primary viewer, unless we already know the imagery is gone. Building the viewer is part
    // of the attempt: if the provider can't even initialize, the label still gets its backup/crop.
    if (!expired) {
      try {
        const primaryViewer = await this.#ensureViewer();
        await primaryViewer.setPano(panoId);
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
    // and a generic "imagery not available" message otherwise. Its return distinguishes those two outcomes.
    this.activeViewerName = 'StaticCrop';
    const cropShown = await this.#panoFailureCallback();
    if (!this.svHolder[0].dataset.closedDuringLoad) this.svHolder.css('visibility', 'visible');
    return cropShown;
  }

  /**
   * Hides the Pannellum canvas and points panoViewer back at the primary viewer (undefined until the first live
   * pano has built it).
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
   * @returns {Promise<boolean>} Whether the crop fallback was shown (false only when no imagery is available at all).
   */
  #panoFailureCallback() {
    $(this.#panoCanvas).css('display', 'none');
    if (this.#cropUrl) {
      // Show the screenshot as a fallback instead of the error message.
      $(this.#fallbackImage).attr('src', this.#cropUrl);
      $(this.#fallbackContainer).css('display', 'block');
      // Position the label icon on the fallback image.
      const fallbackIcon = this.label && this.#iconFor(this.label.label_type);
      if (fallbackIcon) {
        this.#fallbackMarker.style.setProperty('--label-icon', `url(${fallbackIcon})`);
        this.#fallbackMarker.style.setProperty('--label-color', util.misc.getLabelColors(this.label.label_type));
        $(this.#fallbackMarker).css('display', 'block');
        this.#updateFallbackMarkerPosition();
      } else {
        $(this.#fallbackMarker).css('display', 'none');
      }
      $(this.#panoNotAvailable).css('display', 'none');
      this.#buttonHolder.css('display', '');
    } else {
      // Clear any inline height the failed viewer left on svHolder so its CSS (aspect-ratio) height returns; the
      // absolute-positioned .pano-not-avail panel fills that box.
      this.svHolder.css('height', '');
      $(this.#fallbackContainer).css('display', 'none');
      // Same reason as LabelDetail's "Explore here": /explore bounces mobile visitors, so the CTA goes away
      // rather than promising a destination this device can't reach.
      const exploreStreet = $('#explore-street');
      exploreStreet.prop('hidden', util.isMobile());
      if (this.label) exploreStreet.attr('href', `/explore?streetEdgeId=${this.label.streetEdgeId}`);
      $(this.#panoNotAvailable).css('display', 'flex');
      this.#buttonHolder.css('display', 'none');
    }
    return Promise.resolve(Boolean(this.#cropUrl));
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
   * @param {Object} label - Plain-object label shape produced by LabelPopup.
   *   Expected fields: labelId, label_type, canvasX, canvasY, originalCanvasWidth, originalCanvasHeight, pov,
   *   streetEdgeId, aiGenerated.
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
      icon: this.#iconFor(label.label_type),
      size: { width: 28, height: 28 },
    });
    // Halo pulse draws the eye to the (small, often low-contrast) marker when the card opens. A marker is built
    // fresh per render, so the class plays once on a new element and needs no restart.
    panoMarker.marker_.classList.add('label-detail__marker', 'label-marker-pulse');
    // The colour the ring takes once the label is hidden.
    panoMarker.marker_.style.setProperty('--label-color', util.misc.getLabelColors(label.label_type));
    panoMarker.marker_.classList.toggle(LabelVisibilityToggle.HIDDEN_CLASS, this.#labelsHidden);
    this.#labelMarkers.push({
      panoId: this.panoViewer.getPanoId(),
      marker: panoMarker,
    });
    if (label.aiGenerated) this.#attachAiIndicatorToMarker(panoMarker);
  }

  /**
   * Hides or shows the label markers on both views — the pano's and the crop fallback's. The state is remembered
   * because a marker is rebuilt per label, and hiding is meant to carry to the next one paged to (#2477).
   *
   * @param {boolean} hidden - Whether the markers should step aside.
   */
  setLabelsHidden(hidden) {
    this.#labelsHidden = hidden;
    const markers = this.#labelMarkers.map((entry) => entry.marker.marker_).concat(this.#fallbackMarker);
    for (const marker of markers) marker.classList.toggle(LabelVisibilityToggle.HIDDEN_CLASS, hidden);
  }

  /**
   * Adds the AI-generated indicator (and its tooltip) to a marker if it doesn't already have one.
   * @param {PanoMarker} panoMarker
   */
  #attachAiIndicatorToMarker(panoMarker) {
    if (!panoMarker.marker_.querySelector('.admin-ai-icon-marker')) {
      const indicator = aiLabelIndicator(['admin-ai-icon-marker']);
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
   * @returns {?{heading: number, pitch: number, zoom: number}} Null while no viewer has been built (no label shown
   *     yet, or only crop/no-imagery labels so far).
   */
  getPov() {
    if (!this.panoViewer) return null;
    const pov = this.panoViewer.getPov();

    // Adjust heading to be between 0 and 360.
    while (pov.heading < 0) pov.heading += 360;
    while (pov.heading > 360) pov.heading -= 360;

    return pov;
  }
}
