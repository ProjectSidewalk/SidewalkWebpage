/**
 * Creates the PanoViewer and manages access to it, tracking metadata and drawing labels as PanoMarkers.
 */

import { svv } from '../svv.js';
import { PanoMarker } from '../../common/PanoMarker.js';
import { aiLabelIndicator } from '../../common/aiLabelIndicator.js';
import { GsvViewer } from '../../common/pano-viewer/GsvViewer.js';
import { MapillaryViewer } from '../../common/pano-viewer/MapillaryViewer.js';
import { PannellumViewer } from '../../common/pano-viewer/PannellumViewer.js';
import { createPanoAttribution } from '../../common/pano-viewer/PanoAttribution.js';
import { PanoLoadTimeoutError } from '../../common/pano-viewer/PanoLoadTimeoutError.js';
import { createPanoViewerLogo } from '../../common/pano-viewer/PanoViewerLogo.js';
import { util } from '../../common/utilities.js';
import { PanoViewer } from '../../common/pano-viewer/PanoViewer.js';
import '../../common/utilitiesSidewalk.js';
import '../util/throttle.js';
/** @typedef {import('../label/Label.js').Label} Label */
/** @typedef {import('../../common/pano-viewer/PanoData.js').PanoData} PanoData */

export class PanoManager {
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

  /** @type {boolean} Whether the primary viewer draws a pano before its load resolves (see PAINTS_DURING_LOAD). */
  #primaryPaintsDuringLoad = false;

  /**
   * True from a successful load on a PAINTS_DURING_LOAD primary until renderPanoMarker has aimed it at the label and
   * revealed it. Anything that takes the primary canvas down clears it, so a late reveal can't bring back a canvas
   * that has since been handed over or emptied.
   * @type {boolean}
   */
  #primaryRevealPending = false;

  /** @type {number} Counts setPanorama calls, so a reveal can tell whether a newer load has started since its own. */
  #loadSeq = 0;

  #bottomLinksClickable = false;
  #linksListener = null;

  /** @type {{showPrimaryLogo: Function, showSourceLogo: Function}} */
  #logo;

  /** The imagery-attribution pill, shown while the Pannellum fallback — Project Sidewalk's own copy — is up (#4865). */
  #attribution;

  // Throttle POV-change logging. Dragging the pano (especially via touch on mobile) fires `pov_changed`
  // continuously; logging every one floods the interaction buffer and forces the Tracker's 200-action mid-mission
  // flush every few validations (#2745). Log at most once per interval (with a trailing call so the final POV is
  // still recorded). The throttled logger is created in #init so it has one closure per PanoManager.
  static #POV_LOG_INTERVAL_MS = 500;
  #logPovChange;

  // The longest a reveal waits for its two animation frames, in ms. A background tab runs no animation frames, so an
  // uncapped wait would keep the tool locked, and anything awaiting the render, until the tab came back. Nothing is
  // painted in a hidden tab anyway, and the viewer already has the POV, so revealing on the timer shows nothing stale.
  // In a visible tab the two frames take about 33 ms and win.
  static #REVEAL_FRAME_CAP_MS = 100;

  /** @type {Set<PanoViewer>} Viewers already subscribed to by #watchViewerPov(). */
  #povWatchedViewers = new Set();

  /**
   * Initializes panoViewer on the validate page, without loading a pano.
   *
   * The first label's pano is loaded by the first setPanorama, like every other label's. Loading it here as well would
   * make the first label pay two load deadlines on a slow network, the first of them behind the page's loading overlay
   * with its failure type lost (#5581); setPanorama has the expired shortcut and the Pannellum fallback, and reports a
   * slow load as slow.
   *
   * @param {typeof PanoViewer} panoViewerType - The type of pano viewer to initialize
   * @param {string} viewerAccessToken - An access token used to request images for the pano viewer
   * @returns {Promise<void>} A Promise that resolves once the viewer exists
   */
  async #init(panoViewerType, viewerAccessToken) {
    // Create the primary viewer without a startPanoId so viewer construction never fails due to an expired pano.
    /** @type {Record<string, any>} */
    const panoOptions = {
      accessToken: viewerAccessToken,
      defaultNavigation: false,
      // Only PanoramaxViewer reads this (GSV hardcodes it off). ZoomControl owns the wheel over the pano, so the
      // viewer's own wheel zoom stays off; a touch screen sends no wheel events, so it needs no other value.
      scrollwheel: false,
      // Nothing in Validate follows a pano's links, and Mapillary reports them in a graph request that can trail the
      // image by seconds; a load that waited for them kept the canvas hidden that much longer (#5581).
      linkedPanos: false,
    };
    // Every move in Validate is a jump between unrelated panos, so Mapillary's default animated transition only adds
    // frames of the wrong place, turning from the old label's heading (#5582). Explore keeps it: walking between
    // neighboring panos is what the animation is for. The SDK global only exists on pages that load Mapillary.
    if (typeof mapillary !== 'undefined' && panoViewerType === MapillaryViewer) {
      panoOptions.transitionMode = mapillary.TransitionMode.Instantaneous;
    }
    this.#primaryPaintsDuringLoad = Boolean(panoViewerType.PAINTS_DURING_LOAD);

    this.#panoCanvas = document.getElementById('svv-panorama');

    // Sibling canvas for the Pannellum fallback viewer, hidden until an expired pano needs it. `visibility`, not
    // `display`, is what hides it once it holds a viewer: a display:none element has no size, and a viewer only
    // measures the box it is mounted in, so it has to be laid out to load a pano it isn't showing yet (#5206).
    this.#pannellumCanvas = document.createElement('div');
    this.#pannellumCanvas.id = 'svv-panorama-pannellum';
    this.#pannellumCanvas.style.cssText
      = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: none;';
    this.#panoCanvas.insertAdjacentElement('afterend', this.#pannellumCanvas);

    this.#logPovChange = util.throttle(() => svv.tracker.push('POV_Changed'), PanoManager.#POV_LOG_INTERVAL_MS);

    this.#primaryViewer = await panoViewerType.create(this.#panoCanvas, panoOptions);
    svv.panoViewer = this.#primaryViewer;
    // Viewer-internal failures are logged so a black-viewer report can be diagnosed from the database. Validate has
    // no alert banner; its per-label Pannellum fallback is what the labeler sees when the primary viewer stops.
    this.#primaryViewer.addListener('diagnostic', (name, details) => svv.tracker.push(`PanoViewer_${name}`, details));

    // Set up the imagery source logo. #showPannellumPano will override it if Pannellum takes over for a label.
    this.#logo = createPanoViewerLogo(this.#panoCanvas.parentElement, panoViewerType.SOURCE);
    this.#logo.showPrimaryLogo();
    this.#attribution = createPanoAttribution(this.#panoCanvas.parentElement);

    if (svv.legacyMobile) {
      this.sizePano();
      svv.panoViewer.resize(); // Necessary for PannellumViewer for correct vertical position of the label.
    }

    if (panoViewerType === GsvViewer && !svv.legacyMobile) {
      this.#makeGsvAttributionClickable();
      this.#linksListener = /** @type {GsvViewer} */ (this.#primaryViewer).gsvPano
        .addListener('links_changed', this.#makeGsvAttributionClickable.bind(this));
    }
    // Mapillary's attribution pill stays in the SDK's DOM, where the SDK patches its creator and date per image;
    // svv-panorama.css positions it there. Moving it would cut it off from those patches (#5600).
  }

  /**
   * Subscribes a viewer to the shared POV logger, once per viewer.
   *
   * Both viewers need their own subscription: only one of them is `svv.panoViewer` at a time, and Pannellum is built
   * lazily the first time a label's imagery has expired, so it doesn't exist to subscribe to at startup (#4828).
   * Panning and zooming a Pannellum label is the same interaction as panning a GSV one and belongs in the logs the
   * same way. The one throttled logger is shared across viewers, so the interval covers the pano as a whole rather
   * than giving each viewer its own window.
   *
   * @param {PanoViewer} viewer - The viewer to subscribe; ignored if it is already subscribed.
   */
  #watchViewerPov(viewer) {
    if (this.#povWatchedViewers.has(viewer)) return;
    this.#povWatchedViewers.add(viewer);
    viewer.addListener('pov_changed', () => this.#logPovChange());
  }

  /**
   * Gets a specific property from the PanoManager.
   * @param {string} key   - Property name.
   * @returns {*} Value associated with this property or null.
   */
  getProperty(key) {
    return key in this.#properties ? this.#properties[key] : null;
  }

  /**
   * Sets a property for the PanoManager.
   * @param {string} key - Name of property
   * @param {*} value - Value of property
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
   * @param {PanoData} panoData - The PanoData extracted from the PanoViewer when loading the pano
   * @returns {PanoData}
   */
  #setPanoCallback(panoData) {
    // Store the returned pano metadata.
    const panoId = panoData.getPanoId();
    svv.panoStore.addPanoMetadata(panoId, panoData);

    if (!svv.legacyMobile) {
      // Add the capture date of the image to the bottom-right corner of the UI.
      const captureDate = panoData.getProperty('captureDate');
      svv.ui.viewer.date.textContent = Number.isNaN(captureDate.getTime())
        ? ''
        : captureDate.toLocaleDateString(i18next.language, { month: 'short', year: 'numeric' });
    }

    return panoData;
  }

  /**
   * Moves the buttons on the bottom-right of the GSV image to the top layer so they are clickable.
   */
  #makeGsvAttributionClickable() {
    const bottomLinks = document.querySelectorAll('.gm-style-cc');
    if (!this.#bottomLinksClickable && bottomLinks.length > 3) {
      this.#bottomLinksClickable = true;

      // Remove the first child of each remaining .gm-style-cc element because it looks better.
      bottomLinks.forEach((el) => el.firstElementChild?.remove());

      bottomLinks[0].remove(); // Remove GSV keyboard shortcuts link.
      svv.ui.viewer.controlLayer.append(bottomLinks[1].parentElement.parentElement); // Makes remaining links clickable.
    }

    google.maps.event.removeListener(this.#linksListener);
  }

  /**
   * Aims the pano at a label, draws the label as a PanoMarker, and reveals a primary canvas that setPanorama kept
   * unpainted for the load.
   *
   * The marker is drawn before this first awaits, so a caller that doesn't wait still has it on return. What waiting
   * adds is the reveal: on a viewer that paints during a load, the canvas and marker stay unpainted until the viewer
   * has drawn this label's POV, so the first frame the validator sees is already facing the label (#5582). The reveal
   * runs even if aiming or drawing throws: the caller unlocks the tool either way, and a pano at the wrong heading, or
   * without its marker, beats a blank one the validator is asked to judge.
   * @param {Label} currentLabel - The label to render.
   * @returns {Promise<void>} Settles once the pano is on screen at the label's POV.
   */
  async renderPanoMarker(currentLabel) {
    try {
      this.#aimAndDrawMarker(currentLabel);
    } finally {
      await this.#revealPrimaryOnceAimed();
    }
  }

  /**
   * The synchronous half of renderPanoMarker: applies the label's POV and draws or moves its marker.
   * @param {Label} currentLabel - The label to render.
   * @returns {void}
   */
  #aimAndDrawMarker(currentLabel) {
    const labelPov = currentLabel.getOriginalPov();

    // Set to user's POV when labeling, except on /mobile, which centers the label on the screen.
    if (svv.legacyMobile) {
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
      const markerDiameter = this.#markerDiameter(util.uiScale());
      this.labelMarker = new PanoMarker({
        id: 'validate-pano-marker',
        markerContainer: markerLayer,
        panoViewer: svv.panoViewer,
        position: { heading: labelPov.heading, pitch: labelPov.pitch },
        size: { width: markerDiameter, height: markerDiameter },
        zIndex: 2,
      });
      this.#markerViewer = svv.panoViewer;
      // Take the halo class back off once it has played so the element doesn't carry a state class it isn't in.
      // Attached here rather than per render because it belongs to the element's whole lifetime: interrupting a
      // pulse fires animationcancel, not animationend, so a per-render `{ once: true }` listener would never fire
      // and would accumulate one dead listener per label. Under prefers-reduced-motion no animation ever runs or
      // ends, so the class lingers — harmless, since the same media query is what makes it inert.
      const markerEl = this.labelMarker.marker_;
      markerEl.addEventListener('animationend', (e) => {
        if (e.animationName === 'label-marker-pulse') markerEl.classList.remove('label-marker-pulse');
      });
      // A marker created while the canvas is held unpainted (after #clearViewer, or on a switch back from Pannellum)
      // would otherwise float over the empty pano area, placed from a view that isn't aimed yet (#5582).
      if (this.#primaryRevealPending) markerEl.style.visibility = 'hidden';
    } else {
      this.labelMarker.setPosition({ heading: labelPov.heading, pitch: labelPov.pitch });
    }

    const marker = this.labelMarker.marker_;
    this.styleMarkerForLabel(currentLabel);
    // A hidden marker's pulse would play unseen, so the reveal starts it instead.
    if (!this.#primaryRevealPending) this.#restartMarkerPulse(marker);
    this.#updateMarkerAiIndicator(currentLabel.getAuditProperty('aiGenerated'));
  }

  /**
   * Reveals the primary canvas once the viewer has drawn the label's POV, if setPanorama left it waiting for that.
   *
   * Two animation frames after setPov, the same wait PanoViewer._firePovChangedAfterResize uses, and the only
   * guarantee available: the SDKs give nothing to wait on (MapillaryJS's setCenter and setFieldOfView return
   * undefined) and apply and draw a new POV on their own animation frames, so revealing a frame after that keeps the
   * first painted frame from being one drawn before the POV landed. The wait is capped for a background tab
   * (#REVEAL_FRAME_CAP_MS). A newer load starting meanwhile cancels the reveal, as that load owns the canvas now.
   * @returns {Promise<void>}
   */
  async #revealPrimaryOnceAimed() {
    if (!this.#primaryRevealPending) return;
    const loadSeq = this.#loadSeq;
    await new Promise(/** @param {(value?: void) => void} resolve */ (resolve) => {
      const cap = setTimeout(resolve, PanoManager.#REVEAL_FRAME_CAP_MS);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        clearTimeout(cap);
        resolve();
      }));
    });
    if (loadSeq === this.#loadSeq && this.#primaryRevealPending) this.#revealPrimaryCanvas();
  }

  /**
   * Whether the next load leaves the pano area blank while it runs, so the loading status should caption it at once
   * rather than after its usual delay. True for a primary that paints during loads (its canvas is held unpainted for
   * the whole load) and when nothing is up at all after a cleared viewer; false when the outgoing pano stays on
   * screen until the new one is ready, where an instant status would flicker on every fast label.
   * @returns {boolean}
   */
  blanksPanoWhileLoading() {
    const nothingUp = this.#panoCanvas.style.display === 'none' && this.#pannellumCanvas.style.display === 'none';
    return this.#primaryPaintsDuringLoad || nothingUp;
  }

  /**
   * Reveals a primary canvas that setPanorama left unpainted, for a render that failed before renderPanoMarker ran.
   *
   * The caller unlocks the tool after a failed render, and a canvas still held unpainted would leave the validator
   * judging a blank pano area. No-op when nothing is pending.
   * @returns {void}
   */
  revealPendingCanvas() {
    if (this.#primaryRevealPending) this.#revealPrimaryCanvas();
  }

  /**
   * Draws the marker as the label's type. Also called alone when an expert picks a new type (#3671), so the marker
   * shows the type the label is about to become.
   * @param {Label} label
   */
  styleMarkerForLabel(label) {
    if (!this.labelMarker) return;
    // The icon is handed to CSS rather than set as the marker's own background, so that hiding the label can
    // crossfade it out (main.css's .label-marker) while the ring around it stays put to mark the spot. The colour
    // rides along for the dashed ring that ring becomes while hidden.
    const marker = this.labelMarker.marker_;
    marker.style.setProperty('--label-icon', `url(${label.getIconUrl()})`);
    marker.style.setProperty('--label-color', label.getIconColor());
    // The marker is a focusable control (#4729, PanoMarker), so name it as the label it opens the card for,
    // localized the same way the card's header is.
    marker.setAttribute(
      'aria-label',
      util.misc.labelTypeName(label.getProperty('newLabelType')),
    );
  }

  /**
   * Replays the halo pulse once the marker can actually be seen, for the first label of a mission (#4790).
   *
   * That label renders behind page chrome — the loading overlay at boot (Main.js), the mission-complete modal on
   * later missions (Form.js loads the next label before its button is clicked) — and visibility: hidden doesn't
   * pause CSS animations, so the pulse plays unseen and is spent before the validator ever sees the marker. The
   * reveal choreography calls this as its chrome clears; if the mission-start tutorial's overlay is up (desktop —
   * mobile has no tutorial markup), the replay waits for its dismissal the same way the pano hint toast does
   * (#4726).
   */
  replayMarkerPulse() {
    if (!this.labelMarker) return;
    const overlay = document.querySelector('.mission-start-tutorial-overlay');
    if (overlay && getComputedStyle(overlay).display !== 'none') {
      document.addEventListener(
        'ps:mission-start-tutorial:done',
        () => {
          if (this.labelMarker) this.#restartMarkerPulse(this.labelMarker.marker_);
        },
        { once: true },
      );
    } else {
      this.#restartMarkerPulse(this.labelMarker.marker_);
    }
  }

  /**
   * Replays the one-shot halo pulse that draws the eye to the marker (#4790, main.css .label-marker-pulse).
   *
   * Validate reuses one marker element across labels, so re-adding the class is not enough on its own: when a
   * label is answered before its pulse has finished the class is still present, and the browser sees no change
   * to act on. Reading offsetWidth in between flushes the pending style change, which is what restarts it.
   *
   * @param {HTMLElement} marker - The marker element to pulse.
   */
  #restartMarkerPulse(marker) {
    marker.classList.remove('label-marker-pulse');
    void marker.offsetWidth;
    marker.classList.add('label-marker-pulse');
  }

  /**
   * Sets the panorama. Tries the primary viewer first and falls back to Pannellum if there's a backup image, except
   * for a pano flagged expired that has a backup, which goes to Pannellum first and to the primary only if that fails.
   *
   * On a success from a primary viewer that paints during loads (PanoViewer.PAINTS_DURING_LOAD), the canvas is still
   * unpainted when this resolves; renderPanoMarker reveals it once it faces the label.
   *
   * @param {string} panoId - The ID for the panorama that we want to move to.
   * @param {?{pano_id: string, camera_heading?: number, attribution?: object}} backupImage - Self-hosted pano, or null.
   * @param {object} [opts]
   * @param {boolean} [opts.expired=false] - True when the backend's imagery sweep found the provider without this pano.
   * @returns {Promise<{panoData: PanoData, reason?: undefined} | {panoData: null, reason: ('slow'|'no-imagery')}>}
   *      The loaded pano's metadata, or `panoData: null` when no viewer could render it. A null means the pano area is
   *      now empty, so the caller must not draw a label marker over it or ask for a validation of the label it was
   *      loading (#4810). `reason` says whether trying again later could help: 'slow' when the last primary attempt
   *      threw PanoLoadTimeoutError (out of time, or a network failure on a pano not known to be gone, #5581),
   *      'no-imagery' for everything else, including a load that never asked the primary.
   */
  async setPanorama(panoId, backupImage = null, { expired = false } = {}) {
    this.setProperty('panoLoaded', false);
    this.#loadSeq += 1;
    this.#primaryRevealPending = false;

    // A pano the nightly imagery sweep already found gone goes straight to the fallback (#5561). Asking the provider
    // anyway costs a metadata round trip that ends in the rejection the flag predicted, on every such label, and on
    // a phone that is seconds of dead time between the tap and the next pano — as well as the only chance the next
    // label's backup had of being fetched ahead of time going unused. If the flag is stale and the pano is back, the
    // backup is still the right imagery, just older than it needed to be. A label flagged expired but holding no
    // backup takes the ordinary path, since the provider is its only chance.
    const skipPrimary = expired && Boolean(backupImage);

    // The error from the latest primary attempt, which is what decides `reason`; undefined while none has been made.
    let primaryError;
    if (!skipPrimary) {
      const primary = await this.#showPrimaryPano(panoId);
      if (primary.panoData) return { panoData: primary.panoData };
      primaryError = primary.error;
    }

    // The primary viewer failed, or wasn't asked — try Pannellum if we have local pano data.
    if (backupImage) {
      try {
        const panoData = await this.#showPannellumPano(backupImage);
        this.#setPanoCallback(panoData);
        this.setProperty('panoLoaded', true);
        svv.tracker.push('PanoId_Changed');
        return { panoData };
      } catch (err) {
        console.error('PannellumViewer failed to load for Validate:', err);
      }
      // A backup that won't load under a flag that may be stale: the provider it was skipped for is the last
      // chance, and asking costs only the round trip the shortcut saved.
      if (skipPrimary) {
        const primary = await this.#showPrimaryPano(panoId);
        if (primary.panoData) return { panoData: primary.panoData };
        primaryError = primary.error;
      }
    }

    this.#clearViewer();
    return { panoData: null, reason: primaryError instanceof PanoLoadTimeoutError ? 'slow' : 'no-imagery' };
  }

  /**
   * Loads a pano in the primary viewer and makes that the active viewer, or leaves the pano area as it was.
   *
   * The fallback's invariant from #showPannellumPano, applied the other way round (#5453). While the fallback or an
   * empty pano area is up, the primary canvas is out of the layout and holds whatever it last drew: the last live
   * label's pano, however many labels back. A provider left out of the layout doesn't render, so revealing it once
   * setPano resolved put that frame back on screen until it caught up. It rejoins the layout unpainted instead and
   * switches panos underneath the outgoing one; #teardownPannellum reveals it, or renderPanoMarker does on a viewer
   * that paints mid-load. The resize is what makes it measure the box it rejoined: a window resize while the
   * fallback was up only reached the fallback.
   *
   * On a success from a viewer that paints mid-load, the canvas is still unpainted when this resolves.
   *
   * @param {string} panoId - The pano to load.
   * @returns {Promise<{panoData: PanoData, error?: undefined} | {panoData: null, error: unknown}>} The loaded pano's
   *     metadata, or null with the viewer's error, which setPanorama needs to tell a slow load from a missing pano.
   */
  async #showPrimaryPano(panoId) {
    const primaryWasHidden = this.#panoCanvas.style.display === 'none';
    if (primaryWasHidden) {
      this.#panoCanvas.style.visibility = 'hidden';
      this.#panoCanvas.style.display = '';
      this.#primaryViewer.resize();
    } else if (this.#primaryPaintsDuringLoad) {
      // The same invariant for a live label after a live one (#5582). This viewer draws the incoming pano mid-load at
      // the outgoing label's heading, then sits there until the label's POV arrives, which reads as a pano to judge.
      // So the canvas goes unpainted for the load, and the outgoing marker with it: left up, it would float over an
      // empty pano area.
      this.#panoCanvas.style.visibility = 'hidden';
      if (this.labelMarker) this.labelMarker.marker_.style.visibility = 'hidden';
    }
    // Whether the primary canvas is being held unpainted, and so has to be taken down if this load fails. A failed
    // load on a viewer that paints mid-load leaves a half-drawn pano there, which must never be revealed.
    const primaryHeldUnpainted = primaryWasHidden || this.#primaryPaintsDuringLoad;

    try {
      const panoData = await this.#primaryViewer.setPano(panoId);
      // Subscribed after the primary's first load rather than at its creation: that load sets the viewer's initial
      // POV, which fires pov_changed, and the throttle's leading edge would log it as a pan the user never made.
      // (Pannellum subscribes at its own creation instead: by then a POV change is a real one.)
      this.#watchViewerPov(this.#primaryViewer);
      this.#teardownPannellum({ reveal: !this.#primaryPaintsDuringLoad });
      this.#primaryRevealPending = this.#primaryPaintsDuringLoad;
      this.#setPanoCallback(panoData);
      this.setProperty('panoLoaded', true);
      svv.tracker.push('PanoId_Changed');
      return { panoData };
    } catch (err) {
      // Put the primary canvas back the way this call found it, so it can't sit laid out under the fallback.
      if (primaryHeldUnpainted) this.#hidePrimaryCanvas();
      return { panoData: null, error: err };
    }
  }

  /**
   * Starts downloading a pano the validator is expected to see soon, so its load later is quick (#5581). Goes to the
   * primary viewer, since that is the one whose loads are slow enough to need it; a no-op for providers that can't.
   * @param {string} panoId - The primary provider's id for the pano.
   * @returns {void}
   */
  prefetchPano(panoId) {
    this.#primaryViewer.prefetchPano(panoId);
  }

  /**
   * Empties the pano area: hides both viewer canvases and takes down the label marker.
   *
   * Neither viewer clears itself when a load fails — the primary viewer rejects before it ever swaps panos, and
   * Pannellum keeps its last canvas — so without this the validator would be looking at the *previous* label's
   * imagery, panned to the new label's POV with the new label's marker on it, and asked whether that label is
   * correct (#4810). An empty pano is the honest state; the caller decides what to show in its place.
   */
  #clearViewer() {
    this.setProperty('panoLoaded', false);
    this.#hidePrimaryCanvas();
    this.#hidePannellumCanvas();
    if (this.labelMarker) {
      this.labelMarker.removeMarker();
      this.labelMarker = null;
      this.#markerViewer = undefined;
    }
  }

  /**
   * Hands the pano area to the primary viewer and hides the Pannellum canvas; resets svv.panoViewer to the primary.
   *
   * Only called once the primary viewer has loaded the current label's pano, which is what makes it safe to paint.
   * Both properties are restated, as #showPannellumPano does for its own canvas, so an overlapping load's cleanup
   * can't leave this one laid out but hidden.
   *
   * @param {{reveal: boolean}} options - False to leave the canvas laid out but unpainted, for a viewer that is not
   *     yet facing the label (#5582); renderPanoMarker reveals it.
   */
  #teardownPannellum({ reveal }) {
    this.#hidePannellumCanvas();
    this.#panoCanvas.style.display = '';
    this.#panoCanvas.style.visibility = reveal ? '' : 'hidden';
    svv.panoViewer = this.#primaryViewer;
    svv.panoViewer.resize();
    svv.tracker.push('Viewer_Primary');
    this.#logo.showPrimaryLogo();
    this.#attribution.hide(); // The provider's live viewer draws its own.
  }

  /**
   * Loads the given pano into the Pannellum viewer and, once it is on screen, hands the pano area over to it.
   *
   * On the first call this creates a PannellumViewer; on later calls it reuses the same one via loadPano(), to avoid
   * recreating the WebGL context. Sets svv.panoViewer to the Pannellum viewer so the rest of the codebase (setPov,
   * getPov, markers) uses the correct viewer.
   *
   * The invariant: this canvas is painted only while it holds the current label's pano. It has to be, because the
   * viewer is reused and its canvas therefore carries whatever pano it last drew — an earlier label's, from however
   * many labels back that was. Revealing it any sooner than the load resolving would put that pano on screen for
   * the length of the download, under this label's marker and the outgoing label's capture date, where a validator
   * reads it as the label they were just handed (#5206). So the load runs against a laid-out but unpainted canvas
   * and the swap — canvas, active viewer, logo, attribution — happens in one step afterwards; nothing here paints,
   * and the outgoing label's imagery stays up until this one is ready.
   *
   * @param {{pano_id: string, camera_heading?: number, attribution?: object}} backupImage - Self-hosted pano data.
   * @returns {Promise<PanoData>}
   */
  async #showPannellumPano(backupImage) {
    // Use a neutral POV here; renderPanoMarker will setPov to the correct heading immediately after.
    const neutralPov = { heading: backupImage.camera_heading || 0, pitch: 0, zoom: 1 };

    // Put the canvas into the layout without painting it, so the viewer mounted in it can measure itself. One that
    // is already showing is left alone: it holds the outgoing label's imagery, which is what should stay up.
    // `wasShowing` is only consulted to decide how much to undo on failure; it deliberately does not gate the
    // reveal below, which restates the whole visible state rather than assuming what this call changed.
    const wasShowing = this.#pannellumCanvas.style.display !== 'none';
    if (!wasShowing) {
      this.#pannellumCanvas.style.visibility = 'hidden';
      this.#pannellumCanvas.style.display = '';
    }
    try {
      if (this.#pannellumViewer) {
        await this.#pannellumViewer.loadPano(backupImage.pano_id, backupImage, neutralPov);
      } else {
        this.#pannellumViewer = await PannellumViewer.create(this.#pannellumCanvas, {
          panoMetadata: backupImage,
          startPanoId: backupImage.pano_id,
          startHeading: neutralPov.heading,
          startPitch: neutralPov.pitch,
          startZoom: neutralPov.zoom,
          imageCache: svv.panoImageCache ?? null,
        });
      }
    } catch (err) {
      // Put the pano area back the way this call found it, so a failed fallback leaves the outgoing label's imagery
      // up rather than a canvas the caller believes is hidden. setPanorama decides what happens next.
      if (!wasShowing) this.#hidePannellumCanvas();
      throw err;
    }

    this.#watchViewerPov(this.#pannellumViewer);
    svv.panoViewer = this.#pannellumViewer;

    // Whether the image was already on the device (#5562): the measure of the prefetch, and of the wait it saved.
    // Logged once this viewer is the active one, so the row carries the pano it just loaded rather than the
    // outgoing viewer's — or, on the first load of a page, no pano at all.
    if (typeof this.#pannellumViewer.lastLoadPrefetched === 'boolean') {
      svv.tracker.push('PanoPrefetch', { hit: this.#pannellumViewer.lastLoadPrefetched });
    }
    // As #teardownPannellum does on the way back: a viewer only measures its container when told to, and this one
    // has been sitting hidden — since a rotation, in the mobile case, which resized every canvas underneath it.
    svv.panoViewer.resize();
    // Set both properties rather than only the one this call is expected to have changed. Redundant on the common
    // path, load-bearing when two loads overlap: the other one's cleanup can have taken this canvas out of the
    // layout while this load was in flight, and reinstating only `visibility` would leave both canvases hidden —
    // an empty pano area that still reports panoLoaded and gets a marker drawn over it.
    this.#hidePrimaryCanvas();
    this.#pannellumCanvas.style.display = '';
    this.#pannellumCanvas.style.visibility = '';
    svv.tracker.push('Viewer_Pannellum');
    this.#logo.showSourceLogo();
    this.#attribution.show(backupImage.attribution || null);
    return svv.panoViewer.currPanoData;
  }

  /**
   * Takes the primary canvas out of sight and out of the layout, clearing any unpainted-load state setPanorama left.
   */
  #hidePrimaryCanvas() {
    this.#primaryRevealPending = false;
    this.#panoCanvas.style.display = 'none';
    this.#panoCanvas.style.visibility = '';
  }

  /**
   * Paints the primary canvas and the marker hidden with it, once the pano faces the current label, and starts the
   * marker's pulse, which renderPanoMarker held back so it wouldn't play while the marker was hidden.
   * @returns {void}
   */
  #revealPrimaryCanvas() {
    this.#primaryRevealPending = false;
    this.#panoCanvas.style.visibility = '';
    if (this.labelMarker) {
      this.labelMarker.marker_.style.visibility = '';
      this.#restartMarkerPulse(this.labelMarker.marker_);
    }
  }

  /**
   * Takes the Pannellum canvas back out of sight, and out of the layout so it can't sit over the primary viewer.
   */
  #hidePannellumCanvas() {
    this.#pannellumCanvas.style.display = 'none';
    this.#pannellumCanvas.style.visibility = '';
  }

  /**
   * Adds or removes the AI badge on the validation marker.
   *
   * Display-only: the badge carries no tooltip here (#5359). Hovering the marker opens the label card, and that card
   * holds the AI disclaimer, so a tooltip on the badge could only open on top of it. main.css keeps the badge
   * pointer-inert for the same reason.
   *
   * @param {boolean} showIndicator - True to show the AI badge, false to remove it.
   */
  #updateMarkerAiIndicator(showIndicator) {
    const markerEl = this.labelMarker.marker_;
    const existingIndicator = markerEl.querySelector('.ai-icon-marker-validate');

    if (showIndicator && !existingIndicator) {
      markerEl.appendChild(aiLabelIndicator(['ai-icon-marker-validate'], { tooltip: false }));
    } else if (!showIndicator && existingIndicator) {
      existingIndicator.remove();
    }
  }

  /**
   * On-screen diameter of the label marker, in CSS px, at the given UI scale.
   *
   * Capped, the way Explore's placed icon is (#4838). --ui-scale runs to 1.8x, which took this marker from 22px to
   * 40px on screen — a mark that hides more of the very feature the validator is judging the bigger their window
   * gets, and the two tools' markers drifted apart at the top of the range. The cap engages above ~1.73x, so every
   * scale below that is untouched. util.cappedMarkerDiameter leaves mobile's larger touch target alone.
   *
   * @param {number} scale - The UI scale factor (see util.applyToolScale).
   * @returns {number} Diameter in CSS px.
   */
  #markerDiameter(scale) {
    return Math.round(util.cappedMarkerDiameter(svv.labelRadius * 2 + 2, scale));
  }

  /**
   * Resizes the label marker to match the given UI scale factor.
   * @param {number} scale - The current UI scale factor (see util.applyToolScale).
   */
  setMarkerScale(scale) {
    if (!this.labelMarker) return;
    const markerDiameter = this.#markerDiameter(scale);
    this.labelMarker.setSize({ width: markerDiameter, height: markerDiameter });
  }

  /**
   * Sets the zoom level for this panorama.
   * @param {number} zoom - Desired zoom level for this panorama. In general, values in {1.1, 2.1, 3.1}
   * @returns {void}
   */
  setZoom(zoom) {
    const currPov = svv.panoViewer.getPov();
    currPov.zoom = zoom;
    svv.panoViewer.setPov(currPov);
  }

  /**
   * Fills the screen below the tool's header with the panorama. Mobile only; desktop sizes the pano from CSS.
   *
   * Measured from documentElement rather than window.innerWidth/innerHeight, which on iOS track the *visual*
   * viewport: called after a pinch, those report the zoomed-into region and would size the pano to it.
   *
   * The header's height is read off the holder's own top edge, so this follows whatever mobile-validate.css puts
   * above it rather than repeating the number.
   */
  sizePano() {
    const panoHolderElem = document.getElementById('svv-panorama-holder');
    const controlLayerElem = document.getElementById('view-control-layer');
    const heightOffset = panoHolderElem.getBoundingClientRect().top;
    const h = document.documentElement.clientHeight - heightOffset;
    const w = document.documentElement.clientWidth;
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

    // The marker positions itself from the pano's size. It redraws on window resize too, but that listener is
    // older than the one that calls this and runs unthrottled — so on a rotation it has already drawn against the
    // dimensions being replaced here, and nothing would move it again until the next pan.
    this.labelMarker?.draw();
  }

  /**
   * Factory function that sets up the panorama viewer. No pano is loaded yet: the first label's setPanorama does that.
   * @param {typeof PanoViewer} panoViewerType - The type of pano viewer to initialize
   * @param {string} viewerAccessToken - An access token used to request images for the pano viewer
   * @returns {Promise<PanoManager>} The panoManager instance.
   */
  static async create(panoViewerType, viewerAccessToken) {
    const newPanoManager = new PanoManager();
    await newPanoManager.#init(panoViewerType, viewerAccessToken);
    return newPanoManager;
  }
}
