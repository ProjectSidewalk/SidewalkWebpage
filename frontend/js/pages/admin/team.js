/** Entry point for the admin dashboard's team page. */
import { TeamPage } from '../../admin-dashboard/TeamPage.js';

const data = document.getElementById('page-entry').dataset;
// Distances are formatted by the i18next distance formatter, which exists once the app manager is ready.
window.appManager.ready(() => {
  new TeamPage(Number(data.teamId), {
    overviewUrl: '/adminapi/team',
    userSearchUrl: '/adminapi/userSearch',
    setTeamUrl: '/userapi/setUserTeam',
    leaveTeamUrl: '/userapi/leaveTeam',
    teamStatusUrl: '/adminapi/updateTeamStatus',
    teamVisibilityUrl: '/adminapi/updateTeamVisibility',
  }).init();
});
