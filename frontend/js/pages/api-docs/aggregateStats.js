/** Entry point for the /v3/api-docs/aggregateStats page (bundled by rolldown.config.mjs). */
import { AggregateStatsPreview } from '../../api-docs/aggregateStatsPreview.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'aggregateStats' });
AggregateStatsPreview.setup({ maxWidth: 1000 }).init();
