/** Entry point for the admin dashboard's labelMap page. */

import { viewerClassFor } from '../../common/pano-viewer/viewerClassFor.js';
import { LabelMapPage } from '../../admin-dashboard/LabelMapPage.js';

const data = document.getElementById('page-entry').dataset;
window.appManager.ready(() => {
  const imagerySrc = data.imagerySource;
  const viewerType = viewerClassFor(imagerySrc);
  new LabelMapPage({
    mapboxToken: data.mapboxToken,
    viewerType,
    accessToken: data.imageryAccessToken,
    username: data.username,
  }).init();
});
