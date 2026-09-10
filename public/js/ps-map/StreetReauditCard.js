/**
 * Hover card for a street that still needs a re-audit (#5258).
 *
 * The map already draws these streets dashed and the sidebar counts them, but neither says what a mapper would gain
 * by going back. This card answers that: when the street was last mapped, what imagery has landed since, and what was
 * found there last time — so "newer imagery available" becomes a reason to look rather than a label.
 *
 * The card is interactive, so it follows the search pin's hover contract (labelMapLocationSearch.js) rather than the
 * neighborhood popup's: leaving the street hands off to a short grace period that checks whether the pointer landed
 * in the card, and Escape dismisses it (WCAG 1.4.13 hoverable/dismissible). A Mapbox line layer has no focusable DOM
 * node, so there is no keyboard path *to* a street; the same information is keyboard-reachable on the dashboard's
 * re-audit list.
 *
 * Its data is fetched per street rather than carried on the street layer: the map's GeoJSON is one whole-city
 * payload, and per-street label breakdowns for every street in it would be megabytes nobody hovers.
 */
class StreetReauditCard {
  /** Rest-before-opening, matching psTooltip so hover cards across the site feel the same. */
  static #OPEN_DELAY_MS = 250;

  /** Grace period for the pointer to travel from the street line into the card before it tears down. */
  static #POINTER_HANDOFF_MS = 150;

  #map;
  #mapName;
  #logClicks;
  #popup = null;
  #shownStreetId = null;
  #pendingStreetId = null;
  #openTimer = null;
  #closeTimer = null;

  /** Summaries already fetched, keyed by street edge id. Streets don't change state mid-session. */
  #cache = new Map();

  /**
   * @param {object} map - The Mapbox map the card attaches to.
   * @param {object} options - Card options.
   * @param {string} options.mapName - HTML id of the map container, used in logged event names.
   * @param {boolean} [options.logClicks=true] - Whether to log clicks on the card's Explore link.
   */
  constructor(map, { mapName, logClicks = true } = {}) {
    this.#map = map;
    this.#mapName = mapName;
    this.#logClicks = logClicks;

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.hide();
    });
  }

  /**
   * Whether the card is currently open for a given street.
   * @param {number} streetEdgeId - The street to test.
   * @returns {boolean} True if this street's card is open.
   */
  isShowingFor(streetEdgeId) {
    return this.#shownStreetId === streetEdgeId;
  }

  /**
   * Opens the card for a street after the hover delay, unless the pointer moves on first.
   *
   * Safe to call on every `mousemove` over the layer: re-arming for the street already shown or already pending is a
   * no-op, so sliding along one street doesn't restart its timer or refetch it.
   *
   * @param {number} streetEdgeId - The street being hovered.
   * @param {object} lngLat - Mapbox LngLat the card should point at.
   */
  scheduleFor(streetEdgeId, lngLat) {
    if (this.#shownStreetId === streetEdgeId || this.#pendingStreetId === streetEdgeId) {
      this.#cancelClose();
      return;
    }
    this.cancelScheduled();
    this.#cancelClose();
    this.#pendingStreetId = streetEdgeId;
    this.#openTimer = setTimeout(() => {
      this.#openTimer = null;
      this.#open(streetEdgeId, lngLat);
    }, StreetReauditCard.#OPEN_DELAY_MS);
  }

  /**
   * Drops a not-yet-opened card, for a pointer that moved onto a street this card has nothing to say about.
   */
  cancelScheduled() {
    if (this.#openTimer !== null) {
      clearTimeout(this.#openTimer);
      this.#openTimer = null;
    }
    this.#pendingStreetId = null;
  }

  /**
   * Closes the card unless the pointer has landed inside it, which is the user reaching for its Explore link.
   */
  scheduleHide() {
    this.cancelScheduled();
    this.#cancelClose();
    this.#closeTimer = setTimeout(() => {
      this.#closeTimer = null;
      if (!this.#popup?.getElement()?.matches(':hover')) this.hide();
    }, StreetReauditCard.#POINTER_HANDOFF_MS);
  }

  /**
   * Closes the card immediately and forgets which street it was for.
   */
  hide() {
    this.cancelScheduled();
    this.#cancelClose();
    this.#popup?.remove();
    this.#popup = null;
    this.#shownStreetId = null;
  }

  #cancelClose() {
    if (this.#closeTimer !== null) {
      clearTimeout(this.#closeTimer);
      this.#closeTimer = null;
    }
  }

  /**
   * Fetches the street's summary if needed, then opens the card — unless the pointer moved on while it was in flight.
   * @param {number} streetEdgeId - The street to describe.
   * @param {object} lngLat - Where to anchor the card.
   */
  async #open(streetEdgeId, lngLat) {
    let summary = this.#cache.get(streetEdgeId);
    if (summary === undefined) {
      try {
        const response = await fetch(`/contribution/street/${streetEdgeId}/reauditSummary`);
        // 404 means the street is not stale. The street layer is a page-load snapshot, so a street another mapper
        // refreshes still arrives flagged; cache the null so hovering it again doesn't re-ask.
        summary = response.ok ? await response.json() : null;
      } catch {
        return; // Offline or the request failed; say nothing rather than showing an empty card.
      }
      this.#cache.set(streetEdgeId, summary);
    }
    if (summary === null || this.#pendingStreetId !== streetEdgeId) return;

    this.#pendingStreetId = null;
    this.#shownStreetId = streetEdgeId;
    this.#popup = new mapboxgl.Popup({
      offset: 12,
      closeButton: false,
      closeOnClick: false,
      focusAfterOpen: false,
      maxWidth: '290px',
      className: 'street-reaudit-popup',
    })
      .setDOMContent(this.#buildContent(summary))
      .setLngLat(lngLat)
      .addTo(this.#map);

    // The pointer is inside the card now, so the layer's mouseleave has already fired; the card owns its own closing
    // from here.
    this.#popup.getElement().addEventListener('mouseleave', () => this.scheduleHide());
    this.#popup.getElement().addEventListener('mouseenter', () => this.#cancelClose());
  }

  /**
   * Builds the card's DOM.
   * @param {object} summary - The street's re-audit summary, as the endpoint returns it.
   * @returns {HTMLElement} The card's content element.
   */
  #buildContent(summary) {
    const card = document.createElement('div');
    card.className = 'street-reaudit';

    const lastMapped = moment(new Date(summary.last_audited_at)).format('ll');
    // Capture dates are month-granular in practice, so a full date would over-claim precision (the dashboard's
    // re-audit list renders them the same way).
    const newImagery = summary.new_imagery_date
      ? moment(new Date(`${summary.new_imagery_date}T00:00:00`)).format('MMMM YYYY')
      : null;

    card.innerHTML = `
      <h4 class="street-reaudit__title">${i18next.t('labelmap:reaudit-card-title')}</h4>
      <dl class="street-reaudit__facts">
        <dt>${i18next.t('labelmap:reaudit-card-last-mapped')}</dt>
        <dd>${lastMapped}</dd>
        ${newImagery ? `<dt>${i18next.t('labelmap:reaudit-card-new-imagery')}</dt><dd>${newImagery}</dd>` : ''}
      </dl>
      ${this.#labelsHtml(summary.label_counts)}
      <a class="button-ps button--primary button--small street-reaudit__explore"
         href="/explore?streetEdgeId=${summary.street_edge_id}">
        ${i18next.t('labelmap:reaudit-card-explore')}
      </a>`;

    if (this.#logClicks) {
      card.querySelector('.street-reaudit__explore').addEventListener('click', () => {
        window.logWebpageActivity?.(
          `Click_module=${this.#mapName}_action=StreetReauditCardExplore_streetId=${summary.street_edge_id}`,
        );
      });
    }
    return card;
  }

  /**
   * Builds the "what was found here" table, or the empty-state line for a street whose labels were all removed.
   * @param {Array<{label_type: string, count: number}>} labelCounts - Per-type counts, most frequent first.
   * @returns {string} The section's HTML.
   */
  #labelsHtml(labelCounts) {
    if (!labelCounts.length) return `<p class="street-reaudit__empty">${i18next.t('labelmap:reaudit-card-none')}</p>`;

    // The icon is decorative: the localized type name sits right beside it.
    const rows = labelCounts.map(({ label_type: labelType, count }) => `
      <tr>
        <td class="street-reaudit__type">
          <img src="${util.misc.getIconImagePaths(labelType).iconImagePath}" alt="" width="18" height="18">
          ${i18next.t(`common:${util.camelToKebab(labelType)}`).replace('&shy;', '')}
        </td>
        <td class="street-reaudit__count">${count.toLocaleString(i18next.language)}</td>
      </tr>`).join('');

    return `
      <p class="street-reaudit__found">${i18next.t('labelmap:reaudit-card-found')}</p>
      <table class="street-reaudit__labels">
        <tbody>${rows}</tbody>
      </table>`;
  }
}
