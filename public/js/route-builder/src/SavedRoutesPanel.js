/**
 * The "Your saved routes" section on the RouteBuilder intro panel: a card per route with its name, a meta line
 * (distance · est. exploration time · neighborhood), and Explore / copy-link actions. Signed-in users see their
 * account's routes (GET /userapi/routes); anonymous users see the device-local list kept in localStorage, so a
 * forgotten share link isn't fatal.
 */
class SavedRoutesPanel {
  static STORAGE_KEY = 'rb-guest-routes';
  static MAX_GUEST_ROUTES = 20;
  // Kept small so the panel doesn't scroll; the dashboard link below the list is the "see all" path.
  static MAX_SHOWN = 3;

  #isSignedIn;
  #formatMeta;
  #setTemporaryTooltip;
  #onView;
  #panel;
  #list;
  #activeRouteId = null; // Route currently previewed on the map (its card carries the active style).

  /**
   * @param {Object} opts
   * @param {boolean} opts.isSignedIn - Whether the user is signed in (selects the routes source).
   * @param {Function} opts.formatMeta - (distanceMeters, regionName) => the card's meta line.
   * @param {Function} opts.setTemporaryTooltip - (buttonEl, message) that flashes a confirmation tooltip.
   * @param {Function} opts.onView - Called with the route id when a card body is clicked (opens it in the editor).
   */
  constructor(opts) {
    this.#isSignedIn = opts.isSignedIn === true;
    this.#formatMeta = opts.formatMeta;
    this.#setTemporaryTooltip = opts.setTemporaryTooltip;
    this.#onView = opts.onView;
    this.#panel = document.getElementById('saved-routes-panel');
    this.#list = document.getElementById('saved-routes-list');
  }

  /**
   * Marks the card whose route is being previewed on the map (or clears the mark with null). The mark survives
   * re-renders, so it also applies when a deep-linked preview loads before the cards do.
   *
   * @param {number|null} routeId
   */
  markActive(routeId) {
    this.#activeRouteId = routeId;
    this.#list?.querySelectorAll('.saved-route-card').forEach((card) => {
      card.classList.toggle('saved-route-card--active', Number(card.dataset.routeId) === routeId);
    });
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
          slug: r.slug,
          description: r.description,
          regionName: r.region_name,
          distanceMeters: r.distance_meters,
          savedAt: r.created_at,
          startedCount: r.started_count,
          completedCount: r.completed_count,
          thumbnailUrl: r.thumbnail_url,
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

    // With more routes than the panel shows, the dashboard link doubles as the "see the rest" affordance.
    const dashboardLink = document.getElementById('saved-routes-dashboard-link');
    if (dashboardLink && routes.length > SavedRoutesPanel.MAX_SHOWN) {
      dashboardLink.textContent = i18next.t('see-all-routes', { count: routes.length });
    }

    this.#list.innerHTML = sorted.map((route) => {
      const cardClasses = ['saved-route-card',
        route.routeId === highlightRouteId ? 'saved-route-card--new' : '',
        route.routeId === this.#activeRouteId ? 'saved-route-card--active' : ''].filter(Boolean).join(' ');
      const thumb = route.thumbnailUrl
        ? `<img class="saved-route-thumb" src="${route.thumbnailUrl}" alt="" loading="lazy">`
        : '';
      const usage = typeof route.startedCount === 'number'
        ? `<span class="saved-route-usage" title="${i18next.t('route-usage-tooltip')}">
             ${i18next.t('route-usage', { started: route.startedCount, completed: route.completedCount })}
           </span>`
        : '';
      return `
      <li class="${cardClasses}" data-route-id="${route.routeId}">
        <button type="button" class="saved-route-view" data-route-id="${route.routeId}"
                title="${i18next.t('saved-view-title')}">
          ${thumb}
          <span class="saved-route-name"></span>
          <span class="saved-route-desc" hidden></span>
          <span class="saved-route-meta"></span>
          ${usage}
        </button>
        <div class="saved-route-actions">
          <a class="button-ps button--primary button--tiny saved-route-explore" href="/explore?routeId=${route.routeId}"
             data-route-id="${route.routeId}">${i18next.t('saved-explore')}</a>
          <button type="button" class="button-ps button--secondary button--tiny saved-route-copy"
                  data-route-id="${route.routeId}">${i18next.t('recent-copy-link')}</button>
        </div>
      </li>`;
    }).join('');

    // Names, descriptions, and region text are user/geo data: set via textContent so they can't inject markup.
    this.#list.querySelectorAll('.saved-route-card').forEach((card, i) => {
      const route = sorted[i];
      card.querySelector('.saved-route-name').textContent = route.name;
      const descEl = card.querySelector('.saved-route-desc');
      descEl.textContent = route.description ?? '';
      descEl.hidden = !route.description;
      card.querySelector('.saved-route-meta').textContent = typeof route.distanceMeters === 'number'
        ? this.#formatMeta(route.distanceMeters, route.regionName)
        : (route.regionName ?? '');
      // The copy button builds its URL from the slug; kept in a data attribute so user text can't inject markup.
      if (route.slug) card.querySelector('.saved-route-copy').dataset.slug = route.slug;
    });

    this.#list.querySelectorAll('.saved-route-view').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.logWebpageActivity(`RouteBuilder_Click=SavedRoute_Edit_RouteId=${btn.dataset.routeId}`);
        this.#onView(Number(btn.dataset.routeId));
      });
    });
    this.#list.querySelectorAll('.saved-route-explore').forEach((link) => {
      link.addEventListener('click', () => {
        window.logWebpageActivity(`RouteBuilder_Click=SavedRoute_Explore_RouteId=${link.dataset.routeId}`);
      });
    });
    this.#list.querySelectorAll('.saved-route-copy').forEach((btn) => {
      btn.addEventListener('click', () => {
        // Older guest records predate slugs; their links fall back to the routeId form, which keeps working.
        const url = btn.dataset.slug
          ? `${window.location.origin}/r/${btn.dataset.slug}`
          : `${window.location.origin}/explore?routeId=${btn.dataset.routeId}`;
        navigator.clipboard.writeText(url);
        this.#setTemporaryTooltip(btn, i18next.t('copied-to-clipboard'));
        window.logWebpageActivity(`RouteBuilder_Click=SavedRoute_Copy_RouteId=${btn.dataset.routeId}`);
      });
    });
  }
}
