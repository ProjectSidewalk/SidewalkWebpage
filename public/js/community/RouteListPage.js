/**
 * The public /routes page (#4688): the city's saved RouteBuilder routes as a searchable/sortable card grid.
 *
 * Search/sort/dates come from CommunityListPage; this class adds the route-specific layer — the copy-share-link
 * button and activity logging on the Explore / Label Map links.
 */
class RouteListPage {
  #list;

  constructor() {
    this.#list = new CommunityListPage('RouteListPage', {
      newest: { key: 'created', numeric: true, desc: true },
      neighborhood: { key: 'region' },
      longest: { key: 'distance', numeric: true, desc: true },
      explored: { key: 'explored', numeric: true, desc: true },
    });
  }

  init() {
    this.#list.init();
    document.querySelectorAll('.route-card__copy').forEach((btn) => {
      btn.addEventListener('click', () => this.#copyLink(btn));
    });
    document.querySelectorAll('.route-card__explore, .route-card__labelmap').forEach((link) => {
      link.addEventListener('click', () => {
        const kind = link.classList.contains('route-card__explore') ? 'Explore' : 'LabelMap';
        window.logWebpageActivity(`Click_module=RouteListPage_${kind}_RouteId=${link.dataset.routeId}`);
      });
    });
  }

  /**
   * Copies the route's shareable link to the clipboard and confirms with a toast. The slug URL (/r/<slug>) is
   * preferred; cards without one fall back to the routeId link, which also keeps working.
   * @param {HTMLElement} btn - The clicked copy button (carries data-route-id).
   */
  #copyLink(btn) {
    const slug = btn.closest('.route-card')?.dataset.slug;
    const url = slug
      ? `${window.location.origin}/r/${slug}`
      : `${window.location.origin}/explore?routeId=${btn.dataset.routeId}`;
    navigator.clipboard.writeText(url);
    Toast.show({ message: i18next.t('dashboard:routes-link-copied'), reference: btn });
    window.logWebpageActivity(`Click_module=RouteListPage_Copy_RouteId=${btn.dataset.routeId}`);
  }
}
