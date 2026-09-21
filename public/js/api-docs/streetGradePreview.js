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
        const [regionId, breaks] = await Promise.all([this.fetchSampleRegionId(), this.fetchClassBreaks()]);
        const streets = await this.fetchStreets(regionId);
        container.innerHTML = '';
        await this.renderMap(container, streets, breaks);
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
     * The grades the slope classes break at, from the backend.
     * @returns {Promise<number[]>} Ascending breaks; empty in a city with no grade configured.
     */
    fetchClassBreaks() {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}/accessScoreConfig`)
        .then((cfg) => cfg.grade?.map_class_breaks ?? []);
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
     * @param {number[]} breaks - The slope classes' breaks.
     */
    async renderMap(container, streets, breaks) {
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
      map.addSource(STREET_SOURCE, { type: 'geojson', data: streets, promoteId: 'street_edge_id' });
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
      this.addStreetPopups(map, breaks);

      const countChip = ApiDocsMap.addOverlay(map, 'top-right', 'map-chip');
      countChip.textContent = `${features.length} street${features.length === 1 ? '' : 's'}`;

      // Steepest first, as the tool's legend and the chart's own list read.
      const items = AccessScoreGradeRamp.classes(breaks)
        .map((c, i) => ({ color: c.color, label: this.classLabel(i, breaks) }))
        .reverse();
      items.push({ color: NONE_COLOR, label: 'No grade (bridge, tunnel, or no data)' });
      const legend = ApiDocsMap.addOverlay(map, 'bottom-left', 'map-legend');
      ApiDocsMap.renderSwatchLegend(legend, 'Steepest grade (max_grade)', items,
        'Hover a street for its elevation profile; click to pin it.');
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
      const show = (feature, lngLat, pin) => {
        close();
        pinned = pin;
        shownId = feature.id;
        const opened = ApiDocsMap.popup(map, lngLat, this.popupHtml(feature.properties, pin), {
          modifier: 'map-popup--profile',
          closeButton: pin,
          // A hover preview closes as the pointer leaves the street; a pinned one on a click anywhere else.
          closeOnClick: pin,
        });
        opened.on('close', () => {
          if (popup !== opened) return;
          popup = null;
          shownId = null;
          pinned = false;
        });
        popup = opened;
        this.loadProfile(feature.properties.street_edge_id, opened, breaks, () => popup === opened);
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
