/** Entry point for the /cities deployment dashboard. */
import { AccessScoreSpotlight } from '../AccessScoreSpotlight.js';
import { createPSMap } from '../ps-map/createPSMap.js';
import { util } from '../common/utilities.js';

const data = document.getElementById('page-entry').dataset;

window.appManager.ready(() => {
  // Ranks every publicly launched deployment against the others, and lights the row's city on the map above.
  new AccessScoreSpotlight(document.getElementById('access-score-spotlight-container'), { crossCity: true });
  createPSMap({
    mapName: 'cities-map',
    mapStyle: 'mapbox://styles/mapbox/light-v11?optimize=true',
    mapboxApiKey: data.mapboxApiKey,
    mapboxLogoLocation: 'bottom-left',
    scrollWheelZoom: true,
    loadCities: true,
    logClicks: true,
  }).then((mapComponents) => {
    window.citiesMap = mapComponents[0];
    // Force a resize once the map is in its final laid-out container: on a narrow first load the canvas can otherwise
    // keep a wider initial size and spill past the (horizontally clipped) viewport on mobile.
    window.citiesMap.resize();
  }).catch((error) => {
    console.error('Error loading cities map:', error);
    document.getElementById('page-loading').style.display = 'none'; // Hide loading screen even on error
  });

  // Loaded separately from the map so a map failure doesn't hide them; on failure the '-' placeholders stay.
  fetch('/v3/api/aggregateStats')
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(displayAggregateStats)
    .catch((error) => console.error('Failed to load aggregate stats:', error));
});

/**
 * Fills the stats grid. Numbers show in full (#3994); revisit above ten million labels or validations.
 * @param {Record<string, any>} stats - The /v3/api/aggregateStats body (snake_case keys, per the v3 API convention).
 */
function displayAggregateStats(stats) {
  const formatNumber = (num) => i18next.t('common:format-number', { val: num });
  document.getElementById('stat-cities').textContent = stats.num_cities || 0;
  document.getElementById('stat-distance').textContent = util.longDistanceToString(stats.km_explored || 0);
  document.getElementById('stat-labels').textContent = formatNumber(stats.total_labels || 0);
  document.getElementById('stat-validations').textContent = formatNumber(stats.total_validations || 0);
  // Social-proof lead on the map CTA: "Join <n> other communities." Uses the same backend count as the cities stat;
  // hidden entirely if the count is unavailable so we never show "Join 0 other communities."
  const numCities = stats.num_cities || 0;
  const communityLead = document.getElementById('cta-community-count');
  communityLead.hidden = numCities <= 0;
  if (numCities > 0) communityLead.textContent = i18next.t('common:cities-cta-join', { count: numCities });
}
