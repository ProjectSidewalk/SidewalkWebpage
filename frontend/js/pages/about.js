/** Entry point for the /about page (bundled by rolldown.config.mjs). */
import '../common/aggregateStats.js';
import { AboutPage } from '../aboutPage.js';

window.appManager.ready(() => new AboutPage().init());
