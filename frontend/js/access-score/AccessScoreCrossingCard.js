/**
 * What is at a crossing (#5748): the card that opens when a reader hovers or focuses one of the street panel's
 * crossing dots. A top-down view of the intersection with the crossing's clusters on it, the corner types' effects
 * worst first, and the crops of its costliest clusters, so the dot's one figure can be checked against the place.
 *
 * The view is a Mapbox inset, one map for the card's whole life, built on the first open and recentered on the
 * next: a map load is what Mapbox bills, so the card never costs more than one per visit, and never a Street View
 * pano, which Google bills per instantiation. The inset is not interactive and carries no attribution control of
 * its own; the page's main map shows the Mapbox credit.
 *
 * The card is a tooltip, not a dialog: nothing in it can be pressed. The crops are pictures only, since the votable
 * tiles for the same clusters sit just below in the panel's evidence, and a tooltip must not hold controls.
 */

import i18next from 'i18next';
import mapboxgl from '../common/mapboxgl.js';
import { LabelMiniCard } from '../common/LabelMiniCard.js';
import { util } from '../common/utilities.js';
import { AccessScoreClusterFeed } from './AccessScoreClusterFeed.js';
import { signed } from './AccessScoreText.js';
import '../common/utilitiesSidewalk.js';
/** @typedef {import('./AccessScoreModel.js').AccessScoreIntersectionExplanation} AccessScoreIntersectionExplanation */
/** @typedef {import('./AccessScoreClusterFeed.js').AccessScoreFeedCluster} AccessScoreFeedCluster */

export class AccessScoreCrossingCard {
  /** Crops shown before "+N more below": a row of them, the rest being the evidence group under the card. */
  static MAX_CROPS = 4;

  /** Close enough to tell the corners of one intersection apart. */
  static ZOOM = 18;

  /**
   * How long the card is open before its inset is built or moved: a map load is what Mapbox bills, and a focus
   * that is only passing through on its way down the panel should not pay for one.
   */
  static MAP_DELAY_MS = 250;

  #el;
  #styleUrl;
  #feed;
  #types;
  /** @type {?mapboxgl.Map} The inset, once a crossing has been opened. */
  #map = null;
  #mapReady = false;
  /** What the inset should show once it has loaded, or now if it has. */
  #pending = null;
  /** Bumped on every open and close, so a crop that arrives for an earlier crossing is dropped. */
  #token = 0;
  /** The inset's pending build or move, until the card has been open long enough to deserve one. */
  #mapTimer = null;

  /**
   * @param {HTMLElement} el - The card's own element, `hidden` until a crossing opens it.
   * @param {object} options - Data and settings.
   * @param {AccessScoreClusterFeed} options.feed - The page's cluster cache, for the crops' label JSON.
   * @param {string[]} options.types - The scored label types, for the dots' colors.
   * @param {string} options.styleUrl - The inset's basemap style.
   */
  constructor(el, { feed, types, styleUrl }) {
    this.#el = el;
    this.#feed = feed;
    this.#types = types;
    this.#styleUrl = styleUrl;
    this.#el.innerHTML = `<div class="acs-crossing-card__map" data-acs-card-map></div>
      <ul class="acs-crossing-card__rows" role="list" data-acs-card-rows></ul>
      <div class="acs-crossing-card__crops" data-acs-card-crops></div>`;
  }

  /** @returns {boolean} Whether the card is on show. */
  get open() {
    return !this.#el.hidden;
  }

  /**
   * Shows a crossing.
   * @param {object} crossing - What to show.
   * @param {'start'|'end'} crossing.key - Which end of the street, for the tail and the card's name.
   * @param {string} crossing.name - The crossing's name as the dot shows it.
   * @param {{lng: number, lat: number}} crossing.lngLat - Where the crossing is.
   * @param {number[][]} crossing.line - The street's line as `[lng, lat]` vertices, drawn so the reader can tell
   *   which block the panel is about.
   * @param {AccessScoreIntersectionExplanation} crossing.explanation - The crossing's terms, from the model.
   * @param {AccessScoreFeedCluster[]} crossing.clusters - Its clusters, costliest first; null while they load.
   * @param {(props: AccessScoreFeedCluster) => ?{term: number}} crossing.termOf - A cluster's own effect.
   */
  show({ key, name, lngLat, line, explanation, clusters, termOf }) {
    this.#token += 1;
    const token = this.#token;
    this.#el.hidden = false;
    this.#el.dataset.acsCardTail = key;
    this.#el.setAttribute('aria-label', i18next.t('accessscore:panel-crossing-card', { name }));
    this.#renderRows(explanation);
    this.#renderCrops(clusters, termOf, token);
    this.#cancelMapTimer();
    this.#mapTimer = setTimeout(() => {
      this.#mapTimer = null;
      this.#showMap(lngLat, line, clusters ?? []);
    }, AccessScoreCrossingCard.MAP_DELAY_MS);
  }

  /** Hides the card. The inset stays built for the next open; one not yet built is not built. */
  close() {
    this.#token += 1;
    this.#cancelMapTimer();
    this.#el.hidden = true;
  }

  #cancelMapTimer() {
    if (this.#mapTimer !== null) clearTimeout(this.#mapTimer);
    this.#mapTimer = null;
  }

  /** Drops the inset, for a panel that is going away for good. */
  destroy() {
    this.close();
    this.#map?.remove();
    this.#map = null;
    this.#mapReady = false;
  }

  /** The corner types with clusters at this crossing, worst first, each with its count and signed effect. */
  #renderRows(explanation) {
    const esc = util.escapeHTML;
    const rows = Object.entries(explanation?.terms ?? {})
      .filter(([, t]) => t.clusterCount > 0)
      .sort(([, a], [, b]) => a.term - b.term)
      .map(([type, t]) => {
        let tone = 'none';
        if (t.term < 0) tone = 'problem';
        else if (t.term > 0) tone = 'feature';
        return `<li class="acs-crossing-card__row">
          <span class="acs-row__swatch" style="background-color: ${util.misc.getLabelColors(type)};"></span>
          <span class="acs-crossing-card__type">${esc(util.misc.labelTypeName(type))}</span>
          <span class="acs-row__count">${esc(i18next.t('accessscore:panel-clusters', { count: t.clusterCount }))}</span>
          <span class="acs-row__effect acs-row__effect--${tone}">${esc(signed(t.term))}</span>
        </li>`;
      });
    const holder = this.#el.querySelector('[data-acs-card-rows]');
    holder.innerHTML = rows.length
      ? rows.join('')
      : `<li class="acs-crossing-card__row acs-crossing-card__row--empty">${
        esc(i18next.t('accessscore:panel-crossing-no-clusters'))}</li>`;
  }

  /**
   * The costliest clusters' crops, from label JSON the evidence tiles have usually fetched already. Each is a
   * picture with its type's icon; one with no picture is the mini card's stand-in, so "no image" reads the same
   * everywhere.
   */
  async #renderCrops(clusters, termOf, token) {
    const holder = this.#el.querySelector('[data-acs-card-crops]');
    holder.innerHTML = '';
    if (!clusters || clusters.length === 0) return;
    const shown = clusters.slice(0, AccessScoreCrossingCard.MAX_CROPS);
    const labels = await Promise.all(shown.map((p) => this.#feed.label(AccessScoreClusterFeed.newestLabelId(p))
      .catch(() => null)));
    if (token !== this.#token) return;
    const esc = util.escapeHTML;
    for (const [i, props] of shown.entries()) {
      const label = labels[i];
      const type = props.label_type;
      const figure = document.createElement('figure');
      figure.className = 'acs-crossing-card__crop';
      figure.dataset.clusterId = String(props.label_cluster_id);
      const term = termOf(props);
      if (term) {
        figure.title = i18next.t('accessscore:cluster-effect', {
          type: util.misc.labelTypeName(type), value: signed(term.term),
        });
      }
      const src = label?.crop_url || label?.backup_image_url;
      if (src) {
        figure.innerHTML = `<img class="acs-crossing-card__image" src="${esc(src)}" alt="" loading="lazy">
          <img class="acs-crossing-card__icon" src="${util.misc.getIconImagePaths(type).iconImagePath}" alt="">`;
        figure.querySelector('.acs-crossing-card__image').addEventListener('error', () => {
          figure.querySelector('.acs-crossing-card__image').replaceWith(LabelMiniCard.placeholder(type));
        });
      } else {
        figure.appendChild(LabelMiniCard.placeholder(type));
      }
      holder.appendChild(figure);
    }
    const rest = clusters.length - shown.length;
    if (rest > 0) {
      const more = document.createElement('p');
      more.className = 'acs-crossing-card__more';
      more.textContent = i18next.t('accessscore:panel-crossing-more', { count: rest });
      holder.appendChild(more);
    }
  }

  /** Centers the inset on the crossing and draws the street and the clusters, building the map on the first call. */
  #showMap(lngLat, line, clusters) {
    this.#pending = { lngLat, line, clusters };
    if (!this.#map) {
      this.#map = new mapboxgl.Map({
        container: this.#el.querySelector('[data-acs-card-map]'),
        style: this.#styleUrl,
        center: [lngLat.lng, lngLat.lat],
        zoom: AccessScoreCrossingCard.ZOOM,
        interactive: false,
        attributionControl: false,
      });
      this.#map.on('load', () => {
        this.#addLayers();
        this.#mapReady = true;
        this.#applyPending();
      });
      return;
    }
    // The container was display: none while the card was hidden, so the canvas has to be told its size again.
    this.#map.resize();
    this.#map.jumpTo({ center: [lngLat.lng, lngLat.lat], zoom: AccessScoreCrossingCard.ZOOM });
    if (this.#mapReady) this.#applyPending();
  }

  /** A color token from the stylesheet, so the inset's chrome follows the design system like the main map's. */
  static #cssToken(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /** The street as a line and the clusters as dots in their types' colors, over the basemap. */
  #addLayers() {
    const empty = { type: 'FeatureCollection', features: [] };
    this.#map.addSource('acs-card-street', { type: 'geojson', data: empty });
    this.#map.addSource('acs-card-clusters', { type: 'geojson', data: empty });
    this.#map.addLayer({
      id: 'acs-card-street', type: 'line', source: 'acs-card-street',
      paint: {
        'line-color': AccessScoreCrossingCard.#cssToken('--color-neutral-700'), 'line-width': 4, 'line-opacity': 0.6,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
    const colors = util.misc.getLabelColors();
    const fill = ['match', ['get', 'label_type']];
    const stroke = ['match', ['get', 'label_type']];
    for (const type of this.#types) {
      fill.push(type, colors[type].fillStyle);
      stroke.push(type, colors[type].strokeStyle);
    }
    fill.push(colors.Other.fillStyle);
    stroke.push(colors.Other.strokeStyle);
    this.#map.addLayer({
      id: 'acs-card-clusters', type: 'circle', source: 'acs-card-clusters',
      paint: {
        'circle-radius': 6, 'circle-color': fill, 'circle-stroke-color': stroke, 'circle-stroke-width': 1.5,
        'circle-opacity': 0.9,
      },
    });
  }

  #applyPending() {
    const { line, clusters } = this.#pending ?? {};
    if (!line) return;
    this.#map.getSource('acs-card-street').setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: {} }],
    });
    this.#map.getSource('acs-card-clusters').setData({
      type: 'FeatureCollection',
      features: clusters.filter((p) => Array.isArray(p.coordinates)).map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: p.coordinates },
        properties: { label_type: p.label_type, label_cluster_id: p.label_cluster_id },
      })),
    });
  }
}
