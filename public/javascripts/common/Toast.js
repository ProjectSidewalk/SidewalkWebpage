/**
 * A generic, reusable toast notification. Renders a small card with an optional icon, a title, a message, an optional
 * action button, and a close (X) button. It lives on <body> (fixed-positioned) and floats over a reference element.
 *
 * Dismiss behavior: the toast starts slightly transparent and fades itself out after `duration` ms. Hovering it makes
 * it fully opaque, reveals the close button, and pauses the auto-dismiss timer until the cursor leaves. Clicking the
 * close button (or calling dismiss()) fades it out immediately.
 *
 * Specialized toasts (e.g. badge-unlock celebrations) should extend or compose this class rather than re-implement it.
 */
class Toast {
  // Fade-out transition duration (ms). Kept in sync with the CSS opacity transition on `.ps-toast`.
  static #FADE_MS = 300;

  #el;
  #reference;
  #duration;
  #timerId = null;
  #dismissed = false;
  #repositionHandler = null;

  /**
     * @param {Object} opts
     * @param {string} [opts.title] Bold heading line.
     * @param {string} [opts.message] Secondary message line.
     * @param {string} [opts.icon] Image URL shown to the left of the text.
     * @param {string} [opts.iconAlt] Alt text for the icon image (defaults to '').
     * @param {Object} [opts.button] Optional action button: { label, href } or { label, onClick }.
     * @param {HTMLElement} [opts.reference] Element the toast floats over (defaults to the viewport).
     * @param {number} [opts.duration] Milliseconds before auto-dismiss when not hovered (defaults to 5000).
     */
  constructor(opts = {}) {
    this.#reference = opts.reference || null;
    this.#duration = opts.duration ?? 5000;
    this.#el = this.#build(opts);
  }

  /**
     * Convenience factory: builds a toast, shows it, and returns the instance.
     * @param {Object} opts See the constructor.
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
    el.className = 'ps-toast';
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
    closeIcon.src = '/assets/images/icons/cross.svg';
    closeIcon.alt = '';
    close.appendChild(closeIcon);
    close.addEventListener('click', () => this.dismiss());
    el.appendChild(close);

    // Hovering makes the toast fully opaque and pauses the auto-dismiss timer; leaving restarts it.
    el.addEventListener('mouseenter', () => {
      el.classList.add('ps-toast--hover');
      this.#clearTimer();
    });
    el.addEventListener('mouseleave', () => {
      el.classList.remove('ps-toast--hover');
      this.#startTimer();
    });

    return el;
  }

  /**
     * Builds the action button using the shared design-system button classes.
     * @param {Object} button { label, href, newTab } for a link-style action or { label, onClick } for a callback.
     * @returns {HTMLElement}
     */
  #buildButton(button) {
    const el = button.href ? document.createElement('a') : document.createElement('button');
    el.className = 'ps-toast__button button-ps button--primary button--small';
    el.textContent = button.label;
    if (button.href) {
      el.href = button.href;
      if (button.newTab) {
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
      }
    } else {
      el.type = 'button';
      if (button.onClick) el.addEventListener('click', button.onClick);
    }
    return el;
  }

  /** Attaches the toast to its host, positions it over the reference, makes it visible, and starts dismiss timer. */
  show() {
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
     * every normal stacking context regardless of z-index. Mounting the toast inside that dialog puts it in the same
     * top layer so it floats above the popup instead of behind it. The dialog has no transform, so the toast's fixed
     * positioning stays viewport-relative either way.
     * @returns {HTMLElement}
     */
  #host() {
    const dialog = this.#reference && this.#reference.closest && this.#reference.closest('dialog');
    return dialog && dialog.matches(':modal') ? dialog : document.body;
  }

  /**
     * Positions the toast horizontally centered over the reference element. Vertically it sits 10% down from the top.
     */
  #position() {
    const VERTICAL_FRACTION = 0.10;
    const rect = this.#reference
      ? this.#reference.getBoundingClientRect()
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    this.#el.style.left = `${rect.left + rect.width / 2}px`;
    this.#el.style.top = `${rect.top + rect.height * VERTICAL_FRACTION}px`;
  }

  /** Fades the toast out and removes it from the DOM. Safe to call more than once. */
  dismiss() {
    if (this.#dismissed) return;
    this.#dismissed = true;
    this.#clearTimer();
    if (this.#repositionHandler) window.removeEventListener('resize', this.#repositionHandler);
    this.#el.classList.remove('ps-toast--visible');
    setTimeout(() => this.#el.remove(), Toast.#FADE_MS);
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
