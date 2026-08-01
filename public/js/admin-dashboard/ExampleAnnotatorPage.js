/**
 * Authoring tool for example-image annotation marks (#4723).
 *
 * Marks live as data in `public/images/examples/annotations.json` rather than baked into the photos, so they can be
 * repositioned or restyled without re-exporting a raster. That trade only pays off if placing a mark is easier than
 * opening an image editor, which is this page's whole job.
 *
 * Rendering is delegated to `util.misc.renderExampleMarks` — the same call the tooltips will use — so the preview is
 * the result rather than an approximation of it.
 */
class ExampleAnnotatorPage {
  #tree;
  #annotations;
  #ui = {};
  #drag = null;
  #key = null;

  /**
   * @param {Array<string>} imageTree - Example image paths relative to examples/, e.g. "CurbRamp/tag-narrow.png".
   * @param {object} annotations - The stored manifest, or `{}` if none has been committed yet.
   */
  constructor(imageTree, annotations) {
    this.#tree = imageTree;
    this.#annotations = annotations && typeof annotations === 'object' ? annotations : {};
    if (!this.#annotations.version) this.#annotations.version = 1;
  }

  init() {
    const id = (name) => document.getElementById(name);
    this.#ui = {
      select: id('ex-image-select'), markType: id('ex-mark-type'), previewSize: id('ex-preview-size'),
      undo: id('ex-undo'), clear: id('ex-clear'), copy: id('ex-copy'), download: id('ex-download'),
      stage: id('ex-stage'), photo: id('ex-photo'), marks: id('ex-marks'), ghost: id('ex-ghost'),
      json: id('ex-json'), status: id('ex-status'), hint: id('ex-hint'),
    };

    this.#populateImageSelect();
    this.#ui.select.addEventListener('change', () => this.#loadImage(this.#ui.select.value));
    this.#ui.markType.addEventListener('change', () => this.#updateHint());
    this.#ui.previewSize.addEventListener('change', () => this.#applyPreviewSize());
    this.#ui.undo.addEventListener('click', () => this.#undo());
    this.#ui.clear.addEventListener('click', () => this.#clear());
    this.#ui.copy.addEventListener('click', () => this.#copyManifest());
    this.#ui.download.addEventListener('click', () => this.#downloadManifest());

    // Pointer events rather than mouse, so a trackpad drag and a stylus behave the same.
    this.#ui.stage.addEventListener('pointerdown', (e) => this.#onPointerDown(e));
    this.#ui.stage.addEventListener('pointermove', (e) => this.#onPointerMove(e));
    this.#ui.stage.addEventListener('pointerup', (e) => this.#onPointerUp(e));
    this.#ui.stage.addEventListener('pointercancel', () => this.#cancelDrag());

    // The photo dictates the overlay's viewBox, so marks can only be drawn once its aspect ratio is known.
    this.#ui.photo.addEventListener('load', () => this.#render());

    this.#loadImage(this.#ui.select.value);
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

  #loadImage(path) {
    if (!path) return;
    this.#key = this.#keyFor(path);
    this.#ui.photo.src = `/assets/images/examples/${path}`;
    this.#ui.photo.alt = `Example image ${path}`;
    this.#applyPreviewSize();
  }

  /** @returns {Array<object>} This image's marks, creating the manifest entry on first write. */
  #marks() {
    return this.#annotations[this.#key]?.marks || [];
  }

  #setMarks(marks) {
    if (marks.length === 0) delete this.#annotations[this.#key];
    else this.#annotations[this.#key] = { marks };
    this.#render();
    this.#renderManifest();
    this.#refreshSelectedOptionLabel();
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

  #onPointerDown(e) {
    if (!this.#ui.photo.naturalWidth) return;
    e.preventDefault();
    const at = this.#normalise(e);
    if (this.#ui.markType.value === 'marker') {
      this.#setMarks([...this.#marks(), { type: 'marker', at }]);
      return;
    }
    // The first press is the precise one, so it lands on the feature; the tail is set by wherever the drag ends.
    this.#drag = { to: at, from: at };
    this.#ui.stage.setPointerCapture(e.pointerId);
  }

  #onPointerMove(e) {
    if (!this.#drag) return;
    this.#drag.from = this.#normalise(e);
    util.misc.renderExampleMarks(this.#ui.ghost, [this.#pendingMark()], this.#renderOptions());
  }

  #onPointerUp(e) {
    if (!this.#drag) return;
    this.#drag.from = this.#normalise(e);
    const mark = this.#pendingMark();
    this.#cancelDrag();
    // A stray click with no drag would store a zero-length mark that renders as a dot; treat it as a miss.
    const span = Math.hypot(mark.to[0] - mark.from[0], mark.to[1] - mark.from[1]);
    if (span < 0.03) return;
    this.#setMarks([...this.#marks(), mark]);
  }

  #pendingMark() {
    return { type: this.#ui.markType.value, from: this.#drag.from, to: this.#drag.to };
  }

  #cancelDrag() {
    this.#drag = null;
    this.#ui.ghost.replaceChildren();
  }

  #undo() {
    this.#setMarks(this.#marks().slice(0, -1));
  }

  #clear() {
    this.#setMarks([]);
  }

  /** @returns {object} Render options: the photo's true aspect ratio, and its label type for bare marker marks. */
  #renderOptions() {
    const photo = this.#ui.photo;
    const labelType = (this.#key || '').split('/')[0];
    return {
      aspectRatio: photo.naturalWidth && photo.naturalHeight ? photo.naturalWidth / photo.naturalHeight : 1.5,
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
    this.#ui.hint.textContent = this.#ui.markType.value === 'marker'
      ? 'Click where the label icon should sit.'
      : 'Press on the feature, drag out to clear space, release. The first press is the precise one.';
  }

  /** Keeps the mark count in the picker honest as marks are added and removed. */
  #refreshSelectedOptionLabel() {
    const option = this.#ui.select.selectedOptions[0];
    if (!option) return;
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
    const url = URL.createObjectURL(new Blob([this.#manifestText()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'annotations.json';
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
