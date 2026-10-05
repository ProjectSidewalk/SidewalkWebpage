/** Entry point for the /v3/api-docs/validationResultTypes page. */
import { ValidationResultTypesPreview } from '../../api-docs/validationResultTypesPreview.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'validationResultTypes' });
ValidationResultTypesPreview.setup({ maxWidth: 1000 }).init();
