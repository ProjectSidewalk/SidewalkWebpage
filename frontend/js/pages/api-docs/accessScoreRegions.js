/** Entry point for the /v3/api-docs/accessScoreRegions page (bundled by rolldown.config.mjs). */
import { AccessScoreRegionsPreview } from '../../api-docs/accessScoreRegionsPreview.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'accessScoreRegions' });
const { mapboxApiKey } = document.getElementById('page-entry').dataset;
window.appManager.ready(() => AccessScoreRegionsPreview.setup({ mapboxApiKey }).init());
