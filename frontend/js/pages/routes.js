/** Entry point for the public /routes page (bundled by rolldown.config.mjs). */
import { RouteListPage } from '../community/RouteListPage.js';

window.appManager.ready(() => new RouteListPage().init());
