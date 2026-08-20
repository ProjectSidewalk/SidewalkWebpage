/**
 * CrossCityStats — the "Cities you've mapped" section on the user dashboard (#4496).
 *
 * Every other number on the dashboard is scoped to the deployment being viewed, but accounts are shared across all
 * Project Sidewalk cities, so a mapper who has worked in more than one has no way to see their real totals. This
 * fetches /userapi/crossCityStats and renders the roll-up band, a per-city table with deep links, a world map of the
 * cities they've worked in, and a cross-city trophy.
 *
 * The section starts hidden and stays that way when the breakdown can't be computed, so a failed fan-out costs the
 * mapper a section rather than a wrong answer. For someone who has only mapped one city it renders that single row
 * plus a nudge toward the other deployments — the section is discovery for them, not a scoreboard.
 */
class CrossCityStats {
  #section;
  #currentCityName;
  #mapboxToken;

  /**
   * @param {HTMLElement} section - The #ud-cities-section element.
   * @param {Object} opts
   * @param {string} opts.currentCityName - Display name of the deployment being viewed.
   * @param {string} [opts.mapboxApiKey] - Mapbox token; without it the map is skipped and the rest still renders.
   */
  constructor(section, opts) {
    this.#section = section;
    this.#currentCityName = opts.currentCityName || '';
    this.#mapboxToken = opts.mapboxApiKey || '';
  }

  /** Fetches the breakdown and renders the section, leaving it hidden on any failure. */
  async render() {
    let data;
    try {
      const res = await fetch('/userapi/crossCityStats', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (e) {
      console.error('Cross-city stats failed to load; hiding the section', e);
      return;
    }
    // The backend says "unavailable" rather than sending zeros, so an empty band never reads as "you did nothing".
    if (data.unavailable) return;

    const cities = Array.isArray(data.cities) ? data.cities : [];
    this.#section.hidden = false;
    // The section was hidden when the shell built the "On this page" list, so it has to ask for a rebuild now that
    // it is real. A section that never unhides simply never appears there.
    window.adminShell?.refreshTableOfContents();
    this.#renderIntro(cities, data);
    this.#renderTable(cities, data.distance_unit);

    if (cities.length >= 2) {
      this.#renderBand(cities.length, data);
      this.#renderFootnote(cities);
      this.#renderTrophy(cities.length);
      await this.#renderMap(cities);
    } else {
      this.#renderNudge(cities, data.public_city_count);
    }
  }

  // --- Sections ---------------------------------------------------------------------------------------------------

  /** Intro line: a roll-up sentence for a multi-city mapper, an invitation for everyone else. */
  #renderIntro(cities, data) {
    const intro = this.#section.querySelector('#ud-cities-intro');
    if (!intro) return;
    if (cities.length >= 2) {
      intro.textContent = i18next.t('dashboard:cities.intro', {
        cities: CrossCityStats.#num(cities.length),
        labels: CrossCityStats.#num(data.total_labels),
      });
    } else {
      intro.textContent = i18next.t('dashboard:cities.intro-single', { city: this.#cityHereName(cities) });
    }
  }

  /** Fills the shared community band with the mapper's own cross-city totals. */
  #renderBand(cityCount, data) {
    this.#setText('ud-cities-total-cities', CrossCityStats.#num(cityCount));
    this.#setText('ud-cities-total-labels', CrossCityStats.#num(data.total_labels));
    this.#setText('ud-cities-total-validations', CrossCityStats.#num(data.total_validations));
    this.#setText('ud-cities-total-distance', CrossCityStats.#dist(data.total_distance, data.distance_unit));
    const band = this.#section.querySelector('#ud-cities-band');
    if (band) band.hidden = false;
  }

  /**
   * Renders the per-city table. Built as a table rather than cards because every row carries the same five numbers
   * and the point is comparing them down a column.
   *
   * @param {Array<Object>} cities - Per-city rows from the endpoint, most labels first.
   * @param {string} unit - Distance abbreviation for this viewer ("km" / "mi").
   */
  #renderTable(cities, unit) {
    const holder = this.#section.querySelector('#ud-cities-table-holder');
    if (!holder) return;
    holder.replaceChildren();
    if (!cities.length) return;

    const rows = cities.map((c) => {
      const name = CrossCityStats.#esc(c.city_name);
      // A city that isn't publicly launched still shows the mapper's own numbers, but we don't publish its URL.
      const nameCell = c.linkable && c.city_url
        ? `<a href="${CrossCityStats.#esc(c.city_url)}/dashboard">${name}</a>`
        : name;
      const here = c.is_current_city
        ? `<span class="ud-cities-here">${CrossCityStats.#esc(i18next.t('dashboard:cities.you-are-here'))}</span>`
        : '';
      return `
        <tr${c.is_current_city ? ' class="ud-cities-current"' : ''}>
          <th scope="row">${nameCell}${here}</th>
          <td>${CrossCityStats.#num(c.labels)}</td>
          <td>${CrossCityStats.#num(c.validations)}</td>
          <td>${CrossCityStats.#num(c.missions)}</td>
          <td>${CrossCityStats.#esc(CrossCityStats.#dist(c.distance, unit))}</td>
          <td>${CrossCityStats.#esc(CrossCityStats.#lastActive(c.last_activity))}</td>
        </tr>`;
    }).join('');

    // Reuses the shell's shared table styling (and its responsive horizontal scroll) rather than a private one.
    holder.innerHTML = `
      <div class="coverage-table-wrap ud-cities-table-wrap">
      <table class="coverage-table ud-cities-table">
        <thead>
          <tr>
            <th scope="col">${CrossCityStats.#esc(i18next.t('dashboard:cities.col-city'))}</th>
            <th scope="col">${CrossCityStats.#esc(i18next.t('dashboard:cities.col-labels'))}</th>
            <th scope="col">${CrossCityStats.#esc(i18next.t('dashboard:cities.col-validations'))}</th>
            <th scope="col">${CrossCityStats.#esc(i18next.t('dashboard:cities.col-missions'))}</th>
            <th scope="col">${CrossCityStats.#esc(i18next.t('dashboard:cities.col-distance'))}</th>
            <th scope="col">${CrossCityStats.#esc(i18next.t('dashboard:cities.col-last-active'))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </div>`;
  }

  /**
   * Notes that distance outside this city comes from the nightly recompute.
   *
   * Only the current city's distance is measured live, so a mapper who audited elsewhere today would otherwise see a
   * number that looks stale for no stated reason.
   */
  #renderFootnote(cities) {
    const note = this.#section.querySelector('#ud-cities-footnote');
    if (!note || !cities.some((c) => !c.live_distance)) return;
    note.textContent = i18next.t('dashboard:cities.distance-note', { city: this.#cityHereName(cities) });
    note.hidden = false;
  }

  /** Invites a mapper who has only worked in one city (or none yet) to try another deployment. */
  #renderNudge(cities, publicCityCount) {
    const nudge = this.#section.querySelector('#ud-cities-nudge');
    if (!nudge) return;
    const key = cities.length ? 'dashboard:cities.nudge' : 'dashboard:cities.nudge-empty';
    nudge.innerHTML = `${CrossCityStats.#esc(i18next.t(key, { cities: CrossCityStats.#num(publicCityCount) }))} `
      + `<a href="/cities">${CrossCityStats.#esc(i18next.t('dashboard:cities.nudge-link'))}</a>`;
    nudge.hidden = false;
  }

  /**
   * Adds a cross-city trophy to the trophy case.
   *
   * Injected here rather than server-rendered with the other trophies because the count it needs comes from the
   * cross-schema fan-out, and the dashboard deliberately doesn't wait on that to render.
   *
   * @param {number} cityCount - How many cities the mapper has contributed to (always ≥ 2 when this is called).
   */
  #renderTrophy(cityCount) {
    const grid = document.querySelector('.ud-trophy-case');
    if (!grid) return;
    const card = document.createElement('div');
    card.className = 'ud-trophy ud-trophy-globetrotter';
    // Trophy titles are English brand names by design (#4475); only the sub line localizes.
    card.innerHTML = `
      <span class="ud-trophy-medal" aria-hidden="true">🌍</span>
      <span class="ud-trophy-title">Globetrotter</span>
      <span class="ud-trophy-sub">${CrossCityStats.#esc(i18next.t('dashboard:cities.trophy-sub',
        { cities: CrossCityStats.#num(cityCount) }))}</span>`;
    grid.prepend(card);
    const none = document.getElementById('ud-trophy-none');
    if (none) none.hidden = true;
  }

  /**
   * Draws a world map with one circle per city the mapper has worked in, area proportional to their labels there.
   *
   * Coordinates come from /v3/api/cities rather than being shipped with the stats, so city geography has one source.
   * Skipped silently when Mapbox or the coordinates are unavailable — the table above already carries the numbers.
   *
   * @param {Array<Object>} cities - Per-city rows from the endpoint.
   */
  async #renderMap(cities) {
    const host = this.#section.querySelector('#ud-cities-map');
    if (!host || typeof mapboxgl === 'undefined' || !this.#mapboxToken) return;

    let geo;
    try {
      const res = await fetch('/v3/api/cities', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      geo = await res.json();
    } catch (e) {
      console.error('City coordinates failed to load; skipping the cross-city map', e);
      return;
    }
    if (!Array.isArray(geo.cities)) return;

    const statsByCity = new Map(cities.map((c) => [c.city_id, c]));
    const maxLabels = Math.max(1, ...cities.map((c) => c.labels || 0));
    const features = [];
    for (const g of geo.cities) {
      const stat = statsByCity.get(g.city_id);
      if (!stat) continue;
      if (g.center_lat === null || g.center_lat === undefined) continue;
      if (g.center_lng === null || g.center_lng === undefined) continue;
      const n = stat.labels || 0;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [g.center_lng, g.center_lat] },
        properties: {
          // sqrt scaling so circle AREA (not radius) tracks the label count — perceptually honest.
          radius: n > 0 ? 6 + (Math.sqrt(n) / Math.sqrt(maxLabels)) * 18 : 6,
          popup: `<div class="coverage-popup-name">${CrossCityStats.#esc(stat.city_name)}</div>`
            + `<div>${CrossCityStats.#esc(i18next.t('dashboard:cities.map-popup',
              { labels: CrossCityStats.#num(n), validations: CrossCityStats.#num(stat.validations || 0) }))}</div>`,
        },
      });
    }
    if (!features.length) return;

    host.hidden = false;
    const caption = this.#section.querySelector('#ud-cities-map-caption');
    if (caption) caption.hidden = false;
    mapboxgl.accessToken = this.#mapboxToken;
    const map = new mapboxgl.Map({
      container: host,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-30, 28],
      zoom: 0.8,
      minZoom: 0.5,
      projection: 'mercator',
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'coverage-popup' });

    map.on('load', () => {
      map.addSource('ud-cities', { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: 'ud-cities-circles',
        type: 'circle',
        source: 'ud-cities',
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': '#78B0EA',
          'circle-opacity': 0.75,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      });
      const showPopup = (e) => {
        map.getCanvas().style.cursor = 'pointer';
        popup.setLngLat(e.features[0].geometry.coordinates).setHTML(e.features[0].properties.popup).addTo(map);
      };
      map.on('mouseenter', 'ud-cities-circles', showPopup);
      map.on('mousemove', 'ud-cities-circles', showPopup);
      map.on('mouseleave', 'ud-cities-circles', () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
      });
      // The bounds cover only cities this mapper worked in, so the view opens on their own footprint.
      const bounds = features.reduce((b, f) => b.extend(f.geometry.coordinates),
        new mapboxgl.LngLatBounds(features[0].geometry.coordinates, features[0].geometry.coordinates));
      map.fitBounds(bounds, { padding: 60, maxZoom: 6, duration: 0 });
    });
  }

  // --- Helpers ----------------------------------------------------------------------------------------------------

  /**
   * Names the deployment being viewed, preferring the marked row over the config-derived name handed in — the two can
   * disagree on a misconfigured box, and the table is what the reader sees.
   *
   * @param {Array<Object>} cities - Per-city rows from the endpoint.
   * @returns {string} The current city's display name.
   */
  #cityHereName(cities) {
    return cities.find((c) => c.is_current_city)?.city_name || this.#currentCityName;
  }

  #setText(id, value) {
    const el = this.#section.querySelector(`#${id}`);
    if (el) el.textContent = value;
  }

  /** Thousands-separated integer in the viewer's locale. */
  static #num(n) {
    return Number(n || 0).toLocaleString();
  }

  /**
   * Distance with one decimal, floored — matching the hero KPI's formatting so the current city's row and the tile
   * above it never differ in the last digit.
   */
  static #dist(value, unit) {
    return `${util.math.floorTo(Number(value || 0), 1).toFixed(1)} ${unit || ''}`.trim();
  }

  /** Localized month-and-year for a last-labeled timestamp, or a dash when the mapper only validated there. */
  static #lastActive(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString(i18next.language, { year: 'numeric', month: 'short' });
  }

  static #esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
  }
}
