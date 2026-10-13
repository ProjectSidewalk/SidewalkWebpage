/** Entry point for the leaderboard page. */
import '../../user-dashboard/TeamActions.js';
import { RowPager } from '../../common/RowPager.js';

const teamBoard = /** @type {HTMLTableSectionElement|null} */ (document.getElementById('ud-team-board'));
const teamPager = /** @type {HTMLElement|null} */ (document.getElementById('ud-team-pager'));
if (teamBoard && teamPager) {
  new RowPager(teamBoard, teamPager, (page) => window.logWebpageActivity(`Click_module=TeamBoardPage_page=${page}`));
}
