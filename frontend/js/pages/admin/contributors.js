/** Entry point for the admin dashboard's contributors page. */
import { ContributorsPage } from '../../admin-dashboard/ContributorsPage.js';
import { FunnelsSection } from '../../admin-dashboard/FunnelsSection.js';

new ContributorsPage({
  userStatsUrl: '/adminapi/getUserStats',
  leaderboardsUrl: '/adminapi/contributorLeaderboards',
}).init();
new FunnelsSection({
  funnelsUrl: '/adminapi/funnels',
  hostId: 'funnel-blocks',
  statusId: 'funnel-status',
  windowToggleId: 'funnel-window',
  dimToggleId: 'funnel-dim',
}).init();
