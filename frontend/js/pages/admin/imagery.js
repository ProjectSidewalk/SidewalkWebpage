/** Entry point for the admin dashboard's imagery page (bundled by rolldown.config.mjs). */
import { ImageryPage } from '../../admin-dashboard/ImageryPage.js';

const data = document.getElementById('page-entry').dataset;
new ImageryPage({
  mapboxToken: data.mapboxToken,
  streetsUrl: '/v3/api/streets?filetype=geojson',
  priorityUrl: data.priorityUrl,
  pipelineUrl: data.pipelineUrl,
  pipelineDays: Number(data.pipelineDays),
}).init();
