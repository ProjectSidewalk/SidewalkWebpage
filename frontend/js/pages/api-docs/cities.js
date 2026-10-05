/** Entry point for the /v3/api-docs/cities page. */
import '../../common/aggregateStats.js';
import { createPSMap } from '../../ps-map/createPSMap.js';

// apiDocs.js reads these for the download buttons.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'cities' });
const data = document.getElementById('page-entry').dataset;
// The same world map of deployment cities the landing page, /about, and /cities draw.
window.appManager.ready(() => {
  createPSMap({
    mapName: 'cities-preview',
    mapStyle: 'mapbox://styles/mapbox/light-v11?optimize=true',
    mapboxApiKey: data.mapboxApiKey,
    mapboxLogoLocation: 'bottom-left',
    scrollWheelZoom: false,
    cooperativeGestures: true,
    loadCities: true,
    // The reader is scrolling through docs, not watching the map come up, so it shows the world at once instead of
    // performing a zoom-out from this city's own center.
    animateCityFit: false,
    logClicks: true,
  }).catch((error) => {
    console.error('Cities preview error:', error);
    document.getElementById('cities-preview').innerHTML
      = '<div class="message message-error" role="alert">Failed to load cities data.</div>';
  });
});
