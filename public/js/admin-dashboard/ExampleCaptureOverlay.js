/**
 * Full-window framing surface that turns a label into an example photo (#4723).
 *
 * Opens the label's panorama in the shared pano viewer at the point of view the label was placed from, lets the
 * author reframe it, and reads the frame straight off the viewer's canvas — the same capture Explore performs when
 * it makes a label's crop (`Canvas.saveCanvasScreenshot`). Two reasons this beats serving the stored crop: framing
 * becomes a decision rather than whatever the mapper happened to be looking at, and it works for the many labels
 * whose crop is missing entirely or predates the current 1440x960 size.
 *
 * The pano is drawn as large as the window allows because the captured resolution *is* the canvas's backing store
 * (CSS size x devicePixelRatio). The stage is held at the example aspect ratio so the export is a straight downscale
 * with nothing cropped away — what is framed is what is kept.
 */
class ExampleCaptureOverlay {
  /** Every example ships at 3:2 — the app's canonical crop, and what Explore's pano frame and Gallery cards assume. */
  static ASPECT_RATIO = 1.5;

  /** Export size, matching `ImageController.CROP_WIDTH/CROP_HEIGHT`. */
  static EXPORT_WIDTH = 1440;
  static EXPORT_HEIGHT = 960;

  #viewerType;
  #viewerAccessToken;
  #panoManager = null;
  #ui;
  #resolve = null;
  #onKeyDown;

  /**
   * @param {typeof PanoViewer} viewerType - Viewer class for this deployment's imagery source.
   * @param {string} viewerAccessToken - Access token the viewer needs to request imagery.
   */
  constructor(viewerType, viewerAccessToken) {
    this.#viewerType = viewerType;
    this.#viewerAccessToken = viewerAccessToken;
    this.#ui = {
      root: document.getElementById('ex-capture'),
      pano: document.getElementById('ex-capture-pano'),
      title: document.getElementById('ex-capture-title'),
      size: document.getElementById('ex-capture-size'),
      take: document.getElementById('ex-capture-take'),
      cancel: document.getElementById('ex-capture-cancel'),
    };

    this.#ui.take.addEventListener('click', () => this.#finish(this.#capture()));
    this.#ui.cancel.addEventListener('click', () => this.#finish(null));
    this.#onKeyDown = (e) => {
      if (e.key === 'Escape') this.#finish(null);
    };
  }

  /**
   * Opens the panorama for a label and resolves once the author captures a frame or backs out.
   *
   * @param {object} label - The `/adminapi/label/id/:labelId` payload.
   * @returns {Promise<?{dataUrl: string, width: number, height: number, sourceWidth: number}>} The captured frame,
   *          or `null` if cancelled. `sourceWidth` is the canvas's real width before the downscale, which is what
   *          says whether the capture had enough detail to be worth keeping.
   */
  async open(label) {
    this.#ui.title.textContent = `Label ${label.label_id} — ${label.label_type}`;
    this.#ui.size.textContent = '';
    this.#ui.root.hidden = false;
    document.body.classList.add('ex-capture-open');
    document.addEventListener('keydown', this.#onKeyDown);

    // Built lazily and kept: constructing a viewer is expensive, and every capture after the first reuses it.
    if (!this.#panoManager) {
      this.#panoManager = await PopupPanoManager.create(this.#ui.pano, null, true,
        this.#viewerType, this.#viewerAccessToken);
    }
    // The viewer measured a hidden container on the first open, so hand it the real size now that it is laid out.
    this.#panoManager.panoViewer.resize();

    // No cropUrl is passed: the static-crop fallback is a fixed still that cannot be reframed, which is the one
    // thing this surface exists to do. Better to say the imagery is gone than to hand back an unreframeable frame.
    const shown = await this.#panoManager.setPano(label.pano_id, {
      heading: label.heading,
      pitch: label.pitch,
      zoom: label.zoom,
    }, null, !!label.expired);

    this.#reportSize(shown);
    return new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  /** @returns {?HTMLCanvasElement} The canvas the active viewer is painting into, if it has one. */
  #canvas() {
    const viewer = this.#panoManager?.panoViewer;
    if (!viewer) return null;
    return this.#ui.pano.querySelector(`.${viewer.getCanvasClass()}`);
  }

  /**
   * Shows what the capture would come out at, so an under-sized window is obvious before the frame is taken.
   * @param {boolean} shown - Whether `setPano` managed to display any imagery at all.
   */
  #reportSize(shown) {
    const canvas = shown ? this.#canvas() : null;
    if (!canvas) {
      this.#ui.size.textContent = shown
        ? 'This pano fell back to a still image, which cannot be reframed.'
        : 'No imagery available for this pano.';
      this.#ui.size.classList.add('error');
      this.#ui.take.disabled = true;
      return;
    }
    const exportSize = `${ExampleCaptureOverlay.EXPORT_WIDTH}×${ExampleCaptureOverlay.EXPORT_HEIGHT}`;
    const short = canvas.width < ExampleCaptureOverlay.EXPORT_WIDTH;
    this.#ui.take.disabled = false;
    this.#ui.size.classList.toggle('error', short);
    this.#ui.size.textContent = short
      ? `Capturing ${canvas.width}×${canvas.height} — under ${ExampleCaptureOverlay.EXPORT_WIDTH} px wide, so the`
      + ' export is upscaled; a bigger window keeps more detail.'
      : `Capturing ${canvas.width}×${canvas.height} → ${exportSize}.`;
  }

  /**
   * Reads the viewer's canvas into an example-sized image.
   *
   * The stage already holds 3:2, so the centre crop below is a rounding guard rather than a reframe: a canvas half a
   * pixel off would otherwise be stretched to fit, and a stretched example is worse than one a pixel narrower.
   *
   * @returns {?{dataUrl: string, width: number, height: number, sourceWidth: number}}
   */
  #capture() {
    const canvas = this.#canvas();
    if (!canvas) return null;

    const target = ExampleCaptureOverlay.ASPECT_RATIO;
    let sw = canvas.width;
    let sh = canvas.height;
    if (sw / sh > target) sw = Math.round(sh * target);
    else sh = Math.round(sw / target);
    const sx = Math.round((canvas.width - sw) / 2);
    const sy = Math.round((canvas.height - sh) / 2);

    const out = document.createElement('canvas');
    out.width = ExampleCaptureOverlay.EXPORT_WIDTH;
    out.height = ExampleCaptureOverlay.EXPORT_HEIGHT;
    out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);

    // PNG here regardless of the export format: this is the working copy the editor annotates over, and re-encoding
    // it once at export time costs nothing next to carrying a lossy frame through the whole session.
    return {
      dataUrl: out.toDataURL('image/png'),
      width: out.width,
      height: out.height,
      sourceWidth: canvas.width,
    };
  }

  /**
   * Closes the overlay and settles the promise `open()` handed out.
   * @param {?object} result
   */
  #finish(result) {
    document.removeEventListener('keydown', this.#onKeyDown);
    document.body.classList.remove('ex-capture-open');
    this.#ui.root.hidden = true;
    const resolve = this.#resolve;
    this.#resolve = null;
    if (resolve) resolve(result);
  }
}
