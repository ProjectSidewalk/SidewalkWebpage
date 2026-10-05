/** Entry point for the landing page. */
import '../homepage.js';
import { LandingValidationGrid } from '../LandingValidationGrid.js';
import { AccessScoreSpotlight } from '../AccessScoreSpotlight.js';
import { util } from '../common/utilities.js';

const data = document.getElementById('page-entry').dataset;

// The map stack (mapbox-gl + mapbox-gl-language + turf + ps-map) is ~600KB gz — roughly 75% of this page's JS — for
// two maps that both sit well below the fold, so it's kept out of the page's load path entirely but pulled in on the
// visitor's first interaction (#4486) so it's loaded by the time a user scrolls to the map. The vendor libraries
// come as plain scripts (their URLs ride on the entry's tag); ps-map is a chunk of its own through the dynamic import.
util.onFirstInteractionOrIdle(() => {
  const mapboxCss = document.createElement('link');
  mapboxCss.rel = 'stylesheet';
  mapboxCss.href = data.mapboxCssUrl;
  document.head.appendChild(mapboxCss);
  Promise.all([
    util.loadScriptsInOrder(JSON.parse(data.mapScriptUrls)),
    import('../ps-map/createPSMap.js'),
  ]).then(([, { createPSMap }]) => {
    // createPSMap reads translated strings, so it still waits on the app's i18next setup.
    window.appManager.ready(() => {
      createPSMap({
        mapName: 'landing-choropleth',
        mapStyle: 'mapbox://styles/mapbox/light-v11?optimize=true',
        mapboxApiKey: data.mapboxApiKey,
        mapboxLogoLocation: 'bottom-right',
        scrollWheelZoom: false,
        regionsURL: '/regions',
        completionRatesURL: '/regions/completionRates',
        regionFillMode: 'completionRate',
        regionTooltip: 'completionRate',
      }).then((m) => {
        /** @type {any} */ (window).choropleth = m[0];
      });
      createPSMap({
        mapName: 'deployment-map',
        mapStyle: 'mapbox://styles/mapbox/light-v11?optimize=true',
        mapboxApiKey: data.mapboxApiKey,
        mapboxLogoLocation: 'bottom-left',
        scrollWheelZoom: false,
        loadCities: true,
        logClicks: true,
      }).then((m) => {
        /** @type {any} */ (window).deploymentMap = m[0];
      });
    });
  }).catch((e) => console.error('Failed to load the landing page maps', e));
});

// Gets all translations before setting up the grid, which reads translated strings as it builds each card. The grid
// renders its skeletons immediately to reserve layout, then fills itself on the first interaction.
window.appManager.ready(() => {
  new LandingValidationGrid(document.getElementById('landing-validation-container'));
  new AccessScoreSpotlight(document.getElementById('access-score-spotlight-container'));
});
