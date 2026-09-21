/**
 * Street Grade Map Preview Generator (#5223).
 *
 * Renders a sample region's streets colored by their steepest grade (`max_grade`) in the AccessScore tool's slope
 * classes, so the docs show the same map a reader of `/accessScore` sees. Hovering a street opens a popup with its
 * elevation profile from /v3/api/streetGrade, drawn by the tool's own chart; clicking pins that popup so its legend
 * toggles and keyboard slider can be used, which a hover popup would take away as the pointer moved to them.
 *
 * The class breaks come from /v3/api/accessScoreConfig (`grade.map_class_breaks`), never from a literal here.
 *
 * @requires A DOM element with id 'street-grade-preview'
 * @requires mapbox-gl, js/api-docs/apiDocsMap.js, js/common/AccessScoreGradeRamp.js,
 *   js/common/AccessScoreElevationProfile.js, js/common/utilities.js (util.escapeHTML), and the `accessscore` i18next
 *   namespace (the chart's strings)
 */

/**
 * @typedef {object} StreetGradeProperties - The fields of an /v3/api/accessScoreStreets feature this preview reads.
 * @property {number} street_edge_id - The street.
 * @property {?string} street_name - Its OSM name; null for an unnamed way.
 * @property {?number} max_grade - Its steepest grade; null where it has none.
 * @property {?number} mean_grade - Its mean grade; null where it has none.
 * @property {?string} grade_quality - How its profile was obtained; null where it has not been sampled.
 *
 * @typedef {object} StreetGradeFeature
 * @property {{coordinates: Array<Array<number>>}} geometry - The street's LineString.
 * @property {StreetGradeProperties} properties - Its fields.
 */

(function () {
  const STREET_SOURCE = 'street-grade-streets';
  const STREET_LAYER = 'street-grade-lines';

  /** Long enough that sweeping the pointer across a block does not fetch a profile for every street it crosses. */
  const HOVER_DELAY_MS = 150;

  let config = {
    apiBaseUrl: '/v3/api',
    mainContainerId: 'street-grade-preview',
    mapboxApiKey: '',
  };

  const NONE_COLOR = ApiDocsTheme.color('--color-neutral-600'); // Streets with no grade: structures, gaps, unsampled.

  // "No grade" coalesced to a negative, which AccessScoreGradeRamp.expression colors with the fallback.
  const GRADE = ['coalesce', ['get', 'max_grade'], -1];
  const NO_GRADE = ['<', GRADE, 0];

  /** Each street's /v3/api/streetGrade answer, as a promise, so hovering a street again never refetches it. */
  const profiles = new Map();

  /**
   * A grade as a percentage, in the docs' own words.
   * @param {number} grade - A grade as a fraction.
   * @returns {string}
   */
  const percent = (grade) => AccessScoreGradeRamp.percent(grade);

  /**
   * An elevation or length in the reader's units, through the tool's own format.
   * @param {number} meters - The value in meters.
   * @returns {string} Plain text.
   */
  const elevation = (meters) => i18next.t('accessscore:elevation', { meters, interpolation: { escapeValue: false } });

  window.StreetGradePreview = {
    /** Apply caller config overrides. */
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /** Fetch the data and render the map (or a friendly message on failure). */
    async init() {
      const container = document.getElementById(config.mainContainerId);
      if (!container) {
        console.error('Street grade preview container not found.');
        return;
      }

      const loading = document.createElement('div');
      loading.className = 'loading-message';
      loading.textContent = 'Loading street grade data...';
      container.appendChild(loading);

      try {
        // One region keeps the preview legible and the response small, as on the AccessScore: Streets page.
        const [regionId, grade] = await Promise.all([this.fetchSampleRegionId(), this.fetchGradeConfig()]);
        const streets = await this.fetchStreets(regionId);
        container.innerHTML = '';
        await this.renderMap(container, streets, grade);
      } catch (error) {
        console.error('Error rendering street grade preview:', error);
        container.innerHTML = '<div class="map-message" role="alert">Unable to load street grade data '
          + 'for the preview.</div>';
      }
    },

    /** Pick a sample region (the one with the most labels) to keep the preview focused. Null = whole city. */
    fetchSampleRegionId() {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}/regionWithMostLabels`)
        .then((region) => (region ? region.properties.region_id : null))
        .catch(() => null);
    },

    /**
     * The grades the slope classes break at and the elevation models to credit, from the backend.
     * @returns {Promise<{breaks: number[], sources: Array<{credit: string, url: ?string}>}>} Ascending breaks, and
     *   the city's models most streets first; both empty in a city with no grades.
     */
    fetchGradeConfig() {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}/accessScoreConfig`)
        .then((cfg) => ({ breaks: cfg.grade?.map_class_breaks ?? [], sources: cfg.grade?.sources ?? [] }));
    },

    /**
     * The elevation models' credit line for the map's attribution control, each linked to its publisher where it has
     * a page, as the AccessScore tool's map credits them. The names and URLs are the backend's, and text all the same,
     * so they are escaped.
     * @param {Array<{credit: string, url: ?string}>} sources - The city's elevation models.
     * @returns {string} Markup; empty where there is nothing to credit.
     */
    attributionHtml(sources) {
      return sources.map((source) => {
        const credit = util.escapeHTML(source.credit);
        // Escaping keeps a URL inside its attribute; only the scheme keeps it from being a `javascript:` one.
        return /^https:\/\//i.test(source.url ?? '')
          ? `<a href="${util.escapeHTML(source.url)}" target="_blank" rel="noopener">${credit}</a>`
          : credit;
      }).join(' | ');
    },

    /** Fetch the streets (optionally scoped to a region) with their grade fields, as a GeoJSON FeatureCollection. */
    fetchStreets(regionId) {
      const regionParam = regionId ? `&regionId=${regionId}` : '';
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}/accessScoreStreets?inline=true${regionParam}`);
    },

    /**
     * Build the map, draw the streets in their grade classes, and add the legend.
     * @param {HTMLElement} container - The preview's container.
     * @param {{features?: Array<{properties: {max_grade: ?number}}>}} streets - The streets, as GeoJSON.
     * @param {{breaks: number[], sources: Array<{credit: string, url: ?string}>}} grade - The classes' breaks, and
     *   the elevation models to credit.
     */
    async renderMap(container, streets, { breaks, sources }) {
      const features = streets.features || [];

      const mapElement = document.createElement('div');
      mapElement.id = 'street-grade-map';
      container.appendChild(mapElement);

      const bounds = features.length ? featureCollectionBounds({ type: 'FeatureCollection', features }) : null;
      const map = await ApiDocsMap.create({
        container: mapElement,
        mapboxApiKey: config.mapboxApiKey,
        ...(bounds ? { bounds } : { center: [0, 0], zoom: 1 }),
      });

      const graded = features.filter((f) => typeof f.properties.max_grade === 'number').length;
      if (!features.length || !breaks.length || !graded) {
        this.addNoDataMessage(map, features.length
          ? 'This city\'s street grades have not been loaded yet.'
          : 'No streets found for this city.');
        return;
      }

      // promoteId lifts street_edge_id into the feature id that setFeatureState needs for the hover styling below.
      // The credit rides on the source, so Mapbox's attribution control shows it beside the basemap's own.
      const attribution = this.attributionHtml(sources);
      map.addSource(STREET_SOURCE, {
        type: 'geojson', data: streets, promoteId: 'street_edge_id', ...(attribution ? { attribution } : {}),
      });
      map.addLayer({
        id: STREET_LAYER,
        type: 'line',
        source: STREET_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': AccessScoreGradeRamp.expression(GRADE, breaks, { noneColor: NONE_COLOR }),
          'line-width': ApiDocsMap.whenHovered(7, ['case', NO_GRADE, 2, 4]),
          'line-opacity': ApiDocsMap.whenHovered(1, ['case', NO_GRADE, 0.5, 0.9]),
        },
      });
      ApiDocsMap.addHoverState(map, STREET_LAYER, STREET_SOURCE);
      const pin = this.addStreetPopups(map, breaks);
      this.addStreetPicker(container, features, pin);

      const countChip = ApiDocsMap.addOverlay(map, 'top-right', 'map-chip');
      countChip.textContent = `${features.length} street${features.length === 1 ? '' : 's'}`;

      // Steepest first, as the tool's legend and the chart's own list read.
      const items = AccessScoreGradeRamp.classes(breaks)
        .map((c, i) => ({ color: c.color, label: this.classLabel(i, breaks) }))
        .reverse();
      items.push({ color: NONE_COLOR, label: 'No grade (bridge, tunnel, or no data)' });
      const legend = ApiDocsMap.addOverlay(map, 'bottom-left', 'map-legend');
      ApiDocsMap.renderSwatchLegend(legend, 'Steepest grade (max_grade)', items,
        'Point at a street for its elevation profile; click or tap to pin it, or pick one below the map.');
    },

    /**
     * A slope class's range, in the chart legend's words.
     * @param {number} i - The class index.
     * @param {number[]} breaks - The slope classes' breaks.
     * @returns {string} Escaped for markup.
     */
    classLabel(i, breaks) {
      if (i === 0) return i18next.t('accessscore:grade-class-under', { to: percent(breaks[0]) });
      if (i === breaks.length) return i18next.t('accessscore:grade-class-over', { from: percent(breaks[i - 1]) });
      return i18next.t('accessscore:grade-class-between', { from: percent(breaks[i - 1]), to: percent(breaks[i]) });
    },

    /**
     * Hover previews a street's popup and click pins it. A pinned popup stays through further hovering until it is
     * closed or another street is clicked, so the chart inside it can be used.
     * @param {mapboxgl.Map} map - The map.
     * @param {number[]} breaks - The slope classes' breaks.
     * @returns {(feature: {id: number, properties: StreetGradeProperties}, lngLat: Array<number>) => void} Pins a
     *   street's popup
     *   from outside the map, moving focus into it, for a reader with no pointer.
     */
    addStreetPopups(map, breaks) {
      let popup = null;
      let pinned = false;
      let shownId = null;
      let timer = null;

      const close = () => {
        if (popup) popup.remove();
        popup = null;
        shownId = null;
      };
      const show = (feature, lngLat, pin, focus = false) => {
        close();
        pinned = pin;
        shownId = feature.id;
        const opened = ApiDocsMap.popup(map, lngLat, this.popupHtml(feature.properties, pin), {
          modifier: 'map-popup--profile',
          closeButton: pin,
          // A hover preview closes as the pointer leaves the street; a pinned one on a click anywhere else.
          closeOnClick: pin,
          // Opened from the keyboard, focus follows it in, as it would into a dialog.
          focusAfterOpen: focus,
        });
        opened.on('close', () => {
          if (popup !== opened) return;
          popup = null;
          shownId = null;
          pinned = false;
        });
        popup = opened;
        const isCurrent = () => popup === opened;
        this.loadProfile(feature.properties.street_edge_id, opened, breaks, isCurrent)
          .then(() => {
            if (isCurrent()) this.settle(map, opened, pin);
          });
      };

      map.on('mousemove', STREET_LAYER, (e) => {
        if (pinned || !e.features.length || e.features[0].id === shownId) return;
        clearTimeout(timer);
        const [feature] = e.features;
        const { lngLat } = e;
        timer = setTimeout(() => show(feature, lngLat, false), HOVER_DELAY_MS);
      });
      map.on('mouseleave', STREET_LAYER, () => {
        clearTimeout(timer);
        if (!pinned) close();
      });
      map.on('click', STREET_LAYER, (e) => {
        clearTimeout(timer);
        if (e.features.length) show(e.features[0], e.lngLat, true);
      });
      return (feature, lngLat) => {
        clearTimeout(timer);
        show(feature, lngLat, true, true);
      };
    },

    /**
     * A select under the map listing the region's graded streets, steepest first, that pins the chosen street's
     * popup. The map answers only a pointer, so this is how a keyboard or screen-reader user reaches a profile.
     * @param {HTMLElement} container - The preview's container, which the picker follows.
     * @param {StreetGradeFeature[]} features - The streets.
     * @param {(feature: {id: number, properties: StreetGradeProperties}, lngLat: Array<number>) => void} pin - Pins
     *   a street's popup.
     */
    addStreetPicker(container, features, pin) {
      const graded = features.filter((f) => typeof f.properties.max_grade === 'number')
        .sort((a, b) => b.properties.max_grade - a.properties.max_grade);
      const options = graded.map((f) => {
        const p = f.properties;
        // The name is the OSM way's `name` tag, which anyone can edit, so it is never trusted into markup.
        const name = p.street_name ? util.escapeHTML(p.street_name) : 'Unnamed street';
        const label = `${name} · ${percent(p.max_grade)} (street ${p.street_edge_id})`;
        return `<option value="${p.street_edge_id}">${label}</option>`;
      }).join('');
      const picker = document.createElement('div');
      picker.className = 'street-grade-picker';
      picker.innerHTML = `
        <label for="street-grade-picker-select">Show a street's elevation profile</label>
        <select id="street-grade-picker-select" class="ps-select">
          <option value="">Steepest first…</option>
          ${options}
        </select>`;
      container.after(picker);
      const byId = new Map(graded.map((f) => [f.properties.street_edge_id, f]));
      picker.querySelector('select').addEventListener('change', (e) => {
        const feature = byId.get(Number(/** @type {HTMLSelectElement} */ (e.target).value));
        if (!feature) return;
        // The popup sits at the street's middle vertex, which lies on the street, unlike a centroid on a curve.
        const coordinates = feature.geometry.coordinates;
        pin({ id: feature.properties.street_edge_id, properties: feature.properties },
          coordinates[Math.floor(coordinates.length / 2)]);
      });
    },

    /**
     * Re-seats a popup once its content has its final size. Mapbox picks a popup's side of the street from its size
     * when placed and looks again only when the map moves, so a popup opened above the street with one loading line
     * would grow off the top of the frame as the chart arrived, then flip below it on the next repaint.
     *
     * A pinned popup is also panned fully into the frame: it is there to be used, and its close button would
     * otherwise be focusable while clipped out of sight. A hover preview is not, since moving the map under the
     * pointer would take the street away from it; it keeps whichever side has more room.
     * @param {mapboxgl.Map} map - The map.
     * @param {mapboxgl.Popup} popup - The popup, still open.
     * @param {boolean} pinned - Whether it was opened by a click.
     */
    settle(map, popup, pinned) {
      popup.setLngLat(popup.getLngLat());
      if (!pinned) return;
      const frame = map.getContainer().getBoundingClientRect();
      const box = popup.getElement().getBoundingClientRect();
      const margin = 8;
      // How far the popup overhangs one axis of the frame: negative past the start, positive past the end.
      const overhang = (start, end, min, max) => {
        if (start < min + margin) return start - min - margin;
        return end > max - margin ? end - max + margin : 0;
      };
      const dx = overhang(box.left, box.right, frame.left, frame.right);
      const dy = overhang(box.top, box.bottom, frame.top, frame.bottom);
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (dx || dy) map.panBy([dx, dy], { duration: still ? 0 : 300 });
    },

    /**
     * The popup's markup before its profile arrives.
     * @param {{street_edge_id: number, street_name: ?string, max_grade: ?number, mean_grade: ?number,
     *   grade_quality: ?string}} p - The street's properties from /v3/api/accessScoreStreets.
     * @param {boolean} pinned - Whether the popup was opened by a click.
     * @returns {string}
     */
    popupHtml(p, pinned) {
      // The name is the OSM way's `name` tag, which anyone can edit, so it is never trusted into markup.
      const name = p.street_name ? `${util.escapeHTML(p.street_name)} · ` : '';
      const figures = typeof p.max_grade === 'number'
        ? `<p><strong>Steepest:</strong> ${percent(p.max_grade)} &nbsp;
             <strong>Mean:</strong> ${percent(p.mean_grade)}</p>`
        : '';
      // Windowed statistics exist exactly where a profile does, so a street without them is not fetched for one.
      const hasProfile = typeof p.mean_grade === 'number';
      const loading = util.escapeHTML(i18next.t('accessscore:profile-loading'));
      return `
        <h4>${name}Street ${p.street_edge_id}</h4>
        ${figures}
        ${this.qualityNote(p.grade_quality)}
        ${hasProfile ? `<div class="map-popup__profile" aria-live="polite">${loading}</div>` : ''}
        ${pinned ? '' : '<p class="map-popup__hint">Click the street to pin this popup.</p>'}
      `;
    },

    /**
     * Why a street's grade is not a plain measurement, where it is not.
     * @param {?string} quality - The street's `grade_quality`; null where it has not been sampled.
     * @returns {string} A paragraph, or nothing for a measured street.
     */
    qualityNote(quality) {
      const notes = {
        structure: 'A bridge, tunnel, or covered way: an elevation model sees the ground under it, not its deck, so '
          + 'it has no grade.',
        suspect: 'The sampled profile held an implausible pitch, so the grade is a straight line between the '
          + 'street\'s two ends.',
        no_data: 'The elevation model has no data under this street.',
      };
      if (quality === 'measured') return '';
      return `<p>${notes[quality] || 'This street has not been sampled yet.'}</p>`;
    },

    /**
     * Fetches a street's profile into its popup and draws the chart there, or says why there is none.
     * @param {number} streetId - The street.
     * @param {mapboxgl.Popup} forPopup - The popup it belongs in.
     * @param {number[]} breaks - The slope classes' breaks.
     * @param {() => boolean} isCurrent - Whether that popup is still the one open, so a late answer is dropped.
     * @returns {Promise<void>} Settles once the popup holds its final content (or was replaced), never rejecting.
     */
    async loadProfile(streetId, forPopup, breaks, isCurrent) {
      const slot = forPopup.getElement()?.querySelector('.map-popup__profile');
      if (!slot) return;
      if (!profiles.has(streetId)) {
        profiles.set(streetId, ApiDocsMap.fetchJson(`${config.apiBaseUrl}/streetGrade?streetEdgeId=${streetId}`)
          // A failure is not cached, so hovering the street again retries it.
          .catch((error) => {
            profiles.delete(streetId);
            throw error;
          }));
      }
      try {
        const response = await profiles.get(streetId);
        if (!isCurrent()) return;
        if (!AccessScoreElevationProfile.canDraw(response.profile)) {
          slot.textContent = i18next.t('accessscore:profile-none');
          return;
        }
        this.drawProfile(slot, response, breaks);
      } catch (error) {
        console.warn('Street grade preview: profile failed to load', error);
        if (isCurrent()) slot.textContent = i18next.t('accessscore:profile-failed');
      }
    },

    /**
     * Draws the chart the way the AccessScore tool's popup does: the stretch that set `max_grade` is bracketed
     * where the backend placed it, except on a stale street, whose stretch was measured on its earlier geometry.
     * @param {HTMLElement} slot - Where the chart goes.
     * @param {AccessScoreProfileResponse} response - The street's /v3/api/streetGrade answer.
     * @param {number[]} breaks - The slope classes' breaks.
     */
    drawProfile(slot, response, breaks) {
      const elevations = response.profile.elevations_meters;
      const hasStretch = !response.stale && typeof response.max_grade_from_meters === 'number'
        && typeof response.max_grade_to_meters === 'number' && typeof response.max_grade === 'number';
      slot.removeAttribute('aria-live');
      new AccessScoreElevationProfile(slot, response.profile, {
        breaks,
        steepest: hasStretch
          ? { from: response.max_grade_from_meters, to: response.max_grade_to_meters, grade: response.max_grade }
          : null,
        label: i18next.t('accessscore:profile-label', {
          start: elevation(elevations[0]),
          end: elevation(elevations[elevations.length - 1]),
          low: elevation(Math.min(...elevations)),
          high: elevation(Math.max(...elevations)),
          interpolation: { escapeValue: false },
        }),
      });
    },

    /** Show an on-map message (e.g. when there is no data). */
    addNoDataMessage(map, text) {
      const div = document.createElement('div');
      div.className = 'map-message';
      div.setAttribute('role', 'status');
      div.textContent = text;
      map.getContainer().appendChild(div);
    },
  };
})();
