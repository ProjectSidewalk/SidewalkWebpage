/**
 * The shared PSMap choropleth (audited streets + label points) a dashboard shows for one mapper: the signed-in user's
 * own on the dashboard, another mapper's on the public profile, from whichever streets/labels endpoints the caller
 * names.
 */
import { createPSMap } from '../ps-map/createPSMap.js';
import { MapSidebarFilter } from '../ps-map/MapSidebarFilter.js';

/**
 * Loads the map into the existing `#<mapId>` holder once translations are ready.
 *
 * With `wireLabelPopup`, map labels become hoverable/clickable and open the shared label-detail popup, exactly like
 * LabelMap; the page must then expose `window.udLabelPopupReady`, a Promise resolving to its LabelPopup instance (or
 * null if its init failed, which leaves clicks as harmless no-ops).
 *
 * @param {{mapId: string, mapboxApiKey: string, streetsURL: string, labelsURL: string, wireLabelPopup?: boolean}} opts
 * @returns {Promise<?object>} The map, or null if it failed to load, so an awaiting section is never left hanging.
 */
export function loadContributionMap({ mapId, mapboxApiKey, streetsURL, labelsURL, wireLabelPopup = false }) {
  return new Promise((resolve) => {
    window.appManager.ready(async () => {
      const params = {
        mapName: mapId,
        mapStyle: 'mapbox://styles/mapbox/light-v11?optimize=true',
        mapboxApiKey,
        zoomCorrection: -0.5,
        mapboxLogoLocation: 'bottom-right',
        regionsURL: '/regions',
        completionRatesURL: '/regions/completionRates',
        streetsURL,
        labelsURL,
        regionFillMode: 'singleColor',
        regionTooltip: 'none',
        regionFillColor: '#5d6d6b',
        regionFillOpacity: 0.1,
        uiSource: 'UserMap',
        navigationControlPosition: 'top-right',
        // The legend is supporting detail on a dashboard, not the point of the page, so the map gets the room.
        sidebarStartsCollapsed: true,
        // Every street in this feed is one the mapper audited, so there is no unaudited arm to grey out here; the
        // flag's only effect is turning on the dashed rendering for streets that need a re-audit (#4384).
        differentiateUnauditedStreets: true,
      };
      if (wireLabelPopup) {
        // Label hover/click in AddLabelsToMap only activates when a popupLabelViewer is present. This thin adapter
        // resolves the host page's popup lazily at click time, so map setup can't race popup init.
        params.popupLabelViewer = {
          showLabel: async (labelId, uiSource) => {
            const popup = await window.udLabelPopupReady;
            if (!popup) return;
            await popup.showLabel(labelId, uiSource);
          },
        };
      }
      try {
        const m = await createPSMap(params);
        new MapSidebarFilter(m[0], m[4], { highQualityFilter: false });
        resolve(m[0]);
        // Wheel/trackpad zooms the map whenever the pointer is over it, and scrolls the page everywhere else.
        const map = m[0];
        if (map && map.scrollZoom) {
          map.scrollZoom.disable();
          const holder = document.getElementById(`${mapId}-holder`);
          if (holder) {
            holder.addEventListener('mouseenter', () => map.scrollZoom.enable());
            holder.addEventListener('mouseleave', () => map.scrollZoom.disable());
          }
        }
      } catch (e) {
        console.error('Contribution map failed to load', e);
        resolve(null);
      }
    });
  });
}
