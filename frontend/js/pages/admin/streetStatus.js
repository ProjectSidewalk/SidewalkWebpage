/** Entry point for the admin dashboard's streetStatus page (bundled by rolldown.config.mjs). */
import { StreetStatusPage } from '../../admin-dashboard/StreetStatusPage.js';

const data = document.getElementById('page-entry').dataset;
new StreetStatusPage({
  mapboxToken: data.mapboxToken,
  streetsUrl: '/v3/api/streets?filetype=geojson',
  trendUrl: '/adminapi/streetStatusTrend',
  trendWeeks: Number(data.trendWeeks),
}).init();
