/** Entry point for the admin dashboard's team page. */
import { TeamPage } from '../../admin-dashboard/TeamPage.js';

const data = document.getElementById('page-entry').dataset;
new TeamPage(Number(data.teamId), {
  overviewUrl: '/adminapi/team',
  userSearchUrl: '/adminapi/userSearch',
  setTeamUrl: '/userapi/setUserTeam',
  leaveTeamUrl: '/userapi/leaveTeam',
  teamStatusUrl: '/adminapi/updateTeamStatus',
  teamVisibilityUrl: '/adminapi/updateTeamVisibility',
}).init();
