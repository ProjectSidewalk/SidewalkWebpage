/**
 * A row of one-tap reasons for a Disagree or Unsure vote, plus "Other…" for a typed one (#5475), which turns into
 * a text field and a Save button in its own place, so a typed reason is written where the canned ones are picked.
 *
 * The same component on every surface that asks "why?" after a vote (the reason pop-up on the label detail card and
 * the Gallery cards, ReasonPopover.js), so the vocabulary, the keyboard handling and the accessible shape are written
 * once. The reasons come from `validationReasons`, the catalog the backend stamps on every page; the host stores the
 * pick, since how the pick is posted differs per surface.
 *
 * Accessible shape: a `group` named by the prompt, one toggle button per reason (`aria-pressed` marks the one on
 * record), each its own Tab stop with arrow keys between them (and on to "Other…") too, and the "Other…" button
 * (or its field) beside the group. Not a roving tabindex: a `group` doesn't announce arrow keys the way a toolbar
 * does, and with three to five chips readers expect Tab to walk each one (Jon, #5475).
 * Toggle buttons rather than radios: a pick posts at once, so an arrow that *selected* as it moved would file a
 * reason per keypress on the way past. Nothing is required — the vote is already saved when the row appears — so a
 * reader who does not care can move on. Number keys are the host's to route (it knows when it owns the keyboard);
 * `pickByNumber` does the picking, and on a host that routes them each chip wears its digit as a keycap, so the
 * mapping can be read off the row rather than counted along it.
 */

import i18next from 'i18next';
import { util } from './utilities.js';
import { validationReasons } from './validationReasons.js';
import '../../css/components/reason-chips.css';

export class ReasonChips {
  static #KEY_NEXT = new Set(['ArrowRight', 'ArrowDown']);
  static #KEY_PREV = new Set(['ArrowLeft', 'ArrowUp']);

  /** A `selected` value meaning the reader's answer is a typed reason, which "Other…" stands for. */
  static OTHER = Symbol('other');

  #root;
  #onPick;
  #onOther;
  #onSubmitOther;
  #showKeys;
  /** @type {HTMLButtonElement[]} */
  #chips = [];
  /** @type {?HTMLButtonElement} */
  #otherButton = null;
  /** @type {?HTMLFormElement} The field "Other…" became, while it is open. */
  #otherForm = null;
  #otherText = '';
  #otherNumber = 0;
  #saveClickDetail = -1;
  #selected = null;
  #busy = false;

  /**
   * @param {HTMLElement} root - The element to fill; hidden while there is nothing to offer.
   * @param {object} opts
   * @param {(id: string, viaKeyboard: boolean) => void} opts.onPick - A reason was chosen. Not fired for the
   *     chip already selected: picking what is picked is a no-op, not an unpick, so a stray tap can't erase one.
   * @param {(viaKeyboard: boolean) => void} opts.onOther - "Other…" was chosen (its button or its number key) and
   *     has become a field; for the host to log, and to re-place anything sized to the row.
   * @param {(text: string, viaKeyboard: boolean) => void} opts.onSubmitOther - The field was saved with this text,
   *     trimmed and never empty; the host stores it as the reader's typed comment.
   * @param {boolean} [opts.showKeys=false] - Draw each chip's number key as a keycap, on a host that routes the
   *     number keys here. Off for touch surfaces, where a key number is noise.
   */
  constructor(root, { onPick, onOther, onSubmitOther, showKeys = false }) {
    this.#root = root;
    this.#onPick = onPick;
    this.#onOther = onOther;
    this.#onSubmitOther = onSubmitOther;
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
   * @param {?(string|symbol)} [state.selected=null] - The reason already on record, from the reader's own comment,
   *     or `ReasonChips.OTHER` for a typed one.
   * @param {string} [state.otherText=''] - The reader's typed comment, which the "Other…" field opens holding.
   * @param {?string} [state.draft=null] - Words still unsaved in a field this redraw replaces; the field comes back
   *     open, holding them.
   * @returns {number} How many reasons are offered; 0 means the row is hidden.
   */
  render({ labelType, vote, selected = null, otherText = '', draft = null }) {
    const reasons = vote ? validationReasons.forLabel(labelType, vote) : [];
    // Focus rides along to the same chip in the rebuilt row, so a host redrawing after a pick doesn't move it.
    const focusedId = this.#chips.find((c) => c === document.activeElement)?.dataset.reasonId ?? null;
    const hadFocus = this.#root.contains(document.activeElement);
    this.#root.replaceChildren();
    this.#chips = [];
    this.#otherButton = null;
    this.#otherForm = null;
    this.#otherText = otherText;
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
    // "Other…" sits beside the group, not in it: it opens a field rather than picking, so it is no peer of the chips.
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
    this.#otherNumber = reasons.length + 1;
    this.#otherButton = this.#buildOther(this.#otherNumber);
    this.#root.querySelector('.reason-chips__list').appendChild(this.#otherButton);
    this.#syncState();
    if (draft !== null) {
      this.#openOther(false, { notify: false });
      this.#otherInput().value = draft;
      this.#syncOtherSave();
      return reasons.length;
    }
    if (hadFocus) {
      const same = this.#chips.find((c) => c.dataset.reasonId === focusedId);
      if (same) same.focus();
      else this.focus();
    }
    return reasons.length;
  }

  /**
   * Marks a reason as picked without firing `onPick`, for a host reflecting what the server took (or didn't).
   * @param {?(string|symbol)} id - The reason id, `ReasonChips.OTHER` for a typed reason, or null for none.
   */
  setSelected(id) {
    this.#selected = id;
    // What the field now holds is on record, so it is no longer a draft.
    if (id === ReasonChips.OTHER && this.#otherForm) this.#otherText = this.#otherInput().value.trim();
    this.#syncState();
  }

  /** @returns {?(string|symbol)} The reason picked so far, `ReasonChips.OTHER`, or null. */
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
    if (this.#otherForm) {
      // Read-only rather than disabled, so focus stays in the field the reader is typing in.
      this.#otherInput().readOnly = busy;
      this.#syncOtherSave();
    }
  }

  /**
   * @returns {boolean} Whether the "Other…" field holds words not yet saved, which a stray click must not lose. The
   *     comment it opened holding doesn't count until it is changed, and an emptied field has nothing to lose.
   */
  get hasOtherDraft() {
    if (this.#otherForm === null) return false;
    const text = this.#otherInput().value.trim();
    return text !== '' && text !== this.#otherText.trim();
  }

  /** @returns {?string} What the "Other…" field holds while it is open, or null, for a host redrawing the row. */
  get otherFieldText() {
    return this.#otherForm ? this.#otherInput().value : null;
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
    if (n === this.#otherNumber) {
      this.#other(true);
      return true;
    }
    return false;
  }

  /** Moves focus to the picked chip, else the first, for a host opening the row from the keyboard. */
  focus() {
    (this.#chips.find((c) => c.dataset.reasonId === this.#selected) ?? this.#chips[0])?.focus();
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
    this.#fill(chip, reason.text, n);
    // HTML (sanitized by psTooltip.js) so a locale string's <b> renders; nothing user-supplied reaches it.
    if (reason.tooltip) chip.setAttribute('data-ps-tooltip-html', reason.tooltip);
    return chip;
  }

  /**
   * Writes a chip's text, led by its keycap on a host that routes the number keys. The keycap is hidden from the
   * accessibility tree and the key named through `aria-keyshortcuts` instead, so a screen reader says the reason
   * and then its key rather than reading the digit as the first word of the reason.
   * @param {HTMLButtonElement} chip
   * @param {string} text - The reason, or "Other…".
   * @param {number} n - Its number key.
   */
  #fill(chip, text, n) {
    const label = document.createElement('span');
    label.className = 'reason-chips__text';
    label.textContent = text;
    if (!this.#showKeys) {
      chip.replaceChildren(label);
      return;
    }
    const key = document.createElement('kbd');
    key.className = 'reason-chips__key';
    key.setAttribute('aria-hidden', 'true');
    key.textContent = String(n);
    chip.setAttribute('aria-keyshortcuts', String(n));
    chip.replaceChildren(key, label);
  }

  /**
   * Turns "Other…" into a text field and a Save button in its own place, focused, holding the reader's typed
   * comment if they have one. A second "Other…" (its number key, from outside the field) just refocuses it.
   * @param {boolean} viaKeyboard
   * @param {{notify?: boolean}} [opts] - `notify: false` for a redraw restoring the field, which the reader didn't ask
   *     for again and the host mustn't log twice.
   */
  #openOther(viaKeyboard, { notify = true } = {}) {
    if (this.#otherForm) {
      this.#otherInput().focus();
      return;
    }
    const hint = i18next.t('common:validation-reason.other-hint');
    const form = document.createElement('form');
    form.className = 'reason-chips__other-form';
    form.noValidate = true;
    form.innerHTML = `
      <input type="text" name="reason" class="ps-input reason-chips__other-input" autocomplete="off">
      <button type="submit" class="button button--medium button--primary reason-chips__other-save"></button>`;
    const input = /** @type {HTMLInputElement} */ (form.elements.namedItem('reason'));
    input.placeholder = hint;
    input.setAttribute('aria-label', hint);
    input.value = this.#otherText;
    form.querySelector('button').textContent = i18next.t('common:validation-reason.other-save');
    input.addEventListener('input', () => this.#syncOtherSave());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (this.#busy || text === '') return;
      // Enter in the field submits through a click on Save that no pointer made (detail 0), as Enter/Space on Save do.
      const savedViaKeyboard = this.#saveClickDetail <= 0;
      this.#saveClickDetail = -1;
      this.#onSubmitOther(text, savedViaKeyboard);
    });
    form.querySelector('button').addEventListener('click', (e) => {
      this.#saveClickDetail = e.detail;
    });
    this.#otherButton.replaceWith(form);
    this.#otherButton = null;
    this.#otherForm = form;
    this.#syncOtherSave();
    input.focus();
    // Caret at the end, so a prefilled comment is extended rather than typed over.
    input.setSelectionRange(input.value.length, input.value.length);
    if (notify) this.#onOther(viaKeyboard);
  }

  /** @returns {HTMLInputElement} */
  #otherInput() {
    return /** @type {HTMLInputElement} */ (this.#otherForm.elements.namedItem('reason'));
  }

  /** Save takes nothing empty, and nothing while a save is in flight. */
  #syncOtherSave() {
    const save = this.#otherForm?.querySelector('button');
    if (save) save.disabled = this.#busy || this.#otherInput().value.trim() === '';
  }

  /**
   * @param {number} n - Its number key.
   * @returns {HTMLButtonElement}
   */
  #buildOther(n) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'reason-chips__chip reason-chips__chip--other';
    this.#fill(button, i18next.t('common:validation-reason.other'), n);
    button.setAttribute('data-ps-tooltip', i18next.t('common:validation-reason.other-hint'));
    return button;
  }

  /** Reflects the selection into aria-pressed. */
  #syncState() {
    for (const chip of this.#chips) {
      const checked = chip.dataset.reasonId === this.#selected;
      chip.setAttribute('aria-pressed', String(checked));
      chip.classList.toggle('reason-chips__chip--selected', checked);
    }
    const typed = this.#selected === ReasonChips.OTHER;
    if (this.#otherButton) {
      this.#otherButton.setAttribute('aria-pressed', String(typed));
      this.#otherButton.classList.toggle('reason-chips__chip--selected', typed);
    }
    this.#otherForm?.classList.toggle('reason-chips__other-form--saved', typed);
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
    this.#openOther(viaKeyboard);
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

  /**
   * Arrow keys move focus along the row without picking, "Other…" included since it sits in the row like any chip;
   * Enter/Space pick natively. Once "Other…" is a field, its arrows are the field's.
   */
  #handleKeydown = (e) => {
    const row = this.#otherButton ? [...this.#chips, this.#otherButton] : this.#chips;
    const idx = row.findIndex((chip) => chip === document.activeElement);
    if (idx < 0) return;
    let next = null;
    if (ReasonChips.#KEY_NEXT.has(e.key)) next = (idx + 1) % row.length;
    else if (ReasonChips.#KEY_PREV.has(e.key)) next = (idx - 1 + row.length) % row.length;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    row[next].focus();
  };
}
