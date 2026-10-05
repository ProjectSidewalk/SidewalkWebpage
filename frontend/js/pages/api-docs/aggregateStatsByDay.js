/** Entry point for the /v3/api-docs/aggregateStatsByDay page. */
import { AggregateStatsByDayPreview } from '../../api-docs/aggregateStatsByDayPreview.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'aggregateStatsByDay' });
AggregateStatsByDayPreview.setup({ apiBaseUrl: '/v3/api' }).init();
