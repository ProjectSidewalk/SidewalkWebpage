/**
 * ShareWidget — reusable "share this thing" control.
 *
 * Wraps a trigger <button> and, when activated, either invokes the native OS share sheet (mobile / supporting
 * browsers) or opens a small accessible popover offering Copy Link, X, Facebook, and Email actions. The widget is
 * built once and re-pointed at different targets via {@link ShareWidget#setTarget}, so a host that shows a sequence
 * of items (e.g. the label detail view paging between labels) constructs a single instance and just updates the URL.
 *
 * Accessibility (WCAG 2.1/2.2 AA, ARIA menu pattern): the trigger carries `aria-haspopup`/`aria-expanded`; the
 * popover is a labeled `role="menu"`; ESC and click-outside close it; focus moves into the popover on open and
 * returns to the trigger on close; ArrowUp/ArrowDown cycle the items and Home/End jump to the first/last one; all
 * actions are real <button>s with visible focus states (styled in label-detail.css).
 */
class ShareWidget {
  /** @type {HTMLElement} The container the popover is appended into (positioned relative to the trigger). */
  #host;
  /** @type {HTMLButtonElement} The trigger button that toggles the popover / invokes native share. */
  #trigger;
  /** @type {HTMLElement|null} The popover element, lazily built on first non-native open. */
  #popover = null;
  /** @type {HTMLButtonElement|null} The Copy Link button, cached so its transient "Copied!" state can be reset. */
  #copyButton = null;
  /** @type {boolean} Whether the popover is currently open. */
  #open = false;
  /** @type {{url: string, title: string, text: string}} The current share target. */
  #target = { url: '', title: '', text: '' };
  /** @type {number|undefined} Timeout id for the transient "Copied!" state. */
  #copyResetTimer;

  // Bound handlers so add/removeEventListener reference the same function objects.
  #boundOutsideClick = (e) => this.#onOutsideClick(e);
  #boundKeydown = (e) => this.#onKeydown(e);

  /**
   * @param {HTMLButtonElement} trigger - The share trigger button (already in the DOM).
   * @param {object} [opts]
   * @param {HTMLElement} [opts.host] - Element to append the popover into. Defaults to the trigger's parent, which
   *      should be positioned (`position: relative`) so the popover anchors to the trigger.
   */
  constructor(trigger, opts = {}) {
    this.#trigger = trigger;
    this.#host = opts.host || trigger.parentElement || document.body;

    this.#trigger.setAttribute('aria-haspopup', 'true');
    this.#trigger.setAttribute('aria-expanded', 'false');
    this.#trigger.addEventListener('click', () => this.#onTriggerClick());
  }

  /**
   * Points the widget at a new share target. Safe to call repeatedly (e.g. once per shown label). Closes the popover
   * if open so its links can't point at a stale target.
   *
   * @param {object} target
   * @param {string} target.url - Absolute URL to share.
   * @param {string} target.title - Short title (used by the native sheet and as the email subject).
   * @param {string} target.text - Longer descriptive text (used by the native sheet, X, and the email body).
   */
  setTarget({ url, title, text }) {
    this.#target = { url: url || '', title: title || '', text: text || '' };
    if (this.#open) this.#closePopover();
  }

  /**
   * Handles a trigger activation: log the click, then use the native share sheet when available, otherwise toggle
   * the custom popover.
   * @private
   */
  #onTriggerClick() {
    this.#log('Share_Click');
    const { url, title, text } = this.#target;
    if (!url) return;

    const data = { title, text, url };
    // Prefer the native OS share sheet where supported. canShare (when present) must approve the payload.
    if (navigator.share && (typeof navigator.canShare !== 'function' || navigator.canShare(data))) {
      this.#log('Share_Native');
      navigator.share(data).catch(() => { /* User dismissed the sheet; nothing to do. */ });
      return;
    }
    this.#togglePopover();
  }

  /** @private */
  #togglePopover() {
    if (this.#open) this.#closePopover();
    else this.#openPopover();
  }

  /**
   * Builds (once) and opens the popover, moves focus into it, and starts the outside-click / ESC listeners.
   * @private
   */
  #openPopover() {
    if (!this.#popover) this.#buildPopover();
    this.#resetCopyState();
    this.#popover.hidden = false;
    this.#open = true;
    this.#trigger.setAttribute('aria-expanded', 'true');

    // Defer listener registration so the click that opened the popover doesn't immediately close it.
    setTimeout(() => {
      document.addEventListener('click', this.#boundOutsideClick, true);
      document.addEventListener('keydown', this.#boundKeydown, true);
    }, 0);

    const firstItem = this.#popover.querySelector('[role="menuitem"]');
    if (firstItem) firstItem.focus();
  }

  /**
   * Closes the popover, tears down listeners, and returns focus to the trigger.
   * @param {boolean} [returnFocus=true] - Whether to move focus back to the trigger (skip on outside-click).
   * @private
   */
  #closePopover(returnFocus = true) {
    if (this.#popover) this.#popover.hidden = true;
    this.#open = false;
    this.#trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', this.#boundOutsideClick, true);
    document.removeEventListener('keydown', this.#boundKeydown, true);
    if (returnFocus) this.#trigger.focus();
  }

  /**
   * Constructs the popover DOM (heading + four action buttons) and appends it to the host. Called lazily the first
   * time a non-native share is opened.
   * @private
   */
  #buildPopover() {
    const t = (key) => (typeof i18next !== 'undefined' ? i18next.t(`common:${key}`) : key);

    const popover = document.createElement('div');
    popover.className = 'label-detail__share-popover';
    popover.setAttribute('role', 'menu');
    popover.hidden = true;

    const headingId = `share-heading-${Math.random().toString(36).slice(2, 8)}`;
    popover.setAttribute('aria-labelledby', headingId);

    const heading = document.createElement('p');
    heading.className = 'label-detail__share-heading';
    heading.id = headingId;
    heading.textContent = t('share.heading');
    popover.appendChild(heading);

    // Copy Link — mirrors the routeBuilder clipboard pattern with a transient "Copied!" confirmation.
    this.#copyButton = this.#makeItem(ShareWidget.#ICON_LINK, t('share.copy-link'), () => this.#copyLink());
    popover.appendChild(this.#copyButton);

    popover.appendChild(this.#makeItem(ShareWidget.#ICON_X, t('share.on-x'), () => this.#shareTo(
      'Twitter',
      (u, txt) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(u)}&text=${encodeURIComponent(txt)}`,
    )));

    popover.appendChild(this.#makeItem(ShareWidget.#ICON_FACEBOOK, t('share.on-facebook'), () => this.#shareTo(
      'Facebook',
      (u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`,
    )));

    popover.appendChild(this.#makeItem(ShareWidget.#ICON_EMAIL, t('share.via-email'), () => this.#shareEmail()));

    this.#host.appendChild(popover);
    this.#popover = popover;
  }

  /**
   * Builds a single popover action button.
   * @param {string} iconSvg - Inline SVG markup for the leading icon (static, trusted).
   * @param {string} label - Visible button label.
   * @param {() => void} onClick - Click handler.
   * @returns {HTMLButtonElement}
   * @private
   */
  #makeItem(iconSvg, label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'label-detail__share-item';
    btn.setAttribute('role', 'menuitem');

    const icon = document.createElement('span');
    icon.className = 'label-detail__share-item-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = iconSvg; // Static, trusted SVG constants — no user input.

    const text = document.createElement('span');
    text.className = 'label-detail__share-item-label';
    text.textContent = label;

    btn.append(icon, text);
    btn.addEventListener('click', onClick);
    return btn;
  }

  /**
   * Copies the current URL to the clipboard and flips the Copy Link button into a transient "Copied!" state.
   * @private
   */
  #copyLink() {
    navigator.clipboard.writeText(this.#target.url).then(() => {
      this.#log('Share_CopyLink');
      const labelEl = this.#copyButton.querySelector('.label-detail__share-item-label');
      if (labelEl) labelEl.textContent = i18next.t('common:share.copied');
      this.#copyButton.classList.add('is-copied');
      clearTimeout(this.#copyResetTimer);
      this.#copyResetTimer = setTimeout(() => this.#resetCopyState(), 1500);
    }).catch((err) => console.error('Share: clipboard write failed', err));
  }

  /** Resets the Copy Link button back to its default label. @private */
  #resetCopyState() {
    clearTimeout(this.#copyResetTimer);
    if (!this.#copyButton) return;
    const labelEl = this.#copyButton.querySelector('.label-detail__share-item-label');
    if (labelEl) labelEl.textContent = i18next.t('common:share.copy-link');
    this.#copyButton.classList.remove('is-copied');
  }

  /**
   * Opens a social share intent URL in a new tab and logs the platform.
   * @param {string} platform - Platform name for logging (Twitter / Facebook).
   * @param {(url: string, text: string) => string} buildUrl - Builds the intent URL from the target.
   * @private
   */
  #shareTo(platform, buildUrl) {
    this.#log(`Share_Platform=${platform}`);
    window.open(buildUrl(this.#target.url, this.#target.text), '_blank', 'noopener');
    this.#closePopover();
  }

  /**
   * Opens the user's mail client with a prefilled subject/body.
   * @private
   */
  #shareEmail() {
    this.#log('Share_Platform=Email');
    const subject = encodeURIComponent(this.#target.title);
    const body = encodeURIComponent(`${this.#target.text}\n\n${this.#target.url}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    this.#closePopover();
  }

  /**
   * Closes the popover when a click lands outside it and the trigger.
   * @param {MouseEvent} e
   * @private
   */
  #onOutsideClick(e) {
    if (this.#popover.contains(e.target) || this.#trigger.contains(e.target)) return;
    this.#closePopover(false);
  }

  /**
   * Keyboard handling while the popover is open: ESC closes it (stopping propagation so a host <dialog> doesn't
   * also close), and ArrowUp/ArrowDown/Home/End move focus between the menu items per the ARIA menu pattern.
   * @param {KeyboardEvent} e
   * @private
   */
  #onKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.#closePopover();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...this.#popover.querySelectorAll('[role="menuitem"]')];
    if (items.length === 0) return;
    e.preventDefault();

    // When focus sits outside the menu (e.g. the user clicked elsewhere without closing), arrows re-enter at an end.
    const idx = items.indexOf(document.activeElement);
    let next;
    if (e.key === 'Home' || (e.key === 'ArrowDown' && idx === -1)) next = items[0];
    else if (e.key === 'End' || (e.key === 'ArrowUp' && idx === -1)) next = items[items.length - 1];
    else if (e.key === 'ArrowDown') next = items[(idx + 1) % items.length];
    else next = items[(idx - 1 + items.length) % items.length];
    next.focus();
  }

  /**
   * Records an activity via the global logger, if present.
   * @param {string} activity - Event name (e.g. 'Share_CopyLink').
   * @private
   */
  #log(activity) {
    if (typeof window.logWebpageActivity === 'function') window.logWebpageActivity(activity);
  }

  // ─── Inline SVG icons (24×24, currentColor) ───────────────────────────────
  // Line breaks sit at attribute/command boundaries, where SVG treats the newline as plain whitespace.
  static #ICON_LINK = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>`;

  static #ICON_X = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08
      l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"/>
  </svg>`;

  static #ICON_FACEBOOK = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47
      h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956
      1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073Z"/>
  </svg>`;

  static #ICON_EMAIL = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <path d="m22 7-10 6L2 7"/>
  </svg>`;
}
