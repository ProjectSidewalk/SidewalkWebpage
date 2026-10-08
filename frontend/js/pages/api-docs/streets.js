/** Entry point for the /v3/api-docs/streets page. */
import { StreetsPreview } from '../../api-docs/streetsPreview.js';
import '../../../css/pages/api-docs/streets.css';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'streets' });
const { mapboxApiKey } = document.getElementById('page-entry').dataset;
window.appManager.ready(() => StreetsPreview.setup({ mapboxApiKey }).init());
