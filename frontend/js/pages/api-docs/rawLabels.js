/** Entry point for the /v3/api-docs/rawLabels page. */
import { RawLabelsPreview } from '../../api-docs/rawLabelsPreview.js';
import '../../../css/pages/api-docs/raw-labels.css';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'rawLabels' });
const { mapboxApiKey } = document.getElementById('page-entry').dataset;
window.appManager.ready(() => RawLabelsPreview.setup({ mapboxApiKey }).init());
