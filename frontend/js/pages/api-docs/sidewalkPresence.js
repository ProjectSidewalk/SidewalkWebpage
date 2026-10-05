/** Entry point for the /v3/api-docs/sidewalkPresence page. */
import { SidewalkPresencePreview } from '../../api-docs/sidewalkPresencePreview.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'sidewalkPresence' });
const { mapboxApiKey } = document.getElementById('page-entry').dataset;
window.appManager.ready(() => SidewalkPresencePreview.setup({ mapboxApiKey }).init());
