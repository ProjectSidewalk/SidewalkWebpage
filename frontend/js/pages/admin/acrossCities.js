/** Entry point for the admin dashboard's acrossCities page (bundled by rolldown.config.mjs). */
import { AcrossCitiesPage } from '../../admin-dashboard/AcrossCitiesPage.js';

const data = document.getElementById('page-entry').dataset;
new AcrossCitiesPage({
  scorecardsUrl: '/adminapi/cityScorecards',
  citiesUrl: '/v3/api/cities',
  funnelsUrl: '/adminapi/cityFunnels',
  trafficUrl: '/adminapi/cityTraffic',
  storiesPath: data.storiesPath,
  mapboxToken: data.mapboxToken,
}).init();
