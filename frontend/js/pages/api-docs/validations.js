/** Entry point for the /v3/api-docs/validations page. */
import { ValidationsPreview } from '../../api-docs/validationsPreview.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'validations' });
ValidationsPreview.setup({ maxChartsToShow: 6, minValidationsToShow: 10 }).init();
