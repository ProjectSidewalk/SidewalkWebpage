/** Entry point for the admin dashboard's labelMap page (bundled by rolldown.config.mjs). */

import { GsvViewer } from '../../common/pano-viewer/GsvViewer.js';
import { Infra3dViewer } from '../../common/pano-viewer/Infra3dViewer.js';
import { MapillaryViewer } from '../../common/pano-viewer/MapillaryViewer.js';
import { PanoramaxViewer } from '../../common/pano-viewer/PanoramaxViewer.js';
import { LabelMapPage } from '../../admin-dashboard/LabelMapPage.js';

const data = document.getElementById('page-entry').dataset;
window.appManager.ready(() => {
  const imagerySrc = data.imagerySource;
  const viewerType = imagerySrc === 'mapillary'
    ? MapillaryViewer
    : imagerySrc === 'infra3d'
      ? Infra3dViewer
      : imagerySrc === 'panoramax' ? PanoramaxViewer : GsvViewer;
  new LabelMapPage({
    mapboxToken: data.mapboxToken,
    viewerType,
    accessToken: data.imageryAccessToken,
    username: data.username,
  }).init();
});
