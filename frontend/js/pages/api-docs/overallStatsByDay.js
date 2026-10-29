/** Entry point for the /v3/api-docs/overallStatsByDay page. */
import { OverallStatsByDayPreview } from '../../api-docs/overallStatsByDayPreview.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'overallStatsByDay' });
const { cityName } = document.getElementById('page-entry').dataset;
OverallStatsByDayPreview.setup({ apiBaseUrl: '/v3/api', cityName }).init();
