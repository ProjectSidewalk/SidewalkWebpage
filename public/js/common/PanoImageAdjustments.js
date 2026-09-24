/**
 * Display-only image adjustments for a panorama mount: shadows, brightness and contrast (#3136).
 *
 * The adjustment is a CSS `filter` on the element the pano viewer renders into, so it works the same for every
 * imagery provider (GSV, Mapillary, Panoramax, Infra3d all draw into a canvas under that element) and touches nothing
 * layered over it — the label canvas, nav arrows and controls are siblings of the mount, not children. Label crops
 * are unaffected too: `Canvas.saveCanvasScreenshot` reads the provider's canvas with `toDataURL`, which never sees a
 * CSS filter, so the stored crop stays the raw imagery.
 *
 * Why three controls, and why Shadows first: the imagery people struggle with is usually a correctly exposed scene
 * whose sidewalk sits in a fence or tree shadow, with a bright sky in the same frame. A plain `brightness()`
 * multiplies every pixel, so the sky clips to white before the sidewalk is readable. Shadows is a gamma curve
 * (an SVG `feComponentTransfer`): it maps 0→0 and 1→1 and bows the middle up, lifting dark regions while the
 * highlights stay put — what Photoshop's Levels midpoint does. Brightness remains for imagery that is dark
 * everywhere (dusk, overcast captures) and Contrast for the flatness a shadow lift leaves behind. The curve runs
 * first in the filter chain so nothing clips before it.
 *
 * Settings persist in localStorage so a tuned view survives a reload and a new session. Reads are validated field
 * by field (a corrupt or future-shaped value falls back to the default rather than breaking the page) and writes are
 * wrapped so a blocked storage (private mode) degrades to "not remembered".
 *
 * Usage:
 *   const adjustments = new PanoImageAdjustments(document.getElementById('pano'));
 *   adjustments.set('shadows', 60);   // applies immediately and persists
 *   adjustments.reset();
 */
class PanoImageAdjustments {
  /** localStorage key holding `{ v, shadows, brightness, contrast }`. */
  static STORAGE_KEY = 'panoImageAdjustments';

  /** Version stamp stored beside the values, so a later shape change can migrate instead of misreading. */
  static STORAGE_VERSION = 1;

  /** Id of the injected SVG `<filter>` that implements the Shadows curve. */
  static FILTER_ID = 'ps-pano-tone-curve';

  /**
   * Each control's slider range and default. Values are integers a range input can hold directly; brightness and
   * contrast are percentages of the untouched image, shadows is a 0–100 strength that {@link gammaExponent} maps
   * onto the curve.
   * @type {Readonly<Record<'shadows'|'brightness'|'contrast',
   *   {min: number, max: number, step: number, default: number}>>}
   */
  static SPECS = Object.freeze({
    shadows: Object.freeze({ min: 0, max: 100, step: 1, default: 0 }),
    brightness: Object.freeze({ min: 50, max: 200, step: 5, default: 100 }),
    contrast: Object.freeze({ min: 50, max: 150, step: 5, default: 100 }),
  });

  /** The control names, in the order the UI shows them. */
  static KEYS = Object.freeze(/** @type {const} */ (['shadows', 'brightness', 'contrast']));

  /** Gamma exponent at Shadows = 100. Below ~0.4 the lift crushes what tonal separation the shadows had. */
  static #MIN_GAMMA_EXPONENT = 0.4;

  /** @type {HTMLElement} The pano mount the filter is applied to. */
  #target;

  /** @type {Storage|null} Where settings persist; null when storage is unavailable. */
  #storage;

  /** @type {Record<string, number>} Current values, always within their spec's range. */
  #values;

  /** @type {Array<(values: Record<string, number>) => void>} */
  #listeners = [];

  /** @type {SVGElement[]} The three feFunc nodes whose `exponent` carries the Shadows curve. */
  #gammaFuncs = [];

  /**
   * @param {HTMLElement} target - The element the pano viewer renders into.
   * @param {Storage|null} [storage] - Defaults to `window.localStorage`; pass null to disable persistence.
   */
  constructor(target, storage = PanoImageAdjustments.#defaultStorage()) {
    this.#target = target;
    this.#storage = storage;
    this.#values = this.#load();
    this.#apply();
  }

  /**
   * Maps the Shadows strength onto the gamma curve's exponent: 0 → 1 (identity), 100 → the floor.
   * @param {number} shadows - 0–100.
   * @returns {number} The exponent for `feFunc* type="gamma"`.
   */
  static gammaExponent(shadows) {
    const t = PanoImageAdjustments.#clamp(shadows, PanoImageAdjustments.SPECS.shadows) / 100;
    return 1 - (1 - PanoImageAdjustments.#MIN_GAMMA_EXPONENT) * t;
  }

  /**
   * Builds the CSS `filter` value for a set of values. Terms at their default are omitted, and a fully default set
   * yields the empty string, so the untouched state costs nothing and never references the SVG filter.
   * @param {Record<string, number>} values
   * @returns {string}
   */
  static filterString(values) {
    const { SPECS, FILTER_ID } = PanoImageAdjustments;
    const terms = [];
    // The curve runs first so the multiplicative terms can't clip highlights before it lifts the shadows.
    if (values.shadows !== SPECS.shadows.default) terms.push(`url(#${FILTER_ID})`);
    if (values.brightness !== SPECS.brightness.default) terms.push(`brightness(${values.brightness / 100})`);
    if (values.contrast !== SPECS.contrast.default) terms.push(`contrast(${values.contrast / 100})`);
    return terms.join(' ');
  }

  /**
   * @param {string} key - One of {@link KEYS}.
   * @returns {number}
   */
  get(key) {
    return this.#values[key];
  }

  /** @returns {Record<string, number>} A copy of the current values. */
  values() {
    return { ...this.#values };
  }

  /** @returns {boolean} True when every control is at its default. */
  isDefault() {
    return PanoImageAdjustments.KEYS.every((k) => this.#values[k] === PanoImageAdjustments.SPECS[k].default);
  }

  /**
   * Sets one control, clamped to its range, then applies, persists and notifies listeners.
   * @param {string} key - One of {@link KEYS}.
   * @param {number} value
   * @returns {number} The value actually stored.
   */
  set(key, value) {
    const spec = PanoImageAdjustments.SPECS[key];
    if (!spec) throw new Error(`PanoImageAdjustments: unknown control "${key}"`);
    const next = PanoImageAdjustments.#clamp(value, spec);
    if (next === this.#values[key]) return next;
    this.#values[key] = next;
    this.#apply();
    this.#save();
    this.#notify();
    return next;
  }

  /** Returns every control to its default. */
  reset() {
    if (this.isDefault()) return;
    for (const k of PanoImageAdjustments.KEYS) this.#values[k] = PanoImageAdjustments.SPECS[k].default;
    this.#apply();
    this.#save();
    this.#notify();
  }

  /**
   * Subscribes to value changes (after they are applied).
   * @param {(values: Record<string, number>) => void} fn
   */
  onChange(fn) {
    this.#listeners.push(fn);
  }

  /** @returns {string} The `filter` currently on the target ('' when default). */
  currentFilter() {
    return PanoImageAdjustments.filterString(this.#values);
  }

  /**
   * Writes the filter onto the target and the gamma exponent into the SVG curve. The SVG is only created the first
   * time Shadows leaves its default, so pages that never touch it never carry the extra element.
   */
  #apply() {
    const filter = PanoImageAdjustments.filterString(this.#values);
    if (this.#values.shadows !== PanoImageAdjustments.SPECS.shadows.default) {
      this.#ensureFilterSvg();
      const exponent = String(PanoImageAdjustments.gammaExponent(this.#values.shadows));
      for (const fn of this.#gammaFuncs) fn.setAttribute('exponent', exponent);
    }
    if (filter) {
      this.#target.style.filter = filter;
    } else {
      this.#target.style.removeProperty('filter');
    }
  }

  /**
   * Creates the `<svg><filter>` the Shadows term references, once per document. `color-interpolation-filters="sRGB"`
   * is deliberate: the default linearRGB would apply the curve to linear light and lift far less than the slider
   * suggests. Only R, G and B get the curve; alpha is left alone.
   */
  #ensureFilterSvg() {
    if (this.#gammaFuncs.length) return;
    const doc = this.#target.ownerDocument;
    const NS = 'http://www.w3.org/2000/svg';
    /** @type {Element|null} */
    let filter = doc.getElementById(PanoImageAdjustments.FILTER_ID);
    if (!filter) {
      const svg = doc.createElementNS(NS, 'svg');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.classList.add('ps-svg-defs');
      filter = doc.createElementNS(NS, 'filter');
      filter.setAttribute('id', PanoImageAdjustments.FILTER_ID);
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      const transfer = doc.createElementNS(NS, 'feComponentTransfer');
      for (const channel of ['feFuncR', 'feFuncG', 'feFuncB']) {
        const fn = doc.createElementNS(NS, channel);
        fn.setAttribute('type', 'gamma');
        fn.setAttribute('amplitude', '1');
        fn.setAttribute('exponent', '1');
        fn.setAttribute('offset', '0');
        transfer.appendChild(fn);
      }
      filter.appendChild(transfer);
      svg.appendChild(filter);
      doc.body.appendChild(svg);
    }
    this.#gammaFuncs = Array.from(filter.querySelectorAll('feFuncR, feFuncG, feFuncB'));
  }

  /**
   * Reads the stored values, taking each field only if it is a finite number within its range.
   * @returns {Record<string, number>}
   */
  #load() {
    const values = {};
    for (const k of PanoImageAdjustments.KEYS) values[k] = PanoImageAdjustments.SPECS[k].default;
    if (!this.#storage) return values;
    let stored;
    try {
      stored = JSON.parse(this.#storage.getItem(PanoImageAdjustments.STORAGE_KEY));
    } catch {
      return values;
    }
    // A record from a different format version is ignored rather than half-read; migrate here when one exists.
    if (!stored || typeof stored !== 'object' || stored.v !== PanoImageAdjustments.STORAGE_VERSION) return values;
    for (const k of PanoImageAdjustments.KEYS) {
      const spec = PanoImageAdjustments.SPECS[k];
      const v = stored[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= spec.min && v <= spec.max) {
        values[k] = PanoImageAdjustments.#clamp(v, spec);
      }
    }
    return values;
  }

  /** Persists the current values; a blocked storage is not an error, the settings just don't survive a reload. */
  #save() {
    if (!this.#storage) return;
    try {
      const payload = { v: PanoImageAdjustments.STORAGE_VERSION, ...this.#values };
      this.#storage.setItem(PanoImageAdjustments.STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage can be unavailable (private mode, quota); applying still works for this visit.
    }
  }

  #notify() {
    const snapshot = this.values();
    for (const fn of this.#listeners) fn(snapshot);
  }

  /**
   * Snaps a value to the control's step and holds it within its range, so the model never carries a value the
   * slider can't show (a stored 103 would otherwise render as 105 while the pano used 1.03).
   * @param {number} value
   * @param {{min: number, max: number, step: number, default: number}} spec
   * @returns {number} The snapped, clamped value, or the default when `value` isn't a finite number.
   */
  static #clamp(value, spec) {
    const n = Number(value);
    if (!Number.isFinite(n)) return spec.default;
    const snapped = spec.min + Math.round((n - spec.min) / spec.step) * spec.step;
    return Math.min(spec.max, Math.max(spec.min, snapped));
  }

  /** @returns {Storage|null} localStorage when the browser lets us touch it, else null. */
  static #defaultStorage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
}
