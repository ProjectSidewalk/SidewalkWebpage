/** Entry point for the admin dashboard's overview page. */
import { OverviewPage } from '../../admin-dashboard/OverviewPage.js';

// Distances are formatted by the i18next distance formatter, which exists once the app manager is ready.
window.appManager.ready(() => {
  new OverviewPage({
    summaryUrl: '/adminapi/overviewSummary',
    activityByDayUrl: '/adminapi/activityByDay',
    recentActivityUrl: '/adminapi/recentActivity?n=6',
    labelTypesUrl: '/v3/api/labelTypes',
  }).init();
});
