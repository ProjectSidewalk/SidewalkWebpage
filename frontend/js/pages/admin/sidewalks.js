/** Entry point for the admin dashboard's sidewalks page. */
import { SidewalksPage } from '../../admin-dashboard/SidewalksPage.js';

const data = document.getElementById('page-entry').dataset;
// Distances are formatted by the i18next distance formatter, which exists once the app manager is ready.
window.appManager.ready(() => {
  new SidewalksPage({
    mapboxToken: data.mapboxToken,
    streetsUrl: '/v3/api/streets?filetype=geojson',
    presenceUrl: data.presenceUrl,
  }).init();
});
