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

  /**
   * @param {HTMLElement} root - The element to fill; it becomes the radio group.
   * @param {{onPick: (labelType: string) => void, onToggle?: (expanded: boolean) => void}} opts - Both fire on user
   *   action only, never from `render` or `collapse`, so a host can redraw from saved state without re-triggering
   *   itself. `onToggle` reports a collapsed group being opened back up (or folded again).
   */
  constructor(root, { onPick, onToggle = () => {} }) {
    this.#root = root;
    this.#onPick = onPick;
    this.#onToggle = onToggle;
    root.classList.add('label-type-picker');
    root.setAttribute('role', 'radiogroup');
    root.addEventListener('click', this.#handleClick);
    root.addEventListener('keydown', this.#handleKeydown);
  }

  /**
   * @param {{current?: string|null, selected?: string|null}} state - `current` is the label's own type, shown but not
   *   pickable since picking it would mean no change; `selected` is the type picked so far.
   */
  render({ current = null, selected = null } = {}) {
    this.#currentType = current;
    this.#selectedType = selected;
    this.#collapsed = false;
    this.#root.replaceChildren();
    this.#chips = util.misc.VALID_LABEL_TYPES.map((labelType) => this.#buildChip(labelType));
    this.#root.append(...this.#chips);
    this.#syncState();
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
   * Arrow keys move focus and pick, as in a native radio group; the current type's chip is skipped over.
   * @param {KeyboardEvent} e
   */
  #handleKeydown = (e) => {
    const isNext = LabelTypePicker.#KEY_NEXT.has(e.key);
    if (!isNext && !LabelTypePicker.#KEY_PREV.has(e.key)) return;
    const pickable = this.#chips.filter((c) => c.getAttribute('aria-disabled') !== 'true');
    const from = pickable.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    if (from === -1) return;
    e.preventDefault();
    e.stopPropagation(); // The pano viewer under the tool also listens for arrows and would pan the imagery.
    const to = pickable[(from + (isNext ? 1 : pickable.length - 1)) % pickable.length];
    to.focus();
    this.#pick(to);
  };
}
