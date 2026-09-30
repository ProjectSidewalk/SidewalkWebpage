/**
 * A radio group of label-type chips for choosing what type a label should be (#3671), built from the label-type table
 * the backend stamps on every page. Enter is left alone on purpose: the hosting tools use it for their own submit.
 */
class LabelTypePicker {
  static #KEY_NEXT = new Set(['ArrowRight', 'ArrowDown']);
  static #KEY_PREV = new Set(['ArrowLeft', 'ArrowUp']);

  #root;
  #onPick;
  #onToggle;
  /** @type {HTMLButtonElement[]} */
  #chips = [];
  #currentType = null;
  #selectedType = null;
  #collapsed = false;
  #commitsOnPick = false;

  /**
   * @param {HTMLElement} root - The element to fill; it becomes the radio group.
   * @param {{onPick: (labelType: string) => void, onToggle?: (expanded: boolean) => void,
   *   commitsOnPick?: boolean}} opts - The callbacks fire on user action only, never from `render` or `collapse`,
   *   so a host can redraw saved state without re-triggering itself. Set `commitsOnPick` where a pick saves
   *   straight away; the arrows then only move, rather than saving a type per keypress on the way past.
   */
  constructor(root, { onPick, onToggle = () => {}, commitsOnPick = false }) {
    this.#root = root;
    this.#onPick = onPick;
    this.#onToggle = onToggle;
    this.#commitsOnPick = commitsOnPick;
    root.classList.add('label-type-picker');
    root.setAttribute('role', 'radiogroup');
    root.addEventListener('click', this.#handleClick);
    // On window, because every pano viewer stops the arrow keys there before anything deeper can see them.
    window.addEventListener('keydown', this.#handleKeydown, { capture: true });
  }

  /**
   * @param {{current?: string|null, selected?: string|null}} state - `current` is the label's own type, shown but not
   *   pickable since picking it would mean no change; `selected` is the type picked so far.
   */
  render({ current = null, selected = null } = {}) {
    const hadFocus = this.#root.contains(document.activeElement);
    this.#currentType = current;
    this.#selectedType = selected;
    this.#collapsed = false;
    this.#root.replaceChildren();
    this.#chips = util.misc.VALID_LABEL_TYPES.map((labelType) => this.#buildChip(labelType));
    this.#root.append(...this.#chips);
    this.#syncState();
    // Focus rides along to the rebuilt chip, so arrowing through the group survives a host redrawing on every pick.
    if (hadFocus) this.#chips.find((c) => c.tabIndex === 0)?.focus();
  }

  /**
   * Marks a type as picked without firing `onPick`, for a host restoring saved state.
   * @param {string|null} labelType
   */
  setSelected(labelType) {
    this.#selectedType = labelType;
    this.#syncState();
  }

  /** @returns {string|null} The picked type, or null when nothing has been picked yet. */
  getSelected() {
    return this.#selectedType;
  }

  /** Folds the group down to the picked chip, which reopens it on click. No-op until something is picked. */
  collapse() {
    if (this.#selectedType === null) return;
    this.#collapsed = true;
    this.#syncState();
  }

  /** @returns {HTMLButtonElement} */
  #buildChip(labelType) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'label-type-picker__chip';
    chip.dataset.labelType = labelType;
    chip.setAttribute('role', 'radio');
    chip.style.setProperty('--label-color', util.misc.getLabelColors(labelType));

    const name = i18next.t(`common:${util.camelToKebab(labelType)}`).replace('&shy;', '');
    const isCurrent = labelType === this.#currentType;
    chip.innerHTML = `
      <img class="label-type-picker__icon" src="${util.misc.getIconImagePaths(labelType).iconImagePath}" alt="">
      <span class="label-type-picker__name">${name}</span>
      <span class="label-type-picker__change">${i18next.t('common:label-type-picker.change')}</span>`;
    if (isCurrent) {
      chip.classList.add('label-type-picker__chip--current');
      chip.setAttribute('aria-disabled', 'true');
      chip.setAttribute('aria-label', i18next.t('common:label-type-picker.current', { labelType: name }));
    }
    return chip;
  }

  /** Reflects the selection into aria-checked and the roving tabindex. */
  #syncState() {
    const focusable = this.#chips.find((c) => c.dataset.labelType === this.#selectedType)
      ?? this.#chips.find((c) => c.getAttribute('aria-disabled') !== 'true');
    this.#root.classList.toggle('label-type-picker--collapsed', this.#collapsed);
    for (const chip of this.#chips) {
      const checked = chip.dataset.labelType === this.#selectedType;
      chip.setAttribute('aria-checked', String(checked));
      chip.classList.toggle('label-type-picker__chip--selected', checked);
      chip.hidden = this.#collapsed && !checked;
      chip.tabIndex = chip === focusable ? 0 : -1;
    }
  }

  #pick(chip) {
    if (chip.getAttribute('aria-disabled') === 'true') return;
    const labelType = chip.dataset.labelType;
    if (labelType === this.#selectedType) {
      // Picking what is already picked means "this one", so a host that acts on a pick just closes up.
      if (this.#commitsOnPick) {
        this.#onPick(labelType);
        return;
      }
      this.#collapsed = !this.#collapsed;
      this.#syncState();
      this.#onToggle(!this.#collapsed);
      return;
    }
    this.#selectedType = labelType;
    this.#syncState();
    this.#onPick(labelType);
  }

  #handleClick = (e) => {
    const chip = /** @type {HTMLElement} */ (e.target).closest('.label-type-picker__chip');
    if (chip) this.#pick(/** @type {HTMLButtonElement} */ (chip));
  };

  /**
   * Arrow keys move focus and pick, as in a native radio group; the current type's chip is skipped over. Under
   * `commitsOnPick` they only move, and Space or Enter on the chip picks, the way a menu works.
   * @param {KeyboardEvent} e
   */
  #handleKeydown = (e) => {
    if (!this.#root.contains(document.activeElement)) return;
    const isNext = LabelTypePicker.#KEY_NEXT.has(e.key);
    if (!isNext && !LabelTypePicker.#KEY_PREV.has(e.key)) return;
    // Folded down, only the picked chip is on screen, so there is nothing to move between yet: the press opens the
    // group back up and then moves, the keyboard's version of clicking the picked chip.
    if (this.#collapsed) {
      this.#collapsed = false;
      this.#syncState();
      this.#onToggle(true);
    }
    const pickable = this.#chips.filter((c) => c.getAttribute('aria-disabled') !== 'true');
    const from = pickable.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    if (from === -1) return;
    e.preventDefault();
    e.stopPropagation(); // The pano viewer under the tool also listens for arrows and would pan the imagery.
    const to = pickable[(from + (isNext ? 1 : pickable.length - 1)) % pickable.length];
    to.focus();
    if (!this.#commitsOnPick) {
      this.#pick(to);
      return;
    }
    // Tab has to land back on wherever the arrows left off rather than on the picked chip.
    for (const chip of this.#chips) chip.tabIndex = chip === to ? 0 : -1;
  };
}

/**
 * A label's type as a title you can click to change it (#3671, #5409), over the labelTypeTrigger and
 * labelTypePopover templates. A real popover where the browser has them, so the chips can spill outside the card
 * they open from, and a plain block where it doesn't.
 */
class LabelTypeDropdown {
  static #popoverSupported = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

  #static;
  #button;
  #names;
  #icons;
  #popover;
  #picker;
  #onOpen;
  #onClose;

  /**
   * @param {HTMLElement} triggerHost - The element holding the components/labelTypeTrigger markup.
   * @param {HTMLElement} popover - The components/labelTypePopover element.
   * @param {object} opts
   * @param {() => boolean} opts.onOpen - Runs before opening; draw the chips with `picker.render` here, and return
   *   false to keep it shut.
   * @param {(labelType: string) => void} opts.onPick - A type was picked; the popover has already closed.
   * @param {() => void} [opts.onClose] - The popover closed, by whatever means.
   * @param {?string} [opts.hint] - A line shown above the chips.
   */
  constructor(triggerHost, popover, { onOpen, onPick, onClose = () => {}, hint = null }) {
    this.#static = triggerHost.querySelector('.label-type-trigger--static');
    this.#button = /** @type {HTMLButtonElement} */ (triggerHost.querySelector('.label-type-trigger__button'));
    this.#names = triggerHost.querySelectorAll('.label-type-trigger__name');
    this.#icons = /** @type {NodeListOf<HTMLImageElement>} */ (
      triggerHost.querySelectorAll('.label-type-trigger__icon'));
    this.#popover = popover;
    this.#onOpen = onOpen;
    this.#onClose = onClose;

    const hintEl = /** @type {HTMLElement} */ (popover.querySelector('.label-type-popover__hint'));
    if (hint) {
      hintEl.textContent = hint;
      hintEl.hidden = false;
    }
    this.#picker = new LabelTypePicker(popover.querySelector('.label-type-popover__chips'), {
      commitsOnPick: true,
      onPick: (labelType) => {
        // A keyboard pick leaves focus on a chip that is about to go away, so it goes back to the button.
        const fromKeyboard = this.#popover.contains(document.activeElement);
        this.setOpen(false);
        if (fromKeyboard) this.#button.focus();
        onPick(labelType);
      },
    });

    if (LabelTypeDropdown.#popoverSupported) {
      // Native toggling, so a click on the open button closes it instead of racing its own light dismiss.
      popover.hidden = false;
      this.#button.popoverTargetElement = popover;
      popover.addEventListener('beforetoggle', (e) => {
        const opening = /** @type {ToggleEvent} */ (e).newState === 'open';
        if (!opening) return;
        if (!this.#mayOpen()) e.preventDefault();
        else this.#place();
      });
      popover.addEventListener('toggle', (e) => {
        const open = /** @type {ToggleEvent} */ (e).newState === 'open';
        this.#button.setAttribute('aria-expanded', String(open));
        if (open) {
          this.#place();
          this.#focusChips();
        } else {
          this.#onClose();
        }
      });
    } else {
      this.#button.addEventListener('click', () => this.setOpen(!this.isOpen()));
    }
  }

  /** @returns {LabelTypePicker} The chips, for the host to draw in `onOpen`. */
  get picker() {
    return this.#picker;
  }

  /** @returns {HTMLButtonElement} The button, for a host that puts a tooltip on it. */
  get button() {
    return this.#button;
  }

  /** @param {string} labelType - The type to draw into both the plain title and the button. */
  setType(labelType) {
    const name = i18next.t(`common:${util.camelToKebab(labelType)}`).replaceAll('&shy;', '­');
    for (const el of this.#names) el.textContent = name;
    for (const el of this.#icons) el.src = util.misc.getIconImagePaths(labelType).iconImagePath;
    // The name first, then what pressing does (WCAG 2.5.3), minus the soft hyphen a screen reader reads as a break.
    const spoken = name.replaceAll('­', '');
    this.#button.setAttribute('aria-label', `${spoken}: ${i18next.t('common:label-type-picker.change-type')}`);
  }

  /** @param {boolean} editable - True shows the button, false the plain title. */
  setEditable(editable) {
    this.#button.hidden = !editable;
    if (this.#static) this.#static.hidden = editable;
    if (!editable) this.setOpen(false);
  }

  /** @param {boolean} disabled - Keeps the button on screen but inert, for a change that can't be made right now. */
  setDisabled(disabled) {
    this.#button.setAttribute('aria-disabled', String(disabled));
    if (disabled) this.setOpen(false);
  }

  /** @returns {boolean} Whether the popover is showing. */
  isOpen() {
    if (LabelTypeDropdown.#popoverSupported) return this.#popover.matches(':popover-open');
    return !this.#popover.hidden;
  }

  /** @param {boolean} open - Whether to show the popover; refused while disabled or if `onOpen` says no. */
  setOpen(open) {
    if (open === this.isOpen()) return;
    if (LabelTypeDropdown.#popoverSupported) {
      if (open) this.#popover.showPopover(); // beforetoggle asks #mayOpen, which may refuse.
      else this.#popover.hidePopover();
      return;
    }
    if (open && !this.#mayOpen()) return;
    this.#popover.hidden = !open;
    this.#button.setAttribute('aria-expanded', String(open));
    if (open) this.#focusChips();
    else this.#onClose();
  }

  /**
   * @param {?Element} el
   * @returns {boolean} Whether `el` is inside the popover, for a host keeping its key shortcuts off the chips.
   */
  contains(el) {
    return Boolean(el && this.#popover.contains(el));
  }

  /** @returns {boolean} Whether the popover may open; asks the host, which also draws the chips. */
  #mayOpen() {
    return this.#button.getAttribute('aria-disabled') !== 'true' && this.#onOpen();
  }

  /** Opening has to land focus in the list, or the arrow keys have nothing to move from. */
  #focusChips() {
    /** @type {?HTMLElement} */ (this.#popover.querySelector('.label-type-picker__chip[tabindex="0"]'))?.focus();
  }

  /** Parks the popover under its button, since a popover opens centered in the window by default. */
  #place() {
    util.placePopover(this.#popover, this.#button);
  }
}
