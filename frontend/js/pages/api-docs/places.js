/** Entry point for the /v3/api-docs/places page (bundled by rolldown.config.mjs). */
import { PlacesPreview } from '../../api-docs/placesPreview.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'places' });
const { mapboxApiKey } = document.getElementById('page-entry').dataset;
window.appManager.ready(() => PlacesPreview.setup({ mapboxApiKey }).init());
