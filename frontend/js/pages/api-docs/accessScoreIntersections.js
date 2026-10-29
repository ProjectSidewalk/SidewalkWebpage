/** Entry point for the /v3/api-docs/accessScoreIntersections page. */
import { AccessScoreIntersectionsPreview } from '../../api-docs/accessScoreIntersectionsPreview.js';
import '../../../css/pages/api-docs/access-score.css';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'accessScoreIntersections' });
const { mapboxApiKey } = document.getElementById('page-entry').dataset;
window.appManager.ready(() => AccessScoreIntersectionsPreview.setup({ mapboxApiKey }).init());
