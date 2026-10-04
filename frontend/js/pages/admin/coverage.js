/** Entry point for the admin dashboard's coverage page (bundled by rolldown.config.mjs). */
import { CoveragePage } from '../../admin-dashboard/CoveragePage.js';

const data = document.getElementById('page-entry').dataset;
new CoveragePage({
  mapboxToken: data.mapboxToken,
  regionsUrl: '/v3/api/regions?filetype=geojson',
}).init();
