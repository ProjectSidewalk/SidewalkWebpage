/** Entry point for the user dashboard, and the admin's view of a user's dashboard (bundled by rolldown.config.mjs). */

import { LabelPopup } from '../../common/label-detail/LabelPopup.js';
import { viewerClassFor } from '../../common/pano-viewer/viewerClassFor.js';
import { DashboardBadges } from '../../user-dashboard/DashboardBadges.js';
import { CrossCityStats } from '../../user-dashboard/CrossCityStats.js';
import { MyRoutes } from '../../user-dashboard/MyRoutes.js';
import { OutdatedStreets } from '../../user-dashboard/OutdatedStreets.js';
import { MistakeGallery } from '../../user-dashboard/MistakeGallery.js';
import { StoriesSection } from '../../user-dashboard/StoriesSection.js';
import '../../user-dashboard/TeamActions.js';
import { loadContributionMap } from '../../user-dashboard/contributionMap.js';

const data = document.getElementById('page-entry').dataset;
const adminView = data.adminView === 'true';

// Deferred handle the contribution map's click adapter awaits; resolved (popup or null) once init finishes.
let labelPopupReadyResolve;
window.udLabelPopupReady = new Promise((resolve) => {
  labelPopupReadyResolve = resolve;
});

// The signed-in user's own streets and labels; map labels open the same label-detail popup the mistake cards use.
const contributionMapReady = loadContributionMap({
  mapId: 'user-dashboard-choropleth',
  mapboxApiKey: data.mapboxApiKey,
  streetsURL: data.streetsUrl,
  labelsURL: data.labelsUrl,
  wireLabelPopup: true,
});

// Accuracy-bar widths are data-driven per label type; set from the data attribute because inline style
// attributes are lint-banned (htmlhint inline-style-disabled).
document.querySelectorAll('.ud-acc-fill[data-ud-pct]').forEach((el) => {
  el.style.width = `${el.dataset.udPct}%`;
});

window.appManager.ready(async () => {
  const badges = document.getElementById('ud-badges');
  if (badges) {
    try {
      new DashboardBadges(badges).render();
    } catch (e) {
      console.error('Badge render failed', e);
    }
  }

  // Build the interactive label popup up front (it initializes the pano viewer). Entirely optional: if it
  // fails, the mistake cards still work with their inline vote/note controls.
  let labelPopup = null;
  try {
    const src = data.imagerySource;
    const viewerType = viewerClassFor(src);
    // The popup's username marks the viewer's own comments/stories; the view sends it only for a real account.
    labelPopup = await LabelPopup(adminView, viewerType, data.imageryAccessToken, data.viewerUsername || null,
      { showLabelMapLink: true, showExploreHereLink: true });
  } catch (e) {
    console.error('Label popup init failed; mistake cards will use inline controls only', e);
  }
  // An admin's votes, comments, and edits here are recorded as the admin dashboard, whichever section opened
  // the label, so they stay separable from what users do on their own dashboards and profiles.
  if (adminView && labelPopup) {
    const showLabel = labelPopup.showLabel;
    labelPopup.showLabel = (labelId) => showLabel(labelId, 'AdminUserDashboard');
  }
  labelPopupReadyResolve(labelPopup);

  const citiesSection = document.getElementById('ud-cities-section');
  if (citiesSection) {
    // Fire-and-forget: the section stays hidden if this fails, and nothing below it depends on the result.
    new CrossCityStats(citiesSection, {
      statsUrl: citiesSection.dataset.statsUrl,
      currentCityName: data.currentCityName,
      mapboxApiKey: data.mapboxApiKey,
    }).render();
  }

  const routesList = document.getElementById('ud-routes-list');
  if (routesList) new MyRoutes(routesList).init();

  const reauditList = document.getElementById('ud-reaudit-list');
  if (reauditList) new OutdatedStreets(reauditList, { mapReady: contributionMapReady }).init();

  const mistakes = document.getElementById('ud-mistakes');
  if (mistakes) {
    new MistakeGallery(mistakes, {
      userId: mistakes.dataset.userId,
      limit: parseInt(mistakes.dataset.limit, 10) || 6,
      seeAllEl: document.getElementById('ud-mistakes-seeall'),
      labelPopup,
      readOnly: mistakes.dataset.readOnly === 'true',
    }).render();
  }

  const stories = document.getElementById('ud-stories');
  if (stories) {
    new StoriesSection(stories, {
      labelPopup,
      composerDialog: /** @type {HTMLDialogElement} */ (document.getElementById('ud-story-composer')),
      storiesUrl: stories.dataset.storiesUrl,
      storyUrlFor: (storyId) => `${stories.dataset.storyUrlBase}/${storyId}`,
      // The stories belong to the dashboard's user, so their byline is that name (an admin edits on their behalf);
      // the view sends it only for a real account.
      currUsername: data.username || null,
    }).render();
  }
});
