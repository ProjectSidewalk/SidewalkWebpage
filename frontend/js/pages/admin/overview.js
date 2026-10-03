/** Entry point for the admin dashboard's overview page (bundled by rolldown.config.mjs). */
import { OverviewPage } from '../../admin-dashboard/OverviewPage.js';

new OverviewPage({
  summaryUrl: '/adminapi/overviewSummary',
  activityByDayUrl: '/adminapi/activityByDay',
  recentActivityUrl: '/adminapi/recentActivity?n=6',
  labelTypesUrl: '/v3/api/labelTypes',
}).init();
