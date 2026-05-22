/**
 * PopupPanoManager wraps a PanoViewer for the label popup (LabelPopup.js). It manages init, pano-load + fallback image,
 * label markers, and POV calculations.
 *
 * TODO so much of this code is a copy of code that's elsewhere (SVLabel/SVValidate/Gallery PanoManagers).
 *
 * @param svHolder One single DOM element.
 * @param buttonHolder DOM element that holds the validation buttons.
 * @param admin Boolean value that indicates if the user is an admin.
 * @param {typeof PanoViewer} viewerType The type of pano viewer to initialize.
 * @param {string} viewerAccessToken An access token used to request images for the pano viewer.
 * @returns {{className: string}}
 * @constructor
 */
async function PopupPanoManager(svHolder, buttonHolder, admin, viewerType, viewerAccessToken) {
    const self = {
        className: "PopupPanoManager",
        label: undefined,
        labelMarkers: [],
        panoId: undefined,
        // panoViewer always points at the active viewer (primary or Pannellum). Callers should query it through this
        // field so that label markers, POV math, and screenshots all hit the right thing per-label.
        panoViewer: undefined,
        primaryViewer: undefined,    // Always the GSV/Mapillary/Infra3d viewer created at init time.
        pannellumViewer: undefined,  // Only constructed when an expired pano with a self-hosted image is shown.
        activeViewerName: '',        // 'Default' (primary viewer), 'Pannellum', 'StaticApi', or 'StaticCrop'.
        admin: admin
    };

    const icons = {
        CurbRamp : '/assets/images/icons/AdminTool_CurbRamp.png',
        NoCurbRamp : '/assets/images/icons/AdminTool_NoCurbRamp.png',
        Obstacle : '/assets/images/icons/AdminTool_Obstacle.png',
        SurfaceProblem : '/assets/images/icons/AdminTool_SurfaceProblem.png',
        Other : '/assets/images/icons/AdminTool_Other.png',
        Occlusion : '/assets/images/icons/AdminTool_Occlusion.png',
        NoSidewalk : '/assets/images/icons/AdminTool_NoSidewalk.png',
        Crosswalk : '/assets/images/icons/AdminTool_Crosswalk.png',
        Signal : '/assets/images/icons/AdminTool_Signal.png'
    };

    /**
     * This function initializes the Panorama
     */
    async function _init() {
        self.buttonHolder = $(buttonHolder);
        self.svHolder = $(svHolder);
        self.svHolder.addClass("admin-panorama");

        // svHolder's children are absolutely aligned, svHolder's position has to be either absolute or relative
        if (self.svHolder.css('position') !== "absolute" && self.svHolder.css('position') !== "relative")
            self.svHolder.css('position', 'relative');

        // Panorama will be added to panoCanvas. Use 100%/100% so the viewer fills the CSS-driven container
        // rather than locking in whatever pixel dimensions the element happened to measure at init time.
        self.panoCanvas = $("<div id='pano'>").css({
            width: '100%',
            height: '100%'
        })[0];

        // Separate container for the Pannellum fallback viewer. Created up-front but only mounted with a Pannellum
        // instance when we hit an expired pano that has a self-hosted copy.
        self.pannellumCanvas = $("<div id='pano-pannellum'>").css({
            width: '100%',
            height: '100%',
            display: 'none'
        })[0];

        self.panoNotAvailable = $(`<div id='pano-not-avail'>${i18next.t('common:errors.title')}</div>`).css({
            'font-size': '200%',
            'padding-bottom': '15px'
        })[0];

        self.panoNotAvailableDetails =
            $(`<div id='pano-not-avail-2'>${i18next.t('common:errors.explanation')}</div>`).css({
            'font-size': '85%',
            'padding-bottom': '15px'
        })[0];

        self.panoNotAvailableAuditSuggestion =
            $(`<div id="pano-not-avail-audit"><a id="explore-street">${i18next.t('common:errors.explore-street')}</div>`).css({
            'font-size': '85%',
            'padding-bottom': '15px'
        })[0];

        self.fallbackContainer = $('<div id="pano-fallback-container">').css({
            position: 'relative',
            width: '100%',
            height: '100%',
            display: 'none',
            overflow: 'hidden'
        })[0];
        // The panzoom target — wraps the image. The marker stays OUTSIDE this wrapper so it doesn't scale
        // with the image; instead we reposition it manually whenever panzoom emits a transform event.
        self.fallbackPanzoomWrap = $('<div id="pano-fallback-pz">').css({
            width: '100%',
            height: '100%',
            cursor: 'grab'
        })[0];
        self.fallbackImage = $('<img id="pano-fallback-image">').css({
            width: '100%',
            height: '100%',
            'object-fit': 'cover',
            'user-select': 'none',
            '-webkit-user-drag': 'none',
            'pointer-events': 'none'
        })[0];
        self.fallbackMarker = $('<img id="pano-fallback-marker">').addClass('icon-outline').css({
            position: 'absolute',
            width: '20px',
            height: '20px',
            transform: 'translate(-50%, -50%)',
            display: 'none',
            'pointer-events': 'none'
        })[0];
        $(self.fallbackPanzoomWrap).append(self.fallbackImage);
        $(self.fallbackContainer).append(self.fallbackPanzoomWrap, self.fallbackMarker);

        self.svHolder.append($(self.panoCanvas));
        self.svHolder.append($(self.pannellumCanvas));
        self.svHolder.append($(self.fallbackContainer));
        self.svHolder.append($(self.panoNotAvailable));
        self.svHolder.append($(self.panoNotAvailableDetails));
        self.svHolder.append($(self.panoNotAvailableAuditSuggestion));

        // Initialize panzoom on the wrapper.
        self.fallbackPanzoom = panzoom(self.fallbackPanzoomWrap, {
            minZoom: 1,
            maxZoom: 8,
            bounds: true,
            boundsPadding: 1,
            zoomDoubleClickSpeed: 1, // Disables double-click zoom (it would conflict with the dialog UI).
            disableKeyboardInteraction: true
        });
        self.fallbackPanzoom.on('transform', _updateFallbackMarkerPosition);

        // Load the primary pano viewer (GSV/Mapillary/Infra3d).
        const panoOptions = {
            accessToken: viewerAccessToken,
            scrollwheel: true,
            defaultNavigation: !!admin // Only allow navigation on admin version, not on normal LabelMap.
        };
        self.primaryViewer = await viewerType.create(self.panoCanvas, panoOptions);
        self.panoViewer = self.primaryViewer;

        self.logo = createPanoViewerLogo(self.svHolder[0], viewerType);
        self.logo.showPrimaryLogo();

        self.primaryViewer.addListener('pano_changed', () => {
            // Only show the label if we're looking at the correct pano.
            for (let marker of self.labelMarkers) {
                if (marker.panoId === self.primaryViewer.getPanoId()) {
                    marker.marker.setVisible(true);
                } else {
                    marker.marker.setVisible(false);
                }
            }
        });

        return this;
    }

    /**
     * Clears all labels from the panorama.
     */
    function clearLabels() {
        for (const marker of self.labelMarkers) {
            marker.marker.removeMarker();
        }
        self.labelMarkers = [];
    }

    /**
     * Fetches backup image metadata from the backend for Pannellum fallback. Returns null if none exists.
     * @param {string} panoId
     * @returns {Promise<{url: string, metadata: object}|null>}
     * @private
     */
    async function _fetchBackupImageMetadata(panoId) {
        try {
            const res = await fetch(`/backupImage/${encodeURIComponent(panoId)}/metadata`);
            return res.ok ? await res.json() : null;
        } catch (_) {
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
     * @param panoId
     * @param {{heading: number, pitch: number, zoom: number}} pov
     * @param {string|null} cropUrl URL for the screenshot fallback image, if available.
     * @param {boolean} expired Whether the primary imagery is known to be expired — when true, skips the live attempt.
     * @param {{url: string, metadata: object}|null} backupImage Self-hosted pano metadata for this pano.
     *      If null, fetched lazily from /backupImage/:panoId/metadata when the primary viewer fails.
     */
    async function setPano(panoId, pov, cropUrl, expired = false, backupImage = null) {
        self.cropUrl = typeof cropUrl === 'string' ? cropUrl : null;
        self.svHolder.css('visibility', 'hidden'); // Hide until we've finished rendering.
        // Reset fallback zoom/pan so a previous label's manipulation doesn't leak into this one.
        _resetFallbackTransform();

        // Step 1: try the live primary viewer, unless we already know the imagery is gone.
        if (!expired) {
            try {
                await self.primaryViewer.setPano(panoId);
                _teardownPannellum();
                self.activeViewerName = 'Default';
                await _panoSuccessCallback(pov);
                if (!self.svHolder[0].dataset.closedDuringLoad) self.svHolder.css('visibility', 'visible');
                return true;
            } catch (_) {
                // Primary viewer failed — lazy-fetch backup metadata if caller didn't pre-supply it.
                if (!backupImage) backupImage = await _fetchBackupImageMetadata(panoId);
            }
        } else if (!backupImage) {
            // Already known expired and no backup pre-supplied — fetch now before trying Pannellum.
            backupImage = await _fetchBackupImageMetadata(panoId);
        }

        // Step 2: try the self-hosted Pannellum copy if we have its metadata.
        if (backupImage) {
            try {
                await _showPannellumPano(backupImage, pov);
                self.activeViewerName = 'Pannellum';
                if (!self.svHolder[0].dataset.closedDuringLoad) self.svHolder.css('visibility', 'visible');
                return true;
            } catch (err) {
                console.error('PannellumViewer failed to load; falling back to crop:', err);
                _teardownPannellum();
            }
        } else {
            _teardownPannellum();
        }

        // Step 3 & 4: hand off to the existing failure callback, which shows the crop if cropUrl is set
        // and a generic "imagery not available" message otherwise.
        self.activeViewerName = 'StaticCrop';
        await _panoFailureCallback();
        if (!self.svHolder[0].dataset.closedDuringLoad) self.svHolder.css('visibility', 'visible');
        return false;
    }

    /**
     * Hides the Pannellum canvas and points self.panoViewer back at the primary viewer.
     */
    function _teardownPannellum() {
        $(self.pannellumCanvas).css('display', 'none');
        self.panoViewer = self.primaryViewer;
        if (self.logo) self.logo.showPrimaryLogo();
    }

    /**
     * Shows the Pannellum viewer for the given pano. Creates the viewer on the first call, then reused on later calls.
     *
     * @param {{url: string, metadata: object}} backupImage
     * @param {{heading: number, pitch: number, zoom: number}} pov
     * @private
     */
    async function _showPannellumPano(backupImage, pov) {
        // Hide primary canvas, fallback image, and any error messages.
        $(self.panoCanvas).css('display', 'none');
        $(self.fallbackContainer).css('display', 'none');
        $(self.panoNotAvailable).css('display', 'none');
        $(self.panoNotAvailableDetails).css('display', 'none');
        $(self.panoNotAvailableAuditSuggestion).css('display', 'none');
        $(self.buttonHolder).css('display', '');
        $(self.pannellumCanvas).css('display', 'block');

        if (self.pannellumViewer) {
            await self.pannellumViewer.loadPano(backupImage.metadata.panoId, backupImage.metadata, pov);
        } else {
            self.pannellumViewer = await PannellumViewer.create(self.pannellumCanvas, {
                panoMetadata: backupImage.metadata,
                startPanoId: backupImage.metadata.panoId,
                startHeading: pov.heading,
                startPitch: pov.pitch,
                startZoom: pov.zoom
            });
        }
        self.panoViewer = self.pannellumViewer;
        if (self.logo) self.logo.showSourceLogo();

        if (self.label) renderLabel(self.label);
    }

    /**
     * Refreshes all views for the new pano and saves historic pano metadata.
     * @param {{heading: number, pitch: number, zoom: number}} targetPov The desired pov to set for the pano
     * @returns {Promise<void>} A Promise that resolves once the pano and label have rendered
     * @private
     */
    async function _panoSuccessCallback(targetPov) {
        // Show the pano, hide the fallback image and error messages.
        $(self.panoCanvas).css('display', 'block');
        $(self.fallbackContainer).css('display', 'none');
        $(self.panoNotAvailable).css('display', 'none');
        $(self.panoNotAvailableDetails).css('display', 'none');
        $(self.panoNotAvailableAuditSuggestion).css('display', 'none');
        $(self.buttonHolder).css('display', '');

        // There is a bug that can sometimes cause Google's panos to go black when you load a new one. We can deal with
        // it by triggering a resize event after a short delay. This seems to only be an issue with the label popup, not
        // with Explore/Gallery/Validate. Probably because of how we show/hide the popup.
        return new Promise((resolve) => {
            setTimeout(() => {
                self.panoViewer.resize();
                self.panoViewer.setPov(targetPov);
                if (self.label) renderLabel(self.label);
                resolve();
            }, 250);
        });
    }

    /**
     * Shows an error message if the pano fails to load.
     * @param error
     * @returns {Promise<void>}
     * @private
     */
    async function _panoFailureCallback(error) {
        $(self.panoCanvas).css('display', 'none');
        if (self.cropUrl) {
            // Show the screenshot as a fallback instead of the error message.
            $(self.fallbackImage).attr('src', self.cropUrl);
            $(self.fallbackContainer).css('display', 'block');
            // Position the label icon on the fallback image.
            if (self.label && icons[self.label.label_type]) {
                $(self.fallbackMarker).attr('src', icons[self.label.label_type]).css('display', 'block');
                _updateFallbackMarkerPosition();
            } else {
                $(self.fallbackMarker).css('display', 'none');
            }
            $(self.panoNotAvailable).css('display', 'none');
            $(self.panoNotAvailableDetails).css('display', 'none');
            $(self.panoNotAvailableAuditSuggestion).css('display', 'none');
            $(self.buttonHolder).css('display', '');
        } else {
            $(self.svHolder).css('height', '');
            $(self.fallbackContainer).css('display', 'none');
            $(self.panoNotAvailable).text(i18next.t("common:errors.title"));
            $(self.panoNotAvailable).css('display', 'block');
            $(self.panoNotAvailableDetails).css('display', 'block');
            if (self.label) $("#explore-street").attr('href', '/explore?streetEdgeId=' + self.label['streetEdgeId']);
            $(self.panoNotAvailableAuditSuggestion).css('display', 'block');
            $(self.buttonHolder).css('display', 'none');
        }
        return Promise.resolve();
    }

    function setLabel(label) {
        self.label = label;
    }

    /**
     * Resets the fallback image's zoom/pan back to the identity transform.
     * @private
     */
    function _resetFallbackTransform() {
        if (!self.fallbackPanzoom) return;
        self.fallbackPanzoom.zoomAbs(0, 0, 1);
        self.fallbackPanzoom.moveTo(0, 0);
    }

    /**
     * Reposition the fallback marker to track the current panzoom transform of the fallback image.
     * @private
     */
    function _updateFallbackMarkerPosition() {
        if (!self.label || !self.fallbackPanzoom) return;
        if (self.fallbackMarker.style.display === 'none') return;

        const W = self.fallbackContainer.clientWidth;
        const H = self.fallbackContainer.clientHeight;
        if (W === 0 || H === 0) return;

        const t = self.fallbackPanzoom.getTransform();
        const fracX = self.label.canvasX / self.label.originalCanvasWidth;
        const fracY = self.label.canvasY / self.label.originalCanvasHeight;
        self.fallbackMarker.style.left = (t.x + fracX * W * t.scale) + 'px';
        self.fallbackMarker.style.top  = (t.y + fracY * H * t.scale) + 'px';
    }

    /**
     * Renders a PanoMarker (label) onto a Streetview Panorama.
     * @param {object} label Plain-object label shape produced by LabelPopup / Admin.Task / Admin.CommentPopup.
     *   Expected fields: labelId, label_type, canvasX, canvasY, originalCanvasWidth, originalCanvasHeight, pov,
     *   streetEdgeId, oldSeverity, newSeverity, oldTags, newTags, aiGenerated.
     * @returns void
     */
    function renderLabel(label) {
        const pos = util.pano.canvasCoordToCenteredPov(
            label.pov, label.canvasX, label.canvasY, label.originalCanvasWidth, label.originalCanvasHeight
        );
        // Mount the marker inside whichever canvas is currently visible so it sits over the right viewer.
        const activeCanvas = self.panoViewer === self.pannellumViewer ? self.pannellumCanvas : self.panoCanvas;
        const panoMarker = new PanoMarker({
            markerContainer: activeCanvas,
            panoViewer: self.panoViewer,
            position: { heading: pos.heading, pitch: pos.pitch },
            icon: icons[label['label_type']],
            size: { width: 20, height: 20 }
        });
        self.labelMarkers.push({
            panoId: self.panoViewer.getPanoId(),
            marker: panoMarker
        });
        if (label.aiGenerated) attachAiIndicatorToMarker(panoMarker);
    }

    function attachAiIndicatorToMarker(panoMarker) {
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
    function getOriginalPosition() {
        return util.pano.canvasCoordToCenteredPov(self.label.pov, self.label.canvasX, self.label.canvasY,
            self.label.originalCanvasWidth, self.label.originalCanvasHeight);
    }

    /**
     * Returns the pov of the viewer.
     * @returns {{heading: float, pitch: float, zoom: float}}
     */
    function getPov() {
        let pov = self.panoViewer.getPov();

        // Adjust heading to be between 0 and 360.
        while (pov.heading < 0) pov.heading += 360;
        while (pov.heading > 360) pov.heading -= 360;

        return pov;
    }

    await _init();

    self.setPano = setPano;
    self.setLabel = setLabel;
    self.renderLabel = renderLabel;
    self.getOriginalPosition = getOriginalPosition;
    self.getPov = getPov;
    self.clearLabels= clearLabels;

    return self;
}
