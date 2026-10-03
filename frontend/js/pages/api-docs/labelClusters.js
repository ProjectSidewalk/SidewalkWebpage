/** Entry point for the /v3/api-docs/labelClusters page (bundled by rolldown.config.mjs). */
import { LabelClustersPreview } from '../../api-docs/labelClustersPreview.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'labelClusters' });
const { mapboxApiKey } = document.getElementById('page-entry').dataset;
window.appManager.ready(() => LabelClustersPreview.setup({ mapboxApiKey }).init());
