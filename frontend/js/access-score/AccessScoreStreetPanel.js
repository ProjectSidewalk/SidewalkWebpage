/**
 * The street panel (#5748): what opens when a street is clicked in the AccessScore tool. It says why the street
 * scores what it does, in figures rather than sentences, and backs every number with the pictures behind it.
 *
 * Top to bottom: the headline with the three components drawn as the street they are (a crossing, the block, a
 * crossing, each in its score color), the block drawn as its elevation profile where the city has one, with the
 * problems along it pinned where they are; a row per label type with its signed effect as a bar on one shared scale,
 * grade among them, totaled over the block and the crossings at its ends, since those three are what the headline
 * averages, the grade's figures under the profile; then the evidence, one tile per cluster along the block and at each
 * crossing, worst first (the costliest effect leads), each tile a `LabelMiniCard` wearing what that cluster costs or
 * earns; and last the credits for the data. A row lights its tiles, a tile lights its row, its dot on the map and its
 * pin on the profile, so the arithmetic and the pictures are one thing. A crossing's dot, hovered or focused, lights
 * that crossing's clusters here and on the map and opens the crossing card (`AccessScoreCrossingCard`), a top-down
 * view of the intersection with the crops of what is there; pressed, it flies the map to the crossing. Every
 * explanation in words sits behind an "i" button, as the sidebar's do.
 *
 * A panel beside the map rather than a popup over it: the pictures need the width, and the street they explain
 * should stay in view. It owns the map's right padding, as the drawer owns the left and the dock the bottom. The
 * place card (#5311) is the same panel headed by the place, since a place's score is its nearest street's.
 */

import i18next from 'i18next';
import { lineString, nearestPointOnLine, point } from '@turf/turf';
import { LabelMiniCard } from '../common/LabelMiniCard.js';
import { AccessScoreElevationProfile } from '../common/AccessScoreElevationProfile.js';
import { AccessScoreGradeRamp } from '../common/AccessScoreGradeRamp.js';
import { ScoreRamp } from '../common/scoreRamp.js';
import { util } from '../common/utilities.js';
import { setPaddingEdges } from '../ps-map/mapPadding.js';
import { AccessScoreClusterFeed } from './AccessScoreClusterFeed.js';
import { AccessScoreCrossingCard } from './AccessScoreCrossingCard.js';
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

/**
 * One row of "What drives this score": a type's clusters and effect over the block and its scored crossings.
 * @typedef {object} AccessScorePanelRow
 * @property {string} type
 * @property {number} count
 * @property {number} term
 * @property {Record<string, number>} buckets
 */

export class AccessScoreStreetPanel {
  /** Tiles per group before "Show all": enough to see the pattern, not a wall of fetches for one street. */
  static MAX_TILES = 12;

  /** The three places the engine scores a street's clusters, in the panel's order. */
  static GROUPS = Object.freeze(['block', 'start', 'end']);

  /**
   * The window width under which the panel covers the map to the right of the controls drawer and takes no map
   * padding, the drawer's rule: narrower, the drawer, the panel and a map worth looking at don't fit side by side.
   * Matches the stylesheet's breakpoint for the panel (`--breakpoint-md`).
   */
  static NARROW_QUERY = '(width <= 992px)';

  /** How long the pointer rests on a crossing's dot before its card opens: past a pass-through, short of a wait. */
  static CARD_DELAY_MS = 180;

  /** How long the card lingers after the pointer leaves the dot, long enough to reach the card itself. */
  static CARD_LINGER_MS = 120;

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
  /** @type {AccessScoreCrossingCard} */
  #card;
  /** The card's element, kept across renders: the inset map inside it is built once. */
  #cardEl;
  /** The crossing whose dot is hovered or focused, 'start' or 'end', or null. */
  #hoveredEnd = null;
  /** The delay before a pass of the pointer over a dot opens the card. */
  #endTimer = null;
  #loggedEnds = new Set();
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
  /** @type {?AccessScoreElevationProfile} The block's profile once drawn, which the problem markers are pinned on. */
  #profile = null;
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
   * @param {(id: number) => ?number[][]} [options.streetLine] - A street's line as `[lng, lat]` vertices in its
   *   digitized order, the order the elevation profile runs in; what pins a cluster along the profile.
   * @param {(reason: string) => void} options.onClose - Called when the reader closes the panel; the host
   *   deselects, which closes it.
   * @param {(labelId: number, labelIds: number[]) => void} options.onOpenLabel - Opens the full label card.
   * @param {(props: AccessScoreFeedCluster, effect: string) => void} options.onOpenSheet - Opens the cluster
   *   sheet for a tile whose cluster holds more than one label.
   * @param {(props: ?AccessScoreFeedCluster) => void} [options.onHoverCluster] - A tile hovered, or none.
   * @param {(list: ?AccessScoreFeedCluster[]) => void} [options.onHoverGroup] - A crossing's dot or the block
   *   hovered: its clusters, for the map to light together; null as the pointer leaves.
   * @param {(lngLat: {lng: number, lat: number}, where: string) => void} [options.onFlyTo] - A dot or the block
   *   pressed: where the map should fly, and 'start', 'end' or 'block'.
   * @param {string} [options.cardStyleUrl] - The basemap style for the crossing card's inset.
   * @param {(kind: string, value?: string|number) => void} [options.log] - Called for an interaction worth logging.
   */
  constructor(root, {
    model, config, map, feed, gradeSources = [], streetCenter, streetLine = () => null, onClose, onOpenLabel,
    onOpenSheet, onHoverCluster = () => {}, onHoverGroup = () => {}, onFlyTo = () => {}, cardStyleUrl = '',
    log = () => {},
  }) {
    this.#root = root;
    this.#model = model;
    this.#config = config;
    this.#map = map;
    this.#feed = feed;
    this.#gradeSources = gradeSources;
    this.#callbacks = {
      streetCenter, streetLine, onClose, onOpenLabel, onOpenSheet, onHoverCluster, onHoverGroup, onFlyTo, log,
    };
    this.#narrowMq = window.matchMedia ? window.matchMedia(AccessScoreStreetPanel.NARROW_QUERY) : { matches: false };
    this.#els = {
      title: root.querySelector('#acs-panel-title'),
      meta: root.querySelector('#acs-panel-meta'),
      close: root.querySelector('#acs-panel-close'),
      actions: root.querySelector('#acs-panel-actions'),
      body: root.querySelector('#acs-panel-body'),
    };
    this.#cardEl = document.createElement('div');
    this.#cardEl.className = 'acs-crossing-card';
    this.#cardEl.id = 'acs-crossing-card';
    this.#cardEl.setAttribute('role', 'tooltip');
    this.#cardEl.hidden = true;
    // Resting on the card keeps it open, as resting on a tooltip does.
    this.#cardEl.addEventListener('mouseenter', () => this.#cancelEndTimer());
    this.#cardEl.addEventListener('mouseleave', () => this.#leaveEnd());
    this.#card = new AccessScoreCrossingCard(this.#cardEl, { feed, types: model.types, styleUrl: cardStyleUrl });
    this.#els.close.addEventListener('click', () => this.#requestClose('button'));
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      // The card goes first: a reader who opened it from the keyboard closes that, not the whole panel.
      if (this.#card.open) {
        this.#closeCard();
        return;
      }
      this.#requestClose('escape');
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
    this.#closeCard();
    this.#clearTiles();
    this.#street = null;
    this.#place = null;
    this.#groups = null;
    this.#profile = null;
    this.#expanded.clear();
    // The card's element outlives the body's markup: the inset map inside it would otherwise be built again.
    this.#cardEl.remove();
    this.#els.body.innerHTML = '';
    if (this.#els.actions) this.#els.actions.innerHTML = '';
    this.#applyPadding();
    // Focus went into the panel on open; it must not vanish into the document when the panel does.
    if (hadFocus) this.#map.getCanvas?.()?.focus?.();
  }

  /**
   * Re-renders the explanation under new weights, keeping the pictures: a slider tick changes every effect and no
   * cluster, so the tiles on show are re-chipped and re-ordered rather than refetched. Nothing happens while the
   * panel is closed.
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
    this.#reorder();
    this.#applyMarkers();
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
   * Marks one cluster's tile, its type's row and its pin on the profile, as a hover on its dot on the map does;
   * null clears.
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
    this.#profile?.lightMarker(clusterId);
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
    this.#profile = null;
    this.#expanded.clear();
    this.#loggedRows.clear();
    this.#loggedClusters.clear();
    this.#loggedEnds.clear();
    this.#closeCard();
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

  /**
   * The sidebar's "i" button: the explanation in words, shown on hover and focus, and the button's own accessible
   * name, so a screen reader hears the explanation rather than a bare "more information".
   * @param {string} text - The explanation, as plain text.
   * @returns {string} The button's markup.
   */
  static #infoHtml(text) {
    const esc = util.escapeHTML(text);
    return `<button type="button" class="acs-info info-button" data-ps-tooltip="${esc}" aria-label="${esc}">
      <span aria-hidden="true">i</span></button>`;
  }

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
      this.#els.meta.innerHTML = [region ? esc(region.name) : null, formatLength(street.lengthM)]
        .filter(Boolean).join(' · ');
    }
    this.#els.body.innerHTML = `
      ${place ? '<p class="acs-panel__place-street" data-acs-place-street></p>' : ''}
      <div class="acs-panel__verdict" data-acs-verdict></div>
      <p class="sr-only" role="status" data-acs-profile-status></p>
      <section class="acs-panel__section" data-acs-rows aria-labelledby="acs-panel-rows-title"></section>
      <section class="acs-panel__section" data-acs-evidence aria-labelledby="acs-panel-evidence-title">
        <div class="acs-panel__heading-row">
          <h3 class="acs-panel__subtitle" id="acs-panel-evidence-title">${i18next.t('accessscore:panel-evidence')}</h3>
          ${AccessScoreStreetPanel.#infoHtml(i18next.t('accessscore:panel-evidence-help'))}
        </div>
        <p class="acs-panel__status" role="status" data-acs-status></p>
        <div data-acs-groups></div>
      </section>
      <footer class="acs-panel__credits" data-acs-credits hidden></footer>`;
  }

  /** "scored Oct 29, 2026", or nothing before the first clustering run. */
  #updatedHtml() {
    const iso = this.#config.clusters_updated_at;
    if (!iso) return null;
    const date = new Date(iso).toLocaleDateString(i18next.language, util.SHORT_DATE);
    return i18next.t('accessscore:panel-updated', { date, interpolation: { escapeValue: true } });
  }

  /**
   * Everything that follows from the explanation: the verdict, the rows, the grade's figures, the hop. The
   * elevation profile, fetched once, survives a re-render of the verdict around it.
   */
  #renderExplanation() {
    const street = this.#street;
    const q = (sel) => this.#els.body.querySelector(sel);
    if (this.#place) q('[data-acs-place-street]').innerHTML = this.#placeStreetHtml();
    const drawn = q('[data-acs-profile]:not([hidden])');
    // The card's element is lifted out before the verdict is rewritten around it, as the drawn profile is.
    this.#cardEl.remove();
    q('[data-acs-verdict]').innerHTML = street ? this.#verdictHtml(street) : '';
    if (drawn) {
      q('[data-acs-profile]').replaceWith(drawn);
      q('.acs-panel__components')?.classList.add('acs-panel__components--profile');
    }
    // Inside the components grid, as its own full-width row right under the dots, so its tail reaches the dot it
    // hangs from even when the profile's legend follows.
    q('.acs-panel__components')?.appendChild(this.#cardEl);
    this.#bindEnds();
    // An unaudited street has nothing scored on it to list or to picture; its grade, from the elevation model, it
    // still has.
    const scored = Boolean(street?.audited);
    q('[data-acs-rows]').innerHTML = scored ? this.#rowsHtml(street) : '';
    q('[data-acs-rows]').hidden = !scored;
    const evidence = q('[data-acs-evidence]');
    evidence.hidden = !scored;
    const credits = this.#creditsHtml(street);
    q('[data-acs-credits]').innerHTML = credits;
    q('[data-acs-credits]').hidden = credits === '';
    const lngLat = this.#hopLngLat();
    if (this.#els.actions) this.#els.actions.innerHTML = lngLat ? hopLinksHtml(lngLat) : '';
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
   * The headline with its "i", and the three components drawn as the street: the crossing at the start, the block,
   * the crossing at the end, each in its score color. The block is a bar until its elevation profile arrives, which
   * then takes its place between the crossings, the bar shrinking to a pill beneath it; the grade's figures sit
   * right under. A scored crossing's dot and the block are buttons: hovered they light their clusters, pressed they
   * fly the map there. A crossing without a score has nothing to show, so its dot stays inert.
   */
  #verdictHtml(street) {
    const esc = util.escapeHTML;
    if (!street.audited) {
      return `<div class="acs-panel__score">${esc(i18next.t('accessscore:unaudited'))}</div>
        <p class="acs-panel__sentence">${esc(i18next.t('accessscore:panel-verdict-unaudited'))}</p>
        ${this.#gradeLineHtml(street)}`;
    }
    const fly = esc(i18next.t('accessscore:panel-crossing-fly'));
    const end = (e, which) => {
      const name = i18next.t(`accessscore:panel-${which}-crossing`);
      if (!e || e.score === null) {
        const note = i18next.t(`accessscore:panel-${e ? 'no-score' : 'no-crossing'}`);
        return `<div class="acs-panel__end acs-panel__end--${which}">
          <span class="acs-panel__dot acs-panel__dot--none"></span>
          <span class="acs-panel__end-score">—</span><span class="acs-panel__end-name">${esc(name)}</span>
          <span class="acs-panel__end-note">${esc(note)}</span></div>`;
      }
      return `<button type="button" class="acs-panel__end acs-panel__end--${which}" data-acs-end="${which}"
          aria-describedby="acs-crossing-card" data-ps-tooltip="${fly}">
        <span class="acs-panel__dot" style="background-color: ${ScoreRamp.at(e.score)};"></span>
        <span class="acs-panel__end-score">${formatScore(e.score)}</span>
        <span class="acs-panel__end-name">${esc(name)}</span></button>`;
    };
    const blockWords = street.barrier
      ? i18next.t('accessscore:popup-slope-barrier')
      : `<b>${formatScore(street.segmentScore)}</b> · ${formatLength(street.lengthM)}`;
    const blockFly = esc(i18next.t('accessscore:panel-block-fly'));
    return `<div class="acs-panel__headline">
        <div class="acs-panel__score">${formatScore(street.score)}<small>/ 100</small></div>
        ${AccessScoreStreetPanel.#infoHtml(i18next.t('accessscore:panel-score-help'))}
        <a class="acs-panel__docs" href="${esc(this.#root.dataset.docsUrl ?? '')}" target="_blank" rel="noopener">${
          esc(i18next.t('accessscore:how-computed'))}</a>
      </div>
      <div class="acs-panel__components">
        ${end(street.startIntersection, 'start')}
        <div class="acs-panel__profile" data-acs-profile hidden></div>
        <button type="button" class="acs-panel__block" data-acs-block data-ps-tooltip="${blockFly}"
          style="--acs-block-color: ${ScoreRamp.at(street.segmentScore)};">
          <span>${esc(i18next.t('accessscore:panel-block'))} ${blockWords}</span>
        </button>
        ${end(street.endIntersection, 'end')}
      </div>
      ${this.#gradeLineHtml(street)}`;
  }

  /**
   * The grade's figures, right under the profile they describe: steepest, average, climb and descent, or the net
   * grade where that is all the city has, with an "i" for why they are approximate or what a barrier did. Nothing
   * for a street that has not been sampled, so a city with no slope data shows no sign of the feature.
   */
  #gradeLineHtml(street) {
    const g = street?.gradient;
    if (!g) return '';
    const t = (key, values = {}) => i18next.t(`accessscore:${key}`, {
      // The values are this file's own escaped figures.
      ...values, interpolation: { escapeValue: false },
    });
    let line = '';
    if (g.meanGrade !== null && g.maxGrade !== null) {
      line = t('slope-headline', {
        max: percentHtml(g.maxGrade), mean: percentHtml(g.meanGrade),
        climb: formatElevation(g.climbM ?? 0), descent: formatElevation(g.descentM ?? 0),
      });
    } else if (g.netGrade !== null) {
      line = t('slope-net-only', { grade: percentHtml(Math.abs(g.netGrade)) });
    }
    if (!line) return '';
    // Plain text for the "i": the sentences are ours, the one figure a percentage.
    const notes = [];
    // A barrier zeroes the block, not the street: the headline still averages that 0 with the crossings.
    if (street.audited && street.barrier) {
      notes.push(i18next.t('accessscore:slope-barrier-effect', {
        limit: AccessScoreGradeRamp.percent(this.#model.state.slope.barrierThreshold),
        interpolation: { escapeValue: false },
      }));
    }
    if (g.quality !== 'measured') notes.push(t(`slope-quality-${g.quality.replace('_', '-')}`));
    else if (g.confidence !== 'high') notes.push(t('slope-approximate'));
    return `<p class="acs-panel__grade-line" data-acs-grade-line><span>${line}</span>
      ${notes.length ? AccessScoreStreetPanel.#infoHtml(notes.join(' ')) : ''}</p>`;
  }

  /** The panel's last word: where the elevation came from and when the clusters were last computed. */
  #creditsHtml(street) {
    const esc = util.escapeHTML;
    const lines = [];
    const source = this.#gradeSources.find((d) => d.dem_source === street?.gradient?.demSource);
    if (source) lines.push(esc(source.credit));
    const updated = this.#updatedHtml();
    if (updated) lines.push(updated);
    return lines.map((line) => `<p class="acs-panel__credit">${line}</p>`).join('');
  }

  /**
   * Wires the crossing dots and the block: a pass of the pointer (after a beat, so a pointer crossing the row on
   * its way elsewhere opens nothing) or focus lights the clusters and, for a crossing, opens the card; leaving
   * closes; a press flies the map there.
   */
  #bindEnds() {
    for (const el of this.#els.body.querySelectorAll('[data-acs-end], [data-acs-block]')) {
      const key = el.dataset.acsEnd ?? 'block';
      el.addEventListener('mouseenter', () => {
        this.#cancelEndTimer();
        this.#endTimer = setTimeout(() => this.#enterEnd(key), AccessScoreStreetPanel.CARD_DELAY_MS);
      });
      el.addEventListener('mouseleave', () => this.#leaveEnd());
      el.addEventListener('focus', () => {
        this.#cancelEndTimer();
        this.#enterEnd(key);
      });
      el.addEventListener('blur', () => this.#leaveEnd());
      el.addEventListener('click', () => {
        const lngLat = this.#endLngLat(key);
        if (!lngLat) return;
        this.#callbacks.log('PanelFlyTo', key);
        this.#callbacks.onFlyTo(lngLat, key);
      });
    }
  }

  #cancelEndTimer() {
    if (this.#endTimer !== null) clearTimeout(this.#endTimer);
    this.#endTimer = null;
  }

  /** The pointer or focus has settled on a crossing's dot or the block. */
  #enterEnd(key) {
    this.#hoveredEnd = key;
    this.#lightGroup(key);
    if (key === 'block') {
      this.#closeCard();
      return;
    }
    if (!this.#loggedEnds.has(key)) {
      this.#loggedEnds.add(key);
      this.#callbacks.log('PanelCrossing', key);
    }
    this.#openCard(key);
  }

  /**
   * The pointer or focus has left. The card stays for a beat so the pointer can travel from the dot onto the card;
   * that path is the card's own `mouseenter`, which cancels this.
   */
  #leaveEnd() {
    this.#cancelEndTimer();
    this.#endTimer = setTimeout(() => {
      this.#hoveredEnd = null;
      this.#lightGroup(null);
      this.#closeCard();
    }, AccessScoreStreetPanel.CARD_LINGER_MS);
  }

  /** Lights a group's tiles and heading, dims the rest, and hands its clusters to the map; null lifts it. */
  #lightGroup(key) {
    for (const section of this.#els.body.querySelectorAll('[data-acs-group]')) {
      section.classList.toggle('is-on', key !== null && section.dataset.acsGroup === key);
    }
    for (const tile of this.#tiles.values()) {
      tile.el.classList.toggle('is-dim', key !== null && tile.group !== key);
    }
    this.#callbacks.onHoverGroup(key === null ? null : (this.#groups?.[key] ?? []));
  }

  /** Opens, or refreshes, the card for a crossing: the panel's street, its line, its clusters if they have come. */
  #openCard(key) {
    const street = this.#street;
    const e = street?.[`${key}Intersection`];
    const lngLat = this.#endLngLat(key);
    if (!e || e.score === null || !lngLat) return;
    this.#cardEl.dataset.acsCardTail = key;
    // The tail sits under the dot's center, wherever the panel's width has put it.
    const dot = this.#els.body.querySelector(`[data-acs-end="${key}"]`);
    if (dot) {
      this.#cardEl.style.setProperty('--acs-card-tail-left',
        `${dot.offsetLeft + dot.offsetWidth / 2 - this.#cardEl.offsetLeft}px`);
    }
    this.#card.show({
      key,
      name: i18next.t(`accessscore:panel-${key}-crossing`),
      lngLat,
      line: this.#callbacks.streetLine(street.streetId) ?? [],
      explanation: this.#model.explainIntersection(e.id),
      clusters: this.#groups?.[key] ?? null,
      termOf: (props) => this.#model.clusterTerm(props, street),
    });
  }

  #closeCard() {
    this.#cancelEndTimer();
    if (this.#card.open) this.#card.close();
  }

  /**
   * Where a crossing is: the model keeps no intersection geometry, so it is the street line's first or last vertex,
   * in the street's digitized order, which is the order the profile runs in too. The block is its center.
   * @param {'start'|'end'|'block'} key
   * @returns {?{lng: number, lat: number}}
   */
  #endLngLat(key) {
    const street = this.#street;
    if (!street) return null;
    if (key === 'block') return this.#callbacks.streetCenter(street.streetId);
    const line = this.#callbacks.streetLine(street.streetId);
    if (!line || line.length < 2) return null;
    const [lng, lat] = key === 'start' ? line[0] : line[line.length - 1];
    return { lng, lat };
  }

  /**
   * A type's clusters and effect over the three components the headline averages: the block's term and each scored
   * crossing's, added. Tile chips of the type across the three groups add to the same figure, since a corner
   * cluster's term is its crossing's share and a block cluster's the block's.
   * @param {AccessScoreStreetExplanation} street - An audited street.
   * @returns {AccessScorePanelRow[]} Worst first; types with no cluster anywhere left out.
   */
  #typeRows(street) {
    /** @type {Record<string, AccessScorePanelRow>} */
    const rows = {};
    const add = (terms) => {
      for (const [type, term] of Object.entries(terms)) {
        const row = rows[type] ?? (rows[type] = { type, count: 0, term: 0, buckets: {} });
        row.count += term.clusterCount;
        row.term += term.term;
        for (const [bucket, n] of Object.entries(term.buckets)) row.buckets[bucket] = (row.buckets[bucket] ?? 0) + n;
      }
    };
    add(street.terms);
    for (const e of [street.startIntersection, street.endIntersection]) {
      if (!e || e.score === null) continue;
      const crossing = this.#model.explainIntersection(e.id);
      if (crossing) add(crossing.terms);
    }
    return Object.values(rows).filter((r) => r.count > 0).sort((a, b) => a.term - b.term);
  }

  /** The rows: one per type with clusters, worst first, then grade; each effect a bar on one shared scale. */
  #rowsHtml(street) {
    const esc = util.escapeHTML;
    const rows = this.#typeRows(street);
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
      ? `<ul class="acs-rows" role="list">${typeRows.join('')}</ul>`
      : `<p class="acs-panel__empty">${esc(i18next.t('accessscore:popup-no-clusters'))}</p>`;
    return `<div class="acs-panel__heading-row">
        <h3 class="acs-panel__subtitle" id="acs-panel-rows-title">${esc(i18next.t('accessscore:popup-terms'))}</h3>
        ${AccessScoreStreetPanel.#infoHtml(i18next.t('accessscore:panel-rows-help'))}
      </div>
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
   * Fetches the street's elevation profile into the verdict. The profile is the one slope field too heavy for the
   * city-wide payload, so it is asked for a street at a time, and only for a street with windowed statistics, which
   * is exactly a street with a profile. The block's bar stands in until it arrives, and stays where none does.
   */
  async #loadProfile(token) {
    if (this.#street.gradient?.meanGrade === null || this.#street.gradient?.meanGrade === undefined) return;
    const streetId = this.#street.streetId;
    // A live region, so a screen-reader user hears that a profile is coming, and every ending but a drawn chart
    // (which announces itself as the slider it is): removing the text would leave them waiting on one that is not.
    const status = this.#els.body.querySelector('[data-acs-profile-status]');
    status.textContent = i18next.t('accessscore:profile-loading');
    try {
      const response = /** @type {AccessScoreProfileResponse} */ (
        await util.fetchJson(`/v3/api/streetGrade?streetEdgeId=${streetId}`));
      if (token !== this.#token) return;
      if (AccessScoreElevationProfile.canDraw(response.profile)) {
        status.textContent = '';
        this.#drawProfile(response);
      } else {
        status.textContent = i18next.t('accessscore:profile-none');
      }
    } catch (e) {
      console.warn('AccessScore elevation profile failed to load', e);
      if (token === this.#token) status.textContent = i18next.t('accessscore:profile-failed');
    }
  }

  /**
   * Draws the profile in the block's place with its accessible name in the reader's units, the stretch that set its
   * `max_grade`, which only the backend can place, and the block's problems pinned along it. A stale street's
   * stretch is left out: it was placed along the street's previous geometry, not the line now drawn.
   */
  #drawProfile(response) {
    const slot = this.#els.body.querySelector('[data-acs-profile]');
    if (!slot) return;
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
    this.#profile = new AccessScoreElevationProfile(slot, profile, {
      breaks: this.#config.grade.map_class_breaks,
      steepest: hasStretch
        ? { from: response.max_grade_from_meters, to: response.max_grade_to_meters, grade: response.max_grade }
        : null,
      label,
      onLog: this.#callbacks.log,
      markers: this.#markers(),
      onMarkerHover: (id) => this.#hoverCluster(id === null ? null : this.#blockCluster(id), id),
    });
    slot.hidden = false;
    slot.closest('.acs-panel__components')?.classList.add('acs-panel__components--profile');
  }

  /**
   * The block's problem clusters as pins for the profile: each at its distance along the street, in its type's
   * color, titled with what it costs. A cluster at a crossing is the crossing's, and one whose effect is not
   * negative under the current weights is not a problem, so neither is pinned.
   * @returns {import('../common/AccessScoreElevationProfile.js').AccessScoreProfileMarker[]}
   */
  #markers() {
    const street = this.#street;
    const vertices = street && this.#groups ? this.#callbacks.streetLine(street.streetId) : null;
    if (!vertices || vertices.length < 2) return [];
    const line = lineString(vertices);
    const markers = [];
    for (const p of this.#groups.block) {
      if (!Array.isArray(p.coordinates)) continue;
      const term = this.#model.clusterTerm(p, street);
      if (!term || term.term >= 0) continue;
      const along = nearestPointOnLine(line, point(p.coordinates), { units: 'meters' }).properties.location;
      markers.push({
        id: p.label_cluster_id,
        meters: along,
        color: util.misc.getLabelColors(p.label_type),
        title: i18next.t('accessscore:cluster-effect', {
          type: util.misc.labelTypeName(p.label_type), value: signed(term.term), interpolation: { escapeValue: false },
        }),
      });
    }
    return markers;
  }

  /**
   * A block cluster by id, whether or not it has a tile on show: a pin past the tiles' cap still names its dot on
   * the map.
   * @param {number} id - A `label_cluster_id`.
   * @returns {?AccessScoreFeedCluster}
   */
  #blockCluster(id) {
    return this.#groups?.block.find((p) => p.label_cluster_id === id) ?? null;
  }

  /** Re-pins the problems once the clusters are known or the weights have moved; nothing without a profile. */
  #applyMarkers() {
    this.#profile?.setMarkers(this.#markers());
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
    const usable = (list) => list.filter((p) => Array.isArray(p.label_ids) && p.label_ids.length > 0);
    this.#groups = { block: this.#rank(usable(groups.block)), start: this.#rank(usable(groups.start)),
      end: this.#rank(usable(groups.end)) };
    status.textContent = '';
    // A card opened before the clusters came has no crops yet; it gets them now, as does the map's lighting.
    if (this.#hoveredEnd) this.#lightGroup(this.#hoveredEnd);
    if (this.#hoveredEnd && this.#hoveredEnd !== 'block') this.#openCard(this.#hoveredEnd);
    const holder = this.#els.body.querySelector('[data-acs-groups]');
    holder.innerHTML = AccessScoreStreetPanel.GROUPS.map((key) => this.#groupShellHtml(key)).join('');
    for (const key of AccessScoreStreetPanel.GROUPS) {
      const more = holder.querySelector(`[data-acs-group="${key}"] .acs-group__more`);
      more?.addEventListener('click', () => {
        if (this.#expanded.has(key)) {
          this.#expanded.delete(key);
          this.#callbacks.log('PanelCollapseGroup', key);
        } else {
          this.#expanded.add(key);
          this.#callbacks.log('PanelExpandGroup', key);
        }
        this.#renderGroup(key, this.#token);
      });
    }
    this.#applyMarkers();
    await Promise.all(AccessScoreStreetPanel.GROUPS.map((key) => this.#renderGroup(key, token)));
  }

  /**
   * Worst first, by what the arithmetic says: the costliest effect under the current weights leads, so a High
   * missing curb ramp comes before a Medium one and a bad crosswalk, and a feature trails every problem. Equal
   * effects fall back to the feed's standing (rating, verdict, agreement, size), then to the engine's own order of
   * types, so the order is the backend's at every step and never a type list of the panel's own.
   * @param {AccessScoreFeedCluster[]} list - One group's clusters.
   * @returns {AccessScoreFeedCluster[]} A sorted copy.
   */
  #rank(list) {
    const standing = AccessScoreClusterFeed.standing;
    const term = (p) => this.#model.clusterTerm(p, this.#street)?.term ?? 0;
    const order = (p) => this.#model.types.indexOf(p.label_type);
    return [...list].sort((a, b) => term(a) - term(b)
      || AccessScoreClusterFeed.compareWorstFirst(standing(a), standing(b))
      || order(a) - order(b));
  }

  /** Re-sorts each group under new weights and moves the tiles on show into that order, fetching nothing. */
  #reorder() {
    if (!this.#groups) return;
    for (const key of AccessScoreStreetPanel.GROUPS) {
      this.#groups[key] = this.#rank(this.#groups[key]);
      const list = this.#els.body.querySelector(`[data-acs-group="${key}"] .acs-group__tiles`);
      if (!list) continue;
      for (const p of this.#groups[key]) {
        const tile = this.#tiles.get(p.label_cluster_id);
        if (tile && tile.group === key) list.appendChild(tile.el);
      }
    }
    this.#labelIds = [...this.#tiles.values()].map((t) => t.card.labelId);
  }

  /** A group's heading with its score and count, and its empty list; a crossing the street lacks is left out. */
  #groupShellHtml(key) {
    const esc = util.escapeHTML;
    const street = this.#street;
    if (key !== 'block' && !street[`${key}Intersection`]) return '';
    const list = this.#groups[key];
    const title = key === 'block'
      ? i18next.t('accessscore:panel-group-block')
      : i18next.t(`accessscore:panel-${key}-crossing`);
    const count = list.length === 0
      ? i18next.t('accessscore:panel-group-empty')
      : i18next.t('accessscore:panel-clusters', { count: list.length });
    return `<section class="acs-group" data-acs-group="${key}" aria-labelledby="acs-group-${key}-title">
      <h4 class="acs-group__title" id="acs-group-${key}-title">${esc(title)} ${this.#groupScoreHtml(key)}
        <small class="acs-group__count">${esc(count)}</small></h4>
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

  /**
   * Fetches the pictures a group shows and renders its tiles, the cap applied unless the group is expanded. The
   * button under the list shows the rest, or folds them away again, and only exists where there is a rest.
   */
  async #renderGroup(key, token) {
    const section = this.#els.body.querySelector(`[data-acs-group="${key}"]`);
    if (!section) return;
    const all = this.#groups[key];
    const expanded = this.#expanded.has(key);
    const shown = expanded ? all : all.slice(0, AccessScoreStreetPanel.MAX_TILES);
    const more = section.querySelector('.acs-group__more');
    more.hidden = all.length <= AccessScoreStreetPanel.MAX_TILES;
    more.textContent = expanded
      ? i18next.t('accessscore:panel-fewer')
      : i18next.t('accessscore:panel-all', { count: all.length });
    more.setAttribute('aria-expanded', String(expanded));
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
      list.appendChild(tile.el);
    }
    this.#cards = new Map([...this.#tiles.values()].map((t) => [t.card.labelId, t.card]));
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
    el.addEventListener('mouseenter', () => this.#hoverCluster(props, props.label_cluster_id));
    el.addEventListener('mouseleave', () => this.#hoverCluster(null, null));
    el.addEventListener('focusin', () => this.#hoverCluster(props, props.label_cluster_id));
    el.addEventListener('focusout', (e) => {
      if (!(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) this.#hoverCluster(null, null);
    });
    return tile;
  }

  /**
   * A cluster pointed at in the panel, on its tile or its pin on the profile: lit here, on the map, and logged once
   * per open; null as the pointer leaves.
   * @param {?AccessScoreFeedCluster} props - The cluster, or null; a pin whose tile is past the cap still lights
   *   its dot on the map.
   * @param {?number} id - Its `label_cluster_id`, or null.
   */
  #hoverCluster(props, id) {
    if (id !== null && !this.#loggedClusters.has(id)) {
      this.#loggedClusters.add(id);
      this.#callbacks.log('PanelHoverCluster_labelClusterId', id);
    }
    this.lightCluster(id);
    this.#callbacks.onHoverCluster(props);
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
