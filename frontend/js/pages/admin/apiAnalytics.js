/** Entry point for the admin dashboard's apiAnalytics page. */
import { ApiAnalyticsPage } from '../../admin-dashboard/ApiAnalyticsPage.js';

new ApiAnalyticsPage({ dataUrl: '/adminapi/apiAnalyticsBySource' }).init();
