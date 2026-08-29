/**
 * ShareWidget — reusable "share this thing" control.
 *
 * Wraps a trigger <button> and, when activated, either invokes the native OS share sheet (touch-primary devices in
 * supporting browsers) or opens a small accessible popover offering Copy Link, Bluesky, X, Facebook, LinkedIn, and
 * Email actions. The widget is built once and re-pointed at different targets via {@link ShareWidget#setTarget}, so
 * a host that shows a sequence of items (e.g. the label detail view paging between labels) constructs a single
 * instance and just updates the URL.
 *
 * Accessibility (WCAG 2.1/2.2 AA, ARIA menu pattern): the trigger carries `aria-haspopup`/`aria-expanded`; the
 * popover is a labeled `role="menu"`; ESC and click-outside close it; focus moves into the popover on open and
 * returns to the trigger on close; ArrowUp/ArrowDown cycle the items and Home/End jump to the first/last one; all
 * actions are real <button>s with visible focus states (styled in css/components/share-widget.css).
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
  /** @type {?(() => Promise<void>)} Optional async step run before each activation; see the constructor. */
  #beforeOpen = null;
  /** @type {boolean} Whether a beforeOpen step is in flight, so a second click can't start another. */
  #opening = false;
  /** @type {boolean} Which side the host asked the popover to open on; read once, since #fitPopover rewrites it. */
  #prefersBelow = false;
  /** @type {boolean} Whether to measure and fit the popover on each open; see the constructor. */
  #fitToViewport = false;
  /** @type {?(() => void)} Called after a user-initiated close; see the constructor. */
  #onDismiss = null;

  // Order the menu sheds actions in when it can't fit beside its trigger, least-missed first.
  static #SHED_ORDER = ['x', 'bluesky'];

  // Bound handlers so add/removeEventListener reference the same function objects.
  #boundOutsideClick = (e) => this.#onOutsideClick(e);
  #boundKeydown = (e) => this.#onKeydown(e);

  /**
   * @param {HTMLButtonElement} trigger - The share trigger button (already in the DOM).
   * @param {object} [opts]
   * @param {HTMLElement} [opts.host] - Element to append the popover into. Defaults to the trigger's parent, which
   *      should be positioned (`position: relative`) so the popover anchors to the trigger.
   * @param {() => Promise<void>} [opts.beforeOpen] - Awaited on each activation, before the target is read. For a
   *      host whose target may not exist yet — Explore's just-placed labels have no server-side id until the next
   *      form submit — this is where it is brought into being. The trigger carries `is-pending` while it runs.
   * @param {boolean} [opts.fitToViewport=false] - Measure the space around the trigger on each open and adapt (see
   *      #fitPopover). For a trigger that can sit anywhere on screen: the label panels float over the pano and
   *      follow the label icon they are anchored to. Off by default, because the fit is measured against the
   *      viewport — a trigger inside a scrolling or clipping container would be measured against the wrong box.
   * @param {() => void} [opts.onDismiss] - Called after the *user* closes the popover (outside click, ESC, a chosen
   *      action, or a second click on the trigger). For a host that suspends its own dismissal while the popover is
   *      up and needs to know when to resume. Not called when the host closes the widget itself via close() or
   *      setTarget() — it already knows about those.
   */
  constructor(trigger, opts = {}) {
    this.#trigger = trigger;
    this.#host = opts.host || trigger.parentElement || document.body;
    this.#beforeOpen = opts.beforeOpen || null;
    this.#fitToViewport = Boolean(opts.fitToViewport);
    this.#onDismiss = opts.onDismiss || null;

    // Read before the first open: #fitPopover rewrites this class, so the markup's choice has to be captured now.
    this.#prefersBelow = Boolean(this.#host.classList?.contains('label-detail__share--below'));

    this.#trigger.setAttribute('aria-haspopup', 'true');
    this.#trigger.setAttribute('aria-expanded', 'false');
    this.#trigger.addEventListener('click', () => this.#onTriggerClick());
  }

  /**
   * Builds the standard per-card share chip: the positioning wrapper the popover anchors into, plus the trigger
   * button (share glyph + visible localized "Share" label). The landing validation grid's cards and the /stories
   * story cards mount one of these per item; hosts restyle it through the extra wrapper class. The caller appends
   * the wrapper, wires any host-specific logging on the trigger, and constructs the ShareWidget itself.
   *
   * @param {string} [extraWrapClass] - Host-specific class(es) added to the wrapper for per-host styling.
   * @returns {{wrap: HTMLElement, trigger: HTMLButtonElement}}
   */
  static buildChip(extraWrapClass = '') {
    const label = typeof i18next !== 'undefined' ? i18next.t('common:share.button') : 'Share';

    const wrap = document.createElement('span');
    wrap.className = `label-detail__share${extraWrapClass ? ` ${extraWrapClass}` : ''}`;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'label-detail__share-trigger';
    trigger.setAttribute('aria-label', label);
    trigger.innerHTML = ShareWidget.#ICON_SHARE; // Static, trusted SVG constant — no user input.

    const labelEl = document.createElement('span');
    labelEl.className = 'label-detail__share-trigger-label';
    labelEl.textContent = label;
    trigger.appendChild(labelEl);

    wrap.appendChild(trigger);
    return { wrap, trigger };
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
    if (this.#open) this.#closePopover(true, false);
  }

  /**
   * Whether the popover is currently open.
   *
   * Hosts that dismiss themselves need this. Explore's and Validate's label cards hide on a timer once the pointer
   * leaves them, which would otherwise take an open share popover down with the card it is anchored to, mid-choice.
   *
   * @returns {boolean}
   */
  isOpen() {
    return this.#open;
  }

  /**
   * Closes the popover if it is open, without moving focus.
   *
   * For a host that takes its panel away on its own terms — a keyboard shortcut, a pan, a jump to another label.
   * The popover lives inside that panel, so hiding the panel would otherwise leave this widget believing it is
   * still open: its document listeners stay armed, and every `isOpen()` caller keeps getting `true`.
   *
   * Focus is left alone deliberately: the panel holding the trigger is being hidden, so returning focus to it would
   * land focus on an invisible element.
   */
  close() {
    if (this.#open) this.#closePopover(false, false);
  }

  /**
   * Handles a trigger activation: log the click, then use the native share sheet on touch-primary devices that
   * support it, otherwise toggle the custom popover.
   * @private
   */
  async #onTriggerClick() {
    // A click while the popover is up is a dismissal, not a share. Taken before anything else so it neither logs a
    // second Share_Click nor re-runs the host's beforeOpen step for a target that is already resolved.
    if (this.#open) {
      this.#closePopover();
      return;
    }

    this.#log('Share_Click');

    // Give the host a chance to bring the target into being first (see opts.beforeOpen). Guarded against a second
    // click while it is in flight, which would start a duplicate submission.
    if (this.#beforeOpen) {
      if (this.#opening) return;
      this.#opening = true;
      this.#trigger.classList.add('is-pending');
      try {
        await this.#beforeOpen();
      } catch (err) {
        console.error('Share: could not prepare the share target', err);
        return;
      } finally {
        this.#opening = false;
        this.#trigger.classList.remove('is-pending');
      }
    }

    const { url, title, text } = this.#target;
    if (!url) return;

    const data = { title, text, url };
    // Native OS share sheets are designed for phones; on desktop they're clunky — macOS's lacks even a copy-URL
    // action (#4660) — so reserve the native path for touch-primary devices. `pointer: coarse` matches phones and
    // tablets (incl. iPads whose UA masquerades as macOS) but not desktops, even touchscreen laptops, whose primary
    // pointer is a fine mouse/trackpad. canShare (when present) must still approve the payload.
    const touchPrimary = window.matchMedia('(pointer: coarse)').matches;
    if (touchPrimary && navigator.share && (typeof navigator.canShare !== 'function' || navigator.canShare(data))) {
      this.#log('Share_Native');
      navigator.share(data).catch(() => { /* User dismissed the sheet; nothing to do. */ });
      return;
    }
    this.#openPopover();
  }

  /**
   * Fits the popover to the space around its trigger: first by choosing which side to open on, then — if it is still
   * too tall for either — by dropping the least-reached platforms until it fits.
   *
   * Both are measured on every open rather than decided once. The label card's trigger moves with the label icon it
   * is anchored to, which can sit anywhere in the pano, and the menu is six actions tall.
   *
   * Only runs for hosts that ask for it (opts.fitToViewport). Room is measured against the viewport, which is the
   * right box for a panel floating over the pano and the wrong one for a trigger inside a scrolling or clipping
   * container — the label-detail popup's footer and the landing grid's cards both sit in one.
   * @private
   */
  #fitPopover() {
    const wrapper = this.#popover.parentElement;
    if (!wrapper) return;

    // A previous open may have dropped some; start from the full menu and re-derive.
    for (const platform of ShareWidget.#SHED_ORDER) this.#setPlatformHidden(platform, false);

    const GAP = 8;
    const height = () => this.#popover.offsetHeight;
    const room = () => {
      const t = this.#trigger.getBoundingClientRect();
      return { below: window.innerHeight - t.bottom - GAP, above: t.top - GAP };
    };

    // Only overrule the host's preferred side when that side has no room and the other one does; when neither fits,
    // the preference wins so the menu at least opens somewhere predictable, and shedding takes over below.
    let below = this.#prefersBelow;
    const space = room();
    if (below && height() > space.below && height() <= space.above) below = false;
    else if (!below && height() > space.above && height() <= space.below) below = true;
    wrapper.classList.toggle('label-detail__share--below', below);

    // Still too tall. Drop platforms rather than let the menu run off the screen, cheapest first: Copy link is what
    // most people came for, and email is the one that works without an account anywhere.
    for (const platform of ShareWidget.#SHED_ORDER) {
      if (height() <= (below ? room().below : room().above)) return;
      this.#setPlatformHidden(platform, true);
    }
  }

  /**
   * Shows or hides one platform's menu item.
   * @param {string} platform - A key from #SHED_ORDER.
   * @param {boolean} hidden
   * @private
   */
  #setPlatformHidden(platform, hidden) {
    const item = this.#popover.querySelector(`[data-share-platform="${platform}"]`);
    if (item) item.hidden = hidden;
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
    if (this.#fitToViewport) this.#fitPopover();

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
   * @param {boolean} [notifyHost=true] - Whether to run the host's onDismiss hook. False when the host is the one
   *      closing us (close(), setTarget()), which it does not need telling about.
   * @private
   */
  #closePopover(returnFocus = true, notifyHost = true) {
    if (this.#popover) this.#popover.hidden = true;
    this.#open = false;
    this.#trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', this.#boundOutsideClick, true);
    document.removeEventListener('keydown', this.#boundKeydown, true);
    if (returnFocus) this.#trigger.focus();
    if (notifyHost) this.#onDismiss?.();
  }

  /**
   * Constructs the popover DOM (heading + one action button per platform) and appends it to the host. Called lazily
   * the first time a non-native share is opened.
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

    // Bluesky's compose intent has no separate url param, so the permalink rides in the text. Posts cap at 300
    // graphemes and the composer opens in an over-limit state past that, so keep `share.text` short in every locale —
    // today's strings plus a /label/<id> permalink land near 70.
    popover.appendChild(this.#makeItem(ShareWidget.#ICON_BLUESKY, t('share.on-bluesky'), () => this.#shareTo(
      'Bluesky',
      (u, txt) => `https://bsky.app/intent/compose?text=${encodeURIComponent(`${txt}\n\n${u}`)}`,
    ), 'bluesky'));

    // The platform key stays 'Twitter' so the logged events remain comparable across the rename.
    popover.appendChild(this.#makeItem(ShareWidget.#ICON_X, t('share.on-x'), () => this.#shareTo(
      'Twitter',
      (u, txt) => `https://x.com/intent/post?url=${encodeURIComponent(u)}&text=${encodeURIComponent(txt)}`,
    ), 'x'));

    popover.appendChild(this.#makeItem(ShareWidget.#ICON_FACEBOOK, t('share.on-facebook'), () => this.#shareTo(
      'Facebook',
      (u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`,
    )));

    // LinkedIn's share endpoint takes only the url; it builds the post preview from the page's OG tags.
    popover.appendChild(this.#makeItem(ShareWidget.#ICON_LINKEDIN, t('share.on-linkedin'), () => this.#shareTo(
      'LinkedIn',
      (u) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}`,
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
  #makeItem(iconSvg, label, onClick, platform) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'label-detail__share-item';
    btn.setAttribute('role', 'menuitem');
    if (platform) btn.dataset.sharePlatform = platform;

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
   * @param {string} platform - Platform name for logging (Bluesky / Twitter / Facebook / LinkedIn).
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
    // Navigate rather than window.open: the browser hands a mailto: to the OS mail handler without leaving the
    // page, whereas window.open strands a blank tab showing the raw mailto: URL when no handler picks it up.
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
    const items = [...this.#popover.querySelectorAll('[role="menuitem"]')].filter((i) => !i.hidden);
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

  // The trigger's three-node share glyph — the same one the Twirl-rendered triggers carry (shareTrigger.scala.html).
  static #ICON_SHARE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="18" cy="5" r="3"/>
    <circle cx="6" cy="12" r="3"/>
    <circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>`;

  static #ICON_LINK = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>`;

  static #ICON_BLUESKY = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213
      24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299
      -5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782
      8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.3-2.777.473-5.899-.308-6.755-3.369C.42 10.04 0 4.615 0 3.883
      c0-3.67 3.217-2.517 5.202-1.026"/>
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

  static #ICON_LINKEDIN = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351
      V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433
      c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925
      2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542
      C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>`;

  static #ICON_EMAIL = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <path d="m22 7-10 6L2 7"/>
  </svg>`;
}
