/** Entry point for the admin dashboard's apiAnalytics page (bundled by rolldown.config.mjs). */
import { ApiAnalyticsPage } from '../../admin-dashboard/ApiAnalyticsPage.js';

new ApiAnalyticsPage({ dataUrl: '/adminapi/apiAnalyticsBySource' }).init();
