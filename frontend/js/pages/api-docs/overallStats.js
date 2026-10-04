/** Entry point for the /v3/api-docs/overallStats page (bundled by rolldown.config.mjs). */
import { OverallStatsPreview } from '../../api-docs/overallStatsPreview.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'overallStats' });
const { cityName } = document.getElementById('page-entry').dataset;
OverallStatsPreview.setup({ apiBaseUrl: '/v3/api', cityName }).init();
