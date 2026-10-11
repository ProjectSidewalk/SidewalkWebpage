/** Entry point for the admin dashboard's sidewalks page. */
import { SidewalksPage } from '../../admin-dashboard/SidewalksPage.js';

const data = document.getElementById('page-entry').dataset;
new SidewalksPage({
  mapboxToken: data.mapboxToken,
  streetsUrl: '/v3/api/streets?filetype=geojson',
  presenceUrl: data.presenceUrl,
}).init();
