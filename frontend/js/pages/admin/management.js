/** Entry point for the admin dashboard's management page (bundled by rolldown.config.mjs). */
import { ManagementPage } from '../../admin-dashboard/ManagementPage.js';

const data = document.getElementById('page-entry').dataset;
new ManagementPage({
  userStatsUrl: '/adminapi/getUserStats',
  setRoleUrl: '/adminapi/setRole',
  setTeamUrl: '/userapi/setUserTeam',
  teamStatusUrl: '/adminapi/updateTeamStatus',
  teamVisibilityUrl: '/adminapi/updateTeamVisibility',
  clearCacheUrl: '/adminapi/clearPlayCache',
  recalcStatsUrl: '/adminapi/updateUserStats',
  recalcPriorityUrl: '/adminapi/recalculateStreetPriority',
  recalcValidationCountsUrl: '/adminapi/recalculateValidationCounts',
  generateCropsUrl: '/adminapi/generateCrops',
  rebuildSidewalkPresenceUrl: '/adminapi/rebuildSidewalkPresence',
  refreshPlacesUrl: '/adminapi/refreshPlaces',
  recountGradientStalenessUrl: '/adminapi/recountStreetGradientStaleness',
}, JSON.parse(data.assignableRoles)).init();
