/** Entry point for the /about page. */
import '../common/aggregateStats.js';
import { AboutPage } from '../aboutPage.js';
import '../../css/components/deployment-map.css';
import '../../css/pages/about.css';

window.appManager.ready(() => new AboutPage().init());
