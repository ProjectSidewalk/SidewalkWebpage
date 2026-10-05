/** Entry point for the /about page. */
import '../common/aggregateStats.js';
import { AboutPage } from '../aboutPage.js';

window.appManager.ready(() => new AboutPage().init());
