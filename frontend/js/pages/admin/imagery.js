/** Entry point for the admin dashboard's imagery page. */
import { ImageryPage } from '../../admin-dashboard/ImageryPage.js';

const data = document.getElementById('page-entry').dataset;
// Distances are formatted by the i18next distance formatter, which exists once the app manager is ready.
window.appManager.ready(() => {
  new ImageryPage({
    mapboxToken: data.mapboxToken,
    streetsUrl: '/v3/api/streets?filetype=geojson',
    priorityUrl: data.priorityUrl,
    pipelineUrl: data.pipelineUrl,
    pipelineDays: Number(data.pipelineDays),
  }).init();
});
