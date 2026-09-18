/**
 * A generic, reusable toast notification. Renders a small card with an optional icon, a title, a message, an optional
 * action button, and a close (X) button. It lives on <body> (fixed-positioned) and floats over a reference element.
 *
 * Dismiss behavior: the toast starts slightly transparent and fades itself out after `duration` ms. Hovering or
 * focusing it makes it fully opaque; focus also pauses the auto-dismiss timer, and so does hover on a toast that
 * carries an action button. Clicking the close button (or calling dismiss()) fades it out immediately.
 *
 * Queueing: toasts sharing an anchor are positioned identically, so they show one at a time -- Explore alone raises
 * six over `#pano`, and overlapping them leaves two `role="status"` regions live at once. A toast with an action
 * button pauses its timer on hover, so an incumbent under the cursor holds the queue indefinitely; a caller whose
 * message can go stale should re-check it still applies when its turn comes.
 *
 * Specialized toasts (e.g. badge-unlock celebrations) should extend or compose this class rather than re-implement it.
 */
class Toast {
  // Fade-out transition duration (ms). Kept in sync with the CSS opacity transition on `.ps-toast`. Public so a
  // caller sequencing work after a toast doesn't re-encode it as a magic number.
  static FADE_MS = 500;

  // Anchor -> the toast on screen for it, and those waiting. Entries are dropped once an anchor goes idle, so a
  // detached element is never retained here.
  static #ANCHORLESS = Symbol('anchorless');
  static #live = new Map();
  static #waiting = new Map();

  // Duration for a toast that just confirms an action the user took ("Link copied"). It tells them nothing they
  // don't already know, so it needs only long enough to register before it gets out of the way.
  static CONFIRMATION_MS = 1000;

  #el;
  #reference;
  #duration;
  #timerId = null;
  #dismissed = false;
  #repositionHandler = null;
  #pauseOnHover;
  #onClose;
  #hovered = false;
  #focused = false;
  #queued = false;

  /**
   * @param {object} opts
   * @param {string} [opts.title] - Bold heading line.
   * @param {string} [opts.message] - Secondary message line.
   * @param {string} [opts.icon] - Image URL shown to the left of the text.
   * @param {string} [opts.iconAlt] - Alt text for the icon image (defaults to '').
   * @param {{label: string, href?: string, newTab?: boolean, onClick?: (e: MouseEvent) => void}} [opts.button] - An
   *     optional action button: a link with `href`, or a callback with `onClick`.
   * @param {HTMLElement} [opts.reference] - Element the toast floats over (defaults to the viewport).
   * @param {number} [opts.duration] - Milliseconds before auto-dismiss (defaults to 5000).
   * @param {boolean} [opts.dark] - Dark surface instead of white — for toasts that float over photography, where a
   *      white card glares against the imagery and reads as part of the UI chrome rather than a passing note.
   * @param {boolean} [opts.compact] - Tighter padding and smaller type, for a one-line aside rather than an
   *      announcement with a title and an action.
   * @param {() => void} [opts.onClose] - Called when the user clicks the close button, and not when the toast fades
   *      out on its own: the two say different things about whether the message was read.
   */
  constructor(opts = {}) {
    this.#reference = opts.reference || null;
    this.#duration = opts.duration ?? 5000;
    this.#onClose = opts.onClose || null;
    // A toast anchored to a small control — a dashboard "Copy link" button — opens under the cursor that just
    // clicked it, so pausing on hover would strand it on screen until the user happened to move the mouse. Only a
    // toast with an action button to reach for earns the pause.
    this.#pauseOnHover = Boolean(opts.button);
    this.#el = this.#build(opts);
  }

  /**
   * Convenience factory: builds a toast, shows it, and returns the instance.
   * @param {object} opts - See the constructor.
   * @returns {Toast}
   */
  static show(opts = {}) {
    const toast = new Toast(opts);
    toast.show();
    return toast;
  }

  /** Builds the toast DOM subtree (but does not attach it to the page). */
  #build(opts) {
    const el = document.createElement('div');
    el.className = ['ps-toast', opts.dark && 'ps-toast--dark', opts.compact && 'ps-toast--compact']
      .filter(Boolean).join(' ');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    if (opts.icon) {
      const icon = document.createElement('img');
      icon.className = 'ps-toast__icon';
      icon.src = opts.icon;
      icon.alt = opts.iconAlt || '';
      el.appendChild(icon);
    }

    const text = document.createElement('div');
    text.className = 'ps-toast__text';
    if (opts.title) {
      const title = document.createElement('div');
      title.className = 'ps-toast__title';
      title.textContent = opts.title;
      text.appendChild(title);
    }
    if (opts.message) {
      const message = document.createElement('div');
      message.className = 'ps-toast__message';
      message.textContent = opts.message;
      text.appendChild(message);
    }
    el.appendChild(text);

    if (opts.button) el.appendChild(this.#buildButton(opts.button));

    // Close button.
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ps-toast__close';
    close.setAttribute('aria-label', i18next.t('common:close'));
    const closeIcon = document.createElement('img');
    closeIcon.className = 'ps-toast__close-icon';
    closeIcon.src = util.assetPath('images/icons/cross.svg');
    closeIcon.alt = '';
    close.appendChild(closeIcon);
    close.addEventListener('click', () => {
      if (this.#onClose) this.#onClose();
      this.dismiss();
    });
    el.appendChild(close);

    el.addEventListener('mouseenter', () => {
      this.#hovered = true;
      this.#applyHoverFocusState();
    });
    el.addEventListener('mouseleave', () => {
      this.#hovered = false;
      this.#applyHoverFocusState();
    });

    // Focus always pauses the timer, or a toast fades out from under someone tabbing toward its action button — and
    // the role="status" announcement gives no cue that it is on a clock (WCAG 2.2.1). These bubble from the buttons.
    el.addEventListener('focusin', () => {
      this.#focused = true;
      this.#applyHoverFocusState();
    });
    el.addEventListener('focusout', () => {
      this.#focused = false;
      this.#applyHoverFocusState();
    });

    return el;
  }

  /**
   * Builds the action button using the shared design-system button classes.
   * @param {{label: string, href?: string, newTab?: boolean, onClick?: (e: MouseEvent) => void}} button - A
   *     link-style action with `href`, or a callback with `onClick`.
   * @returns {HTMLElement}
   */
  #buildButton(button) {
    let el;
    if (button.href) {
      el = document.createElement('a');
      el.href = button.href;
      if (button.newTab) {
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
      }
    } else {
      el = document.createElement('button');
      el.type = 'button';
      if (button.onClick) el.addEventListener('click', button.onClick);
    }
    el.className = 'ps-toast__button button-ps button--primary button--small';
    el.textContent = button.label;
    return el;
  }

  /**
   * Shows the toast, or queues it behind one already live on the same anchor. Returns immediately either way;
   * dismiss() before its turn simply drops it from the queue.
   */
  show() {
    const anchor = this.#anchorKey();
    const live = Toast.#live.get(anchor);
    if (live && live !== this) {
      this.#queued = true;
      const waiting = Toast.#waiting.get(anchor) || [];
      waiting.push(this);
      Toast.#waiting.set(anchor, waiting);
      return;
    }
    Toast.#live.set(anchor, this);
    this.#mount();
  }

  /** @returns {Element|symbol} Queue key. Anchorless toasts share one, since they share one position. */
  #anchorKey() {
    return this.#reference || Toast.#ANCHORLESS;
  }

  /**
   * Hands the anchor to the next waiting toast, or releases it. Called once this element is gone, so a successor
   * never overlaps its predecessor's fade.
   */
  #releaseAnchor() {
    const anchor = this.#anchorKey();
    if (Toast.#live.get(anchor) !== this) return;
    Toast.#live.delete(anchor);
    const waiting = Toast.#waiting.get(anchor) || [];
    const next = waiting.shift();
    if (waiting.length) Toast.#waiting.set(anchor, waiting);
    else Toast.#waiting.delete(anchor);
    if (next) {
      next.#queued = false;
      Toast.#live.set(anchor, next);
      next.#mount();
    }
  }

  #mount() {
    this.#host().appendChild(this.#el);
    this.#position();

    // The toast is fixed-positioned over the reference, so keep it aligned as the viewport changes.
    this.#repositionHandler = () => this.#position();
    window.addEventListener('resize', this.#repositionHandler);

    // Force a reflow so the entry transition runs from the initial (hidden) state.
    void this.#el.offsetWidth;
    this.#el.classList.add('ps-toast--visible');
    this.#startTimer();
  }

  /**
   * The element to mount the toast into. Normally <body>, but if the reference lives inside a modal <dialog> (opened
   * with showModal(), e.g. the LabelMap label-detail popup), that dialog renders in the browser's top layer — above
   * every normal stacking context regardless of z-index. Mounting the toast inside that dialog puts it in the same top
   * layer so it floats above the popup instead of behind it. The dialog has no transform, so the toast's fixed
   * positioning stays viewport-relative either way.
   * @returns {HTMLElement}
   */
  #host() {
    const dialog = this.#reference && this.#reference.closest && this.#reference.closest('dialog');
    return dialog && dialog.matches(':modal') ? dialog : document.body;
  }

  /**
   * Positions the toast horizontally centered over the reference element. Vertically it sits 10% down from the top.
   *
   * The center is then pulled back inside the viewport if half the toast would hang past either edge. The toast is
   * fixed-positioned, so an overhang is not scrollable — whatever lands outside is simply unreachable — and a
   * reference near the edge of a narrow window (or just a long translation) is enough to put it there.
   */
  #position() {
    const VERTICAL_FRACTION = 0.10;
    const EDGE = 8;
    const rect = this.#reference
      ? this.#reference.getBoundingClientRect()
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

    const halfWidth = this.#el.getBoundingClientRect().width / 2;
    const minCenter = EDGE + halfWidth;
    const maxCenter = window.innerWidth - EDGE - halfWidth;
    // Left-align rather than center when the toast is wider than the viewport, so its start stays readable.
    const center = Math.min(Math.max(rect.left + rect.width / 2, minCenter), Math.max(maxCenter, minCenter));

    this.#el.style.left = `${center}px`;
    this.#el.style.top = `${rect.top + rect.height * VERTICAL_FRACTION}px`;
  }

  /** Fades the toast out and removes it from the DOM. Safe to call more than once. */
  dismiss() {
    if (this.#dismissed) return;
    this.#dismissed = true;
    this.#clearTimer();
    // Never mounted: nothing to fade, and the live toast keeps the anchor.
    if (this.#queued) {
      const anchor = this.#anchorKey();
      const waiting = (Toast.#waiting.get(anchor) || []).filter((t) => t !== this);
      if (waiting.length) Toast.#waiting.set(anchor, waiting);
      else Toast.#waiting.delete(anchor);
      this.#queued = false;
      return;
    }
    if (this.#repositionHandler) window.removeEventListener('resize', this.#repositionHandler);
    this.#el.classList.remove('ps-toast--visible');
    setTimeout(() => {
      this.#el.remove();
      this.#releaseAnchor();
    }, Toast.FADE_MS);
  }

  /**
   * Brightens the toast while it is hovered or focused, and stops or resumes the auto-dismiss countdown to match.
   * A running countdown is left alone rather than restarted, so a cursor passing over a toast that doesn't pause on
   * hover can't keep extending its life.
   */
  #applyHoverFocusState() {
    if (this.#dismissed) return;
    this.#el.classList.toggle('ps-toast--hover', this.#hovered || this.#focused);
    if (this.#focused || (this.#hovered && this.#pauseOnHover)) this.#clearTimer();
    else if (this.#timerId === null) this.#startTimer();
  }

  /** Starts (or restarts) the auto-dismiss countdown. A non-positive duration disables auto-dismiss. */
  #startTimer() {
    this.#clearTimer();
    if (this.#duration > 0) this.#timerId = setTimeout(() => this.dismiss(), this.#duration);
  }

  /** Cancels any pending auto-dismiss countdown. */
  #clearTimer() {
    if (this.#timerId !== null) {
      clearTimeout(this.#timerId);
      this.#timerId = null;
    }
  }
}
