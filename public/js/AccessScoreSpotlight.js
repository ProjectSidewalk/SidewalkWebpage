/**
 * One row of a Spotlight list, as /v3/api/accessScoreSpotlight returns it.
 * @typedef {object} SpotlightRow
 * @property {?number} score - The unit's AccessScore in [0, 1]; null only in the "closest to being ranked" list.
 * @property {number} [region_id]
 * @property {string} [name]
 * @property {number} [completion_rate]
 * @property {number} [osm_way_id]
 * @property {number} [street_edge_id]
 * @property {string} [region_name]
 * @property {number} [length_m]
 * @property {string} [city_id]
 * @property {string} [city_name]
 * @property {string} [city_url]
 */

/**
 * One unit's Spotlight feed.
 * @typedef {object} SpotlightFeed
 * @property {string} unit
 * @property {number} min_completion
 * @property {number} min_street_length_m
 * @property {number} qualifying
 * @property {number} total
 * @property {?string} computed_at
 * @property {SpotlightRow[]} top
 * @property {SpotlightRow[]} bottom
 * @property {SpotlightRow[]} nearest
 */

/**
 * AccessScore Spotlight (#5215): the highest- and lowest-scoring neighborhoods, or streets, as two ranked lists.
 *
 * One module, two pages. On a city's landing page it ranks that city and lights the neighborhood on the choropleth
 * below as you move down the list; on /cities it ranks every publicly launched deployment against the others and
 * lights that city's circle on the world map. The map never moves — a fly on every hover is nauseating in a list of
 * ten — and a click leaves for the AccessScore tool, at that neighborhood or street.
 *
 * The scores come from a nightly snapshot rather than a live computation, which is what makes it safe to put on the
 * home page at all: the feed is a bounded read of two tables. That also means a label placed today counts tomorrow,
 * which the "Updated nightly" note says out loud.
 *
 * Most Project Sidewalk cities do not have enough explored ground to rank five neighborhoods, so the sparse case is
 * the common one and is treated as the ask rather than as an error: the columns become "Ranked so far" and "Closest
 * to being ranked", the latter listing the neighborhoods nearest the completion floor with a button that starts a
 * mission in one. With nothing ranked at all in either unit the section hides itself.
 *
 * Nothing is fetched during page load; the module fills itself once the visitor shows a sign of engagement.
 */
class AccessScoreSpotlight {
  /** How many rows each list holds, and the number of ranked units at which the lists become a top and a bottom. */
  static #LIST_SIZE = 5;

  /** Skeleton rows drawn per column while the feed loads. */
  static #SKELETON_ROWS = 5;

  /** The choropleth's region source and the cities map's city source, as ps-map names them. */
  static #REGION_SOURCE = 'region-polygons';
  static #CITY_SOURCE = 'cities';

  #section;
  #root;
  #crossCity;
  /** Per unit: the feed, or null until it has been fetched. */
  #feeds = { regions: null, streets: null };
  #unit = 'regions';
  #viewLogged = false;
  /** Row ids already logged as hovered this page view, so moving down a list doesn't flood the buffer. */
  #hoverLogged = new Set();
  /** The map feature currently lit, so it can be cleared when the pointer moves on. */
  #litFeature = null;

  /**
   * @param {HTMLElement} sectionEl - The section element (rendered with `hidden`), holding a `.spotlight` root.
   * @param {object} [options] - Which page this is on.
   * @param {boolean} [options.crossCity=false] - True on /cities: rank every public deployment, and light the city's
   *                                              circle rather than a neighborhood polygon.
   */
  constructor(sectionEl, options = {}) {
    this.#section = sectionEl;
    this.#root = sectionEl.querySelector('.spotlight');
    this.#crossCity = Boolean(options.crossCity);

    // Unhide and hold the space with skeletons immediately, so the real lists swap in without a layout shift. The
    // section re-hides if the city turns out to have nothing ranked.
    this.#section.hidden = false;
    this.#root.appendChild(this.#buildSkeleton());

    // Don't hit the server until the visitor shows a sign of engagement, so crawlers and link-preview fetches don't
    // spend the query. The maps this hover-links to load on the same gate.
    util.onFirstInteractionOrIdle(() => this.#start());
  }

  /** Fetches both units, picks the one to open on, and renders — or hides the section if nothing is ranked. */
  async #start() {
    const [regions, streets] = await Promise.all([this.#fetchUnit('regions'), this.#fetchUnit('streets')]);
    this.#feeds = { regions, streets };

    const ranked = (feed) => (feed ? feed.qualifying : 0);
    if (ranked(regions) === 0 && ranked(streets) === 0) {
      this.#section.hidden = true;
      return;
    }

    // Streets qualify almost as soon as a city starts, so a young city opens on streets and switches to
    // neighborhoods once enough of them clear the completion floor. A city mapped as one neighborhood has no
    // interesting neighborhood list at all, so it opens on streets too.
    const neighborhoodsWorthOpening = ranked(regions) >= AccessScoreSpotlight.#LIST_SIZE && regions.total > 1;
    this.#unit = neighborhoodsWorthOpening || ranked(streets) === 0 ? 'regions' : 'streets';
    this.#render();
  }

  /**
   * Fetches one unit's feed.
   * @param {string} unit - 'regions' or 'streets'.
   * @returns {Promise<?SpotlightFeed>} The feed, or null if it could not be loaded.
   */
  async #fetchUnit(unit) {
    const scope = this.#crossCity ? '&scope=cities' : '';
    try {
      const response = await fetch(
        `/v3/api/accessScoreSpotlight?unit=${unit}&n=${AccessScoreSpotlight.#LIST_SIZE}${scope}`,
      );
      if (!response.ok) throw new Error(`spotlight fetch failed: ${response.status}`);
      return await response.json();
    } catch (e) {
      console.error(`Failed to load the AccessScore Spotlight (${unit})`, e);
      return null;
    }
  }

  /** Two columns of placeholder rows, drawn before the feed arrives. */
  #buildSkeleton() {
    const cols = document.createElement('div');
    cols.className = 'spotlight-cols';
    for (let c = 0; c < 2; c++) {
      const list = document.createElement('ol');
      list.className = 'spotlight-list';
      for (let i = 0; i < AccessScoreSpotlight.#SKELETON_ROWS; i++) {
        const row = document.createElement('li');
        row.className = 'spotlight-row spotlight-row--skeleton';
        list.appendChild(row);
      }
      cols.appendChild(list);
    }
    return cols;
  }

  /** Redraws the module for the currently selected unit. */
  #render() {
    const feed = this.#feeds[this.#unit];
    this.#clearHighlight();
    this.#root.replaceChildren();
    if (!feed) {
      this.#section.hidden = true;
      return;
    }

    this.#renderSubtitle(feed);

    const head = document.createElement('div');
    head.className = 'spotlight-head';
    head.appendChild(this.#buildUnitSwitch());
    this.#root.appendChild(head);

    const cols = document.createElement('div');
    cols.className = 'spotlight-cols';
    const ranked = feed.qualifying >= AccessScoreSpotlight.#LIST_SIZE;
    const oneRegion = this.#unit === 'regions' && feed.total === 1;

    // With a full set of ranked units the lists are a top and a bottom; below that there is only one list worth
    // showing, so the second column becomes the "help the next one across the line" ask.
    cols.appendChild(this.#buildColumn(
      ranked ? 'highest' : 'ranked-so-far',
      ranked ? 4 : 3,
      feed.top,
      'ranked',
    ));
    if (ranked) {
      cols.appendChild(this.#buildColumn('lowest', 0, feed.bottom, 'ranked'));
    } else if (!oneRegion && feed.nearest.length > 0) {
      cols.appendChild(this.#buildColumn('closest', 2, feed.nearest, 'pending'));
    } else {
      cols.classList.add('spotlight-cols--single');
    }
    this.#root.appendChild(cols);

    this.#root.appendChild(this.#buildNote(feed));
    if (!this.#crossCity) this.#root.appendChild(this.#buildCta());

    if (!this.#viewLogged) {
      this.#viewLogged = true;
      const count = this.#root.querySelectorAll('.spotlight-row').length;
      window.logWebpageActivity(`View_module=AccessScoreSpotlight_unit=${this.#unit}_count=${count}`);
    }
  }

  /**
   * Writes the section subtitle, which says what a score is and, when the city is short of data, how far along it is.
   * @param {SpotlightFeed} feed - The unit's feed.
   */
  #renderSubtitle(feed) {
    const subtitle = this.#section.querySelector('.spotlight-subtitle');
    if (!subtitle) return;
    let key = `common:access-score-spotlight.subtitle-${this.#unit}`;
    if (this.#unit === 'regions' && feed.total === 1) {
      key = 'common:access-score-spotlight.subtitle-one-region';
    } else if (this.#unit === 'regions' && feed.qualifying < AccessScoreSpotlight.#LIST_SIZE) {
      key = 'common:access-score-spotlight.subtitle-sparse';
    }
    // Both floors come from the feed: they are the backend's rules, and a copy here could disagree with the ranking
    // the very same response was built by.
    subtitle.textContent = i18next.t(key, {
      percent: Math.round(feed.min_completion * 100),
      qualifying: feed.qualifying,
      total: feed.total,
      minLength: util.distanceToString(feed.min_street_length_m),
    });
  }

  /** The Neighborhoods / Streets switch, as two toggle buttons rather than tabs: each redraws this same region. */
  #buildUnitSwitch() {
    const group = document.createElement('div');
    group.className = 'spotlight-units';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', i18next.t('common:access-score-spotlight.units-label'));
    for (const unit of ['regions', 'streets']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'spotlight-unit';
      button.textContent = i18next.t(`common:access-score-spotlight.unit-${unit}`);
      button.setAttribute('aria-pressed', String(unit === this.#unit));
      button.addEventListener('click', () => {
        if (this.#unit === unit) return;
        this.#unit = unit;
        window.logWebpageActivity(`Click_module=AccessScoreSpotlightUnit_unit=${unit}`);
        this.#render();
        this.#root.querySelector(`.spotlight-unit[aria-pressed="true"]`)?.focus();
      });
      group.appendChild(button);
    }
    return group;
  }

  /**
   * One list with its heading.
   * @param {string} key - The heading's i18n key under `access-score-spotlight.`.
   * @param {number} rampStop - Which score-ramp color the heading's dot takes, 0 (worst) to 4 (best).
   * @param {SpotlightRow[]} rows - The rows to list.
   * @param {string} kind - 'ranked' for a scored row, 'pending' for a "closest to being ranked" one.
   * @returns {HTMLElement}
   */
  #buildColumn(key, rampStop, rows, kind) {
    const column = document.createElement('div');
    const heading = document.createElement('div');
    heading.className = 'spotlight-col-heading';
    const dot = document.createElement('span');
    dot.className = 'spotlight-dot';
    dot.style.background = window.ScoreRamp.colors()[rampStop];
    heading.appendChild(dot);
    heading.appendChild(document.createTextNode(i18next.t(`common:access-score-spotlight.${key}`)));
    column.appendChild(heading);

    const list = document.createElement('ol');
    list.className = 'spotlight-list';
    list.setAttribute('aria-label', i18next.t(`common:access-score-spotlight.${key}`));
    rows.forEach((row, index) => list.appendChild(this.#buildRow(row, index + 1, kind)));
    column.appendChild(list);
    return column;
  }

  /**
   * One row: rank, the name (a link into the AccessScore tool), a bar on the score ramp, and the score.
   * @param {SpotlightRow} row - The row's data.
   * @param {number} position - Its place in its list, from 1.
   * @param {string} kind - 'ranked' or 'pending'.
   * @returns {HTMLElement}
   */
  #buildRow(row, position, kind) {
    const item = document.createElement('li');
    item.className = kind === 'pending' ? 'spotlight-row spotlight-row--pending' : 'spotlight-row';

    const rank = document.createElement('span');
    rank.className = 'spotlight-rank';
    // A pending row has no rank -- it is ordered by how far along it is, which the bar already shows.
    rank.textContent = kind === 'pending' ? '·' : String(position);
    rank.setAttribute('aria-hidden', 'true');
    item.appendChild(rank);
    item.appendChild(this.#buildName(row, kind));
    item.appendChild(this.#buildBar(row, kind));
    item.appendChild(kind === 'pending' ? this.#buildExplore(row) : this.#buildScore(row));

    // Focus behaves like hover, so a keyboard reader sees the same map highlight a mouse user does. The listeners go
    // on the row rather than the link, so the whole row lights up either way.
    const on = () => this.#highlight(item, row, true);
    const off = () => this.#highlight(item, row, false);
    item.addEventListener('mouseenter', on);
    item.addEventListener('mouseleave', off);
    item.addEventListener('focusin', on);
    item.addEventListener('focusout', off);
    return item;
  }

  /** The name cell: a link into the AccessScore tool, plus a second line naming the neighborhood, length, or city. */
  #buildName(row, kind) {
    const cell = document.createElement('span');
    cell.className = 'spotlight-name';
    const label = this.#unit === 'streets'
      ? row.name || i18next.t('common:access-score-spotlight.unnamed')
      : row.name;

    if (kind === 'pending') {
      // Nothing to open in the tool yet, so the name is plain text and the row's call to action is the button.
      const name = document.createElement('span');
      name.className = 'spotlight-name-link';
      name.textContent = label;
      cell.appendChild(name);
    } else {
      const link = document.createElement('a');
      link.className = 'spotlight-name-link';
      link.href = this.#toolHref(row);
      link.textContent = label;
      link.addEventListener('click', () => {
        const id = this.#unit === 'streets' ? row.street_edge_id : row.region_id;
        const city = row.city_id ? `_city=${row.city_id}` : '';
        window.logWebpageActivity(`Click_module=AccessScoreSpotlight_unit=${this.#unit}_id=${id}${city}`);
      });
      cell.appendChild(link);
    }

    const sub = this.#subLine(row, kind);
    if (sub) cell.appendChild(sub);
    return cell;
  }

  /**
   * The row's second line, which differs per page and unit: a street's neighborhood and length, a pending
   * neighborhood's progress, or — across cities — a link to the city the row came from.
   * @returns {?HTMLElement}
   */
  #subLine(row, kind) {
    if (row.city_url) {
      const link = document.createElement('a');
      link.className = 'spotlight-sub-link';
      link.href = row.city_url;
      link.textContent = this.#unit === 'streets'
        ? i18next.t('common:access-score-spotlight.street-in-city', { region: row.region_name, city: row.city_name })
        : row.city_name;
      return link;
    }
    const sub = document.createElement('span');
    sub.className = 'spotlight-sub';
    if (kind === 'pending') {
      sub.textContent = i18next.t('common:access-score-spotlight.percent-explored',
        { percent: Math.round(row.completion_rate * 100) });
    } else if (this.#unit === 'streets') {
      // Length matters here in a way it does not for a neighborhood: it says how much sidewalk the score speaks for.
      sub.textContent = i18next.t('common:access-score-spotlight.street-sub',
        { region: row.region_name, length: util.longDistanceToString(row.length_m / 1000, 1) });
    } else {
      return null;
    }
    return sub;
  }

  /** The bar: the score on the shared AccessScore ramp, or a dashed meter of how explored a pending row is. */
  #buildBar(row, kind) {
    const track = document.createElement('span');
    track.className = 'spotlight-track';
    // The value travels as text in the score column and the row's accessible name, so the bar is decoration.
    track.setAttribute('aria-hidden', 'true');
    const bar = document.createElement('span');
    bar.className = 'spotlight-bar';
    const fraction = kind === 'pending' ? row.completion_rate : row.score;
    bar.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    // A pending row's fill is the dashed pattern from the stylesheet, not a score color it does not have.
    if (kind !== 'pending') bar.style.background = window.ScoreRamp.at(row.score);
    track.appendChild(bar);
    return track;
  }

  /** The score, on the 0–100 scale the AccessScore tool prints. */
  #buildScore(row) {
    const score = document.createElement('span');
    score.className = 'spotlight-score';
    score.textContent = (row.score * 100).toFixed(1);
    return score;
  }

  /** The pending row's call to action: start a mission in that neighborhood, as a choropleth click does. */
  #buildExplore(row) {
    const link = document.createElement('a');
    link.className = 'spotlight-explore';
    link.href = `/explore?regionId=${row.region_id}`;
    link.textContent = i18next.t('common:access-score-spotlight.explore');
    link.setAttribute('aria-label', i18next.t('common:access-score-spotlight.explore-region', { name: row.name }));
    link.addEventListener('click', () => {
      window.logWebpageActivity(`Click_module=AccessScoreSpotlightExplore_regionId=${row.region_id}`);
    });
    return link;
  }

  /** The count line and the "Updated nightly" note, whose (i) carries the explanation and the last run's time. */
  #buildNote(feed) {
    const note = document.createElement('div');
    note.className = 'spotlight-note';

    const counts = document.createElement('span');
    counts.textContent = i18next.t(`common:access-score-spotlight.count-${this.#unit}`, {
      qualifying: feed.qualifying, total: feed.total, percent: Math.round(feed.min_completion * 100),
    });
    note.appendChild(counts);

    const updated = document.createElement('span');
    updated.className = 'spotlight-updated';
    updated.appendChild(document.createTextNode(i18next.t('common:access-score-spotlight.updated-nightly')));

    const tip = document.createElement('span');
    tip.className = 'spotlight-tip';
    tip.setAttribute('role', 'tooltip');
    tip.id = `spotlight-tip-${this.#crossCity ? 'cities' : 'city'}`;
    tip.hidden = true;
    const when = feed.computed_at
      ? ` ${i18next.t('common:access-score-spotlight.updated-last',
        { date: new Date(feed.computed_at).toLocaleString(i18next.language) })}`
      : '';
    tip.textContent = `${i18next.t('common:access-score-spotlight.updated-info')}${when}`;

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'spotlight-info';
    info.textContent = 'i';
    info.setAttribute('aria-label', i18next.t('common:access-score-spotlight.updated-nightly'));
    info.setAttribute('aria-describedby', tip.id);
    const show = () => {
      tip.hidden = false;
    };
    const hide = () => {
      tip.hidden = true;
    };
    info.addEventListener('mouseenter', show);
    info.addEventListener('mouseleave', hide);
    info.addEventListener('focus', show);
    info.addEventListener('blur', hide);
    info.addEventListener('click', () => {
      tip.hidden = !tip.hidden;
    });
    // WCAG 1.4.13: a tooltip a pointer or keyboard revealed must be dismissable without moving either.
    updated.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !tip.hidden) hide();
    });
    updated.appendChild(info);
    updated.appendChild(tip);
    note.appendChild(updated);
    return note;
  }

  /** "See every neighborhood / street in the AccessScore tool", which /cities has no single destination for. */
  #buildCta() {
    const wrap = document.createElement('div');
    wrap.className = 'spotlight-cta';
    const link = document.createElement('a');
    link.className = 'button-ps button--secondary button--small';
    link.href = `/accessScore?unit=${this.#unit}`;
    link.textContent = i18next.t(`common:access-score-spotlight.cta-${this.#unit}`);
    link.addEventListener('click', () => {
      window.logWebpageActivity(`Click_module=AccessScoreSpotlightTool_unit=${this.#unit}`);
    });
    wrap.appendChild(link);
    return wrap;
  }

  /**
   * Where a row's name link goes: the AccessScore tool, opened on that unit. Across cities that is the row's own
   * deployment, since a neighborhood only exists in its own city's tool.
   * @param {SpotlightRow} row - The row.
   * @returns {string}
   */
  #toolHref(row) {
    const id = this.#unit === 'streets' ? row.street_edge_id : row.region_id;
    const base = row.city_url ? row.city_url.replace(/\/$/, '') : '';
    return `${base}/accessScore?unit=${this.#unit}&sel=${id}`;
  }

  /**
   * Lights (or clears) the row and the map feature it stands for. The map never moves: a fly on every hover is
   * nauseating in a list of ten, and the point is to show where a name is, not to go there.
   *
   * @param {HTMLElement} item - The row element, which takes the shared `.highlighted` style.
   * @param {SpotlightRow} row - The hovered or focused row's data.
   * @param {boolean} on - Whether to light it or clear it.
   */
  #highlight(item, row, on) {
    this.#clearHighlight();
    if (!on) return;
    item.classList.add('highlighted');

    // A street row lights its neighborhood: the choropleth draws no streets, so that is the nearest true answer.
    const feature = this.#crossCity
      ? { source: AccessScoreSpotlight.#CITY_SOURCE, id: row.city_id }
      : { source: AccessScoreSpotlight.#REGION_SOURCE, id: row.region_id };
    if (feature.id === undefined || feature.id === null) return;
    if (this.#setFeatureState(feature, true)) this.#litFeature = feature;

    const id = this.#unit === 'streets' ? row.street_edge_id : row.region_id;
    if (this.#hoverLogged.has(`${this.#unit}:${id}`)) return;
    this.#hoverLogged.add(`${this.#unit}:${id}`);
    window.logWebpageActivity(`Hover_module=AccessScoreSpotlight_unit=${this.#unit}_id=${id}`);
  }

  /** Clears whatever map feature this module last lit, and the row highlight that went with it. */
  #clearHighlight() {
    this.#root.querySelectorAll('.spotlight-row.highlighted')
      .forEach((row) => row.classList.remove('highlighted'));
    if (this.#litFeature) {
      this.#setFeatureState(this.#litFeature, false);
      this.#litFeature = null;
    }
  }

  /**
   * Sets a map feature's `hover` state, the same one the maps' own pointer handlers use.
   *
   * @param {{source: string, id: (number|string)}} feature - The source and feature id to light.
   * @param {boolean} hover - Whether it is lit.
   * @returns {boolean} Whether the map was there to take it; false while the map stack is still loading.
   */
  #setFeatureState(feature, hover) {
    const map = this.#crossCity ? window.citiesMap : window.choropleth;
    // The map stack loads on the same first-interaction gate as this module, so it is routinely not there yet; a
    // list that lights nothing for a second is fine, and a thrown error in a hover handler is not.
    if (!map || typeof map.getSource !== 'function' || !map.getSource(feature.source)) return false;
    try {
      map.setFeatureState({ source: feature.source, id: feature.id }, { hover });
      return true;
    } catch {
      // A source that exists but has not finished loading its data throws here; the next hover will find it ready.
      return false;
    }
  }
}
