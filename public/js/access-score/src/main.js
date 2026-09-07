/**
 * Bootstraps the AccessScore tool page (#5217): loads the engine config, the city's streets, and the neighborhood
 * polygons and completion rates in parallel with the map, then wires the model, the map view, the sidebar, and the
 * URL together. Everything the page does after load is an event flowing sidebar → model → map/URL/panel.
 */
window.AccessScoreApp = (function () {
  const MAP_STYLE = 'mapbox://styles/mapbox/light-v11?optimize=true';
  const SCORE_ENDPOINT = '/v3/api/accessScoreStreets';

  /** Fetches JSON, treating a non-2xx status as a failure so the overlay's error card shows. */
  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }

  /** A score in [0, 1] as the 0–100 figure people see, to one decimal. */
  function formatScore(score) {
    return (score * 100).toFixed(1);
  }

  /** A length in meters in the reader's unit system, through i18next's distance formatter. */
  function formatLength(meters) {
    return i18next.t('accessscore:length', { meters });
  }

  /** The display name of a label type, from the common namespace ("NoCurbRamp" → common:no-curb-ramp). */
  function typeName(type) {
    return i18next.t(`common:${type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`);
  }

  /** Records an interaction under the tool's own module name. */
  function log(kind, value) {
    const suffix = value === undefined ? '' : `_value=${value}`;
    window.logWebpageActivity?.(`Click_module=AccessScore_${kind}${suffix}`, true);
  }

  /**
   * Starts the page.
   *
   * @param {object} options - Page options.
   * @param {string} options.mapboxApiKey - The Mapbox access token.
   * @returns {Promise<object>} Resolves with `{map, model, mapView}` once the map is scored (also exposed as
   *   `window.accessScore` for the insights panel and the browser tests).
   */
  async function start({ mapboxApiKey }) {
    const overlay = new MapLoadingOverlay({ onRetry: () => window.location.reload() });
    const sidebarEl = document.getElementById('filter-sidebar');
    let map = null;

    const dataPromise = Promise.all([
      fetchJson('/v3/api/accessScoreConfig'),
      fetchJson(SCORE_ENDPOINT),
      fetchJson('/neighborhoods'),
      fetchJson('/neighborhoods/completionRate'),
    ]);

    const mapPromise = createPSMap($, {
      mapName: 'acs-map',
      mapStyle: MAP_STYLE,
      mapboxApiKey,
      mapboxLogoLocation: 'bottom-right',
      navigationControlPosition: 'top-right',
      onMapReady: (readyMap) => {
        map = readyMap;
        MapSidebarUrlSync.applyUrlViewport(map);
        initLabelMapLocationSearch(map, mapboxApiKey);
        overlay.show();
      },
    }).then((loaded) => loaded[0]);

    let config;
    let streets;
    let regions;
    let completion;
    try {
      [[config, streets, regions, completion]] = await Promise.all([dataPromise, mapPromise]);
    } catch (e) {
      console.error('AccessScore data failed to load', e);
      overlay.showError();
      throw e;
    }

    const urlState = AccessScoreUrlSync.read(config);
    const model = new AccessScoreModel(config, streets, completion, urlState.state);
    const sidebar = new AccessScoreSidebar(sidebarEl, config);
    const urlSync = new AccessScoreUrlSync(model, map);
    let popup = null;

    const explanationHtml = ({ unit, id }) => (unit === 'streets' ? streetPopupHtml(id) : regionPopupHtml(id));

    const select = (selection, { fromUrl = false } = {}) => {
      popup?.remove();
      popup = null;
      if (!selection) {
        mapView.setSelection(null);
        urlSync.setSelection(null);
        return;
      }
      mapView.setSelection(selection);
      urlSync.setSelection(selection.id);
      const html = explanationHtml(selection);
      if (!html) return;
      popup = new mapboxgl.Popup({ className: 'acs-popup', maxWidth: '360px', focusAfterOpen: !fromUrl })
        .setLngLat(selection.lngLat).setHTML(html).addTo(map);
      popup.on('close', () => {
        if (!popup) return;
        popup = null;
        select(null);
      });
      if (!fromUrl) log(`Select_${selection.unit === 'streets' ? 'street' : 'region'}Id`, selection.id);
    };

    const mapView = new AccessScoreMapView(map, {
      model,
      streets,
      regions,
      onSelect: (selection) => select(selection),
      tooltipHtml: ({ unit, id }) => (unit === 'streets' ? streetTooltipHtml(id) : regionTooltipHtml(id)),
    });

    /** Applies a state change everywhere it shows: map, sidebar bars, URL, and the panel's listeners. */
    const applyChange = (meta) => {
      const state = model.state;
      if (meta.kind === 'Unit') mapView.setUnit(state.unit);
      if (meta.kind === 'ShowUnaudited') mapView.setShowUnaudited(state.showUnaudited);
      mapView.applyScores();
      sidebar.setContributions(model.contributions().means);
      if (popup) select(null);
      urlSync.scheduleWrite();
      if (meta.final) log(meta.kind, meta.value);
      document.dispatchEvent(new CustomEvent('accessscore:change', { detail: { state, meta } }));
    };

    sidebar.onChange((partial, meta) => {
      if (meta.kind === 'Reset') {
        model.setState({ ...AccessScoreModel.DEFAULT_STATE, weights: { ...config.presets.default } });
        sidebar.setState(model.state);
        mapView.setUnit(model.state.unit);
        mapView.setShowUnaudited(model.state.showUnaudited);
      } else {
        model.setState(partial);
      }
      applyChange(meta);
    });

    sidebar.setState(model.state);
    sidebar.setContributions(model.contributions().means);
    renderUpdatedAt(config.clusters_updated_at);
    document.getElementById('acs-copy-link')?.addEventListener('click', async () => {
      urlSync.writeNow();
      try {
        await navigator.clipboard.writeText(window.location.href);
        Toast.show({ message: i18next.t('accessscore:link-copied'), compact: true, duration: 2500 });
      } catch (e) {
        console.error('Copy failed', e);
      }
      log('CopyLink');
    });

    sidebarEl.classList.remove('filter-sidebar--loading');
    overlay.hide();

    if (urlState.selection !== null) {
      const unit = model.state.unit;
      const lngLat = unit === 'regions' ? regionCenter(urlState.selection) : streetCenter(urlState.selection);
      if (lngLat) {
        if (unit === 'regions' && !MapSidebarUrlSync.hasUrlViewport()) mapView.flyToRegion(urlState.selection);
        select({ unit, id: urlState.selection, lngLat }, { fromUrl: true });
      }
    }

    const app = { map, model, mapView, sidebar, config, streets, regions };
    window.accessScore = app;
    document.dispatchEvent(new CustomEvent('accessscore:ready', { detail: app }));
    return app;

    /** The "scores reflect labels clustered on …" note under the sidebar's actions. */
    function renderUpdatedAt(iso) {
      const el = document.getElementById('acs-updated-at');
      if (!el) return;
      if (!iso) {
        el.textContent = i18next.t('accessscore:updated-never');
        return;
      }
      const date = new Intl.DateTimeFormat(i18next.language, { dateStyle: 'medium' }).format(new Date(iso));
      el.textContent = i18next.t('accessscore:updated-at', { date });
    }

    function streetTooltipHtml(id) {
      const s = model.explainStreet(id);
      if (!s) return null;
      const title = i18next.t('accessscore:popup-street', { id });
      if (!s.audited) return `<strong>${title}</strong><br>${i18next.t('accessscore:unaudited')}`;
      const { problems, features } = countClusters(s);
      return `<strong>${title}</strong>
        <div class="acs-tooltip__score">${formatScore(s.score)}</div>
        <div>${i18next.t('accessscore:tooltip-meta', { problems, features })}</div>`;
    }

    function regionTooltipHtml(id) {
      const r = model.explainRegion(id);
      if (!r) return null;
      const percent = Math.round(r.completion * 100);
      const body = r.score === null || r.belowFloor
        ? i18next.t('accessscore:insufficient', { percent })
        : `<div class="acs-tooltip__score">${formatScore(r.score)}</div>
           <div>${i18next.t('accessscore:completion', { percent })}</div>`;
      return `<strong>${r.name}</strong>${body}`;
    }

    /** Clusters of problem vs feature types on a street, for the one-line summary. */
    function countClusters(s) {
      let problems = 0;
      let features = 0;
      for (const [type, term] of Object.entries(s.terms)) {
        if (config.type_weights[type].base_weight < 0) problems += term.clusterCount;
        else features += term.clusterCount;
      }
      return { problems, features };
    }

    /**
     * The per-type breakdown shared by both popups: cluster count (a per-street average for a neighborhood, hence
     * the decimal) and signed term per type that has any clusters.
     */
    function termsTableHtml(terms, clustersHeading = i18next.t('accessscore:popup-clusters')) {
      const rows = config.scored_types.filter((type) => terms[type].clusterCount > 0).map((type) => {
        const t = terms[type];
        const sign = t.term >= 0 ? '+' : '−';
        const count = Number.isInteger(t.clusterCount) ? t.clusterCount : t.clusterCount.toFixed(1);
        return `<tr>
          <td><span class="acs-popup__swatch" style="background-color: ${util.misc.getLabelColors(type)};"></span>${
    typeName(type)}</td>
          <td class="acs-popup__num">${count}</td>
          <td class="acs-popup__num acs-popup__term--${t.term >= 0 ? 'feature' : 'problem'}">${sign}${
    Math.abs(t.term).toFixed(2)}</td>
        </tr>`;
      }).join('');
      if (!rows) return `<p class="acs-popup__empty">${i18next.t('accessscore:popup-no-clusters')}</p>`;
      return `<table class="acs-popup__table">
        <thead><tr>
          <th>${i18next.t('accessscore:popup-type')}</th>
          <th>${clustersHeading}</th>
          <th>${i18next.t('accessscore:popup-term')}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    }

    function hopLinksHtml(lngLat) {
      const lat = lngLat.lat.toFixed(5);
      const lng = lngLat.lng.toFixed(5);
      return `<div class="acs-popup__links">
        <a href="/labelMap?lat=${lat}&lng=${lng}&zoom=17" data-acs-hop="ViewOnLabelMap">${
    i18next.t('accessscore:view-labelmap')}</a>
        <a href="/explore?lat=${lat}&lng=${lng}" data-acs-hop="ExploreHere">${i18next.t('accessscore:explore-here')}</a>
      </div>`;
    }

    function streetPopupHtml(id) {
      const s = model.explainStreet(id);
      if (!s) return null;
      const lngLat = streetCenter(id) || map.getCenter();
      const score = s.audited ? formatScore(s.score) : i18next.t('accessscore:unaudited');
      const region = model.explainRegion(s.regionId);
      return `<h3 class="acs-popup__title">${i18next.t('accessscore:popup-street', { id })}</h3>
        <div class="acs-popup__score">${score}</div>
        <div class="acs-popup__meta">${region ? `${region.name} · ` : ''}${formatLength(s.lengthM)}</div>
        <h4 class="acs-popup__subtitle">${i18next.t('accessscore:popup-terms')}</h4>
        ${termsTableHtml(s.terms)}
        ${hopLinksHtml(lngLat)}`;
    }

    function regionPopupHtml(id) {
      const r = model.explainRegion(id);
      if (!r) return null;
      const percent = Math.round(r.completion * 100);
      const score = r.score === null || r.belowFloor
        ? i18next.t('accessscore:insufficient', { percent })
        : formatScore(r.score);
      const streetsList = model.regionStreets(id);
      const lngLat = regionCenter(id) || map.getCenter();
      // A region's breakdown is the mean of its audited streets' terms and cluster counts.
      const ids = new Set(streetsList.map((s) => s.streetId));
      const { means, clusterMeans } = model.contributions({ streetIds: ids });
      const terms = Object.fromEntries(config.scored_types.map((type) => [type, {
        clusterCount: clusterMeans[type], term: means[type],
      }]));
      return `<h3 class="acs-popup__title">${r.name}</h3>
        <div class="acs-popup__score">${score}</div>
        <div class="acs-popup__meta">${i18next.t('accessscore:completion', { percent })} · ${
    i18next.t('accessscore:popup-streets', { audited: r.auditedStreetCount, total: r.streetCount })}</div>
        <h4 class="acs-popup__subtitle">${i18next.t('accessscore:popup-terms-mean')}</h4>
        ${termsTableHtml(terms, i18next.t('accessscore:popup-clusters-mean'))}
        ${hopLinksHtml(lngLat)}`;
    }

    /** A street's midpoint, from its geometry. */
    function streetCenter(id) {
      const f = streets.features.find((feature) => feature.properties.street_edge_id === id);
      if (!f) return null;
      const coords = f.geometry.coordinates;
      const [lng, lat] = coords[Math.floor(coords.length / 2)];
      return { lng, lat };
    }

    /** A region's bounding-box center, from its polygon. */
    function regionCenter(id) {
      const f = regions.features.find((feature) => feature.properties.region_id === id);
      if (!f) return null;
      const bounds = featureCollectionBounds({ type: 'FeatureCollection', features: [f] });
      return bounds.isEmpty() ? null : bounds.getCenter();
    }
  }

  // Hops out of a popup are logged by delegation, since the popup's DOM is rebuilt on every selection.
  document.addEventListener('click', (e) => {
    const hop = e.target.closest?.('[data-acs-hop]');
    if (hop) log(hop.dataset.acsHop);
  });

  return { start, formatScore };
})();
