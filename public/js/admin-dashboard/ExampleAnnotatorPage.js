/**
 * Authoring tool for example imagery and its annotation marks (#4723).
 *
 * Marks live as data in `public/images/examples/annotations.json` rather than baked into the photos, so they can be
 * repositioned or restyled without re-exporting a raster. That trade only pays off if placing a mark is easier than
 * opening an image editor, which is this page's whole job.
 *
 * Photos come from one of two places: an example already committed to the tree, or a fresh frame captured from any
 * label's panorama (see `ExampleCaptureOverlay`). Either way the page writes nothing — the photo and the manifest
 * both leave as downloads, because both are source and belong in git.
 *
 * Rendering is delegated to `util.misc.renderExampleMarks` — the same call the tooltips will use — so the preview is
 * the result rather than an approximation of it.
 */
class ExampleAnnotatorPage {
  /** Grab radius for hit-testing a mark, in view units (hundredths of the image's height). */
  static GRAB_RADIUS = 4;

  /** Below this the drag reads as a stray click rather than an intended mark. */
  static MIN_MARK_SPAN = 0.03;

  #tree;
  #annotations;
  #tagsByType;
  #opts;
  #ui = {};
  #drag = null;
  #key = null;
  #capture = null;
  #label = null;
  #captured = null;
  #history = new Map();

  /**
   * @param {Array<string>} imageTree - Example image paths relative to examples/, e.g. "CurbRamp/tag-narrow.png".
   * @param {object} annotations - The stored manifest, or `{}` if none has been committed yet.
   * @param {Object<string, Array<string>>} tagsByType - Tag names per label type, for naming a captured example.
   * @param {{viewerType: Function, viewerAccessToken: string}} opts - Pano viewer wiring for the capture overlay.
   */
  constructor(imageTree, annotations, tagsByType, opts = {}) {
    this.#tree = imageTree;
    this.#annotations = annotations && typeof annotations === 'object' ? annotations : {};
    if (!this.#annotations.version) this.#annotations.version = 1;
    this.#tagsByType = tagsByType && typeof tagsByType === 'object' ? tagsByType : {};
    this.#opts = opts;
  }

  init() {
    const id = (name) => document.getElementById(name);
    this.#ui = {
      select: id('ex-image-select'), markType: id('ex-mark-type'), previewSize: id('ex-preview-size'),
      undo: id('ex-undo'), clear: id('ex-clear'), copy: id('ex-copy'), download: id('ex-download'),
      exportBtn: id('ex-export'),
      stage: id('ex-stage'), photo: id('ex-photo'), marks: id('ex-marks'), ghost: id('ex-ghost'),
      json: id('ex-json'), status: id('ex-status'), hint: id('ex-hint'),
      treePanel: id('ex-source-tree-panel'), labelPanel: id('ex-source-label-panel'),
      labelForm: id('ex-label-form'), labelId: id('ex-label-id'), labelMsg: id('ex-label-msg'),
      labelMeta: id('ex-label-meta'),
      destinationRow: id('ex-destination-row'), destination: id('ex-destination'),
      destinationCustomField: id('ex-destination-custom-field'), destinationCustom: id('ex-destination-custom'),
      destinationPath: id('ex-destination-path'), format: id('ex-format'),
    };

    this.#populateImageSelect();
    this.#ui.select.addEventListener('change', () => this.#loadTreeImage(this.#ui.select.value));
    this.#ui.markType.addEventListener('change', () => this.#updateHint());
    this.#ui.previewSize.addEventListener('change', () => this.#applyPreviewSize());
    this.#ui.undo.addEventListener('click', () => this.#undo());
    this.#ui.clear.addEventListener('click', () => this.#clear());
    this.#ui.copy.addEventListener('click', () => this.#copyManifest());
    this.#ui.download.addEventListener('click', () => this.#downloadManifest());
    this.#ui.exportBtn.addEventListener('click', () => this.#export());

    for (const radio of document.querySelectorAll('input[name="ex-source"]')) {
      radio.addEventListener('change', () => this.#setSource(radio.value));
    }
    this.#ui.labelForm.addEventListener('submit', (e) => {
      e.preventDefault(); // The lookup runs over fetch; a form navigation would throw the session away.
      this.#loadLabel();
    });
    this.#ui.destination.addEventListener('change', () => this.#applyDestination());
    this.#ui.destinationCustom.addEventListener('input', () => this.#applyDestination());
    this.#ui.format.addEventListener('change', () => this.#renderDestinationPath());

    // Pointer events rather than mouse, so a trackpad drag and a stylus behave the same.
    this.#ui.stage.addEventListener('pointerdown', (e) => this.#onPointerDown(e));
    this.#ui.stage.addEventListener('pointermove', (e) => this.#onPointerMove(e));
    this.#ui.stage.addEventListener('pointerup', (e) => this.#onPointerUp(e));
    this.#ui.stage.addEventListener('pointercancel', () => this.#cancelDrag());

    // The photo dictates the overlay's viewBox, so marks can only be drawn once its aspect ratio is known.
    this.#ui.photo.addEventListener('load', () => this.#render());

    this.#loadTreeImage(this.#ui.select.value);
    this.#updateHint();
    this.#renderManifest();
  }

  /** Groups the tree by label type, with a marker on entries that already carry marks. */
  #populateImageSelect() {
    const byType = new Map();
    for (const path of this.#tree) {
      const [type] = path.split('/');
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(path);
    }
    for (const [type, paths] of byType) {
      const group = document.createElement('optgroup');
      group.label = type;
      for (const path of paths) {
        const option = document.createElement('option');
        option.value = path;
        const marks = this.#annotations[this.#keyFor(path)]?.marks?.length || 0;
        option.textContent = marks ? `${path.split('/')[1]}  (${marks})` : path.split('/')[1];
        group.appendChild(option);
      }
      this.#ui.select.appendChild(group);
    }
  }

  /** @param {string} path @returns {string} The manifest key: the path minus its extension. */
  #keyFor(path) {
    return path.replace(/\.[a-z0-9]+$/i, '');
  }

  /**
   * Switches between annotating a committed example and capturing one from a label.
   * @param {string} source - `'tree'` or `'label'`.
   */
  #setSource(source) {
    const fromLabel = source === 'label';
    this.#ui.treePanel.hidden = fromLabel;
    this.#ui.labelPanel.hidden = !fromLabel;
    this.#ui.exportBtn.hidden = !fromLabel || !this.#captured;
    if (fromLabel) {
      if (this.#captured) this.#showCapturedPhoto();
      else this.#ui.labelId.focus();
    } else {
      this.#loadTreeImage(this.#ui.select.value);
    }
  }

  #loadTreeImage(path) {
    if (!path) return;
    this.#key = this.#keyFor(path);
    this.#ui.photo.src = `/assets/images/examples/${path}`;
    this.#ui.photo.alt = `Example image ${path}`;
    this.#applyPreviewSize();
  }

  /** Looks the label up, then hands it to the framing overlay. */
  async #loadLabel() {
    const labelId = parseInt(this.#ui.labelId.value, 10);
    if (!(labelId > 0)) {
      this.#labelMsg('Enter a numeric label ID.', true);
      return;
    }
    this.#labelMsg('Looking up label…');
    let label;
    try {
      const response = await fetch(`/adminapi/label/id/${labelId}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      label = await response.json();
    } catch (err) {
      this.#labelMsg(`Could not load label ${labelId} — is the ID from this city? (${err.message})`, true);
      return;
    }

    this.#label = label;
    this.#labelMsg('');
    this.#renderLabelMeta(label);
    this.#populateDestinations(label);

    if (!this.#capture) {
      this.#capture = new ExampleCaptureOverlay(this.#opts.viewerType, this.#opts.viewerAccessToken);
    }
    const captured = await this.#capture.open(label);
    if (!captured) return; // Cancelled — keep whatever was already on the stage.

    this.#captured = captured;
    this.#applyDestination();
    this.#showCapturedPhoto();
    this.#ui.exportBtn.hidden = false;
    if (captured.sourceWidth < ExampleCaptureOverlay.EXPORT_WIDTH) {
      this.#labelMsg(`Captured from a ${captured.sourceWidth} px canvas, so the export is upscaled —`
        + ' reframe in a bigger window for a sharper example.', true);
    }
  }

  #showCapturedPhoto() {
    this.#ui.photo.src = this.#captured.dataUrl;
    this.#ui.photo.alt = `Frame captured from label ${this.#label?.label_id}`;
    this.#applyPreviewSize();
  }

  /** The facts that decide which example slot a label can fill, and whether it is a good candidate at all. */
  #renderLabelMeta(label) {
    const rows = [
      ['Type', label.label_type],
      ['Severity', label.severity ?? '—'],
      ['Tags', label.tags?.length ? label.tags.join(', ') : '—'],
      ['Imagery', label.image_capture_date || '—'],
      ['Validations', `${label.num_agree} agree · ${label.num_disagree} disagree · ${label.num_unsure} unsure`],
    ];
    this.#ui.labelMeta.replaceChildren(...rows.flatMap(([term, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = String(value);
      return [dt, dd];
    }));
    this.#ui.labelMeta.hidden = false;
  }

  /**
   * Offers the example slots this label could fill, named by the app's own rules.
   *
   * The filenames come from `util.misc.tagSlug` rather than being assembled here, because a name this page invents
   * and a name the tooltips request have to be the same string or the photo is simply never shown.
   */
  #populateDestinations(label) {
    const type = label.label_type;
    const options = [];
    if (label.severity) options.push([`${type}/severity-${label.severity}`, `severity ${label.severity}`]);
    for (const tag of label.tags || []) {
      options.push([`${type}/tag-${util.misc.tagSlug(tag)}`, `tag “${tag}”`]);
    }
    // Every other tag on this label type, so a photo that happens to show one can still be filed under it.
    for (const tag of this.#tagsByType[type] || []) {
      const value = `${type}/tag-${util.misc.tagSlug(tag)}`;
      if (!options.some(([existing]) => existing === value)) options.push([value, `tag “${tag}” (not on this label)`]);
    }

    this.#ui.destination.replaceChildren(...options.map(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${value}  —  ${text}`;
      return option;
    }));
    const custom = document.createElement('option');
    custom.value = '';
    custom.textContent = 'Something else…';
    this.#ui.destination.appendChild(custom);
    this.#ui.destinationRow.hidden = false;
    this.#applyDestination();
  }

  /** Points the editor at the chosen destination, carrying any marks already placed over to the new key. */
  #applyDestination() {
    const chosen = this.#ui.destination.value;
    this.#ui.destinationCustomField.hidden = chosen !== '';
    const key = chosen || this.#ui.destinationCustom.value.trim().replace(/\.[a-z0-9]+$/i, '');
    if (key && key !== this.#key) {
      // Re-key rather than reset: renaming the destination mid-session should not throw away the marks.
      if (this.#key && this.#annotations[this.#key]) {
        this.#annotations[key] = this.#annotations[this.#key];
        delete this.#annotations[this.#key];
      }
      this.#key = key;
      this.#render();
      this.#renderManifest();
    }
    this.#renderDestinationPath();
  }

  #renderDestinationPath() {
    if (!this.#key) {
      this.#ui.destinationPath.textContent = '';
      return;
    }
    const filename = `${this.#key}.${this.#ui.format.value}`;
    this.#ui.destinationPath.textContent = `Exports as public/images/examples/${filename},`
      + ` keyed in the manifest as "${this.#key}".`;
  }

  #labelMsg(message, isError = false) {
    this.#ui.labelMsg.textContent = message;
    this.#ui.labelMsg.classList.toggle('error', !!isError);
  }

  /** @returns {Array<object>} This image's marks, creating the manifest entry on first write. */
  #marks() {
    return this.#annotations[this.#key]?.marks || [];
  }

  /**
   * @param {Array<object>} marks
   * @param {boolean} [recordHistory=true] - False while dragging, so one gesture is one undo step.
   */
  #setMarks(marks, recordHistory = true) {
    if (recordHistory) this.#pushHistory();
    if (marks.length === 0) delete this.#annotations[this.#key];
    else this.#annotations[this.#key] = { marks };
    this.#render();
    this.#renderManifest();
    this.#refreshSelectedOptionLabel();
  }

  /** Snapshots the current marks so Undo can step back through moves, not just additions. */
  #pushHistory() {
    if (!this.#key) return;
    if (!this.#history.has(this.#key)) this.#history.set(this.#key, []);
    const stack = this.#history.get(this.#key);
    stack.push(JSON.stringify(this.#marks()));
    if (stack.length > 50) stack.shift();
  }

  /**
   * Converts a pointer event into normalised image coordinates, clamped to the frame.
   * @param {PointerEvent} e
   * @returns {Array<number>} `[u, v]`, each 0-1, rounded to three places — finer than that is below one pixel of a
   *                          1440px image and only adds noise to the diff.
   */
  #normalise(e) {
    const rect = this.#ui.photo.getBoundingClientRect();
    const round = (n) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
    return [round((e.clientX - rect.left) / rect.width), round((e.clientY - rect.top) / rect.height)];
  }

  /** @returns {number} The photo's aspect ratio, or the 3:2 default before it has loaded. */
  #aspectRatio() {
    const photo = this.#ui.photo;
    return photo.naturalWidth && photo.naturalHeight ? photo.naturalWidth / photo.naturalHeight : 1.5;
  }

  /**
   * Distance in view units — the same space `renderExampleMarks` draws in, where one unit is equal on both axes.
   * Measuring in raw normalised units would make the grab radius wider than it is tall on any non-square photo.
   *
   * @param {Array<number>} a `[u, v]`
   * @param {Array<number>} b `[u, v]`
   * @returns {number}
   */
  #viewDistance(a, b) {
    const ar = this.#aspectRatio();
    return Math.hypot((a[0] - b[0]) * 100 * ar, (a[1] - b[1]) * 100);
  }

  /**
   * Finds the mark under the pointer, preferring an endpoint handle over the body.
   *
   * Searched newest-first so the mark drawn on top is the one grabbed, matching what the author sees.
   *
   * @param {Array<number>} at `[u, v]`
   * @returns {?{index: number, handle: string}} `handle` is `'from'`, `'to'`, `'at'`, or `'whole'`.
   */
  #hitTest(at) {
    const marks = this.#marks();
    const radius = ExampleAnnotatorPage.GRAB_RADIUS;
    for (let i = marks.length - 1; i >= 0; i--) {
      const mark = marks[i];
      if (mark.type === 'marker') {
        if (mark.at && this.#viewDistance(at, mark.at) <= radius * 2) return { index: i, handle: 'at' };
        continue;
      }
      if (!mark.from || !mark.to) continue;
      if (this.#viewDistance(at, mark.to) <= radius) return { index: i, handle: 'to' };
      if (this.#viewDistance(at, mark.from) <= radius) return { index: i, handle: 'from' };
      if (this.#distanceToSegment(at, mark.from, mark.to) <= radius) return { index: i, handle: 'whole' };
    }
    return null;
  }

  /**
   * @param {Array<number>} point `[u, v]`
   * @param {Array<number>} a Segment start `[u, v]`
   * @param {Array<number>} b Segment end `[u, v]`
   * @returns {number} Distance from the point to the segment, in view units.
   */
  #distanceToSegment(point, a, b) {
    const ar = this.#aspectRatio();
    const toView = (p) => [p[0] * 100 * ar, p[1] * 100];
    const [px, py] = toView(point);
    const [ax, ay] = toView(a);
    const [bx, by] = toView(b);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    // A zero-length segment is just its own endpoint; without this guard t would be NaN and the hit would be lost.
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  #onPointerDown(e) {
    if (!this.#ui.photo.naturalWidth) return;
    e.preventDefault();
    const at = this.#normalise(e);

    // Grabbing an existing mark wins over drawing a new one: a placed mark is the more valuable of the two, and a
    // new mark can always be started from empty space a few pixels away.
    const hit = this.#hitTest(at);
    if (hit) {
      this.#pushHistory();
      this.#drag = { mode: 'move', ...hit, origin: at, before: JSON.parse(JSON.stringify(this.#marks()[hit.index])) };
      this.#ui.stage.setPointerCapture(e.pointerId);
      return;
    }

    if (this.#ui.markType.value === 'marker') {
      this.#setMarks([...this.#marks(), { type: 'marker', at }]);
      return;
    }
    // The first press is the precise one, so it lands on the feature; the tail is set by wherever the drag ends.
    this.#drag = { mode: 'create', to: at, from: at };
    this.#ui.stage.setPointerCapture(e.pointerId);
  }

  #onPointerMove(e) {
    if (!this.#drag) return;
    const at = this.#normalise(e);
    if (this.#drag.mode === 'move') {
      this.#applyMove(at);
      return;
    }
    this.#drag.from = at;
    util.misc.renderExampleMarks(this.#ui.ghost, [this.#pendingMark()], this.#renderOptions());
  }

  #onPointerUp(e) {
    if (!this.#drag) return;
    if (this.#drag.mode === 'move') {
      this.#applyMove(this.#normalise(e));
      this.#cancelDrag();
      return;
    }
    this.#drag.from = this.#normalise(e);
    const mark = this.#pendingMark();
    this.#cancelDrag();
    // A stray click with no drag would store a zero-length mark that renders as a dot; treat it as a miss.
    const span = Math.hypot(mark.to[0] - mark.from[0], mark.to[1] - mark.from[1]);
    if (span < ExampleAnnotatorPage.MIN_MARK_SPAN) return;
    this.#setMarks([...this.#marks(), mark]);
  }

  /**
   * Moves the grabbed mark to follow the pointer.
   * @param {Array<number>} at `[u, v]`
   */
  #applyMove(at) {
    const { index, handle, origin, before } = this.#drag;
    const marks = this.#marks().slice();
    const round = (n) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;

    if (handle === 'whole') {
      // Whole-mark drags shift both ends by the same delta, so the arrow keeps its length and angle.
      const du = at[0] - origin[0];
      const dv = at[1] - origin[1];
      marks[index] = {
        ...before,
        from: [round(before.from[0] + du), round(before.from[1] + dv)],
        to: [round(before.to[0] + du), round(before.to[1] + dv)],
      };
    } else {
      marks[index] = { ...before, [handle]: at };
    }
    this.#setMarks(marks, false);
  }

  #pendingMark() {
    return { type: this.#ui.markType.value, from: this.#drag.from, to: this.#drag.to };
  }

  #cancelDrag() {
    this.#drag = null;
    this.#ui.ghost.replaceChildren();
  }

  #undo() {
    const stack = this.#history.get(this.#key);
    if (!stack || stack.length === 0) return;
    this.#setMarks(JSON.parse(stack.pop()), false);
  }

  #clear() {
    this.#setMarks([]);
  }

  /** @returns {object} Render options: the photo's true aspect ratio, and its label type for bare marker marks. */
  #renderOptions() {
    const labelType = (this.#key || '').split('/')[0];
    return {
      aspectRatio: this.#aspectRatio(),
      labelType: util.misc.VALID_LABEL_TYPES.includes(labelType) ? labelType : null,
    };
  }

  #render() {
    util.misc.renderExampleMarks(this.#ui.marks, this.#marks(), this.#renderOptions());
    const photo = this.#ui.photo;
    const count = this.#marks().length;
    const ratio = photo.naturalWidth ? (photo.naturalWidth / photo.naturalHeight).toFixed(2) : '';
    this.#ui.status.textContent = photo.naturalWidth
      ? `${photo.naturalWidth}×${photo.naturalHeight}, ${ratio}:1 — ${count} mark${count === 1 ? '' : 's'}`
      : '';
  }

  /** Constrains the stage to one of the real render widths, so a mark can be judged at the size it ships at. */
  #applyPreviewSize() {
    const width = Number(this.#ui.previewSize.value);
    this.#ui.stage.style.maxWidth = width ? `${width}px` : '';
  }

  #updateHint() {
    const place = this.#ui.markType.value === 'marker'
      ? 'Click where the label icon should sit.'
      : 'Press on the feature, drag out to clear space, release. The first press is the precise one.';
    this.#ui.hint.textContent = `${place} Drag a placed mark to move it, or grab an end to re-aim it.`;
  }

  /** Keeps the mark count in the picker honest as marks are added and removed. */
  #refreshSelectedOptionLabel() {
    const option = this.#ui.select.selectedOptions[0];
    if (!option || this.#ui.treePanel.hidden) return;
    const count = this.#marks().length;
    const name = option.value.split('/')[1];
    option.textContent = count ? `${name}  (${count})` : name;
  }

  /** @returns {string} The manifest, with one mark per line — compact enough to read a diff of. */
  #manifestText() {
    const keys = Object.keys(this.#annotations).filter((k) => k !== 'version').sort();
    const entries = keys.map((key) => {
      const marks = this.#annotations[key].marks.map((m) => `      ${JSON.stringify(m)}`).join(',\n');
      return `  ${JSON.stringify(key)}: {\n    "marks": [\n${marks}\n    ]\n  }`;
    });
    return `{\n  "version": 1${entries.length ? ',\n' : '\n'}${entries.join(',\n')}\n}\n`;
  }

  #renderManifest() {
    this.#ui.json.textContent = this.#manifestText();
  }

  async #copyManifest() {
    try {
      await navigator.clipboard.writeText(this.#manifestText());
      this.#flash(this.#ui.copy, 'Copied');
    } catch {
      this.#flash(this.#ui.copy, 'Copy failed — select the text below');
    }
  }

  #downloadManifest() {
    this.#download(new Blob([this.#manifestText()], { type: 'application/json' }), 'annotations.json');
  }

  /**
   * Exports the captured photo and the manifest together.
   *
   * One action rather than two buttons because the manifest keys the photo by name: exporting one without the other
   * leaves a mark record pointing at a file that does not exist, or a file nothing knows how to draw over.
   */
  async #export() {
    if (!this.#captured || !this.#key) return;
    const format = this.#ui.format.value;
    const blob = await this.#encode(this.#captured.dataUrl, format);
    // Flat filename: browsers strip directories from a download name, so the label type has to be re-created by hand
    // when the file is filed under public/images/examples/.
    this.#download(blob, `${this.#key.replace('/', '_')}.${format}`);
    this.#downloadManifest();
    this.#flash(this.#ui.exportBtn, 'Exported');
  }

  /**
   * Re-encodes the working PNG into the export format.
   * @param {string} dataUrl
   * @param {string} format - `'webp'` or `'png'`.
   * @returns {Promise<Blob>}
   */
  #encode(dataUrl, format) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        // q88 for WebP is the agreed example-imagery setting; PNG ignores the quality argument.
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))), `image/${format}`, 0.88);
      };
      image.onerror = () => reject(new Error('could not read the captured frame'));
      image.src = dataUrl;
    });
  }

  /**
   * @param {Blob} blob
   * @param {string} filename
   */
  #download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  #flash(button, message) {
    const original = button.textContent;
    button.textContent = message;
    setTimeout(() => {
      button.textContent = original;
    }, 1600);
  }
}
