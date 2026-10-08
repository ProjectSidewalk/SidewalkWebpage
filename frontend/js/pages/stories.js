/** Entry point for the public /stories page. */

import { LabelPopup } from '../common/label-detail/LabelPopup.js';
import { viewerClassFor } from '../common/pano-viewer/viewerClassFor.js';
import { StoryListPage } from '../community/StoryListPage.js';

window.appManager.ready(async () => {
  const page = new StoryListPage();
  page.init();
  try {
    // A bundled file can't be templated, so the view hands over its values on the script tag.
    const data = document.getElementById('page-entry').dataset;
    const src = data.imagerySource;
    const viewerType = viewerClassFor(src);
    page.setLabelPopup(await LabelPopup(false, viewerType, data.imageryAccessToken, data.username || null));
  } catch (e) {
    console.error('Stories page: label popup failed to initialize; links will navigate instead.', e);
  }
});
