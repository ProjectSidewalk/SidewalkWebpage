/**
 * The street panel (#5748): what opens when a street is clicked in the AccessScore tool. It says why the street
 * scores what it does, verdict first, and backs every number with the pictures behind it.
 *
 * Top to bottom: the headline with a sentence in words and the three components drawn as the street they are (a
 * crossing, the block, a crossing, each in its score color); a row per label type with its signed effect as a bar
 * on one shared scale, grade among them; the grade itself with the elevation profile; then the evidence, one tile
 * per cluster along the block and at each crossing, worst first, each tile a `LabelMiniCard` wearing what that
 * cluster costs or earns. A row lights its tiles and a tile lights its row and its dot on the map, so the arithmetic
 * and the pictures are one thing.
 *
 * A panel beside the map rather than a popup over it: the pictures need the width, and the street they explain
 * should stay in view. It owns the map's right padding, as the drawer owns the left and the dock the bottom. The
 * place card (#5311) is the same panel headed by the place, since a place's score is its nearest street's.
 */

import i18next from 'i18next';
import { LabelMiniCard } from '../common/LabelMiniCard.js';
import { AccessScoreElevationProfile } from '../common/AccessScoreElevationProfile.js';
import { AccessScoreGradeRamp } from '../common/AccessScoreGradeRamp.js';
import { ScoreRamp } from '../common/scoreRamp.js';
import { util } from '../common/utilities.js';
import { setPaddingEdges } from '../ps-map/mapPadding.js';
import { AccessScoreClusterFeed } from './AccessScoreClusterFeed.js';
import {
  formatElevation, formatLength, formatScore, hopLinksHtml, percentHtml, signed, streetTitle,
} from './AccessScoreText.js';
import '../common/utilitiesSidewalk.js';
/** @typedef {import('./AccessScoreModel.js').AccessScoreModel} AccessScoreModel */
/** @typedef {import('./AccessScoreModel.js').AccessScoreConfig} AccessScoreConfig */
/** @typedef {import('./AccessScoreModel.js').AccessScoreStreetExplanation} AccessScoreStreetExplanation */
/** @typedef {import('./AccessScoreClusterFeed.js').AccessScoreFeedCluster} AccessScoreFeedCluster */
/**
 * @typedef {import('../common/AccessScoreElevationProfile.js').AccessScoreProfileResponse}
 *   AccessScoreProfileResponse
 */

/**
 * A place as the places layer hands one over (#5311), the fields the panel reads.
 * @typedef {object} AccessScorePanelPlace
 * @property {number} place_id
 * @property {?string} name
 * @property {string} category
 * @property {?number} region_id
 * @property {?number} nearest_street_edge_id
 * @property {number} nearest_street_distance_m
 * @property {{lng: number, lat: number}} lngLat
 */

/**
 * The panel's one tile: a cluster, the card picturing it, and the chip that carries its effect.
 * @typedef {object} AccessScorePanelTile
 * @property {AccessScoreFeedCluster} props
 * @property {string} group - 'block', 'start' or 'end'.
 * @property {HTMLElement} el - The `<li>`.
 * @property {HTMLElement} effect - The effect chip, rewritten on a reweighting.
 * @property {LabelMiniCard} card
 */

export class AccessScoreStreetPanel {
  /** Tiles per group before "Show all": enough to see the pattern, not a wall of fetches for one street. */
  static MAX_TILES = 12;

  /** The three places the engine scores a street's clusters, in the panel's order. */
  static GROUPS = Object.freeze(['block', 'start', 'end']);

  /** Below this headline the block "scores low" in the verdict; the score ramp's first class. */
  static LOW_SCORE = 0.2;

  /**
   * The window width under which the panel covers the map to the right of the controls drawer and takes no map
   * padding, the drawer's rule: narrower, the drawer, the panel and a map worth looking at don't fit side by side.
   * Matches the stylesheet's breakpoint for the panel (`--breakpoint-md`).
   */
  static NARROW_QUERY = '(width <= 992px)';

  #root;
  #els;
  /** @type {AccessScoreModel} */
  #model;
  /** @type {AccessScoreConfig} */
  #config;
  #map;
  /** @type {AccessScoreClusterFeed} */
  #feed;
  #gradeSources;
  #callbacks;
  #narrowMq;
  /** Bumped on every show and close, so a late feed or profile answer for an earlier street is dropped. */
  #token = 0;
  /** @type {?AccessScoreStreetExplanation} */
  #street = null;
  /** @type {?AccessScorePanelPlace} The place the panel is headed by, or null when it is a street's own. */
  #place = null;
  /** @type {Map<number, AccessScorePanelTile>} By cluster id. */
  #tiles = new Map();
  /** @type {Map<number, LabelMiniCard>} By label id, so a vote cast in the full card can be reflected here. */
  #cards = new Map();
  /** The label ids on show, in tile order: the full label card pages through them in this order. */
  #labelIds = [];
  /** The groups a reader asked to see in full. */
  #expanded = new Set();
  /** @type {?{block: AccessScoreFeedCluster[], start: AccessScoreFeedCluster[], end: AccessScoreFeedCluster[]}} */
  #groups = null;
  #paddingRight = 0;
  #litType = null;
  #loggedRows = new Set();
  #loggedClusters = new Set();

  /**
   * @param {HTMLElement} root - The `<aside id="acs-panel">` the view ships, hidden.
   * @param {object} options - Data and callbacks.
   * @param {AccessScoreModel} options.model - The scoring model.
   * @param {AccessScoreConfig} options.config - The engine config.
   * @param {mapboxgl.Map} options.map - The map, for its padding and for keeping the street in view.
   * @param {AccessScoreClusterFeed} options.feed - The page's cluster cache.
   * @param {Array<{dem_source: string, credit: string}>} [options.gradeSources] - The city's elevation models.
   * @param {(id: number) => ?{lng: number, lat: number}} options.streetCenter - A street's midpoint, for the hop.
   * @param {(reason: string) => void} options.onClose - Called when the reader closes the panel; the host
   *   deselects, which closes it.
   * @param {(labelId: number, labelIds: number[]) => void} options.onOpenLabel - Opens the full label card.
   * @param {(props: AccessScoreFeedCluster, effect: string) => void} options.onOpenSheet - Opens the cluster
   *   sheet for a tile whose cluster holds more than one label.
   * @param {(props: ?AccessScoreFeedCluster) => void} [options.onHoverCluster] - A tile hovered, or none.
   * @param {(kind: string, value?: string|number) => void} [options.log] - Called for an interaction worth logging.
   */
  constructor(root, {
    model, config, map, feed, gradeSources = [], streetCenter, onClose, onOpenLabel, onOpenSheet,
    onHoverCluster = () => {}, log = () => {},
  }) {
    this.#root = root;
    this.#model = model;
    this.#config = config;
    this.#map = map;
    this.#feed = feed;
    this.#gradeSources = gradeSources;
    this.#callbacks = { streetCenter, onClose, onOpenLabel, onOpenSheet, onHoverCluster, log };
    this.#narrowMq = window.matchMedia ? window.matchMedia(AccessScoreStreetPanel.NARROW_QUERY) : { matches: false };
    this.#els = {
      title: root.querySelector('#acs-panel-title'),
      meta: root.querySelector('#acs-panel-meta'),
      close: root.querySelector('#acs-panel-close'),
      body: root.querySelector('#acs-panel-body'),
    };
    this.#els.close.addEventListener('click', () => this.#requestClose('button'));
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.#requestClose('escape');
      }
    });
    this.#narrowMq.addEventListener?.('change', () => this.#applyPadding());
    this.#setShown(false);
  }

  /** @returns {boolean} Whether the panel is on screen. */
  get open() {
    return !this.#root.hidden;
  }

  /** @returns {?number} The street on show, or null. */
  get streetId() {
    return this.#street?.streetId ?? null;
  }

  /**
   * Shows a street.
   * @param {number} streetId - The street's `street_edge_id`.
   * @param {{fromUrl?: boolean}} [options] - `fromUrl` for a selection a link carried in: no focus move, no log.
   * @returns {boolean} False for an unknown street, which leaves the panel as it was.
   */
  showStreet(streetId, { fromUrl = false } = {}) {
    const street = this.#model.explainStreet(streetId);
    if (!street) return false;
    this.#show(street, null, fromUrl);
    return true;
  }

  /**
   * Shows a place: the panel of its nearest street, headed by the place. A place with no street in reach, or an
   * unaudited one, says so where the score would be.
   * @param {AccessScorePanelPlace} props - The place's properties from the places layer, with its `lngLat`.
   * @param {{fromUrl?: boolean}} [options] - As for `showStreet`.
   */
  showPlace(props, { fromUrl = false } = {}) {
    const id = props.nearest_street_edge_id;
    const street = id === null || id === undefined ? null : this.#model.explainStreet(id);
    this.#show(street, props, fromUrl);
  }

  /** Closes the panel, if open. The host calls this from its deselect; a reader's close goes through `onClose`. */
  close() {
    if (this.#root.hidden) return;
    this.#token += 1;
    const hadFocus = this.#root.contains(document.activeElement);
    this.#setShown(false);
    this.#clearTiles();
    this.#street = null;
    this.#place = null;
    this.#groups = null;
    this.#expanded.clear();
    this.#els.body.innerHTML = '';
    this.#applyPadding();
    // Focus went into the panel on open; it must not vanish into the document when the panel does.
    if (hadFocus) this.#map.getCanvas?.()?.focus?.();
  }

  /**
   * Re-renders the explanation under new weights, keeping the pictures: a slider tick changes every effect and no
   * cluster. Nothing happens while the panel is closed.
   */
  refresh() {
    if (this.#root.hidden) return;
    if (this.#street) this.#street = this.#model.explainStreet(this.#street.streetId);
    this.#renderExplanation();
    for (const tile of this.#tiles.values()) this.#paintEffect(tile);
    for (const key of AccessScoreStreetPanel.GROUPS) {
      const score = this.#root.querySelector(`[data-acs-group="${key}"] .acs-group__score`);
      if (score) score.outerHTML = this.#groupScoreHtml(key);
    }
  }

  /**
   * Re-renders one tile from fresh label JSON, after a vote cast in the full label card.
   * @param {Record<string, any>} label - A `/label/id/:id` JSON.
   */
  refreshLabel(label) {
    this.#feed.rememberLabel(label);
    this.#cards.get(label.label_id)?.update(label);
  }

  /**
   * Lights one type's tiles and dims the rest, as a hover on its row does; null lifts it.
   * @param {?string} type - A label type, 'grade', or null.
   */
  light(type) {
    this.#litType = type;
    for (const tile of this.#tiles.values()) {
      tile.el.classList.toggle('is-dim', type !== null && tile.props.label_type !== type);
    }
    for (const row of this.#root.querySelectorAll('.acs-row')) {
      row.classList.toggle('is-on', type !== null && row.dataset.type === type);
    }
  }

  /**
   * Marks one cluster's tile and its type's row, as a hover on its dot on the map does; null clears.
   * @param {?number} clusterId - A `label_cluster_id`, or null.
   */
  lightCluster(clusterId) {
    let type = null;
    for (const [id, tile] of this.#tiles) {
      const on = clusterId !== null && id === clusterId;
      tile.el.classList.toggle('is-on', on);
      if (on) type = tile.props.label_type;
    }
    for (const row of this.#root.querySelectorAll('.acs-row')) {
      row.classList.toggle('is-on', type !== null && row.dataset.type === type);
    }
  }

  /** Opens for a street, headed by a place or by itself, and starts the loads. */
  #show(street, place, fromUrl) {
    const wasOpen = this.open;
    this.#token += 1;
    const token = this.#token;
    this.#clearTiles();
    this.#street = street;
    this.#place = place;
    this.#groups = null;
    this.#expanded.clear();
    this.#loggedRows.clear();
    this.#loggedClusters.clear();
    this.#litType = null;
    this.#renderShell();
    this.#renderExplanation();
    this.#setShown(true);
    this.#applyPadding(this.#hopLngLat());
    if (!fromUrl) {
      this.#els.title.focus();
      if (!wasOpen) this.#callbacks.log('Panel', 'open');
    }
    if (street?.audited) this.#loadEvidence(token);
    if (street) this.#loadProfile(token);
  }

  #setShown(shown) {
    this.#root.hidden = !shown;
    this.#root.inert = !shown;
    this.#root.setAttribute('aria-hidden', String(!shown));
  }

  /** A reader's own close: logged, then handed to the host, whose deselect comes back as `close()`. */
  #requestClose(reason) {
    if (this.#root.hidden) return;
    this.#callbacks.log('PanelClose', reason);
    this.#callbacks.onClose(reason);
  }

  /**
   * Owns the map's right edge: pads it by the panel's width while open (not when the panel covers a narrow window,
   * where padding that wide would project the center off the canvas), publishes the width for the stylesheet and
   * how much of the map's right edge it covers as `--map-inset-right` (what centers the status pill on the part of
   * the map still visible, with the drawer's `--map-inset-left`), and brings the selected street into that part
   * when the panel would cover it.
   * @param {?{lng: number, lat: number}} [reveal] - A point to keep in view, if any.
   */
  #applyPadding(reveal = null) {
    const open = !this.#root.hidden;
    const width = open ? this.#root.offsetWidth : 0;
    const right = open && !this.#narrowMq.matches ? width : 0;
    const style = this.#root.parentElement?.style;
    style?.setProperty('--acs-panel-width', `${width}px`);
    style?.setProperty('--map-inset-right', `${right}px`);
    let center = null;
    if (reveal && right > 0 && typeof this.#map.project === 'function') {
      const p = this.#map.project(reveal);
      const visibleRight = this.#map.getContainer().clientWidth - right;
      if (p.x > visibleRight) center = reveal;
    }
    if (right === this.#paddingRight && !center) return;
    this.#paddingRight = right;
    setPaddingEdges(this.#map, { right }, { camera: center ? { center } : {} });
  }

  // ---- The explanation ----

  /** The header and the body's fixed containers, filled by `#renderExplanation` and the loads. */
  #renderShell() {
    const esc = util.escapeHTML;
    const street = this.#street;
    const place = this.#place;
    if (place) {
      const category = i18next.t(`accessscore:place-${place.category}`, { defaultValue: place.category });
      const region = place.region_id === null || place.region_id === undefined
        ? null
        : this.#model.explainRegion(place.region_id);
      this.#els.title.innerHTML = place.name ? esc(place.name) : esc(category);
      // An unnamed place is already titled by its category, so the meta line does not repeat it.
      this.#els.meta.innerHTML = [place.name ? esc(category) : null, region ? esc(region.name) : null]
        .filter(Boolean).join(' · ');
    } else {
      const region = this.#model.explainRegion(street.regionId);
      this.#els.title.innerHTML = streetTitle(street);
      this.#els.meta.innerHTML = [region ? esc(region.name) : null, formatLength(street.lengthM), this.#updatedHtml()]
        .filter(Boolean).join(' · ');
    }
    this.#els.body.innerHTML = `
      ${place ? '<p class="acs-panel__place-street" data-acs-place-street></p>' : ''}
      <div class="acs-panel__verdict" data-acs-verdict></div>
      <section class="acs-panel__section" data-acs-rows aria-labelledby="acs-panel-rows-title"></section>
      <section class="acs-panel__section" data-acs-grade aria-labelledby="acs-panel-grade-title"></section>
      <section class="acs-panel__section" data-acs-evidence aria-labelledby="acs-panel-evidence-title">
        <h3 class="acs-panel__subtitle" id="acs-panel-evidence-title">${i18next.t('accessscore:panel-evidence')}</h3>
        <p class="acs-panel__status" role="status" data-acs-status></p>
        <div data-acs-groups></div>
      </section>
      <div class="acs-panel__links" data-acs-links></div>`;
  }

  /** "Scores from the clusters of Oct 29, 2026", or nothing before the first clustering run. */
  #updatedHtml() {
    const iso = this.#config.clusters_updated_at;
    if (!iso) return null;
    const date = new Date(iso).toLocaleDateString(i18next.language, util.SHORT_DATE);
    return i18next.t('accessscore:panel-updated', { date, interpolation: { escapeValue: true } });
  }

  /** Everything that follows from the explanation: the verdict, the rows, the grade text, the hop. */
  #renderExplanation() {
    const street = this.#street;
    const q = (sel) => this.#els.body.querySelector(sel);
    if (this.#place) q('[data-acs-place-street]').innerHTML = this.#placeStreetHtml();
    q('[data-acs-verdict]').innerHTML = street ? this.#verdictHtml(street) : '';
    // An unaudited street has nothing scored on it to list or to picture; its grade, from the elevation model, it
    // still has.
    const scored = Boolean(street?.audited);
    q('[data-acs-rows]').innerHTML = scored ? this.#rowsHtml(street) : '';
    q('[data-acs-rows]').hidden = !scored;
    this.#renderGrade(street);
    const evidence = q('[data-acs-evidence]');
    evidence.hidden = !scored;
    const lngLat = this.#hopLngLat();
    q('[data-acs-links]').innerHTML = lngLat ? hopLinksHtml(lngLat) : '';
    for (const row of this.#els.body.querySelectorAll('.acs-row')) this.#bindRow(row);
    if (this.#litType !== null) this.#light(this.#litType);
  }

  /** Where "Explore here" opens: the place itself, else the street's midpoint. */
  #hopLngLat() {
    if (this.#place?.lngLat) return this.#place.lngLat;
    return this.#street ? this.#callbacks.streetCenter(this.#street.streetId) : null;
  }

  /** "Nearest street · Cedar Lane · Street 1 · 25 ft away", or why there is no score. */
  #placeStreetHtml() {
    const street = this.#street;
    if (!street) return i18next.t('accessscore:popup-no-street-nearby');
    const distance = i18next.t('accessscore:popup-street-distance', {
      meters: Math.round(this.#place.nearest_street_distance_m), interpolation: { escapeValue: true },
    });
    return `${i18next.t('accessscore:popup-nearest-street')} · ${streetTitle(street)} · ${distance}`;
  }

  /**
   * The headline, a sentence saying where it comes from, and the three components drawn as the street: the
   * crossing at the start, the block, the crossing at the end, each in its score color.
   */
  #verdictHtml(street) {
    const esc = util.escapeHTML;
    const endScore = (e) => (e && e.score !== null ? formatScore(e.score) : '—');
    if (!street.audited) {
      return `<div class="acs-panel__score">${esc(i18next.t('accessscore:unaudited'))}</div>
        <p class="acs-panel__sentence">${esc(i18next.t('accessscore:panel-verdict-unaudited'))}</p>`;
    }
    const end = (e, which) => {
      const name = i18next.t(`accessscore:panel-${which}-crossing`);
      if (!e) {
        return `<div class="acs-panel__end"><span class="acs-panel__dot acs-panel__dot--none"></span>
          <span class="acs-panel__end-score">—</span><span class="acs-panel__end-name">${esc(name)}</span>
          <span class="acs-panel__end-note">${esc(i18next.t('accessscore:panel-no-crossing'))}</span></div>`;
      }
      if (e.score === null) {
        return `<div class="acs-panel__end"><span class="acs-panel__dot acs-panel__dot--none"></span>
          <span class="acs-panel__end-score">—</span><span class="acs-panel__end-name">${esc(name)}</span>
          <span class="acs-panel__end-note">${esc(i18next.t('accessscore:panel-no-score'))}</span></div>`;
      }
      return `<div class="acs-panel__end"><span class="acs-panel__dot" style="background-color: ${
        ScoreRamp.at(e.score)};"></span>
        <span class="acs-panel__end-score">${formatScore(e.score)}</span>
        <span class="acs-panel__end-name">${esc(name)}</span></div>`;
    };
    return `<div class="acs-panel__score">${formatScore(street.score)}<small>/ 100</small></div>
      <p class="acs-panel__sentence">${this.#sentenceHtml(street)}</p>
      <div class="acs-panel__components" role="img" aria-label="${esc(i18next.t('accessscore:score-components', {
        segment: formatScore(street.segmentScore),
        start: endScore(street.startIntersection),
        end: endScore(street.endIntersection),
        interpolation: { escapeValue: false },
      }))}">
        ${end(street.startIntersection, 'start')}
        <div class="acs-panel__block" style="background-color: ${ScoreRamp.at(street.segmentScore)};">
          <span>${esc(i18next.t('accessscore:panel-block'))} <b>${formatScore(street.segmentScore)}</b> · ${
            formatLength(street.lengthM)}</span>
        </div>
        ${end(street.endIntersection, 'end')}
      </div>
      <p class="acs-panel__how">${esc(i18next.t('accessscore:unit-help'))}
        <a href="${esc(this.#root.dataset.docsUrl ?? '')}" target="_blank" rel="noopener">${
          esc(i18next.t('accessscore:how-computed'))}</a></p>`;
  }

  /** The verdict in words: how the block came out and what did it, then what the crossings make of it. */
  #sentenceHtml(street) {
    const t = (key, values = {}) => i18next.t(`accessscore:${key}`, {
      ...values, interpolation: { escapeValue: true },
    });
    const terms = Object.entries(street.terms).filter(([, term]) => term.clusterCount > 0);
    const worst = terms.reduce((a, b) => (b[1].term < (a?.[1].term ?? 0) ? b : a), null);
    const best = terms.reduce((a, b) => (b[1].term > (a?.[1].term ?? 0) ? b : a), null);
    const block = formatScore(street.segmentScore);
    let first;
    if (street.barrier) {
      first = t('panel-verdict-barrier', { limit: percentHtml(this.#model.state.slope.barrierThreshold) });
    } else if (terms.length === 0) {
      first = t('panel-verdict-block-clean', { block });
    } else if (street.segmentScore < AccessScoreStreetPanel.LOW_SCORE && worst) {
      first = t('panel-verdict-block-low', {
        block, count: worst[1].clusterCount, type: util.misc.labelTypeName(worst[0]), value: signed(worst[1].term),
      });
    } else if (street.segmentScore < 0.5 && worst) {
      first = t('panel-verdict-block-mid', {
        block, type: util.misc.labelTypeName(worst[0]), value: signed(worst[1].term),
      });
    } else if (best) {
      first = t('panel-verdict-block-good', {
        block, type: util.misc.labelTypeName(best[0]), value: signed(best[1].term),
      });
    } else {
      first = t('panel-verdict-block-clean', { block });
    }
    const ends = [['start', street.startIntersection], ['end', street.endIntersection]]
      .filter(([, e]) => e && e.score !== null);
    let second;
    if (ends.length === 2) {
      second = t('panel-verdict-crossings-both', {
        start: formatScore(ends[0][1].score), end: formatScore(ends[1][1].score),
      });
    } else if (ends.length === 1) {
      second = t('panel-verdict-crossings-one', {
        which: i18next.t(`accessscore:panel-end-${ends[0][0]}`), score: formatScore(ends[0][1].score),
      });
    } else {
      second = t('panel-verdict-crossings-none');
    }
    return `<b>${first}</b> ${second}`;
  }

  /** The rows: one per type with clusters, worst first, then grade; each effect a bar on one shared scale. */
  #rowsHtml(street) {
    const esc = util.escapeHTML;
    const rows = Object.entries(street.terms)
      .filter(([, term]) => term.clusterCount > 0)
      .sort((a, b) => a[1].term - b[1].term)
      .map(([type, term]) => ({ type, count: term.clusterCount, term: term.term, buckets: term.buckets }));
    const grade = street.gradient ? { type: 'grade', term: street.barrier ? 0 : street.slopeTerm } : null;
    const scale = Math.max(1, ...rows.map((r) => Math.abs(r.term)), grade ? Math.abs(grade.term) : 0);
    const bar = (term) => {
      const w = (Math.abs(term) / scale) * 50;
      const left = term < 0 ? 50 - w : 50;
      return `<span class="acs-row__bar"><i class="acs-row__fill acs-row__fill--${term < 0 ? 'problem' : 'feature'}"
        style="left: ${left.toFixed(1)}%; width: ${w.toFixed(1)}%;"></i></span>`;
    };
    const effectClass = (term) => {
      if (term < 0) return 'problem';
      return term > 0 ? 'feature' : 'none';
    };
    const typeRows = rows.map((r) => {
      const keys = util.misc.getRatingLevelKeys(r.type);
      const ratingWord = (bucket) => (bucket === 'null' || !keys?.[bucket]
        ? i18next.t('accessscore:cluster-unrated')
        : i18next.t(`common:${keys[bucket]}`));
      const parts = Object.entries(r.buckets)
        .filter(([, n]) => n > 0)
        .map(([bucket, n]) => `${n} ${ratingWord(bucket)}`);
      return `<li class="acs-row" tabindex="0" data-type="${esc(r.type)}">
        <span class="acs-row__swatch" style="background-color: ${util.misc.getLabelColors(r.type)};"></span>
        <span class="acs-row__label">${esc(util.misc.labelTypeName(r.type))}<small>${
          esc(parts.join(' · '))}</small></span>
        <span class="acs-row__count">${r.count}</span>
        <span class="acs-row__effect acs-row__effect--${effectClass(r.term)}">${signed(r.term)}</span>
        ${bar(r.term)}
      </li>`;
    });
    if (grade) {
      const g = street.gradient;
      // Plain text here, escaped once at the sink below: a percentage holds nothing markup could mistake.
      let note;
      if (g.maxGrade !== null) {
        note = i18next.t('accessscore:panel-grade-steepest', {
          max: AccessScoreGradeRamp.percent(g.maxGrade), interpolation: { escapeValue: false },
        });
      } else if (g.netGrade !== null) {
        note = i18next.t('accessscore:slope-net-only', {
          grade: AccessScoreGradeRamp.percent(Math.abs(g.netGrade)), interpolation: { escapeValue: false },
        });
      } else {
        note = i18next.t('accessscore:slope-none');
      }
      let effect = '0';
      if (street.barrier) effect = i18next.t('accessscore:popup-slope-barrier');
      else if (grade.term !== 0) effect = `−${Math.abs(grade.term).toFixed(2)}`;
      const tone = street.barrier || grade.term < 0 ? 'problem' : 'none';
      typeRows.push(`<li class="acs-row" tabindex="0" data-type="grade">
        <span class="acs-row__swatch acs-row__swatch--grade"></span>
        <span class="acs-row__label">${esc(i18next.t('accessscore:popup-slope'))}<small>${esc(note)}</small></span>
        <span class="acs-row__count">—</span>
        <span class="acs-row__effect acs-row__effect--${tone}">${esc(effect)}</span>
        ${bar(grade.term)}
      </li>`);
    }
    const body = typeRows.length
      ? `<ul class="acs-rows" role="list">${typeRows.join('')}</ul>
        <p class="acs-panel__sum">${esc(i18next.t('accessscore:panel-sum', {
          sum: signed(street.preSigmoid), block: formatScore(street.segmentScore),
          interpolation: { escapeValue: false },
        }))}</p>`
      : `<p class="acs-panel__empty">${esc(i18next.t('accessscore:popup-no-clusters'))}</p>`;
    return `<h3 class="acs-panel__subtitle" id="acs-panel-rows-title">${esc(i18next.t('accessscore:popup-terms'))}</h3>
      ${body}`;
  }

  /** Wires a row's hover and focus to the tiles. */
  #bindRow(row) {
    const type = row.dataset.type;
    const on = () => {
      this.#light(type);
      if (!this.#loggedRows.has(type)) {
        this.#loggedRows.add(type);
        this.#callbacks.log('PanelRow', type);
      }
    };
    const off = () => this.#light(null);
    row.addEventListener('mouseenter', on);
    row.addEventListener('focus', on);
    row.addEventListener('mouseleave', off);
    row.addEventListener('blur', off);
  }

  /** `light` without the public name, for the rows' own handlers. */
  #light(type) {
    this.light(type);
  }

  /**
   * The grade section (#5223): one line of grades and climb, the elevation profile's slot, and why the numbers
   * are missing or approximate when they are. Empty for a street that has not been sampled, so a city with no slope
   * data shows no sign of the feature. The profile's own element survives a re-render: it was fetched once.
   */
  #renderGrade(street) {
    const section = this.#els.body.querySelector('[data-acs-grade]');
    const g = street?.gradient;
    if (!g) {
      section.hidden = true;
      section.innerHTML = '';
      return;
    }
    section.hidden = false;
    const existing = section.querySelector('[data-acs-profile]');
    const t = (key, values = {}) => i18next.t(`accessscore:${key}`, {
      // The values are this file's own escaped figures.
      ...values, interpolation: { escapeValue: false },
    });
    const lines = [];
    if (g.meanGrade !== null && g.maxGrade !== null) {
      lines.push(t('slope-headline', {
        max: percentHtml(g.maxGrade), mean: percentHtml(g.meanGrade),
        climb: formatElevation(g.climbM ?? 0), descent: formatElevation(g.descentM ?? 0),
      }));
    } else if (g.netGrade !== null) {
      lines.push(t('slope-net-only', { grade: percentHtml(Math.abs(g.netGrade)) }));
    }
    // A barrier zeroes the block, not the street: the headline still averages that 0 with the crossings.
    if (street.audited && street.barrier) {
      lines.push(`<strong>${t('slope-barrier-effect', {
        limit: percentHtml(this.#model.state.slope.barrierThreshold),
      })}</strong>`);
    }
    const notes = [];
    if (g.quality !== 'measured') notes.push(t(`slope-quality-${g.quality.replace('_', '-')}`));
    else if (g.confidence !== 'high') notes.push(t('slope-approximate'));
    const source = this.#gradeSources.find((d) => d.dem_source === g.demSource);
    // eslint-disable-next-line ps/escape-in-markup -- translated strings of ours around figures escaped above
    const linesHtml = lines.map((line) => `<p class="acs-panel__meta">${line}</p>`).join('');
    // eslint-disable-next-line ps/escape-in-markup -- translated strings of ours with no values interpolated
    const notesHtml = notes.map((note) => `<p class="acs-panel__note">${note}</p>`).join('');
    section.innerHTML = `<h3 class="acs-panel__subtitle" id="acs-panel-grade-title">${t('popup-slope')}</h3>
      ${linesHtml}
      ${g.meanGrade !== null ? '<div class="acs-panel__profile" data-acs-profile aria-live="polite"></div>' : ''}
      ${notesHtml}
      ${source ? `<p class="acs-panel__credit">${util.escapeHTML(source.credit)}</p>` : ''}`;
    const slot = section.querySelector('[data-acs-profile]');
    if (existing && slot) slot.replaceWith(existing);
  }

  /**
   * Fetches the street's elevation profile into its slot. The profile is the one slope field too heavy for the
   * city-wide payload, so it is asked for a street at a time, and only where there is a slot for it (a street with
   * windowed statistics, which is exactly a street with a profile).
   */
  async #loadProfile(token) {
    const slot = this.#els.body.querySelector('[data-acs-profile]');
    if (!slot) return;
    const streetId = this.#street.streetId;
    slot.textContent = i18next.t('accessscore:profile-loading');
    try {
      const response = /** @type {AccessScoreProfileResponse} */ (
        await util.fetchJson(`/v3/api/streetGrade?streetEdgeId=${streetId}`));
      if (token !== this.#token) return;
      // The slot is a live region that has just said "loading", so every ending but a drawn chart is said in it
      // too: removing it would leave a screen-reader user waiting on a profile that is not coming.
      if (AccessScoreElevationProfile.canDraw(response.profile)) this.#drawProfile(slot, response);
      else slot.textContent = i18next.t('accessscore:profile-none');
    } catch (e) {
      console.warn('AccessScore elevation profile failed to load', e);
      if (token === this.#token) slot.textContent = i18next.t('accessscore:profile-failed');
    }
  }

  /**
   * Draws the profile with its accessible name in the reader's units and the stretch that set its `max_grade`,
   * which only the backend can place. A stale street's stretch is left out: it was placed along the street's
   * previous geometry, not the line now drawn.
   */
  #drawProfile(slot, response) {
    const { profile } = response;
    const plain = { escape: false };
    const elevations = profile.elevations_meters;
    const hasStretch = !response.stale && typeof response.max_grade_from_meters === 'number'
      && typeof response.max_grade_to_meters === 'number' && typeof response.max_grade === 'number';
    const label = i18next.t('accessscore:profile-label', {
      start: formatElevation(elevations[0], plain),
      end: formatElevation(elevations[elevations.length - 1], plain),
      low: formatElevation(Math.min(...elevations), plain),
      high: formatElevation(Math.max(...elevations), plain),
      interpolation: { escapeValue: false },
    });
    slot.removeAttribute('aria-live');
    new AccessScoreElevationProfile(slot, profile, {
      breaks: this.#config.grade.map_class_breaks,
      steepest: hasStretch
        ? { from: response.max_grade_from_meters, to: response.max_grade_to_meters, grade: response.max_grade }
        : null,
      label,
      onLog: this.#callbacks.log,
    });
  }

  // ---- The evidence ----

  /** Fetches the street's clusters and draws the three groups. */
  async #loadEvidence(token) {
    const status = this.#els.body.querySelector('[data-acs-status]');
    status.textContent = i18next.t('accessscore:panel-loading');
    let groups;
    try {
      groups = await this.#feed.forStreet(this.#street);
    } catch (e) {
      console.warn('AccessScore street panel: cluster feed failed', e);
      if (token === this.#token) status.textContent = i18next.t('accessscore:panel-load-failed');
      return;
    }
    if (token !== this.#token) return;
    const standing = AccessScoreClusterFeed.standing;
    const rank = (list) => list
      .filter((p) => Array.isArray(p.label_ids) && p.label_ids.length > 0)
      .sort((a, b) => AccessScoreClusterFeed.compareWorstFirst(standing(a), standing(b)));
    this.#groups = { block: rank(groups.block), start: rank(groups.start), end: rank(groups.end) };
    status.textContent = '';
    const holder = this.#els.body.querySelector('[data-acs-groups]');
    holder.innerHTML = AccessScoreStreetPanel.GROUPS.map((key) => this.#groupShellHtml(key)).join('');
    for (const key of AccessScoreStreetPanel.GROUPS) {
      const more = holder.querySelector(`[data-acs-group="${key}"] .acs-group__more`);
      more?.addEventListener('click', () => {
        this.#expanded.add(key);
        this.#callbacks.log('PanelExpandGroup', key);
        this.#renderGroup(key, this.#token);
      });
    }
    await Promise.all(AccessScoreStreetPanel.GROUPS.map((key) => this.#renderGroup(key, token)));
  }

  /** A group's heading, caption and empty list; a crossing the street does not have is left out. */
  #groupShellHtml(key) {
    const esc = util.escapeHTML;
    const street = this.#street;
    if (key !== 'block' && !street[`${key}Intersection`]) return '';
    const list = this.#groups[key];
    const title = key === 'block'
      ? i18next.t('accessscore:panel-group-block')
      : i18next.t(`accessscore:panel-${key}-crossing`);
    const caption = list.length === 0
      ? i18next.t('accessscore:panel-group-empty')
      : i18next.t(`accessscore:panel-group-caption-${key === 'block' ? 'block' : 'crossing'}`, { count: list.length });
    return `<section class="acs-group" data-acs-group="${key}" aria-labelledby="acs-group-${key}-title">
      <h4 class="acs-group__title" id="acs-group-${key}-title">${esc(title)} ${this.#groupScoreHtml(key)}</h4>
      <p class="acs-group__caption">${esc(caption)}</p>
      <ol class="acs-group__tiles" role="list"></ol>
      <button type="button" class="acs-group__more button button--small button--secondary" hidden></button>
    </section>`;
  }

  /** A group's score beside its heading: the block's own, or the crossing's. */
  #groupScoreHtml(key) {
    const street = this.#street;
    const score = key === 'block' ? street.segmentScore : (street[`${key}Intersection`]?.score ?? null);
    if (score === null || score === undefined) return '<span class="acs-group__score acs-group__score--none">—</span>';
    return `<span class="acs-group__score acs-group__score--${score < 0.5 ? 'problem' : 'feature'}">${
      formatScore(score)}</span>`;
  }

  /** Fetches the pictures a group shows and renders its tiles, the cap applied unless the group is expanded. */
  async #renderGroup(key, token) {
    const section = this.#els.body.querySelector(`[data-acs-group="${key}"]`);
    if (!section) return;
    const all = this.#groups[key];
    const shown = this.#expanded.has(key) ? all : all.slice(0, AccessScoreStreetPanel.MAX_TILES);
    const more = section.querySelector('.acs-group__more');
    more.hidden = shown.length >= all.length;
    more.textContent = i18next.t('accessscore:panel-all', { count: all.length });
    const loaded = await Promise.all(shown.map((p) => this.#feed.label(AccessScoreClusterFeed.newestLabelId(p))
      .then((label) => ({ label, props: p }), () => null)));
    if (token !== this.#token) return;
    const list = section.querySelector('.acs-group__tiles');
    for (const tile of list.querySelectorAll('.acs-tile')) {
      const id = Number(tile.dataset.clusterId);
      this.#tiles.delete(id);
    }
    list.innerHTML = '';
    const failed = loaded.filter((x) => x === null).length;
    for (const entry of loaded) {
      if (!entry) continue;
      const tile = this.#tile(entry.props, entry.label, key);
      this.#tiles.set(entry.props.label_cluster_id, tile);
      this.#cards.set(entry.label.label_id, tile.card);
      list.appendChild(tile.el);
    }
    this.#labelIds = [...this.#tiles.values()].map((t) => t.card.labelId);
    if (failed > 0) {
      const status = this.#els.body.querySelector('[data-acs-status]');
      status.textContent = i18next.t('accessscore:sheet-error', { count: failed });
    }
    if (this.#litType !== null) this.#light(this.#litType);
  }

  /** One tile: the cluster's card with the effect chip and, for a cluster of several labels, the way to them all. */
  #tile(props, label, group) {
    const el = document.createElement('li');
    el.className = 'acs-tile';
    el.dataset.clusterId = String(props.label_cluster_id);
    const card = new LabelMiniCard(label, {
      size: 'sheet',
      showType: true,
      tag: 'div',
      className: 'acs-tile__card',
      source: 'AccessScorePanel',
      log: this.#callbacks.log,
      onOpen: (labelId) => {
        this.#callbacks.log('PanelOpenLabel_labelId', labelId);
        this.#callbacks.onOpenLabel(labelId, this.#labelIds);
      },
    });
    const effect = document.createElement('span');
    effect.className = 'acs-tile__effect';
    el.appendChild(card.element);
    el.appendChild(effect);
    if (props.cluster_size > 1) {
      const size = document.createElement('button');
      size.type = 'button';
      size.className = 'acs-tile__size';
      size.textContent = i18next.t('accessscore:cluster-size', { count: props.cluster_size });
      size.setAttribute('aria-label', i18next.t('accessscore:panel-open-sheet', { count: props.cluster_size }));
      size.addEventListener('click', () => {
        this.#callbacks.log('PanelSheet_labelClusterId', props.label_cluster_id);
        const term = this.#model.clusterTerm(props, this.#street);
        const effectLine = term
          ? i18next.t('accessscore:cluster-effect', {
              type: util.misc.labelTypeName(props.label_type), value: signed(term.term),
            })
          : '';
        this.#callbacks.onOpenSheet(props, effectLine);
      });
      el.appendChild(size);
    }
    const tile = { props, group, el, effect, card };
    this.#paintEffect(tile);
    const hover = (on) => {
      if (on) {
        if (!this.#loggedClusters.has(props.label_cluster_id)) {
          this.#loggedClusters.add(props.label_cluster_id);
          this.#callbacks.log('PanelHoverCluster_labelClusterId', props.label_cluster_id);
        }
        this.lightCluster(props.label_cluster_id);
      } else {
        this.lightCluster(null);
      }
      this.#callbacks.onHoverCluster(on ? props : null);
    };
    el.addEventListener('mouseenter', () => hover(true));
    el.addEventListener('mouseleave', () => hover(false));
    el.addEventListener('focusin', () => hover(true));
    el.addEventListener('focusout', (e) => {
      if (!(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) hover(false);
    });
    return tile;
  }

  /** Writes a tile's effect chip from the current weights. */
  #paintEffect(tile) {
    const esc = util.escapeHTML;
    const term = this.#model.clusterTerm(tile.props, this.#street);
    const el = tile.effect;
    if (!term) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const value = signed(term.term);
    el.textContent = value;
    if (term.pooled) el.textContent = i18next.t('accessscore:panel-effect-pooled', { value });
    let tone = 'none';
    if (term.term < 0) tone = 'problem';
    else if (term.term > 0) tone = 'feature';
    el.className = `acs-tile__effect acs-tile__effect--${tone}`;
    el.setAttribute('data-ps-tooltip', esc(i18next.t('accessscore:cluster-effect', {
      type: util.misc.labelTypeName(tile.props.label_type), value,
    })));
  }

  #clearTiles() {
    this.#tiles.clear();
    this.#cards.clear();
    this.#labelIds = [];
  }
}
