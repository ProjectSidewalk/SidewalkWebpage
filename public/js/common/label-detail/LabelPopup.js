/**
 * LabelPopup — thin <dialog> wrapper around LabelDetail.
 *
 * Markup lives in `labelPopup.scala.html` (a <dialog id="label-modal" class="label-detail"> wrapping the inner
 * labelDetail partial). This module just opens/closes the dialog and forwards showLabel() calls to the host-agnostic
 * LabelDetail controller. All rendering, fetching, validation, commenting, & admin-flag logic lives in LabelDetail.js.
 *
 * Used by LabelMap, the User Dashboard, and admin pages (admin/index, admin/label).
 *
 * @param {boolean} admin If true, this is an admin UI, so additional info can be shown.
 * @param {typeof PanoViewer} viewerType The type of pano viewer to initialize.
 * @param {string} viewerAccessToken An access token used to request images for the pano viewer.
 * @param {string} [currUsername] Username of the current viewer; identifies this user's own comments.
 * @param {Object} [opts]
 * @param {string} [opts.syncUrlSource] When set, the open label is mirrored into the page URL as ?labelId=<id>
 *     (cleared on close) so the view is shareable and survives a refresh; a labelId already in the URL is opened
 *     after init, using this string as the validation source (e.g. 'LabelMap').
 * @returns {Promise<object>} Resolves once the pano viewer has been initialized.
 */
async function LabelPopup(admin, viewerType, viewerAccessToken, currUsername, opts = {}) {
  const dialog = document.getElementById('label-modal');
  if (!dialog) {
    throw new Error('LabelPopup: #label-modal not found. Did you include common.labelPopup() on the page?');
  }

  // The pano viewer needs a visible host element on init (Mapillary in particular). Open the dialog inside an
  // "initializing" class that hides both the dialog and its ::backdrop, init LabelDetail (which builds the pano
  // viewer), then close. Future showLabel() calls just toggle the dialog open without re-init.
  dialog.classList.add('label-detail--initializing');
  dialog.showModal();
  const labelDetail = await LabelDetail.create(dialog, {
    admin,
    viewerType,
    viewerAccessToken,
    currUsername,
  });
  dialog.close();
  // Hold the initializing class through the close transition duration so the fade-out doesn't flash the dialog.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  dialog.classList.remove('label-detail--initializing');

  // Close button + backdrop click. ESC is handled natively by <dialog>.
  dialog.querySelector('[data-action="close-label-detail"]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    // Click outside the dialog box (i.e. on the backdrop) closes it. We compare against the bounding rect rather
    // than e.target===dialog bc clicks on dialog's own padding also have e.target===dialog and shouldn't dismiss.
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside = r.top <= e.clientY && e.clientY <= r.bottom
      && r.left <= e.clientX && e.clientX <= r.right;
    if (!inside) dialog.close();
  });

  // Capture inner showLabel before we replace it on returned object, otherwise the wrapper would recurse into itself.
  const innerShowLabel = labelDetail.showLabel;

  /**
   * Sets or clears the labelId query param without adding history entries, so the open label is shareable
   * and survives a refresh but Back still leaves the page.
   * @param {?number} labelId The open label's ID, or null to clear the param.
   */
  function syncUrl(labelId) {
    const url = new URL(window.location);
    if (labelId) url.searchParams.set('labelId', labelId);
    else url.searchParams.delete('labelId');
    history.replaceState(null, '', url);
  }

  /**
   * Opens the dialog and shows the requested label.
   * @param {number} labelId The ID of the label to show.
   * @param {string} source  The UI that created the popup (recorded with validations).
   */
  async function showLabel(labelId, source) {
    if (!dialog.open) dialog.showModal();
    if (opts.syncUrlSource) syncUrl(labelId);
    await innerShowLabel(labelId, source);
  }

  if (opts.syncUrlSource) {
    // Every close path (X, backdrop, ESC) fires the dialog's close event.
    dialog.addEventListener('close', () => syncUrl(null));

    // Reopen the label a shared or refreshed URL points at.
    const initialLabelId = parseInt(new URLSearchParams(window.location.search).get('labelId'), 10);
    if (initialLabelId) {
      showLabel(initialLabelId, opts.syncUrlSource).catch(() => syncUrl(null));
    }
  }

  // Expose the LabelDetail instance's properties for backwards compatibility with callsites that reach
  // into the popup (e.g. for `panoManager`).
  labelDetail.showLabel = showLabel;
  return labelDetail;
}
