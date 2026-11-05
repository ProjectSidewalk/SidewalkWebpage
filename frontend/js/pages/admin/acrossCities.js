/** Entry point for the admin dashboard's acrossCities page. */
import { AcrossCitiesPage } from '../../admin-dashboard/AcrossCitiesPage.js';

const data = document.getElementById('page-entry').dataset;
// Distances are formatted by the i18next distance formatter, which exists once the app manager is ready.
window.appManager.ready(() => {
  new AcrossCitiesPage({
    scorecardsUrl: '/adminapi/cityScorecards',
    citiesUrl: '/v3/api/cities',
    funnelsUrl: '/adminapi/cityFunnels',
    trafficUrl: '/adminapi/cityTraffic',
    storiesPath: data.storiesPath,
    mapboxToken: data.mapboxToken,
  }).init();
});
