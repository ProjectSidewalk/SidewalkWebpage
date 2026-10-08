/** Entry point for the /v3/api-docs/streetTypes page. */
import { StreetTypesPreview } from '../../api-docs/streetTypesPreview.js';
import '../../../css/pages/api-docs/street-types.css';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'streetTypes' });
StreetTypesPreview.setup({ maxWidth: 1000 }).init();
