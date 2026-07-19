/**
 * Navbar controller: dropdown disclosures, the searchable city switcher, the mobile hamburger, and click logging.
 *
 * Vanilla + self-contained: the navbar's interactivity lives here, independent of any third-party plugin.
 * Menus follow the WAI-ARIA disclosure pattern (a button with aria-expanded controlling a panel of links) rather
 * than the application-menu pattern, which is the recommended model for site navigation and lets the city panel
 * hold a search field. Loaded as a deferred script on every page that renders the navbar (via main.scala.html).
 */
class NavbarController {
  /** @type {HTMLElement} The <nav id="header"> root. */
  #nav;

  /** @type {HTMLButtonElement[]} All dropdown toggle buttons. */
  #toggles = [];

  /** @type {?{li: HTMLElement, btn: HTMLButtonElement}} The currently open dropdown, or null. */
  #current = null;

  /** @type {?HTMLElement} The <div id="navbar"> holding both nav groups. */
  #menu = null;

  /** @type {?HTMLElement} The hamburger button; its visibility tells us the nav is in its stacked state. */
  #hamburger = null;

  /**
   * Space-freeing steps for the inline bar, ordered lowest priority first. Each takes a boolean and applies or
   * clears its effect; #fitNav applies as few as will make the bar fit.
   * @type {Array<function(boolean): void>}
   */
  #shedSteps = [];

  /**
   * Click-target id → activity string logged for that navbar element.
   * @type {Object<string, string>}
   */
  #logMap = {
    'navbar-brand': 'Click_module=PSLogo',
    'navbar-sign-in-btn': 'Click_module=SignIn',
    'navbar-start-btn': 'Click_module=StartExploring',
    'navbar-validate-btn': 'Click_module=StartValidating',
    'navbar-guide-btn': 'Click_module=LabelingGuide',
    'navbar-retake-tutorial-btn': 'Click_module=RetakeTutorial',
    'navbar-help-btn': 'Click_module=Help',
    'navbar-api-btn': 'Click_module=SidewalkAPI',
    'navbar-cities-btn': 'Click_module=DeploymentSitesDashboard',
    'navbar-gallery-btn': 'Click_module=Gallery',
    'navbar-expert-validate-btn-tools': 'Click_module=ExpertValidate_from=ToolsDropdown',
    'navbar-leaderboard-btn': 'Click_module=Leaderboard',
    'navbar-leaderboard-btn-user': 'Click_module=Leaderboard_from=UserDropdown',
    'navbar-labelmap-btn': 'Click_module=LabelMap',
    'navbar-labelmap-btn-tools': 'Click_module=LabelMap_from=ToolsDropdown',
    'navbar-route-builder-btn': 'Click_module=RouteBuilder',
    'navbar-sign-out-btn': 'Click_module=SignOut',
    'navbar-admin-btn': 'Click_module=ToAdmin',
    'navbar-dashboard-btn': 'Click_module=ToDashboard',
    'navbar-expert-validate-btn-user': 'Click_module=ExpertValidate_from=UserDropdown',
  };

  constructor() {
    this.#nav = document.getElementById('header');
    if (!this.#nav) return;
    this.#wireDropdowns();
    this.#wireHamburger();
    this.#wireCitySearch();
    this.#wireGlobalHandlers();
    this.#wireLogging();
    this.#wireResponsiveNav();
  }

  /**
   * Returns the visible, focusable links/buttons inside a panel (excludes the city search input and hidden items).
   * @param {HTMLElement} panel - The dropdown panel.
   * @returns {HTMLElement[]} Focusable items in DOM order.
   */
  #items(panel) {
    return Array.from(panel.querySelectorAll('a[href], button:not([disabled])'))
      .filter((el) => el.offsetParent !== null);
  }

  /**
   * Opens a dropdown, closing any other open one first.
   * @param {HTMLElement} li - The <li> wrapping the toggle + panel.
   * @param {HTMLButtonElement} btn - The toggle button.
   * @param {HTMLElement} panel - The panel to reveal.
   * @param {boolean} [focusFirst=false] - Move focus into the panel (search input if present, else first item).
   */
  #open(li, btn, panel, focusFirst = false) {
    this.#closeAll(li);
    li.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    this.#current = { li, btn };
    // Only move focus into the panel on a keyboard-initiated open; a mouse/touch open leaves focus on the toggle so
    // it doesn't steal focus into the city search (which would pop the on-screen keyboard on mobile).
    if (!focusFirst) return;
    const search = panel.querySelector('.nav-city-search');
    if (search) {
      search.focus();
    } else {
      const items = this.#items(panel);
      if (items[0]) items[0].focus();
    }
  }

  /**
   * Closes a dropdown.
   * @param {HTMLElement} li - The <li> wrapping the toggle + panel.
   * @param {HTMLButtonElement} btn - The toggle button.
   * @param {boolean} [focusBtn=false] - Return focus to the toggle button (used for keyboard close).
   */
  #close(li, btn, focusBtn = false) {
    li.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    if (this.#current && this.#current.li === li) this.#current = null;
    if (focusBtn) btn.focus();
  }

  /**
   * Closes every open dropdown except an optional one to keep open.
   * @param {?HTMLElement} [except] - A <li> to leave open.
   */
  #closeAll(except) {
    for (const btn of this.#toggles) {
      const li = btn.closest('.navbar-lnk');
      if (li && li !== except && li.classList.contains('is-open')) this.#close(li, btn);
    }
  }

  /** Wires click + keyboard behavior on each dropdown toggle and its panel. */
  #wireDropdowns() {
    this.#toggles = Array.from(this.#nav.querySelectorAll('[data-nav-dropdown]'));
    for (const btn of this.#toggles) {
      const li = btn.closest('.navbar-lnk');
      const panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (!li || !panel) continue;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (li.classList.contains('is-open')) this.#close(li, btn, true);
        // e.detail === 0 marks a keyboard-activated click (Enter/Space); move focus into the panel then, but not on
        // a real mouse/touch click (whose detail is >= 1) so tapping doesn't pop the mobile keyboard.
        else this.#open(li, btn, panel, e.detail === 0);
      });

      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (li.classList.contains('is-open')) {
            const items = this.#items(panel);
            if (items[0]) items[0].focus();
          } else {
            this.#open(li, btn, panel, true);
          }
        } else if (e.key === 'Escape' && li.classList.contains('is-open')) {
          e.preventDefault();
          this.#close(li, btn, true);
        }
      });

      panel.addEventListener('keydown', (e) => this.#onPanelKeydown(e, li, btn, panel));
    }
  }

  /**
   * Handles roving focus + Escape within an open panel.
   * @param {KeyboardEvent} e - The keydown event.
   * @param {HTMLElement} li - The wrapping <li>.
   * @param {HTMLButtonElement} btn - The toggle button.
   * @param {HTMLElement} panel - The panel.
   */
  #onPanelKeydown(e, li, btn, panel) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.#close(li, btn, true);
      return;
    }
    const items = this.#items(panel);
    const search = panel.querySelector('.nav-city-search');
    // In the search field, only ArrowDown (jump to first result) is intercepted; typing is left alone.
    if (e.target === search) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items[0]) items[0].focus();
      }
      return;
    }
    const idx = items.indexOf(e.target);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items[idx + 1]) items[idx + 1].focus();
      else if (search) search.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx > 0) items[idx - 1].focus();
      else if (search) search.focus();
      else btn.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (items[0]) items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      if (items.length) items[items.length - 1].focus();
    }
  }

  /** Wires the mobile hamburger toggle for the collapsed nav. */
  #wireHamburger() {
    const toggle = this.#nav.querySelector('[data-nav-toggle]');
    const menu = document.getElementById('navbar');
    if (!toggle || !menu) return;
    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  /**
   * Sets up the progressive shedding that keeps the bar on one line, and re-runs it whenever the available width
   * can have changed.
   */
  #wireResponsiveNav() {
    this.#menu = document.getElementById('navbar');
    this.#hamburger = this.#nav.querySelector('[data-nav-toggle]');
    if (!this.#menu) return;

    // Items opt in via data-nav-shed="<n>", n ascending from the first to be dropped.
    this.#shedSteps = Array.from(this.#menu.querySelectorAll('[data-nav-shed]'))
      .sort((a, b) => Number(a.dataset.navShed) - Number(b.dataset.navShed))
      .map((li) => (on) => li.classList.toggle('is-shed', on));

    const lang = document.getElementById('language-dropdown');
    if (lang) this.#shedSteps.push((on) => lang.classList.toggle('is-compact', on));

    let queued = false;
    const update = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        this.#fitNav();
      });
    };
    window.addEventListener('resize', update);
    // Web fonts land after first paint and change every label's width, so re-fit once they're in.
    if (document.fonts) document.fonts.ready.then(update);
    this.#fitNav();
  }

  /**
   * Keeps the inline bar on a single line: restores every item, then applies shed steps in priority order until the
   * two nav groups fit. Measured at runtime rather than pinned to breakpoints, because the widths involved depend on
   * the active language's labels and on the signed-in username.
   */
  #fitNav() {
    // In the stacked hamburger panel each item has its own row, so everything is shown.
    const stacked = this.#hamburger && this.#hamburger.offsetParent !== null;
    for (const step of this.#shedSteps) step(false);
    if (stacked) return;
    for (const step of this.#shedSteps) {
      // A few pixels of slack so items never sit flush against the edge of the available space.
      if (this.#menu.scrollWidth <= this.#menu.clientWidth - 8) return;
      step(true);
    }
  }

  /** Wires live client-side filtering of the city switcher, hiding empty country groups. */
  #wireCitySearch() {
    const input = document.getElementById('nav-city-search');
    const menu = document.getElementById('nav-city-menu');
    if (!input || !menu) return;
    const empty = menu.querySelector('.nav-city-empty');
    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      let anyVisible = false;
      for (const item of menu.querySelectorAll('.nav-city-item')) {
        const match = !query || (item.dataset.search || '').includes(query);
        item.hidden = !match;
        if (match) anyVisible = true;
      }
      for (const group of menu.querySelectorAll('.nav-city-group')) {
        group.hidden = !group.querySelector('.nav-city-item:not([hidden])');
      }
      if (empty) empty.hidden = anyVisible;
    });
  }

  /** Closes the open dropdown on an outside click or when focus leaves it (e.g. Tab-out). */
  #wireGlobalHandlers() {
    const closeIfOutside = (target) => {
      if (this.#current && !this.#current.li.contains(target)) {
        this.#close(this.#current.li, this.#current.btn);
      }
    };
    document.addEventListener('click', (e) => closeIfOutside(e.target));
    document.addEventListener('focusin', (e) => closeIfOutside(e.target));
  }

  /** Logs navbar clicks to the activity table via a single delegated listener keyed on element id. */
  #wireLogging() {
    const knownSelector = Object.keys(this.#logMap).map((id) => `#${id}`).join(',');
    this.#nav.addEventListener('click', (e) => {
      if (!(e.target instanceof Element)) return;
      const cityLink = e.target.closest('#nav-city-menu a[href]');
      if (cityLink && !cityLink.closest('.nav-city-current')) {
        this.#log(`Click_module=NavbarCityDropdown_city=${cityLink.id}`);
        return;
      }
      const known = e.target.closest(knownSelector);
      if (known && this.#logMap[known.id]) this.#log(this.#logMap[known.id]);
    });
  }

  /**
   * Sends one activity log line in the navbar's established format.
   * @param {string} activity - The Click_module=... prefix.
   */
  #log(activity) {
    if (typeof window.logWebpageActivity !== 'function') return;
    window.logWebpageActivity(`${activity}_location=Navbar_route=${window.location.pathname}`);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new NavbarController());
} else {
  new NavbarController();
}
