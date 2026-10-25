/**
 * The reason pop-up: "why?" asked right where a Disagree or Unsure vote was cast (#5475).
 *
 * Mobile Validate's notched reason panel, generalised. One element serves the whole page and hangs off whichever
 * control cast the vote (a label card thumb, a pano overlay button, a Gallery strip button or thumb, or the card's
 * "Reasons" button), with a tail pointing at it. It grows upward out of the anchor and flips below only when there
 * is no room above. The chips inside are a {@link ReasonChips}; this file owns where the question appears, how it
 * leaves, and the keys it answers while open. The host owns what a pick does (it posts the comment) and tells the
 * pop-up when the pick landed, which is when it says "Reason saved" and shrinks back into its anchor.
 *
 * It leaves on a pick, a saved typed reason, Escape, its close control, a click outside (unless "Other…" holds
 * unsaved words), or when the host closes it (paging, another vote). Never on mouse-leave: the first version did
 * that and read as a flash. Mouse opens never move focus; a keyboard open focuses the chips. Number keys 1–N pick,
 * N+1 is "Other…", so the pop-up reads like Validate's menu; where a keyboard is likely (a hover-capable pointer)
 * each chip wears its digit as a keycap.
 *
 * Native Popover API where there is one (top layer, so the Gallery grid never reflows and no card clips it) with
 * the same `hidden` fallback PanoImageAdjustmentsPopover uses, which is also what jsdom runs.
 *
 * Usage:
 *   reasonPopover.open({
 *     anchor: thumbButton, host: cardEl, labelType: 'CurbRamp', vote: 'Disagree', selected: null,
 *     onPick: (id, viaKeyboard) => post(id).then(() => reasonPopover.markSaved(id)),
 *     onSubmitOther: (text, viaKeyboard) => post(text).then(() => reasonPopover.markSaved(ReasonChips.OTHER)),
 *     onDismiss: (via, viaKeyboard) => log(...),
 *   });
 */

import i18next from 'i18next';
import { ReasonChips } from './ReasonChips.js';
import { util } from './utilities.js';
import '../../css/components/reason-popover.css';

/**
 * @typedef {object} ReasonPopoverRequest
 * @property {HTMLElement} anchor - The control the pop-up hangs off; the tail points at its centre.
 * @property {HTMLElement} host - The card the vote belongs to. A click on another vote control inside it is that
 *     control's business (a re-vote), not a dismissal.
 * @property {string} labelType - The label's type, which decides the reasons offered.
 * @property {string} vote - 'Disagree' or 'Unsure'.
 * @property {?(string|symbol)} [selected] - The reason already on record, or `ReasonChips.OTHER` for typed text.
 * @property {string} [otherText] - The reader's typed comment on the label, which the "Other…" field opens holding.
 * @property {boolean} [viaKeyboard] - Opened from the keyboard, so focus moves into the chips.
 * @property {(id: string, viaKeyboard: boolean) => void} onPick - A reason was chosen.
 * @property {(viaKeyboard: boolean) => void} [onOther] - "Other…" was opened into its field; for logging.
 * @property {(text: string, viaKeyboard: boolean) => void} onSubmitOther - The field was saved with this text.
 * @property {(via: string, viaKeyboard: boolean) => void} [onDismiss] - Closed without a pick, by the reader:
 *     'close' (the ✕), 'escape', or 'outside'. Not called for a host-driven close or a close after a pick.
 * @property {() => void} [onClose] - Closed by any path, after the pop-up is gone; for a host keeping a disclosure
 *     control's state in step with it.
 */

export class ReasonPopover {
  /** How long "Reason saved" stays up before the pop-up leaves: long enough to read, short enough not to wait on. */
  static SAVED_HOLD_MS = 600;

  /** @type {HTMLElement} */
  #el;
  /** @type {HTMLButtonElement} */
  #closeButton;
  /** @type {HTMLElement} */
  #footEl;
  #hintEl;
  /** @type {HTMLElement} */
  #savedEl;
  /** @type {ReasonChips} */
  #chips;
  /** @type {?ReasonPopoverRequest} */
  #request = null;
  /** @type {?ReturnType<typeof setTimeout>} */
  #closeTimer = null;
  #swallowEscapeKeyup = false;
  /** @type {WeakSet<HTMLDialogElement>} */
  #watchedDialogs = new WeakSet();

  constructor() {
    this.#el = document.createElement('div');
    this.#el.className = 'reason-popover';
    this.#el.setAttribute('role', 'dialog');
    this.#el.setAttribute('popover', 'manual');
    this.#el.innerHTML = `
      <div class="reason-popover__head">
        <div class="reason-popover__chips"></div>
        <button type="button" class="reason-popover__close" data-action="close">✕</button>
      </div>
      <div class="reason-popover__foot" role="status">
        <span class="reason-popover__hint"></span>
        <span class="reason-popover__saved"></span>
      </div>
      <span class="reason-popover__tail" aria-hidden="true"></span>`;
    this.#closeButton = this.#el.querySelector('[data-action="close"]');
    this.#footEl = this.#el.querySelector('.reason-popover__foot');
    this.#hintEl = this.#el.querySelector('.reason-popover__hint');
    this.#savedEl = this.#el.querySelector('.reason-popover__saved');
    // The chips draw the prompt, so the dialog is named by that prompt rather than a second copy of it.
    this.#chips = new ReasonChips(this.#el.querySelector('.reason-popover__chips'), {
      onPick: (id, viaKeyboard) => this.#request?.onPick(id, viaKeyboard),
      onOther: (viaKeyboard) => {
        this.#request?.onOther?.(viaKeyboard);
        if (this.isOpen()) this.#position(); // The field can wrap onto a row of its own.
      },
      onSubmitOther: (text, viaKeyboard) => this.#request?.onSubmitOther(text, viaKeyboard),
      showKeys: window.matchMedia?.('(hover: hover)').matches ?? true,
    });
    if (typeof this.#el.showPopover !== 'function') this.#el.setAttribute('hidden', '');
    document.body.appendChild(this.#el);
    // Typing into "Other…" during the "Reason saved" hold starts a new answer, which the pending close would discard.
    this.#el.addEventListener('input', () => {
      if (this.#closeTimer === null) return;
      this.#clearCloseTimer();
      this.#el.classList.remove('reason-popover--saved');
      this.#savedEl.textContent = '';
      this.#syncFoot();
    });

    this.#closeButton.addEventListener('click', (e) => this.#dismiss('close', e.detail === 0));
    // pointerdown rather than click: a drag that starts outside should close it too, and a click on a hover-only
    // control (the pano overlay strip) is a pointerdown on it before any hover state can change.
    document.addEventListener('pointerdown', this.#onPointerDown, { capture: true });
    document.addEventListener('keydown', this.#onKeydown, { capture: true });
    window.addEventListener('keyup', (e) => {
      // The host's shortcuts (Gallery closes the expanded view on Escape keyup) must not see the Escape that
      // closed this; PanoImageAdjustmentsPopover does the same.
      if (this.#swallowEscapeKeyup && e.key === 'Escape') {
        e.stopPropagation();
        this.#swallowEscapeKeyup = false;
      }
    }, { capture: true });
    const reposition = () => {
      if (this.isOpen()) this.#position();
    };
    window.addEventListener('resize', reposition);
    // Capture: a scrolling ancestor (the LabelMap popup, the Gallery grid) moves the anchor without a window scroll.
    window.addEventListener('scroll', reposition, { capture: true });
  }

  /** @returns {boolean} */
  isOpen() {
    return this.#request !== null;
  }

  /**
   * @param {HTMLElement} host
   * @returns {boolean} Whether the pop-up is open for this host's vote.
   */
  isOpenFor(host) {
    return this.#request?.host === host;
  }

  /** @returns {?HTMLElement} The element the open pop-up hangs off, or null. */
  get anchor() {
    return this.#request?.anchor ?? null;
  }

  /** @returns {boolean} Whether focus is inside the pop-up, for a host deciding whether a key is its own. */
  containsFocus() {
    return this.#el.contains(document.activeElement);
  }

  /**
   * Shows the reasons for a vote at its anchor. Opening while open for the same card (a re-vote, or a reopen from
   * its Reasons button) redraws in place and logs no dismissal; opening for another card dismisses the first.
   * @param {ReasonPopoverRequest} request
   * @returns {boolean} Whether anything opened; false when the type offers no reason for the vote.
   */
  open(request) {
    this.#clearCloseTimer();
    // A vote landing after its card was paged away would otherwise leave an invisible pop-up still taking clicks.
    if (!request.anchor.isConnected || !request.host.isConnected) {
      this.close();
      return false;
    }
    // A re-vote on the same card redraws the row; words half-typed into "Other…" ride across rather than vanish.
    const draft = this.#request?.host === request.host ? this.#chips.otherFieldText : null;
    const count = this.#chips.render({
      labelType: request.labelType, vote: request.vote, selected: request.selected ?? null,
      otherText: request.otherText ?? '', draft,
    });
    if (count === 0) {
      this.close();
      return false;
    }
    const wasOpen = this.isOpen();
    const left = wasOpen && this.#request.host !== request.host ? this.#request : null;
    if (left) left.host.classList.remove('has-reason-popover');
    const moved = this.#mount(request.host);
    this.#request = request;
    // The card left behind was dismissed without a pick, so it hears so as if closed: a host holding its comment
    // row for the pop-up would otherwise hold it until its label changes. Told after the swap, so its handlers see
    // the pop-up as no longer theirs.
    if (left) {
      left.onClose?.();
      left.onDismiss?.('outside', false);
    }
    request.host.classList.add('has-reason-popover');
    // The chips draw the prompt afresh on every render, so the dialog takes its name from the new one.
    const prompt = this.#el.querySelector('.reason-chips__prompt');
    if (prompt) this.#el.setAttribute('aria-labelledby', prompt.id);
    this.#el.classList.toggle('reason-popover--disagree', request.vote === 'Disagree');
    this.#el.classList.toggle('reason-popover--unsure', request.vote === 'Unsure');
    // Set per open rather than once, in case the page's language resolved after the pop-up was built.
    this.#closeButton.setAttribute('aria-label', i18next.t('common:validation-reason.dismiss'));
    this.#savedEl.textContent = '';
    this.#hintEl.textContent = '';
    this.#syncFoot();
    this.#el.classList.remove('reason-popover--saved');
    // Moving the element out of the document hides a shown popover, so a move needs a fresh show.
    if (!wasOpen || moved) {
      if (typeof this.#el.showPopover === 'function') this.#el.showPopover();
      else this.#el.removeAttribute('hidden');
    }
    this.#position();
    // Two frames rather than one: the first paints the resting transform the transition starts from.
    this.#el.classList.remove('reason-popover--open');
    requestAnimationFrame(() => {
      if (this.#request !== request) return;
      this.#position();
      this.#el.classList.add('reason-popover--open');
    });
    if (request.viaKeyboard) this.#chips.focus();
    return true;
  }

  /**
   * Puts the element where the host's reader can reach it. A modal <dialog> (the LabelMap card) makes everything
   * outside it inert, top layer included, so a pop-up left in the body there takes no click and no focus; only the
   * number keys, caught on the document, got through. Inside the dialog it still shows in the top layer, unclipped.
   * @param {HTMLElement} host
   * @returns {boolean} Whether the element changed parent.
   */
  #mount(host) {
    const dialog = host.closest('dialog');
    const parent = dialog ?? document.body;
    if (this.#el.parentElement === parent) return false;
    parent.appendChild(this.#el);
    if (dialog && !this.#watchedDialogs.has(dialog)) {
      this.#watchedDialogs.add(dialog);
      // A dialog closed under the pop-up (its backdrop, while "Other…" holds words) hides it with no way back.
      dialog.addEventListener('close', () => {
        if (this.#request && dialog.contains(this.#request.host)) this.close();
      });
    }
    return true;
  }

  /**
   * Hides the pop-up without telling anyone: for the host, when the label pages, the vote changes, or a pick has
   * landed. Focus goes back to the anchor only if it was inside, so a mouse user's focus stays where it was.
   */
  close() {
    this.#clearCloseTimer();
    const request = this.#request;
    if (!request) return;
    const hadFocus = this.containsFocus();
    this.#request = null;
    request.host.classList.remove('has-reason-popover');
    this.#el.classList.remove('reason-popover--open');
    if (typeof this.#el.hidePopover === 'function') this.#el.hidePopover();
    else this.#el.setAttribute('hidden', '');
    if (hadFocus && request.anchor.isConnected) request.anchor.focus();
    request.onClose?.();
  }

  /**
   * Locks the chips while a pick is in flight (or the host's vote is), so a second tap can't race the first.
   * @param {boolean} busy
   */
  setBusy(busy) {
    this.#chips.setBusy(busy);
    this.#closeButton.disabled = false; // Dismissing stays allowed; the pick in flight lands either way.
  }

  /**
   * Marks the pick as picked on the chips, says so, and leaves after a short hold.
   * @param {string|symbol} id - The reason the server took, or `ReasonChips.OTHER` for a typed one.
   */
  markSaved(id) {
    if (!this.isOpen()) return;
    this.#chips.setSelected(id);
    this.#chips.setBusy(false);
    this.#savedEl.textContent = i18next.t('common:validation-reason.saved');
    this.#hintEl.textContent = '';
    this.#syncFoot();
    this.#el.classList.add('reason-popover--saved');
    this.#clearCloseTimer();
    this.#closeTimer = setTimeout(() => this.close(), ReasonPopover.SAVED_HOLD_MS);
  }

  /**
   * Puts the chips back in play after a pick that failed to save, saying so where a host has no status line of its
   * own (a Gallery card); the label card says it under its comment box as well.
   * @param {string} [message] - What to show in the footer, which is otherwise empty until a pick saves.
   */
  markFailed(message = i18next.t('labelmap:comment-save-failed')) {
    if (!this.isOpen()) return;
    this.#chips.setBusy(false);
    this.#hintEl.textContent = message;
    this.#syncFoot();
  }

  /**
   * Collapses the footer while it has nothing to say ("Reason saved", or why a pick failed), so the chips sit on the
   * panel's own padding the rest of the time. Collapsed, not hidden: it is the live region, and a region that appears
   * together with its text isn't reliably announced. The panel is placed from its height, so a footer that appears
   * re-places it and the tail stays on the anchor: the panel grows away from the anchor rather than over it.
   */
  #syncFoot() {
    const empty = this.#savedEl.textContent === '' && this.#hintEl.textContent === '';
    this.#footEl.classList.toggle('reason-popover__foot--empty', empty);
    if (this.isOpen()) this.#position();
  }

  /**
   * @param {string} via - 'close', 'escape' or 'outside'.
   * @param {boolean} viaKeyboard
   */
  #dismiss(via, viaKeyboard) {
    const request = this.#request;
    if (!request) return;
    this.close();
    request.onDismiss?.(via, viaKeyboard);
  }

  #clearCloseTimer() {
    if (this.#closeTimer !== null) clearTimeout(this.#closeTimer);
    this.#closeTimer = null;
  }

  /** @param {PointerEvent} e */
  #onPointerDown = (e) => {
    const request = this.#request;
    if (!request) return;
    const target = e.target instanceof Node ? e.target : null;
    if (!target || this.#el.contains(target) || request.anchor.contains(target)) return;
    // Another vote control on the same card: that control's handler decides what happens (a re-vote reopens, a
    // clear closes), and logging a dismissal as well would count one gesture twice.
    const control = target instanceof Element ? target.closest('[data-reason-anchor]') : null;
    if (control && request.host.contains(control)) return;
    // Words typed into "Other…" and not yet saved outlast a stray click; Escape and the ✕ still close.
    if (this.#chips.hasOtherDraft) return;
    this.#dismiss('outside', false);
  };

  /**
   * Escape closes; number keys pick while nothing is being typed. Capture phase, ahead of the hosts' own shortcut
   * listeners, so a digit never reaches a page that gives digits a meaning of its own.
   * @param {KeyboardEvent} e
   */
  #onKeydown = (e) => {
    // Safari ends a composition with a keydown that has isComposing false but keyCode 229; that key is the IME's.
    // eslint-disable-next-line no-restricted-properties
    if (!this.isOpen() || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.#swallowEscapeKeyup = true;
      this.#dismiss('escape', true);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return;
    const typing = e.target instanceof HTMLElement && e.target.matches('input, textarea, select, [contenteditable]');
    if (typing) return;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (digit && this.#chips.pickByNumber(Number(digit[1]))) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  /**
   * Above the anchor, centred on it, with the tail pointing down at its centre; below it, tail up, only when the
   * top of the viewport is in the way. Clamped inside the viewport, which moves the box but never the tail.
   */
  #position() {
    const request = this.#request;
    if (!request) return;
    // A host re-rendered under it leaves nothing to point at, and its onPick would file a reason for a gone card.
    if (!request.anchor.isConnected || !request.host.isConnected) {
      this.close();
      return;
    }
    const margin = 8;
    const gap = Math.round(10 * util.uiScale());
    const anchor = request.anchor.getBoundingClientRect();
    const width = this.#el.offsetWidth;
    const height = this.#el.offsetHeight;
    const above = anchor.top - height - gap >= margin
      || anchor.bottom + height + gap > window.innerHeight - margin;
    const centre = anchor.left + anchor.width / 2;
    const left = Math.round(Math.max(margin, Math.min(centre - width / 2, window.innerWidth - width - margin)));
    const top = Math.round(above ? anchor.top - height - gap : anchor.bottom + gap);
    const tailMargin = 18;
    const tailX = Math.round(Math.max(tailMargin, Math.min(centre - left, width - tailMargin)));
    this.#el.style.left = `${left}px`;
    this.#el.style.top = `${top}px`;
    this.#el.style.setProperty('--reason-popover-tail-x', `${tailX}px`);
    this.#el.style.transformOrigin = `${tailX}px ${above ? '100%' : '0%'}`;
    this.#el.classList.toggle('reason-popover--below', !above);
  }
}

/** The page's one pop-up, made on first use so a page without votes never builds it. */
let shared = null;

/** @returns {ReasonPopover} */
export function reasonPopover() {
  if (shared === null) shared = new ReasonPopover();
  return shared;
}

/** Closes the pop-up if one was ever built, for a host about to throw away the cards it could be hanging off. */
export function closeReasonPopover() {
  shared?.close();
}
