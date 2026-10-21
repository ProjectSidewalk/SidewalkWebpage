/** Entry point for the public /routes page. */
import { RouteListPage } from '../community/RouteListPage.js';
import '../../css/pages/community-list.css';

window.appManager.ready(() => new RouteListPage().init());
