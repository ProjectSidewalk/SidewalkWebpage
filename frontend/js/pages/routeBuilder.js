/** Entry point for the RouteBuilder. */
import { RouteBuilder } from '../route-builder/RouteBuilder.js';
import { util } from '../common/utilities.js';
import '../../css/pages/route-builder.css';

const data = document.getElementById('page-entry').dataset;
// Gets all translations before loading the map.
window.appManager.ready(async () => {
  // All three requests go out at once; the map only needs its params, and each layer draws when its data lands.
  const loadRegions = util.fetchJson('/regions');
  const loadStreets = util.fetchJson('/contribution/streets/all?filterLowQuality=true');
  const mapParams = await util.fetchJson('/cityMapParams');
  const routeBuilder = new RouteBuilder(data.mapboxApiKey, mapParams, data.signedIn === 'true',
    Number(data.minutesPerHundredM));
  loadRegions.then((regionData) => routeBuilder.renderRegions(regionData))
    .catch((err) => console.error('Failed to load regions:', err));
  loadStreets.then((streetData) => routeBuilder.renderStreets(streetData))
    .catch((err) => console.error('Failed to load streets:', err));
});
