/** Entry point for the /v3/api-docs/accessScoreRegions page. */
import { AccessScoreRegionsPreview } from '../../api-docs/accessScoreRegionsPreview.js';
import '../../../css/pages/api-docs/access-score.css';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'accessScoreRegions' });
const { mapboxApiKey } = document.getElementById('page-entry').dataset;
window.appManager.ready(() => AccessScoreRegionsPreview.setup({ mapboxApiKey }).init());
