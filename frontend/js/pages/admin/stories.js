/** Entry point for the admin dashboard's stories page. */

import { LabelPopup } from '../../common/label-detail/LabelPopup.js';
import { viewerClassFor } from '../../common/pano-viewer/viewerClassFor.js';
import { StoriesPage } from '../../admin-dashboard/StoriesPage.js';

const data = document.getElementById('page-entry').dataset;
window.appManager.ready(async () => {
  const page = new StoriesPage({ feedUrl: '/adminapi/stories?n=200' });
  page.init();
  // The pano viewer initializes asynchronously; once it's ready, hand the popup to the page so label links open
  // inline. If this fails, the links keep their href fallback (navigate to /admin/label/:id).
  try {
    const imagerySrc = data.imagerySource;
    const viewerType = viewerClassFor(imagerySrc);
    const accessToken = data.imageryAccessToken;
    const popup = await LabelPopup(true, viewerType, accessToken, data.username);
    page.setLabelPopup(popup);
  } catch (err) {
    console.error('Stories page: label popup failed to initialize; links will navigate instead.', err);
  }
});
