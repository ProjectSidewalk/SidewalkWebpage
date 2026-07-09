/**
 * Renders the admin Label Map page (#4272): an interactive per-label point map for spatially exploring labels.
 *
 * This is the redesign's home for the legacy admin "Map" tab. It reuses the shared PSMap component (createPSMap) and
 * the common map-sidebar filter (MapSidebarFilter), loading every label from /adminapi/labels/all as colored points,
 * and wires the label-detail popup so clicking a point opens its full detail. A label-ID search box jumps straight to
 * any label's popup (and exposes /admin/label/:id as a fallback link). All map/filter/popup behavior is identical to
 * the legacy map — only the surrounding page is the new dashboard shell.
 */
class LabelMapPage {
  #opts;
  #popup = null;
  #map = null;
  #mapData = null;

  /**
   * @param {{mapboxToken: string, viewerType: Function, accessToken: string, username: string}} opts
   */
  constructor(opts) {
    this.#opts = opts;
  }

  async init() {
    this.#wireSearch(); // Wire the ID search immediately; it stays usable even if the map/popup are slow.

    // Build the label-detail popup first so the map can hand clicks to it. If it fails (e.g. pano libs missing),
    // the map still renders and the search box falls back to opening /admin/label/:id as a page.
    try {
      this.#popup = await LabelPopup(true, this.#opts.viewerType, this.#opts.accessToken, this.#opts.username);
    } catch (err) {
      console.error('Label Map: label popup failed to initialize; clicks/search will navigate instead.', err);
    }

    // Same params as the legacy admin "Map" tab: neighborhoods in a flat grey, interactive streets, all labels as
    // points, and the popup wired in. mapData (index 4 of the resolved array) is what MapSidebarFilter filters on.
    const params = {
      mapName: 'admin-labelmap-choropleth',
      mapStyle: 'mapbox://styles/mapbox/light-v11?optimize=true',
      mapboxApiKey: this.#opts.mapboxToken,
      mapboxLogoLocation: 'bottom-right',
      neighborhoodsURL: '/neighborhoods',
      completionRatesURL: '/adminapi/neighborhoodCompletionRate',
      streetsURL: '/contribution/streets/all?filterLowQuality=true',
      labelsURL: '/adminapi/labels/all',
      neighborhoodFillMode: 'singleColor',
      neighborhoodFillColor: '#808080',
      neighborhoodFillOpacity: 0.1,
      neighborhoodTooltip: 'none',
      differentiateUnauditedStreets: true,
      interactiveStreets: true,
      navigationControlPosition: 'top-right',
      uiSource: 'AdminLabelMap',
      popupLabelViewer: this.#popup,
      logClicks: false,
      highQualityFilter: true,
    };

    try {
      const result = await createPSMap($, params);
      this.#map = result[0];
      this.#mapData = result[4];
      new MapSidebarFilter(this.#map, this.#mapData, { highQualityFilter: true });
    } catch (err) {
      console.error('Label Map: map failed to load.', err);
      const holder = document.getElementById('admin-labelmap-choropleth');
      if (holder) {
        holder.innerHTML = '<p class="dq-empty" style="padding:24px">Could not load the map. Please try again.</p>';
      }
    }
  }

  #wireSearch() {
    const form = document.getElementById('label-map-search');
    const input = document.getElementById('label-map-search-input');
    if (!form || !input) return;

    form.addEventListener('submit', () => {
      const id = parseInt(input.value, 10);
      if (!(id > 0)) {
        this.#searchMsg('Enter a numeric label ID.', true);
        return;
      }
      if (this.#popup) {
        this.#searchMsg('');
        this.#popup.showLabel(id, 'AdminLabelMap');
      } else {
        // Popup unavailable — fall back to the standalone label page.
        window.open(`/admin/label/${id}`, '_blank', 'noopener');
      }
    });
  }

  #searchMsg(message, isError = false) {
    const el = document.getElementById('label-map-search-msg');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', !!isError);
  }
}
