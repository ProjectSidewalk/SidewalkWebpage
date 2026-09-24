/**
 * A row of one-tap reasons for a Disagree or Unsure vote, plus "Other…" for a typed one (#5475).
 *
 * The same component on every surface that asks "why?" after a vote — the label detail card and the Gallery cards
 * today — so the vocabulary, the keyboard handling and the accessible shape are written once. The reasons come
 * from `util.validationReasons`, the catalog the backend stamps on every page; the host stores the pick, since how
 * the pick is posted differs per surface.
 *
 * Accessible shape: a `group` named by the prompt, one toggle button per reason (`aria-pressed` marks the one on
 * record) with a roving tabindex and arrow keys between them, and the "Other…" button beside the group. Toggle
 * buttons rather than radios: a pick posts at once, so an arrow that *selected* as it moved would file a reason per
 * keypress on the way past. Nothing is required — the vote is already saved when the row appears — so a reader who
 * does not care can move on. Number keys are the host's to route (it knows when it owns the keyboard);
 * `pickByNumber` does the picking.
 */
class ReasonChips {
  static #KEY_NEXT = new Set(['ArrowRight', 'ArrowDown']);
  static #KEY_PREV = new Set(['ArrowLeft', 'ArrowUp']);

  #root;
  #onPick;
  #onOther;
  #showKeys;
  /** @type {HTMLButtonElement[]} */
  #chips = [];
  /** @type {?HTMLButtonElement} */
  #otherButton = null;
  #selected = null;
  #busy = false;

  /**
   * @param {HTMLElement} root - The element to fill; hidden while there is nothing to offer.
   * @param {object} opts
   * @param {(id: string, viaKeyboard: boolean) => void} opts.onPick - A reason was chosen. Not fired for the
   *     chip already selected: picking what is picked is a no-op, not an unpick, so a stray tap can't erase one.
   * @param {(viaKeyboard: boolean) => void} opts.onOther - "Other…" was chosen; the host opens its comment box.
   * @param {boolean} [opts.showKeys=false] - Name each chip's number key in its tooltip, on a host that routes the
   *     number keys here. Off for touch surfaces, where a key number is noise.
   */
  constructor(root, { onPick, onOther, showKeys = false }) {
    this.#root = root;
    this.#onPick = onPick;
    this.#onOther = onOther;
    this.#showKeys = showKeys;
    root.classList.add('reason-chips');
    root.hidden = true;
    root.addEventListener('click', this.#handleClick);
    root.addEventListener('keydown', this.#handleKeydown);
  }

  /**
   * Draws the reasons for a label type and vote, or empties and hides the row when there are none (an Agree, or a
   * type with no canned reasons, like Other).
   *
   * @param {object} state
   * @param {string} state.labelType - The label's type.
   * @param {?string} state.vote - The vote to explain: 'Disagree' or 'Unsure'; anything else clears the row.
   * @param {?string} [state.selected=null] - The reason already on record, from the reader's own comment.
   * @returns {number} How many reasons are offered; 0 means the row is hidden.
   */
  render({ labelType, vote, selected = null }) {
    const reasons = vote ? util.validationReasons.forLabel(labelType, vote) : [];
    // Focus rides along to the same chip in the rebuilt row, so a host redrawing after a pick doesn't move it.
    const focusedId = this.#chips.find((c) => c === document.activeElement)?.dataset.reasonId ?? null;
    const hadFocus = this.#root.contains(document.activeElement);
    this.#root.replaceChildren();
    this.#chips = [];
    this.#otherButton = null;
    this.#selected = selected;
    this.#busy = false;
    this.#root.classList.remove('reason-chips--busy');
    this.#root.classList.toggle('reason-chips--disagree', vote === 'Disagree' && reasons.length > 0);
    this.#root.classList.toggle('reason-chips--unsure', vote === 'Unsure' && reasons.length > 0);
    this.#root.hidden = reasons.length === 0;
    if (reasons.length === 0) return 0;

    const promptId = `reason-chips-prompt-${Math.random().toString(36).slice(2, 8)}`;
    const promptKey = vote === 'Unsure' ? 'prompt-unsure' : 'prompt-disagree';
    const prompt = util.escapeHTML(i18next.t(`common:validation-reason.${promptKey}`));
    // "Other…" sits beside the group, not in it: it opens a box rather than picking, so it is no peer of the chips.
    this.#root.innerHTML = `
      <span class="reason-chips__prompt" id="${promptId}">${prompt}</span>
      <div class="reason-chips__list">
        <div class="reason-chips__group" role="group" aria-labelledby="${promptId}"></div>
      </div>`;
    const group = this.#root.querySelector('.reason-chips__group');
    reasons.forEach((reason, i) => {
      const chip = this.#buildChip(reason, i + 1);
      this.#chips.push(chip);
      group.appendChild(chip);
    });
    this.#otherButton = this.#buildOther(reasons.length + 1);
    this.#root.querySelector('.reason-chips__list').appendChild(this.#otherButton);
    this.#syncState();
    if (hadFocus) {
      const same = this.#chips.find((c) => c.dataset.reasonId === focusedId);
      if (same) same.focus();
      else this.focus();
    }
    return reasons.length;
  }

  /**
   * Marks a reason as picked without firing `onPick`, for a host reflecting what the server took (or didn't).
   * @param {?string} id - The reason id, or null for none (a free-text comment replaced it).
   */
  setSelected(id) {
    this.#selected = id;
    this.#syncState();
  }

  /** @returns {?string} The reason picked so far, or null. */
  getSelected() {
    return this.#selected;
  }

  /**
   * Locks the chips while a pick is in flight, so a second tap can't race the first to the server.
   * @param {boolean} busy
   */
  setBusy(busy) {
    this.#busy = busy;
    this.#root.classList.toggle('reason-chips--busy', busy);
    for (const chip of this.#chips) chip.setAttribute('aria-disabled', String(busy));
    if (this.#otherButton) this.#otherButton.setAttribute('aria-disabled', String(busy));
  }

  /** @returns {number} How many reasons the row currently offers. */
  get count() {
    return this.#chips.length;
  }

  /** @returns {boolean} Whether the row is on screen with something to pick. */
  get isShowing() {
    return !this.#root.hidden && this.#chips.length > 0;
  }

  /**
   * Picks by number key: 1–N the reasons in order, N+1 "Other…", the way Validate's number keys read.
   * @param {number} n - The key pressed.
   * @returns {boolean} Whether the number named something; a host leaves an unclaimed key alone.
   */
  pickByNumber(n) {
    if (!this.isShowing) return false;
    if (n >= 1 && n <= this.#chips.length) {
      this.#pick(this.#chips[n - 1], true);
      return true;
    }
    if (n === this.#chips.length + 1) {
      this.#other(true);
      return true;
    }
    return false;
  }

  /** Moves focus to the picked chip, else the first, for a host opening the row from the keyboard. */
  focus() {
    this.#chips.find((c) => c.tabIndex === 0)?.focus();
  }

  /**
   * @param {{id: string, text: string, tooltip: ?string}} reason
   * @param {number} n - Its number key.
   * @returns {HTMLButtonElement}
   */
  #buildChip(reason, n) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'reason-chips__chip';
    chip.dataset.reasonId = reason.id;
    chip.setAttribute('aria-pressed', 'false');
    chip.textContent = reason.text;
    // The tooltip renders as HTML (psTooltip.js), which is fine for these first-party strings and lets one carry
    // inline emphasis; nothing user-supplied reaches it.
    const tip = [reason.tooltip, this.#showKeys ? `(${n})` : null].filter(Boolean).join(' ');
    if (tip) chip.setAttribute('data-ps-tooltip', tip);
    return chip;
  }

  /**
   * @param {number} n - Its number key.
   * @returns {HTMLButtonElement}
   */
  #buildOther(n) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'reason-chips__chip reason-chips__chip--other';
    button.textContent = i18next.t('common:validation-reason.other');
    const hint = i18next.t('common:validation-reason.other-hint');
    button.setAttribute('data-ps-tooltip', this.#showKeys ? `${hint} (${n})` : hint);
    return button;
  }

  /** Reflects the selection into aria-pressed and the roving tabindex. */
  #syncState() {
    const focusable = this.#chips.find((c) => c.dataset.reasonId === this.#selected) ?? this.#chips[0];
    for (const chip of this.#chips) {
      const checked = chip.dataset.reasonId === this.#selected;
      chip.setAttribute('aria-pressed', String(checked));
      chip.classList.toggle('reason-chips__chip--selected', checked);
      chip.tabIndex = chip === focusable ? 0 : -1;
    }
  }

  /**
   * @param {HTMLButtonElement} chip
   * @param {boolean} viaKeyboard
   */
  #pick(chip, viaKeyboard) {
    if (this.#busy) return;
    const id = chip.dataset.reasonId;
    if (id === this.#selected) return;
    this.#onPick(id, viaKeyboard);
  }

  /** @param {boolean} viaKeyboard */
  #other(viaKeyboard) {
    if (this.#busy) return;
    this.#onOther(viaKeyboard);
  }

  #handleClick = (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const chip = target?.closest('.reason-chips__chip');
    if (!(chip instanceof HTMLButtonElement) || !this.#root.contains(chip)) return;
    // `detail === 0` is a click the keyboard produced (Enter or Space on the focused chip), the idiom the label
    // card and Navbar use to log the two input paths apart.
    const viaKeyboard = e.detail === 0;
    if (chip === this.#otherButton) this.#other(viaKeyboard);
    else this.#pick(chip, viaKeyboard);
  };

  /** Arrow keys move focus along the chips without picking; Enter/Space pick natively. */
  #handleKeydown = (e) => {
    const idx = this.#chips.findIndex((chip) => chip === document.activeElement);
    if (idx < 0) return;
    let next = null;
    if (ReasonChips.#KEY_NEXT.has(e.key)) next = (idx + 1) % this.#chips.length;
    else if (ReasonChips.#KEY_PREV.has(e.key)) next = (idx - 1 + this.#chips.length) % this.#chips.length;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    for (const chip of this.#chips) chip.tabIndex = -1;
    this.#chips[next].tabIndex = 0;
    this.#chips[next].focus();
  };
}
