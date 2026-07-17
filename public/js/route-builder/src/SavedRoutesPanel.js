/**
 * The "Your saved routes" section on the RouteBuilder intro panel: a card per route with its name, a meta line
 * (distance · est. exploration time · neighborhood), and Explore / copy-link actions. Signed-in users see their
 * account's routes (GET /userapi/routes); anonymous users see the device-local list kept in localStorage, so a
 * forgotten share link isn't fatal.
 */
class SavedRoutesPanel {
  static STORAGE_KEY = 'rb-guest-routes';
  static MAX_GUEST_ROUTES = 20;
  static MAX_SHOWN = 5;

  #isSignedIn;
  #formatMeta;
  #setTemporaryTooltip;
  #panel;
  #list;

  /**
   * @param {Object} opts
   * @param {boolean} opts.isSignedIn - Whether the user is signed in (selects the routes source).
   * @param {Function} opts.formatMeta - (distanceMeters, regionName) => the card's meta line.
   * @param {Function} opts.setTemporaryTooltip - (buttonEl, message) that flashes a confirmation tooltip.
   */
  constructor(opts) {
    this.#isSignedIn = opts.isSignedIn === true;
    this.#formatMeta = opts.formatMeta;
    this.#setTemporaryTooltip = opts.setTemporaryTooltip;
    this.#panel = document.getElementById('saved-routes-panel');
    this.#list = document.getElementById('saved-routes-list');
  }

  /**
   * Re-reads the routes (account routes over HTTP, or the device-local list) and re-renders the section.
   *
   * @param {number} [highlightRouteId] - Route to visually mark as just-saved.
   */
  refresh(highlightRouteId = null) {
    if (!this.#panel) return;
    if (this.#isSignedIn) {
      fetch('/userapi/routes', { headers: { Accept: 'application/json' } })
        .then((response) => (response.ok ? response.json() : []))
        .then((routes) => this.#render(routes.map((r) => ({
          routeId: r.route_id,
          name: r.name,
          regionName: r.region_name,
          distanceMeters: r.distance_meters,
          savedAt: r.created_at,
        })), highlightRouteId))
        .catch(() => this.#render([], null));
    } else {
      this.#render(this.#readGuestRoutes(), highlightRouteId);
    }
  }

  /**
   * Prepends a guest-saved route to the device-local list (capped, newest first).
   *
   * @param {Object} route - {routeId, name, regionName, url, distanceMeters}.
   */
  recordGuestRoute(route) {
    const routes = this.#readGuestRoutes().filter((r) => r.routeId !== route.routeId);
    routes.unshift({ ...route, savedAt: new Date().toISOString() });
    try {
      localStorage.setItem(
        SavedRoutesPanel.STORAGE_KEY, JSON.stringify(routes.slice(0, SavedRoutesPanel.MAX_GUEST_ROUTES)),
      );
    } catch {
      // Storage unavailable (e.g. private browsing): the card still renders for this page load.
    }
  }

  /**
   * Reads the guest routes list from localStorage.
   * @returns {Array<Object>} Saved route records, newest first; empty if none or storage is unavailable.
   */
  #readGuestRoutes() {
    try {
      const raw = localStorage.getItem(SavedRoutesPanel.STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Renders the newest few routes as cards (the section hides itself when there are none).
   *
   * @param {Array<Object>} routes - {routeId, name, regionName, distanceMeters, savedAt, [url]}.
   * @param {number|null} highlightRouteId
   */
  #render(routes, highlightRouteId) {
    const sorted = routes
      .slice()
      .sort((a, b) => new Date(b.savedAt ?? 0) - new Date(a.savedAt ?? 0))
      .slice(0, SavedRoutesPanel.MAX_SHOWN);
    this.#panel.hidden = sorted.length === 0;
    if (sorted.length === 0) return;

    this.#list.innerHTML = sorted.map((route) => `
      <li class="saved-route-card${route.routeId === highlightRouteId ? ' saved-route-card--new' : ''}">
        <span class="saved-route-name"></span>
        <span class="saved-route-meta"></span>
        <div class="saved-route-actions">
          <a class="button-ps button--primary button--tiny saved-route-explore" href="/explore?routeId=${route.routeId}"
             data-route-id="${route.routeId}">${i18next.t('saved-explore')}</a>
          <button type="button" class="button-ps button--secondary button--tiny saved-route-copy"
                  data-route-id="${route.routeId}">${i18next.t('recent-copy-link')}</button>
        </div>
      </li>`).join('');

    // Names and region text are user/geo data: set via textContent so they can't inject markup.
    this.#list.querySelectorAll('.saved-route-card').forEach((card, i) => {
      const route = sorted[i];
      card.querySelector('.saved-route-name').textContent = route.name;
      card.querySelector('.saved-route-meta').textContent = typeof route.distanceMeters === 'number'
        ? this.#formatMeta(route.distanceMeters, route.regionName)
        : (route.regionName ?? '');
    });

    this.#list.querySelectorAll('.saved-route-explore').forEach((link) => {
      link.addEventListener('click', () => {
        window.logWebpageActivity(`RouteBuilder_Click=SavedRoute_Explore_RouteId=${link.dataset.routeId}`);
      });
    });
    this.#list.querySelectorAll('.saved-route-copy').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(`${window.location.origin}/explore?routeId=${btn.dataset.routeId}`);
        this.#setTemporaryTooltip(btn, i18next.t('copied-to-clipboard'));
        window.logWebpageActivity(`RouteBuilder_Click=SavedRoute_Copy_RouteId=${btn.dataset.routeId}`);
      });
    });
  }
}
