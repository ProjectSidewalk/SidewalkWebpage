/** Entry point for the admin dashboard's activity page (bundled by rolldown.config.mjs). */

import { LabelPopup } from '../../common/label-detail/LabelPopup.js';
import { viewerClassFor } from '../../common/pano-viewer/viewerClassFor.js';
import { ActivityPage } from '../../admin-dashboard/ActivityPage.js';

const data = document.getElementById('page-entry').dataset;
window.appManager.ready(async () => {
  const page = new ActivityPage({
    seriesUrl: '/adminapi/activityByDay',
    recentUrl: '/adminapi/recentActivity',
    contributionTimeUrl: '/adminapi/getContributionTimeStats',
  });
  page.init();
  // The pano viewer initializes asynchronously; once it's ready, hand the popup to the page so feed label
  // links open inline. If this fails, the links keep their href fallback (navigate to /admin/label/:id).
  try {
    const imagerySrc = data.imagerySource;
    const viewerType = viewerClassFor(imagerySrc);
    const accessToken = data.imageryAccessToken;
    const popup = await LabelPopup(true, viewerType, accessToken, data.username);
    page.setLabelPopup(popup);
  } catch (err) {
    console.error('Activity page: label popup failed to initialize; links will navigate instead.', err);
  }
});
