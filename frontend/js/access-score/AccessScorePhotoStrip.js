/**
 * The photo strip in the AccessScore insights dock (#5217): a scrollable ribbon of label crops from the scope in
 * view, so the imagery behind a score is one glance away rather than a click into a cluster. A thumbnail opens the
 * full label card, whose arrows page through the strip.
 *
 * Source is the cluster feed for one region (`/v3/api/labelClusters?regionId=…`), cached for the page's life by
 * `AccessScoreClusterFeed` (shared with the street panel, #5748),
 * because a street is a filter over its region's clusters and a city has too many clusters to fetch for a
 * dozen pictures; the area in view pools the few nearest regions' feeds and keeps the clusters inside the
 * map's bounds. The brush never narrows the strip: a brush is a set of street ids across the city and the strip
 * draws from region feeds. One label per cluster (its newest), capped at `MAX_PHOTOS`, ranked worst first (#5386)
 * and numbered: the clusters' medians and vote totals choose which get a picture, then the pictures take the order
 * of their own label's rating and votes, the ones a reader sees on the card. Each is a `LabelMiniCard`, so a
 * picture can be agreed or disagreed with where it is seen.
 */

import i18next from 'i18next';
import { LabelMiniCard } from '../common/LabelMiniCard.js';
import { AccessScoreClusterFeed } from './AccessScoreClusterFeed.js';

export class AccessScorePhotoStrip {
  /** Enough to fill the ribbon with a scroll's worth; more is a wall of fetches for pictures nobody reaches. */
  static MAX_PHOTOS = 12;

  /**
   * The ranking the ribbon uses, the shared feed's (#5748).
   * @param {{severity: ?number, agree: number, disagree: number, size?: number}} a - One entry's rating and votes.
   * @param {{severity: ?number, agree: number, disagree: number, size?: number}} b - The other's.
   * @returns {number} Negative when `a` ranks ahead of `b`.
   */
  static compareWorstFirst(a, b) {
    return AccessScoreClusterFeed.compareWorstFirst(a, b);
  }

  /** @type {AccessScoreClusterFeed} */
  #feed;
  #onOpenLabel;
  #log;
  #els;
  /** The cards on show, by label id, so a vote cast in the full label card can be reflected here. */
  #cards = new Map();
  /** The label ids on show, in ribbon order: the full label card pages through them in this order. */
  #ids = [];
  /** The label ids the last draw asked for, in cluster order, so a pan that picks the same ones skips the redraw. */
  #wanted = [];
  #token = 0;

  /**
   * @param {HTMLElement} container - The element the strip renders into.
   * @param {object} options - Configuration and callbacks.
   * @param {string[]} options.types - The scored label types the feed is asked for.
   * @param {(labelId: number, stripLabelIds: number[]) => void} options.onOpenLabel - Called when a thumbnail is
   *   chosen, with the strip's label ids for the card's arrows to page through.
   * @param {(kind: string, value?: string|number) => void} [options.log] - Called for an interaction worth logging.
   * @param {AccessScoreClusterFeed} [options.feed] - The page's shared cluster cache; the strip makes its own when
   *   it is the only reader.
   */
  constructor(container, { types, onOpenLabel, log = () => {}, feed = null }) {
    this.#feed = feed ?? new AccessScoreClusterFeed({ types });
    this.#onOpenLabel = onOpenLabel;
    this.#log = log;
    // An <ol>: the ribbon is a ranking, and the CSS numbers it. The explicit role keeps it a list in Safari, which
    // drops list semantics under `list-style: none`.
    container.innerHTML = `
      <p class="acs-photos__caption"></p>
      <p class="acs-photos__status" role="status"></p>
      <ol class="acs-photos__ribbon" role="list"></ol>`;
    this.#els = {
      caption: container.querySelector('.acs-photos__caption'),
      status: container.querySelector('.acs-photos__status'),
      ribbon: container.querySelector('.acs-photos__ribbon'),
    };
  }

  /**
   * Shows the photos of a scope. No region (a city with nothing scored yet) shows the empty state. A viewport
   * scope keeps the current pictures up while its feeds load and skips the redraw when it picks the same clusters:
   * a pan arrives as a run of such calls, and a ribbon that blinks on each one is unreadable.
   *
   * @param {object} scope - Where the photos come from.
   * @param {string} scope.caption - The strip's caption, already worded.
   * @param {?number} [scope.regionId] - The region whose cluster feed is read; null for none.
   * @param {?Array<number>} [scope.regionIds] - Several regions' feeds, pooled (the area in view).
   * @param {?Array<number>} [scope.bounds] - `[west, south, east, north]`; keep only the clusters inside.
   * @param {?number} [scope.streetId] - Keep only the clusters on this street…
   * @param {Set<number>} [scope.intersectionIds] - …or at these intersections (its ends).
   * @returns {Promise<void>} Resolves once the strip is drawn (or superseded by a later call).
   */
  async show({ caption, regionId = null, regionIds = null, bounds = null, streetId = null, intersectionIds = null }) {
    const token = ++this.#token;
    this.#els.caption.textContent = caption;
    const ids = regionIds ?? (regionId === null || regionId === undefined ? [] : [regionId]);
    const keepWhileLoading = bounds !== null;
    if (!keepWhileLoading) {
      this.#els.ribbon.innerHTML = '';
      this.#ids = [];
      this.#wanted = [];
    }
    if (ids.length === 0) {
      this.#els.ribbon.innerHTML = '';
      this.#ids = [];
      this.#wanted = [];
      this.#els.status.textContent = i18next.t('accessscore:photos-empty');
      return;
    }
    if (!keepWhileLoading) this.#els.status.textContent = i18next.t('accessscore:photos-loading');
    // A region whose feed fails contributes nothing rather than sinking the others.
    const perRegion = await Promise.all(ids.map((id) => this.#feed.regionClusters(id).catch((e) => {
      console.warn('AccessScore photo strip: cluster feed failed', e);
      return [];
    })));
    if (token !== this.#token) return; // The scope moved on while the feed loaded.
    let clusters = perRegion.flat();
    if (streetId !== null) {
      clusters = clusters.filter((p) => p.street_edge_id === streetId
        || (intersectionIds && intersectionIds.has(p.intersection_id)));
    }
    if (bounds !== null) {
      const [west, south, east, north] = bounds;
      clusters = clusters.filter((p) => Array.isArray(p.coordinates)
        && p.coordinates[0] >= west && p.coordinates[0] <= east
        && p.coordinates[1] >= south && p.coordinates[1] <= north);
    }
    const standing = AccessScoreClusterFeed.standing;
    const picked = clusters
      .filter((p) => Array.isArray(p.label_ids) && p.label_ids.length > 0)
      .sort((a, b) => AccessScoreClusterFeed.compareWorstFirst(standing(a), standing(b)))
      .slice(0, AccessScorePhotoStrip.MAX_PHOTOS);
    if (picked.length === 0) {
      this.#els.ribbon.innerHTML = '';
      this.#ids = [];
      this.#wanted = [];
      this.#els.status.textContent = i18next.t('accessscore:photos-empty');
      return;
    }
    // A cluster's newest label stands for it, the feed's rule.
    const newest = AccessScoreClusterFeed.newestLabelId;
    const wanted = picked.map(newest);
    // Only a ribbon with pictures on it is worth keeping: a draw whose every label failed to load retries instead.
    const unchanged = wanted.length === this.#wanted.length && wanted.every((id, k) => id === this.#wanted[k]);
    if (keepWhileLoading && unchanged && this.#ids.length > 0) {
      this.#els.status.textContent = '';
      return;
    }
    if (keepWhileLoading) this.#els.status.textContent = i18next.t('accessscore:photos-loading');
    const labels = await Promise.all(picked.map((p) => this.#feed.label(newest(p)).then(
      (label) => ({ label, cluster: p }),
      () => null,
    )));
    if (token !== this.#token) return;
    // Ordered by each label's own rating and votes (what the card shows), not its cluster's medians; the stable sort
    // keeps the cluster rank as the tiebreak.
    const own = ({ label }) => ({
      severity: label.severity, agree: label.num_agree || 0, disagree: label.num_disagree || 0,
    });
    const loaded = labels.filter(Boolean).sort((a, b) => AccessScoreClusterFeed.compareWorstFirst(own(a), own(b)));
    this.#wanted = wanted;
    this.#ids = loaded.map(({ label }) => label.label_id);
    this.#els.status.textContent = loaded.length === 0 ? i18next.t('accessscore:photos-empty') : '';
    this.#els.ribbon.innerHTML = '';
    this.#cards.clear();
    for (const { label } of loaded) {
      const card = new LabelMiniCard(label, {
        size: 'strip',
        className: 'acs-photos__item',
        source: 'AccessScoreStrip',
        log: this.#log,
        onOpen: (labelId) => {
          this.#log('PhotoStrip_labelId', labelId);
          this.#onOpenLabel(labelId, this.#ids);
        },
      });
      this.#cards.set(label.label_id, card);
      this.#els.ribbon.appendChild(card.element);
    }
  }

  /**
   * Re-renders one thumbnail after a vote cast in the full label card, keeping the fresh JSON for the next redraw.
   * @param {Record<string, any>} label - A `/label/id/:id` JSON.
   */
  refreshLabel(label) {
    this.#feed.rememberLabel(label);
    this.#cards.get(label.label_id)?.update(label);
  }
}
