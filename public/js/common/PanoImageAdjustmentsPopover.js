/**
 * The Image adjustments panel: a pill button that opens a popover of sliders bound to a {@link PanoImageAdjustments}
 * model (#3136).
 *
 * The markup lives in app/views/common/panoImageAdjustments.scala.html (id="pano-image-adjustments") so its text
 * goes through i18n; this class only wires it. Slider ranges come from the model's SPECS rather than the markup, so
 * there is one place that knows what "100" means. The popover uses the native Popover API like PanoInfoPopover,
 * positioned by JS below the button, and falls back to the `hidden` attribute where the API is missing.
 *
 * Page-specific concerns — what to log, and suspending the page's keyboard shortcuts so Arrow keys nudge a slider
 * instead of panning the pano — are injected as callbacks, which keeps the class mountable on any page with a pano.
 *
 * Usage (Explore):
 *   new PanoImageAdjustmentsPopover(svl.imageAdjustments, button, popoverEl, {
 *     onOpen: () => svl.keyboard.disableKeyboard(),
 *     onClose: () => svl.keyboard.enableKeyboard(),
 *     onChange: (values) => svl.tracker.push('ImageAdjustments_Change', values),
 *   });
 */
class PanoImageAdjustmentsPopover {
  /** Class on the trigger while any control is off its default, so a persisted setting isn't a mystery later. */
  static ACTIVE_CLASS = 'pano-overlay-button--active';

  /** @type {PanoImageAdjustments} */
  #model;

  /** @type {HTMLElement} */
  #button;

  /** @type {HTMLElement} */
  #popover;

  /** @type {Record<string, HTMLInputElement>} Slider per control name. */
  #sliders = {};

  /** @type {Record<string, HTMLElement>} Live value readout per control name. */
  #outputs = {};

  /** @type {HTMLButtonElement|null} */
  #resetButton;

  /** @type {{onOpen: Function, onClose: Function, onChange: Function, onReset: Function}} */
  #hooks;

  /**
   * @param {PanoImageAdjustments} model
   * @param {HTMLElement} button - The trigger. Gets `aria-expanded`, `aria-controls` and the active-dot class.
   * @param {HTMLElement} popover - The `#pano-image-adjustments` element from the Twirl partial.
   * @param {object} [hooks]
   * @param {() => void} [hooks.onOpen] - Called when the panel opens (log it; suspend page shortcuts).
   * @param {() => void} [hooks.onClose] - Called when the panel closes by any path.
   * @param {(values: Record<string, number>) => void} [hooks.onChange] - Called once per committed slider change
   *     (the `change` event, i.e. on release), with the resulting values. Not called per pixel of drag.
   * @param {() => void} [hooks.onReset] - Called when the Reset button is used.
   */
  constructor(model, button, popover, hooks = {}) {
    this.#model = model;
    this.#button = button;
    this.#popover = popover;
    this.#hooks = {
      onOpen: hooks.onOpen || (() => {}),
      onClose: hooks.onClose || (() => {}),
      onChange: hooks.onChange || (() => {}),
      onReset: hooks.onReset || (() => {}),
    };

    if (!this.#button || !this.#popover) {
      console.error('PanoImageAdjustmentsPopover: trigger or #pano-image-adjustments missing. '
        + 'Include @common.panoImageAdjustments() in the view.');
      return;
    }

    this.#button.setAttribute('aria-expanded', 'false');
    this.#button.setAttribute('aria-controls', this.#popover.id);
    this.#button.setAttribute('aria-haspopup', 'dialog');

    this.#wireSliders();
    this.#resetButton = this.#popover.querySelector('[data-action="reset"]');
    this.#resetButton?.addEventListener('click', () => {
      this.#model.reset();
      this.#hooks.onReset();
      this.#sliders[PanoImageAdjustments.KEYS[0]]?.focus();
    });

    this.#popover.querySelector('[data-action="close"]')?.addEventListener('click', () => this.close());
    this.#button.addEventListener('click', () => (this.isOpen() ? this.close() : this.open()));

    // Light dismiss: a click anywhere outside the panel and its trigger closes it. Clicking the pano to pan counts.
    document.addEventListener('click', (e) => {
      const target = /** @type {Node} */ (e.target);
      if (this.isOpen() && !this.#popover.contains(target) && !this.#button.contains(target)) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        e.stopPropagation();
        this.close();
      }
    }, { capture: true });

    this.#model.onChange(() => this.#render());
    this.#render();
  }

  /** @returns {boolean} */
  isOpen() {
    return this.#button.getAttribute('aria-expanded') === 'true';
  }

  /** Opens the panel below the trigger and moves focus to the first slider. */
  open() {
    if (this.isOpen()) return;
    this.#button.setAttribute('aria-expanded', 'true');
    if (typeof this.#popover.showPopover === 'function') {
      this.#popover.showPopover();
    } else {
      this.#popover.removeAttribute('hidden');
    }
    this.#position();
    this.#hooks.onOpen();
    this.#sliders[PanoImageAdjustments.KEYS[0]]?.focus();
  }

  /** Closes the panel, returning focus to the trigger if it was inside. */
  close() {
    if (!this.isOpen()) return;
    const hadFocus = this.#popover.contains(document.activeElement);
    this.#button.setAttribute('aria-expanded', 'false');
    if (typeof this.#popover.hidePopover === 'function') {
      this.#popover.hidePopover();
    } else {
      this.#popover.setAttribute('hidden', '');
    }
    this.#hooks.onClose();
    if (hadFocus) this.#button.focus();
  }

  /** Binds each `[data-adjust]` slider to its control: range from SPECS, `input` applies, `change` logs. */
  #wireSliders() {
    for (const key of PanoImageAdjustments.KEYS) {
      const slider = /** @type {HTMLInputElement|null} */ (this.#popover.querySelector(`[data-adjust="${key}"]`));
      if (!slider) continue;
      const spec = PanoImageAdjustments.SPECS[key];
      slider.min = String(spec.min);
      slider.max = String(spec.max);
      slider.step = String(spec.step);
      this.#sliders[key] = slider;
      this.#outputs[key] = this.#popover.querySelector(`[data-adjust-value="${key}"]`);

      slider.addEventListener('input', () => this.#model.set(key, Number(slider.value)));
      slider.addEventListener('change', () => this.#hooks.onChange(this.#model.values()));
    }
  }

  /** Reflects the model into the sliders, readouts, Reset button and the trigger's active dot. */
  #render() {
    const atDefault = this.#model.isDefault();
    for (const key of PanoImageAdjustments.KEYS) {
      const value = this.#model.get(key);
      const slider = this.#sliders[key];
      if (slider && Number(slider.value) !== value) slider.value = String(value);
      const readout = PanoImageAdjustmentsPopover.formatValue(key, value);
      if (slider) slider.setAttribute('aria-valuetext', readout);
      if (this.#outputs[key]) this.#outputs[key].textContent = readout;
    }
    if (this.#resetButton) this.#resetButton.disabled = atDefault;
    this.#button.classList.toggle(PanoImageAdjustmentsPopover.ACTIVE_CLASS, !atDefault);
  }

  /**
   * The readout beside a slider: shadows as a signed strength, the percentage controls as percentages.
   * @param {string} key
   * @param {number} value
   * @returns {string}
   */
  static formatValue(key, value) {
    if (key === 'shadows') return value > 0 ? `+${value}` : '0';
    return `${value}%`;
  }

  /** Places the panel under the trigger, left edges aligned, clamped to the viewport. */
  #position() {
    const uiScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const gap = 6 * uiScale;
    const margin = 8;
    const btn = this.#button.getBoundingClientRect();
    const pop = this.#popover.getBoundingClientRect();
    let left = btn.left;
    let top = btn.bottom + gap;
    left = Math.max(margin, Math.min(left, window.innerWidth - pop.width - margin));
    // Below is the natural spot; only flip above when there is no room.
    if (top + pop.height > window.innerHeight - margin && btn.top - gap - pop.height >= margin) {
      top = btn.top - gap - pop.height;
    }
    this.#popover.style.left = `${Math.round(left)}px`;
    this.#popover.style.top = `${Math.round(top)}px`;
  }
}
