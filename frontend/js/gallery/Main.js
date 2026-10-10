/** Wires the Gallery together: the one place its modules are built, so every dependency between them is visible. */

import { BadgeAchievements } from '../common/BadgeAchievements.js';
import { wireSidebarDisclosure } from '../common/sidebarDisclosure.js';
import { CardContainer } from './cards/CardContainer.js';
import { Form } from './data/Form.js';
import { Tracker } from './data/Tracker.js';
import { GalleryFilter } from './filter/GalleryFilter.js';
import { KeyboardManager } from './keyboard/KeyboardManager.js';

/**
 * What gallery.scala.html wrote into the page, plus the viewer class pages/gallery.js picked for the imagery source.
 * @typedef {object} GalleryParams
 * @property {string} dataStoreUrl - Where interaction logs are POSTed.
 * @property {Record<string, any>} initialFilters - The filters the server parsed out of the URL.
 * @property {Record<string, string>} [regionNames] - Region names for the cards' location line, keyed by region id.
 * @property {typeof import('../common/pano-viewer/PanoViewer.js').PanoViewer} viewerType - The pano viewer to use.
 * @property {string} viewerAccessToken - An access token that authorizes image requests for the pano viewer.
 * @property {?string} currUsername - The viewer's username when signed in to a real account, else null.
 */

/**
 * Builds the Gallery's modules and starts it.
 * @param {GalleryParams} params - What the page was opened with.
 * @returns {Promise<void>} Resolves once the first page of cards has been requested and the expanded view is built.
 */
export async function startGallery(params) {
  // Seed the all-time counts so validating a card can celebrate a newly unlocked validation badge.
  BadgeAchievements.seedCounts();

  // Logging comes first, so nothing built after it has to cope with its absence.
  const tracker = new Tracker(new Form(params.dataStoreUrl));

  // Review-list mode (#5444) renders neither the sidebar nor the reset, so both lookups come back null. GalleryFilter
  // is still built, sidebar-less, because it owns the address bar and the filter state CardContainer reads.
  const cardFilter = new GalleryFilter(
    document.getElementById('card-filter'),
    /** @type {?HTMLButtonElement} */ (document.getElementById('clear-filters')),
    params.initialFilters,
    tracker,
  );

  const cardContainer = await CardContainer.create({
    holder: document.getElementById('image-card-container'),
    prevPage: /** @type {HTMLButtonElement} */ (document.getElementById('prev-page')),
    pageNumber: document.getElementById('page-number'),
    nextPage: /** @type {HTMLButtonElement} */ (document.getElementById('next-page')),
    pageControl: document.querySelector('.page-control'),
    pageLoading: document.getElementById('page-loading'),
    labelsNotFound: document.getElementById('labels-not-found-text'),
    expandedView: document.querySelector('.gallery-expanded-view'),
  }, {
    initialFilters: params.initialFilters,
    regionNames: params.regionNames ?? {},
    panoViewerType: params.viewerType,
    viewerAccessToken: params.viewerAccessToken,
    currUsername: params.currUsername,
  }, cardFilter, tracker);

  new KeyboardManager(cardContainer.getExpandedView(), tracker);

  // Narrow-layout filter disclosure (button in gallery.scala.html; filter.css shows it under the breakpoint).
  const filterToggle = document.getElementById('gallery-filter-toggle');
  if (filterToggle) {
    wireSidebarDisclosure(filterToggle, filterToggle.closest('.sidebar'), {
      controlled: document.getElementById('gallery-filter-sections'),
      onToggle: (open) => tracker.push(open ? 'FilterDisclosureOpen' : 'FilterDisclosureClose'),
    });
  }
}
