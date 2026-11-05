/** Entry point for the admin dashboard's coverage page. */
import { CoveragePage } from '../../admin-dashboard/CoveragePage.js';

const data = document.getElementById('page-entry').dataset;
// Distances are formatted by the i18next distance formatter, which exists once the app manager is ready.
window.appManager.ready(() => {
  new CoveragePage({
    mapboxToken: data.mapboxToken,
    regionsUrl: '/v3/api/regions?filetype=geojson',
  }).init();
});
