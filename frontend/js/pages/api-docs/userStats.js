/** Entry point for the /v3/api-docs/userStats page. */
import { UserStatsPreview } from '../../api-docs/userStatsPreview.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'userStats' });
const { cityName } = document.getElementById('page-entry').dataset;
UserStatsPreview.setup({ containerHeight: 500, apiBaseUrl: '/v3/api', cityName }).init();
