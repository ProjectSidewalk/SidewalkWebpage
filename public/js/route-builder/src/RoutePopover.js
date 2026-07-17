/**
 * The small action menu that opens when the drawn route is clicked: two labeled icon buttons, "Reverse direction"
 * and "Delete route". These act on the whole route (auto-routed routes are edited by adding/undoing points, not
 * street-by-street).
 */
class RoutePopover {
  #map;
  #popup;
  #onReverse;
  #onDelete;

  /**
   * @param {Object} map - The Mapbox map.
   * @param {Function} onReverse - Called when "Reverse direction" is clicked.
   * @param {Function} onDelete - Called when "Delete route" is clicked.
   */
  constructor(map, onReverse, onDelete) {
    this.#map = map;
    this.#onReverse = onReverse;
    this.#onDelete = onDelete;
    this.#popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: true, offset: 10, maxWidth: '260px' });
  }

  /**
   * Opens the menu at the clicked location.
   *
   * @param {Object} lngLat - Where to anchor the popup (the click location).
   */
  open(lngLat) {
    const container = document.createElement('div');
    container.className = 'route-popover';
    container.innerHTML = `
      <button type="button" class="route-popover-btn route-popover-reverse">
        <img src="/assets/images/icons/repeat-feather.svg" alt="" class="route-popover-icon">
        <span>${i18next.t('reverse-direction')}</span>
      </button>
      <button type="button" class="route-popover-btn route-popover-delete">
        <img src="/assets/images/icons/trash-2-feather.svg" alt="" class="route-popover-icon">
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
    container.querySelector('.route-popover-reverse').focus();
  }

  /** Closes the menu (no-op if it isn't open). */
  close() {
    this.#popup.remove();
  }
}
