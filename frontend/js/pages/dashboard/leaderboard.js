/** Entry point for the leaderboard page. */
import '../../user-dashboard/TeamActions.js';
import { TablePager } from '../../common/TablePager.js';

const teamBoard = /** @type {HTMLTableSectionElement|null} */ (document.getElementById('ud-team-board'));
const teamPager = /** @type {HTMLElement|null} */ (document.getElementById('ud-team-pager'));
if (teamBoard && teamPager) {
  const logPage = (page) => window.logWebpageActivity?.(`Click_module=TeamBoardPage_page=${page}`);
  new TablePager(teamBoard, teamPager, logPage);
}
