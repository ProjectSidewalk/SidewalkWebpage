/**
 * LabelPopup — thin <dialog> wrapper around LabelDetail.
 *
 * Markup lives in `labelPopup.scala.html` (a <dialog id="label-modal" class="label-detail"> wrapping the inner
 * labelDetail partial). This module just opens/closes the dialog and forwards showLabel() calls to the host-agnostic
 * LabelDetail controller. All rendering, fetching, validation, commenting, & admin-flag logic lives in LabelDetail.js.
 *
 * Used by LabelMap, the User Dashboard, and the admin Label Map.
 *
 * @param {boolean} admin If true, this is an admin UI, so additional info can be shown.
 * @param {typeof PanoViewer} viewerType The type of pano viewer to initialize.
 * @param {string} viewerAccessToken An access token used to request images for the pano viewer.
 * @param {string} [currUsername] Username of the current viewer; identifies this user's own comments.
 * @param {Object} [opts]
 * @param {string} [opts.syncUrlSource] When set, the open label is mirrored into the page URL as ?labelId=<id>
 *     (cleared on close) so the view is shareable and survives a refresh; a labelId already in the URL is opened
 *     after init, using this string as the validation source (e.g. 'LabelMap').
 * @param {function(number): void} [opts.onShow] Called with the label's ID every time one is shown (map click,
 *     deep link, prev/next arrows); LabelMap uses it to keep the shown label spotlighted on the map.
 * @param {function(number, Object): void} [opts.onMetadata] Called with the label's ID and its fetched metadata
 *     payload once the shown label's data has loaded (skipped if another label was opened in the meantime);
 *     LabelMap uses the payload's camera coords to position the map for labels its own layer data can't locate.
 * @param {function(number): void} [opts.onClose] Called with the last-shown label's ID whenever the dialog
 *     closes (X, ESC, or backdrop); LabelMap uses it to pulse that label's spot on the map.
 * @param {boolean} [opts.showLabelMapLink] Show the popup's "View on Label Map" footer link (for hosts that
 *     aren't the label map themselves — e.g. the user dashboard).
 * @param {boolean} [opts.showExploreHereLink] Show the popup's "Explore here" footer link, which opens Explore at
 *     the shown label's pano and point of view (#4637).
 * @returns {Promise<object>} Resolves once the dialog is wired; the pano viewer itself is built on the first
 *     showLabel().
 */
async function LabelPopup(admin, viewerType, viewerAccessToken, currUsername, opts = {}) {
  const dialog = document.getElementById('label-modal');
  if (!dialog) {
    throw new Error('LabelPopup: #label-modal not found. Did you include common.labelPopup() on the page?');
  }
  const panoEl = dialog.querySelector('.label-detail__pano');

  // The pano viewer is built on the first showLabel(), never here (#5128): Google bills every StreetViewPanorama
  // constructed, hidden or not, and most visits to a hosting page never open a label. showLabel() opens the dialog
  // before the viewer is built, which is what satisfies the viewer's visible-host requirement (Mapillary measures
  // its container at init).
  const labelDetail = await LabelDetail.create(dialog, {
    admin,
    viewerType,
    viewerAccessToken,
    currUsername,
    showLabelMapLink: opts.showLabelMapLink,
    showExploreHereLink: opts.showExploreHereLink,
  });

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

  // Prev/next arrows (rendered when the host's labelPopup include sets withPaging): hidden until a navigator
  // arrives via setNearbyNavigator() — the map's label data loads after the popup is built.
  const prevBtn = dialog.querySelector('.label-detail__paging--prev');
  const nextBtn = dialog.querySelector('.label-detail__paging--next');
  let nearbyNav = null;
  let currentLabelId = null;
  let lastSource = null;
  if (prevBtn) prevBtn.hidden = true;
  if (nextBtn) nextBtn.hidden = true;

  // Attached once here, guarded on the current navigator, so a repeat setNearbyNavigator() call can't stack
  // duplicate handlers that would double-advance the navigator on a single click.
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (!nearbyNav) return;
      window.logWebpageActivity(`Click_module=LabelPopup_action=PrevLabel_labelId=${currentLabelId}`);
      const id = nearbyNav.prev(currentLabelId);
      if (id) showLabel(id, lastSource);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (!nearbyNav) return;
      window.logWebpageActivity(`Click_module=LabelPopup_action=NextLabel_labelId=${currentLabelId}`);
      const id = nearbyNav.next(currentLabelId);
      if (id) showLabel(id, lastSource);
    });
  }

  function updatePagingState() {
    if (!nearbyNav) return;
    if (prevBtn) prevBtn.disabled = !nearbyNav.hasPrev(currentLabelId);
    if (nextBtn) nextBtn.disabled = !nearbyNav.hasNext(currentLabelId);
  }

  /**
   * Opens the dialog and shows the requested label.
   * @param {number} labelId The ID of the label to show.
   * @param {string} source  The UI that created the popup (recorded with validations).
   */
  async function showLabel(labelId, source) {
    if (!dialog.open) dialog.showModal();
    // Clear the close-guard so this label's pano is allowed to reveal itself once it loads.
    delete panoEl?.dataset.closedDuringLoad;
    if (opts.syncUrlSource) LabelDetail.syncUrlLabelId(labelId);
    currentLabelId = labelId;
    lastSource = source;
    // The arrows are computed from the navigator alone, so they can reflect this label now rather than showing the
    // previous label's state until its metadata fetch resolves.
    updatePagingState();
    // Before the await so the host's map movement runs in parallel with the pano load.
    if (typeof opts.onShow === 'function') opts.onShow(labelId);
    const meta = await innerShowLabel(labelId, source);
    updatePagingState();
    // Guard against a newer label having been opened while the fetch resolved.
    if (typeof opts.onMetadata === 'function' && meta && currentLabelId === labelId) opts.onMetadata(labelId, meta);
  }

  // Every close path (X, backdrop, ESC) fires the dialog's close event.
  dialog.addEventListener('close', () => {
    if (panoEl) {
      // Clear setPano()'s inline visibility and flag the close, so a load still in flight can't reveal itself.
      panoEl.style.visibility = '';
      panoEl.dataset.closedDuringLoad = 'true';
    }
    if (opts.syncUrlSource) LabelDetail.syncUrlLabelId(null);
    if (typeof opts.onClose === 'function' && currentLabelId) opts.onClose(currentLabelId);
  });

  if (opts.syncUrlSource) {
    // Reopen the label a shared or refreshed URL points at.
    const initialLabelId = LabelDetail.urlLabelId();
    if (initialLabelId) {
      showLabel(initialLabelId, opts.syncUrlSource).catch(() => LabelDetail.syncUrlLabelId(null));
      // Hold the host here until the viewer is built. A host builds its map as soon as this resolves, and the two
      // inits contending for the main thread roughly doubles the time to imagery (measured on LabelMap: ~1.4 s →
      // ~2.4 s) — the deep-linked label is what this visit is for, so it goes first. Bounded, so a provider whose
      // script never loads costs the page a pause rather than its map.
      await labelDetail.panoManager.warmUp(PopupPanoManager.DEEP_LINK_BUILD_WAIT_MS);
    }
  }

  /**
   * Enables the prev/next arrows, stepping through labels via the given navigator (see nearbyLabelNavigator.js).
   * @param {{next: function, prev: function, hasPrev: function, hasNext: function,
   *     onRefresh: function}} nav Navigator over the host's label set. Its onRefresh is what keeps the arrows
   *     honest on a host whose reachable set changes under them: LabelMap loads labels by viewport (#5002), so a
   *     deep-linked popup opens over an empty set and has nowhere to page until the set fills (#5068), and its
   *     sidebar filters narrow where "next" may land (#5124).
   */
  labelDetail.setNearbyNavigator = (nav) => {
    // Subscribe only for a navigator we haven't seen, so a repeat call can't stack duplicate recomputes.
    if (nav !== nearbyNav) nav.onRefresh(updatePagingState);
    nearbyNav = nav;
    if (!prevBtn || !nextBtn) return;
    prevBtn.hidden = false;
    nextBtn.hidden = false;
    updatePagingState();
  };

  // Expose the LabelDetail instance's properties for backwards compatibility with callsites that reach
  // into the popup (e.g. for `panoManager`).
  labelDetail.showLabel = showLabel;
  return labelDetail;
}
