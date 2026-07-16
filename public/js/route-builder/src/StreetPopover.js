/**
 * The labeled action menu that opens when a street already in the route is clicked (#4578): two explicit
 * buttons — "Reverse direction" and "Remove street" — replacing the old undiscoverable click-to-reverse /
 * click-again-to-remove cycling.
 */
class StreetPopover {
  #popup;
  #onReverse;
  #onRemove;

  /**
   * @param {Object} map - The Mapbox map.
   * @param {Function} onReverse - Called with the street id when "Reverse direction" is clicked.
   * @param {Function} onRemove - Called with the street id when "Remove street" is clicked.
   */
  constructor(map, onReverse, onRemove) {
    this.map = map;
    this.#onReverse = onReverse;
    this.#onRemove = onRemove;
    this.#popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: true, offset: 10, maxWidth: '260px' });
  }

  /**
   * Opens the menu for a street at the clicked location.
   *
   * @param {number} streetId
   * @param {Object} lngLat - Where to anchor the popup (the click location).
   */
  open(streetId, lngLat) {
    const container = document.createElement('div');
    container.className = 'street-popover';
    container.innerHTML = `
      <button type="button" class="street-popover-btn street-popover-reverse">
        <img src="/assets/images/icons/routebuilder/reverse-street.svg" alt="" class="street-popover-icon">
        <span>${i18next.t('reverse-direction')}</span>
      </button>
      <button type="button" class="street-popover-btn street-popover-remove">
        <img src="/assets/images/icons/routebuilder/delete-street.svg" alt="" class="street-popover-icon">
        <span>${i18next.t('remove-street')}</span>
      </button>`;
    container.querySelector('.street-popover-reverse').addEventListener('click', () => {
      window.logWebpageActivity(`RouteBuilder_Click=ReverseStreet_StreetId=${streetId}`);
      this.#onReverse(streetId);
      this.close();
    });
    container.querySelector('.street-popover-remove').addEventListener('click', () => {
      window.logWebpageActivity(`RouteBuilder_Click=RemoveStreet_StreetId=${streetId}`);
      this.#onRemove(streetId);
      this.close();
    });

    this.#popup.setLngLat(lngLat).setDOMContent(container).addTo(this.map);
    container.querySelector('.street-popover-reverse').focus();
  }

  close() {
    this.#popup.remove();
  }
}
