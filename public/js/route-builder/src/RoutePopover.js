/**
 * The small action menu for the drawn route: two labeled rows, "Reverse route direction" and "Delete route". It
 * opens on click or after a short hover on the route (so it's discoverable), anchored where the pointer is. These
 * act on the whole route (auto-routed routes are edited by adding/undoing points, not street-by-street).
 */
class RoutePopover {
  #map;
  #popup;
  #onReverse;
  #onDelete;

  /**
   * @param {Object} map - The Mapbox map.
   * @param {Function} onReverse - Called when "Reverse route direction" is clicked.
   * @param {Function} onDelete - Called when "Delete route" is clicked.
   */
  constructor(map, onReverse, onDelete) {
    this.#map = map;
    this.#onReverse = onReverse;
    this.#onDelete = onDelete;
    this.#popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: true,
      offset: 12,
      maxWidth: '280px',
      className: 'route-popover-popup',
    });
  }

  /**
   * Whether the menu is currently open.
   * @returns {boolean}
   */
  isOpen() {
    return this.#popup.isOpen();
  }

  /**
   * Opens the menu at the given location.
   *
   * @param {Object} lngLat - Where to anchor the popup (the pointer location on the route).
   * @param {boolean} [focus=false] - Move keyboard focus into the menu (for click-opens; a hover-open must not
   *   steal focus from whatever the user is doing).
   */
  open(lngLat, focus = false) {
    const container = document.createElement('div');
    container.className = 'route-popover';
    container.setAttribute('role', 'menu');
    container.innerHTML = `
      <button type="button" class="route-popover-btn route-popover-reverse" role="menuitem">
        <span class="route-popover-icon-chip">
          <img src="/assets/images/icons/repeat-feather.svg" alt="" class="route-popover-icon">
        </span>
        <span>${i18next.t('reverse-direction')}</span>
      </button>
      <button type="button" class="route-popover-btn route-popover-delete" role="menuitem">
        <span class="route-popover-icon-chip route-popover-icon-chip--danger">
          <img src="/assets/images/icons/trash-2-red-feather.svg" alt="" class="route-popover-icon">
        </span>
        <span>${i18next.t('delete-route')}</span>
      </button>`;
    container.querySelector('.route-popover-reverse').addEventListener('click', () => {
      window.logWebpageActivity('RouteBuilder_Click=ReverseRoute_Popover');
      this.close();
      this.#onReverse();
    });
    container.querySelector('.route-popover-delete').addEventListener('click', () => {
      window.logWebpageActivity('RouteBuilder_Click=DeleteRoute_Popover');
      this.close();
      this.#onDelete();
    });

    this.#popup.setLngLat(lngLat).setDOMContent(container).addTo(this.#map);
    if (focus) container.querySelector('.route-popover-reverse').focus();
  }

  /** Closes the menu (no-op if it isn't open). */
  close() {
    this.#popup.remove();
  }
}
