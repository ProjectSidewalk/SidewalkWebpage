/** Entry point for the public /routes page. */
import { RouteListPage } from '../community/RouteListPage.js';

window.appManager.ready(() => new RouteListPage().init());
