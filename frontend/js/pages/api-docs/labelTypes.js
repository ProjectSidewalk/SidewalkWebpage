/** Entry point for the /v3/api-docs/labelTypes page (bundled by rolldown.config.mjs). */
import { LabelTypesPreview } from '../../api-docs/labelTypesPreview.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'labelTypes' });
LabelTypesPreview.setup({ maxWidth: 1000 }).init();
