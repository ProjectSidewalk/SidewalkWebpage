/** Entry point for the /v3/api-docs/regions page (bundled by rolldown.config.mjs). */
import { RegionsPreview } from '../../api-docs/regionsPreview.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'regions' });
const { mapboxApiKey } = document.getElementById('page-entry').dataset;
window.appManager.ready(() => RegionsPreview.setup({ mapboxApiKey }).init());
