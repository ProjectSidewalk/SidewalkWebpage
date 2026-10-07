/** Entry point for the /v3/api-docs/accessScoreStreets page. */
import { AccessScoreStreetsPreview } from '../../api-docs/accessScoreStreetsPreview.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'accessScoreStreets' });
const { mapboxApiKey } = document.getElementById('page-entry').dataset;
window.appManager.ready(() => AccessScoreStreetsPreview.setup({ mapboxApiKey }).init());
