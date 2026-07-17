/**
 * The device-local "Your recent routes" list for anonymous users (#3343): remembers guest-saved routes in
 * localStorage and renders the recovery panel on the RouteBuilder intro screen, so a forgotten share link isn't
 * fatal. Signed-in users don't use this — their routes live in the dashboard's My Routes section.
 */
class GuestRoutes {
  static STORAGE_KEY = 'rb-guest-routes';
  static MAX_ROUTES = 20;

  #panel;
  #list;
  #setTemporaryTooltip;

  /**
   * @param {Function} setTemporaryTooltip - Callback (buttonEl, message) that flashes a confirmation tooltip.
   */
  constructor(setTemporaryTooltip) {
    this.#panel = document.getElementById('recent-routes-panel'); // Only rendered for anonymous users.
    this.#list = document.getElementById('recent-routes-list');
    this.#setTemporaryTooltip = setTemporaryTooltip;
  }

  /** Hides the panel (used while a route is being built). */
  hide() {
    if (this.#panel) this.#panel.hidden = true;
  }

  /**
   * Reads the guest routes list from localStorage.
   * @returns {Array<Object>} Saved route records, newest first; empty if none or storage is unavailable.
   */
  read() {
    try {
      const raw = localStorage.getItem(GuestRoutes.STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Prepends a guest-saved route to the device-local recent routes list (capped, newest first).
   *
   * @param {number} routeId
   * @param {string} name
   * @param {string|null} regionName
   * @param {string} url - The shareable /explore?routeId= link.
   */
  record(routeId, name, regionName, url) {
    const routes = this.read().filter((r) => r.routeId !== routeId);
    routes.unshift({
      routeId,
      name,
      regionName,
      savedAt: new Date().toISOString(),
      url,
    });
    try {
      const capped = routes.slice(0, GuestRoutes.MAX_ROUTES);
      localStorage.setItem(GuestRoutes.STORAGE_KEY, JSON.stringify(capped));
    } catch {
      // Storage unavailable (e.g. private browsing): the copy-link flow still works.
    }
  }

  /**
   * Renders the "recent routes on this device" panel (hidden for signed-in users and empty lists).
   */
  render() {
    if (!this.#panel) return; // Panel only exists for anonymous users.
    const routes = this.read();
    this.#panel.hidden = routes.length === 0;
    if (routes.length === 0) return;

    this.#list.innerHTML = routes.map((r) => `
      <li class="recent-route-item">
        <div class="recent-route-info">
          <a href="${r.url}" class="recent-route-name" data-route-id="${r.routeId}"></a>
          <span class="recent-route-meta"></span>
        </div>
        <button type="button" class="recent-route-copy button-ps button--secondary button--tiny" data-url="${r.url}"
                data-route-id="${r.routeId}">${i18next.t('recent-copy-link')}</button>
      </li>`).join('');

    // Names and region/date are user/geo data: set via textContent so they can't inject markup.
    this.#list.querySelectorAll('.recent-route-item').forEach((item, i) => {
      const route = routes[i];
      item.querySelector('.recent-route-name').textContent = route.name;
      const date = new Date(route.savedAt).toLocaleDateString(i18next.language);
      item.querySelector('.recent-route-meta').textContent
        = route.regionName ? `${route.regionName} · ${date}` : date;
    });

    this.#list.querySelectorAll('.recent-route-name').forEach((link) => {
      link.addEventListener('click', () => {
        window.logWebpageActivity(`RouteBuilder_Click=RecoverGuestRoute_RouteId=${link.dataset.routeId}`);
      });
    });
    this.#list.querySelectorAll('.recent-route-copy').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.url);
        this.#setTemporaryTooltip(btn, i18next.t('copied-to-clipboard'));
        window.logWebpageActivity(`RouteBuilder_Click=RecoverGuestRoute_Copy_RouteId=${btn.dataset.routeId}`);
      });
    });
  }
}
