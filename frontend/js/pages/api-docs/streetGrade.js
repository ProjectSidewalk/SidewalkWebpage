/** Entry point for the /v3/api-docs/streetGrade page. */
import { StreetGradePreview } from '../../api-docs/streetGradePreview.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'streetGrade' });
const { mapboxApiKey } = document.getElementById('page-entry').dataset;
window.appManager.ready(() => StreetGradePreview.setup({ mapboxApiKey }).init());
