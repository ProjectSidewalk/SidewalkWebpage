/**
 * Bootstraps the AccessScore tool page (#5217): loads the engine config, the city's streets, and the region
 * polygons and completion rates in parallel with the map, then wires the model, the map view, the cluster evidence
 * layer, the sidebar, the insights dock, and the URL together. Everything the page does after load is an event
 * flowing sidebar → model → map/dock/URL, or dock → map.
 */
window.AccessScoreApp = (function () {
  const MAP_STYLES = {
    light: 'mapbox://styles/mapbox/light-v11?optimize=true',
    dark: 'mapbox://styles/mapbox/dark-v11?optimize=true',
  };
  const SCORE_ENDPOINT = '/v3/api/accessScoreStreets';
  const INTERSECTIONS_ENDPOINT = '/v3/api/accessScoreIntersections';
  const PLACES_ENDPOINT = '/v3/api/places';
  /** The sidebar changes that alter which places are drawn. */
  const PLACE_CHANGE_KINDS = new Set([
    'PlaceCategory', 'PlaceCategoryOnly', 'PlaceCategorySelectAll', 'PlaceCategoryDeselectAll',
  ]);
  /** The sliders: mid-drag, the sidebar must not be re-synced from the model (the thumb is under a finger). */
  const DRAG_KINDS = new Set(['Weight', 'SlopeWeight']);
  const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };

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
    // Markup sink: the only caller writes this into the street popup's HTML.
    return i18next.t('accessscore:length', { meters, interpolation: { escapeValue: true } });
  }

  /**
   * An elevation, a rise, or a short stretch of street in meters, to the whole meter or foot. Not `formatLength`: its
   * nearest-25 rounding suits a street's length and would turn a 7 ft drop into "0 ft".
   */
  function formatElevation(meters, { escape = true } = {}) {
    // Markup sink by default: most callers write this into the street popup's HTML. The elevation profile asks for
    // plain text, since it escapes whatever it is given where that meets its own markup.
    return i18next.t('accessscore:elevation', { meters, interpolation: { escapeValue: escape } });
  }

  /** The display name of a label type; one implementation for the whole tool. */
  function typeName(type) {
    return AccessScoreChart.typeName(type);
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
   * @param {typeof PanoViewer} options.viewerType - The pano viewer class for the city's imagery, for the label card.
   * @param {string} options.imageryAccessToken - The imagery provider's token.
   * @param {?string} [options.username] - The signed-in user's name, or null.
   * @returns {Promise<{map: mapboxgl.Map, model: AccessScoreModel, mapView: AccessScoreMapView,
   *   sidebar: AccessScoreSidebar, dock: AccessScoreDock, config: AccessScoreConfig,
   *   streets: GeoJSON.FeatureCollection, regions: GeoJSON.FeatureCollection, clusterLoader: ViewportLabelLoader,
   *   clusterLayer: AccessScoreClusterLayer, placeSearch: ?{clear: () => boolean}}>} Resolves once the map is scored
   *   (also exposed as `window.accessScore` for the browser tests).
   */
  async function start({ mapboxApiKey, viewerType, imageryAccessToken, username = null }) {
    const overlay = new MapLoadingOverlay({ onRetry: () => window.location.reload() });
    const sidebarEl = document.getElementById('filter-sidebar');
    /** @type {mapboxgl.Map} */
    let map = null;

    const dataPromise = Promise.all([
      fetchJson('/v3/api/accessScoreConfig'),
      fetchJson(SCORE_ENDPOINT),
      // Without the crossings the page still works, every street just keeps its segment score — better than a
      // dead page for one feed's outage, and the console says which half is missing.
      fetchJson(INTERSECTIONS_ENDPOINT).catch((e) => {
        console.warn('AccessScore intersections failed to load; scores are segment-only', e);
        return EMPTY_COLLECTION;
      }),
      fetchJson('/regions'),
      fetchJson('/regions/completionRates'),
    ]);

    // A basemap asked for in the URL is chosen before the map exists, so the first paint is already right.
    const dark = new URLSearchParams(window.location.search).get('dark') === '1';
    document.getElementById('acs-map-holder')?.classList.toggle('acs-map-holder--dark', dark);

    let initialCamera = null;
    /**
     * The address-search handle, kept so the app object can hand out its `clear()` (#5321).
     * @type {?{clear: () => boolean}}
     */
    let placeSearch = null;
    const mapPromise = createPSMap($, {
      mapName: 'acs-map',
      mapStyle: dark ? MAP_STYLES.dark : MAP_STYLES.light,
      mapboxApiKey,
      mapboxLogoLocation: 'bottom-right',
      navigationControlPosition: 'top-right',
      onMapReady: (readyMap) => {
        map = readyMap;
        // The page's own opening view, before a shared link's viewport lands on it: what "Reset everything" returns to.
        initialCamera = { center: readyMap.getCenter(), zoom: readyMap.getZoom() };
        MapSidebarUrlSync.applyUrlViewport(map);
        placeSearch = initLabelMapLocationSearch(map, mapboxApiKey);
        overlay.show();
      },
    }).then((loaded) => loaded[0]);

    let config;
    let streets;
    let intersections;
    let regions;
    let completion;
    try {
      [[config, streets, intersections, regions, completion]] = await Promise.all([dataPromise, mapPromise]);
    } catch (e) {
      console.error('AccessScore data failed to load', e);
      overlay.showError();
      throw e;
    }

    // The elevation models the city's slopes came from (#5223); empty in a city that has not been sampled, which is
    // what keeps every slope control and credit off the page there.
    const gradeSources = config.gradient?.sources ?? [];
    /** The slope classes the map colors and the legend brushes by; null where the city has no slope at all. */
    const gradeBreaks = gradeSources.length > 0 ? config.gradient.map_class_breaks : null;
    const urlState = AccessScoreUrlSync.read(config);
    const model = new AccessScoreModel(config, streets, intersections, completion, urlState.state);
    const sidebar = new AccessScoreSidebar(sidebarEl, config, () => model.slopeImpact());
    const urlSync = new AccessScoreUrlSync(model, map);
    /** @type {?mapboxgl.Popup} */
    let popup = null;
    /** @type {?AccessScoreDock} */
    let dock = null;

    const explanationHtml = ({ unit, id }) => (unit === 'streets' ? streetPopupHtml(id) : regionPopupHtml(id));

    const select = (selection, { fromUrl = false } = {}) => {
      // Mapbox fires `close` synchronously from `remove()`, so the reference is dropped first: the close handler
      // below sees no popup and stays out, rather than deselecting everything under a selection in progress.
      const previous = popup;
      popup = null;
      previous?.remove();
      // One card at a time: a street or region takes the place card's spot.
      if (selection) places?.select(null);
      if (!selection) {
        mapView.setSelection(null);
        urlSync.setSelection(null);
        dock?.setSelection(null);
        return;
      }
      mapView.setSelection(selection);
      mapView.hideTooltip();
      urlSync.setSelection(selection.id);
      dock?.setSelection(selection);
      const html = explanationHtml(selection);
      if (!html) return;
      // Not closeOnClick: the popup is opened from a map click, and Mapbox would close it on that same click. A
      // click on bare map deselects through the map view instead.
      popup = new mapboxgl.Popup({
        className: 'acs-popup', maxWidth: '360px', focusAfterOpen: !fromUrl, closeOnClick: false,
      })
        .setLngLat(selection.lngLat).setHTML(html).addTo(map);
      if (selection.unit === 'streets') loadProfile(selection.id, popup);
      popup.on('close', () => {
        if (!popup) return;
        popup = null;
        select(null);
      });
      if (!fromUrl) log(`Select_${selection.unit === 'streets' ? 'street' : 'region'}Id`, selection.id);
    };

    // The cluster and place layers are built after the map view so they draw above the streets, but the map view
    // has to be able to ask about them from its own handlers, hence the late binding.
    let evidence = null;
    let places = null;
    const mapView = new AccessScoreMapView(map, {
      model,
      streets,
      regions,
      onSelect: (selection) => select(selection),
      onHover: (hover) => dock?.markHover(hover),
      tooltipHtml: ({ unit, id }) => (unit === 'streets' ? streetTooltipHtml(id) : regionTooltipHtml(id)),
      // A click on a cluster dot or a place marker opens its own card, never the street or region under it.
      clickClaimed: (e) => evidence?.layer.claims(e) === true || places?.layer.claims(e) === true,
      hoverClaimed: (e) => evidence?.layer.claims(e) === true || places?.layer.claims(e) === true,
      dark,
      gradeBreaks,
      gradeAttribution: gradeAttributionHtml(),
      // The legend's classes are a brush like the histogram's range, so the dock owns them; an empty list clears.
      onGradeClasses: (classes) => dock?.setBrush(classes.length > 0 ? { kind: 'grade', classes } : null),
    });
    evidence = await mountClusterEvidence();
    places = mountPlaces();
    // The view stamps the city's name on the map holder, so the needle can name the city rather than say "City".
    const cityName = document.getElementById('acs-map-holder')?.dataset.cityName ?? '';
    dock = new AccessScoreDock(document.getElementById('acs-dock'), {
      cityName,
      model,
      mapView,
      map,
      // A rank row goes to the region; in the regions unit it selects it too, in the streets unit the
      // regions aren't selectable, so the fly-to is the whole answer.
      // In the regions unit a rank click is a map selection; in the streets unit the dock's own focus scopes
      // the band to the region without a region ever being "selected" on a streets map.
      onRankSelect: (regionId) => {
        mapView.flyToRegion(regionId);
        if (model.state.unit === 'regions') {
          const lngLat = regionCenter(regionId);
          if (lngLat) select({ unit: 'regions', id: regionId, lngLat });
        }
      },
      onOpenLabel: (labelId, ids) => evidence.openLabel(labelId, ids),
      onStateChange: () => urlSync.setDock(dock.state),
      log,
      gradeBreaks,
    });

    /** Applies a state change everywhere it shows: map, sidebar bars, dock, URL, and the panel's listeners. */
    const applyChange = (meta) => {
      if (meta.kind === 'Section') {
        log(meta.kind, meta.value);
        return;
      }
      const state = model.state;
      if (meta.kind === 'Unit') mapView.setUnit(state.unit);
      if (meta.kind === 'ShowUnaudited') mapView.setShowUnaudited(state.showUnaudited);
      if (meta.kind === 'ShowGrade') mapView.setShowGrade(state.showGrade);
      // Or the map would paint a street gentle while the score penalizes it for a pitch the other statistic hid.
      if (meta.kind === 'SlopeStat' || meta.kind === 'SlopeReset') mapView.setGradeStatistic();
      if (meta.kind === 'ShowClusters') evidence.setVisible(state.showClusters);
      if (PLACE_CHANGE_KINDS.has(meta.kind)) places?.apply(state);
      mapView.applyScores();
      // A reset moves every slider; a slider mid-drag already shows its own value.
      if (meta.final || !DRAG_KINDS.has(meta.kind)) sidebar.setState(model.state);
      sidebar.setContributions(model.contributions().means);
      if (popup) select(null);
      // The place card stays open across a reweighting; its nearest-street score follows the sliders, as do the
      // markers' discs.
      places?.refreshCard();
      places?.layer.rescore();
      dock.applyChange(meta);
      // The count is against the last settled state, so a drag reports what the whole drag moved.
      sidebar.afterRecompute(meta, model.changedCount);
      if (meta.final !== false) model.markSettled();
      urlSync.scheduleWrite();
      if (meta.final) log(meta.kind, meta.value);
      document.dispatchEvent(new CustomEvent('accessscore:change', { detail: { state, meta } }));
    };

    sidebar.onChange((partial, meta) => {
      if (meta.kind === 'Reset') {
        // What is drawn (unit, cluster dots, unaudited streets) is the reader's view, not the weighting, and stays.
        model.setState({ weights: { ...config.presets.default } });
        sidebar.setState(model.state);
      } else if (partial) {
        // A `Section` fold changes nothing the model holds and reports null.
        model.setState(partial);
      }
      applyChange(meta);
    });

    sidebar.setState(model.state);
    sidebar.setContributions(model.contributions().means);
    // A link that carries custom weights, or places, opens that fold, so what it shares is in view rather than a
    // hint beside a heading.
    if (!model.weightsAreDefault) sidebar.setWeightsOpen(true);
    if (!model.slopeIsDefault && sidebar.slope.available) sidebar.slope.setOpen(true);
    if (model.state.placeCategories === null || model.state.placeCategories.length > 0) sidebar.setPlacesOpen(true);
    renderUpdatedAt(config.clusters_updated_at);
    // A live `setStyle` drops everything the tool added, so the map view and the cluster layer remount once the new
    // style has loaded. The band keeps the light ramp; only the map surface changes.
    const darkInput = /** @type {HTMLInputElement} */ (document.getElementById('acs-dark-map'));
    /** Swaps the basemap; the toggle's own change logs it, a reset does not (it logs `ResetAll`). */
    const setDarkMap = (next) => {
      document.getElementById('acs-map-holder')?.classList.toggle('acs-map-holder--dark', next);
      mapView.setDark(next);
      places?.layer.setDark(next);
      map.once('style.load', () => {
        mapView.remount();
        evidence?.layer.remount();
        places?.layer.remount();
      });
      // Never a diffed swap: a diff would strip the tool's layers without ever firing `style.load`.
      map.setStyle(next ? MAP_STYLES.dark : MAP_STYLES.light, { diff: false });
      urlSync.setDark(next);
    };
    if (darkInput) {
      darkInput.checked = dark;
      darkInput.addEventListener('change', () => {
        log('DarkMap', darkInput.checked);
        setDarkMap(darkInput.checked);
      });
    }
    urlSync.setDark(dark);

    // Everything back to the page as first opened: the weighting, what is drawn, the selection, the searched
    // place, the brush, the band, the basemap and the camera. Each piece goes through its own path so nothing is
    // reset twice or half.
    document.getElementById('acs-reset-all')?.addEventListener('click', () => {
      log('ResetAll');
      select(null);
      places?.select(null);
      placeSearch?.clear();
      model.setState({
        ...AccessScoreModel.DEFAULT_STATE, weights: { ...config.presets.default },
        slope: AccessScoreModel.slopeDefaults(config),
      });
      const state = model.state;
      mapView.setUnit(state.unit);
      mapView.setShowUnaudited(state.showUnaudited);
      mapView.setShowGrade(state.showGrade);
      evidence.setVisible(state.showClusters);
      places?.apply(state);
      mapView.applyScores();
      places?.layer.rescore();
      sidebar.setState(state);
      sidebar.setContributions(model.contributions().means);
      dock.setBrush(null, { log: false });
      dock.setOpen(true, { log: false });
      dock.applyChange({ kind: 'ResetAll', final: true });
      if (darkInput?.checked) {
        darkInput.checked = false;
        setDarkMap(false);
      }
      // The URL carries the camera, so it is written where the fly lands, not where it starts.
      if (initialCamera) {
        map.once('moveend', () => urlSync.writeNow());
        map.flyTo({ center: initialCamera.center, zoom: initialCamera.zoom });
      } else {
        urlSync.writeNow();
      }
      document.dispatchEvent(new CustomEvent('accessscore:change', { detail: { state, meta: { kind: 'ResetAll' } } }));
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
    // After the selection: a Selected scope has nothing to stand on before it.
    dock.applyUrlState(urlState.dock);

    const app = {
      map, model, mapView, sidebar, dock, config, streets, regions, clusterLoader: evidence.loader,
      clusterLayer: evidence.layer, placeSearch, placesLayer: places.layer,
      /** Opens a place's card by id, as a marker click does; the browser tests' way in. */
      selectPlace: (placeId) => places.select(places.layer.place(placeId)),
    };
    window.accessScore = app;
    document.dispatchEvent(new CustomEvent('accessscore:ready', { detail: app }));
    return app;

    /**
     * The clusters the scores are computed from, drawn on the map: one layer per scored type, fed by the viewport
     * loader once the map is zoomed to street level (a whole city's clusters is megabytes, and at city scale the
     * score colors are the story). A click opens the cluster sheet — every label in the cluster at once — and a
     * card there opens the full label card, whose arrows page through the same cluster.
     *
     * Clusters rather than raw labels because clusters are what the engine scores — three pins on one broken curb
     * are one cluster and one term. Drawing the labels would put a denser population on the map than the
     * arithmetic uses, which is exactly the question a reader checking a score would trip over.
     */
    async function mountClusterEvidence() {
      /** @type {?AccessScoreClusterSheet} */
      let sheet = null;
      const popupLabelViewer = await LabelPopup(false, viewerType, imageryAccessToken, username, {
        syncUrlSource: 'AccessScore',
        showExploreHereLink: true,
        // A vote in the full card changes counts a mini-card may be showing; the card's own JSON is the truth.
        onVote: (action, meta) => fetch(`/label/id/${meta.label_id}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((label) => {
            sheet?.refreshLabel(label);
            dock?.refreshLabel(label);
          })
          .catch((e) => console.warn('AccessScore: could not refresh a voted label', e)),
      });
      const openLabel = (labelId, ids) => {
        popupLabelViewer.setNearbyNavigator(clusterNavigator(ids));
        popupLabelViewer.showLabel(labelId, 'AccessScore');
      };
      sheet = new AccessScoreClusterSheet({ log, onOpenLabel: openLabel });
      const layer = new AccessScoreClusterLayer(map, {
        types: config.scored_types,
        tooltipHtml: clusterTooltipHtml,
        onSelect: (props) => {
          if (!props.label_ids?.length) return;
          log('SelectCluster_labelType', props.label_type);
          const street = model.explainStreet(props.street_edge_id);
          const term = street?.audited ? street.terms[props.label_type] : null;
          const effect = term
            ? i18next.t('accessscore:cluster-effect', { type: typeName(props.label_type), value: signed(term.term) })
            : '';
          sheet.open(props, effect);
        },
      });
      const feedUrl = new URL('/v3/api/labelClusters', window.location.origin);
      // Only the scored types are "behind the scores"; an Occlusion cluster moves nothing and would just be noise.
      feedUrl.searchParams.set('labelType', config.scored_types.join(','));
      const loader = new ViewportLabelLoader(map, feedUrl, {
        minFetchZoom: 14,
        floorApplies: () => true,
        dataBounds: featureCollectionBounds(regions),
      });
      const pill = new MapStatusPill(document.getElementById('acs-map'), {
        keys: { belowFloor: 'accessscore:zoom-in-for-clusters', loading: 'accessscore:loading-clusters' },
      });
      let visible = model.state.showClusters;
      loader.onData((featureCollection) => layer.setData(featureCollection));
      loader.onError((e) => console.error('AccessScore cluster feed failed', e));
      loader.onStateChange((state) => pill.setState(visible ? state : 'idle'));
      loader.start();
      layer.setVisible(visible);
      return {
        loader,
        layer,
        /** The label card, paging over a list — the cluster sheet's and the photo strip's shared exit. */
        openLabel,
        setVisible(show) {
          visible = show;
          layer.setVisible(show);
          if (!show) pill.setState('idle');
        },
      };
    }

    /**
     * The places beside the scores (#5311): one marker layer per category, fetched after the scores are on the map
     * since nothing waits on it, plus the sidebar rows, the place card, and the URL's `place` param.
     */
    function mountPlaces() {
      const categories = config.place_categories ?? [];
      let card = null;
      let selected = null;
      const layer = new AccessScorePlacesLayer(map, {
        categories,
        tooltipHtml: placeTooltipHtml,
        onSelect: (props) => selectPlace(props),
        // A marker's disc is the nearest street's score, binned as the histogram bins it.
        bins: AccessScoreModel.HISTOGRAM_BINS,
        binOf: (props) => (props.nearest_street_edge_id === null || props.nearest_street_edge_id === undefined
          ? null
          : model.streetBin(props.nearest_street_edge_id)),
        dark,
      });

      const apply = (state) => layer.setCategories(state.placeCategories);

      // A place is not a `sel` — it never scopes the dock or lands in `sel=` — but one card is open at a time, so a
      // street or region card closes, and its selection with it, when a place card opens (as `select` does the
      // reverse).
      const selectPlace = (props, { fromUrl = false } = {}) => {
        const previous = card;
        card = null;
        previous?.remove();
        selected = props ?? null;
        urlSync.setPlace(props ? { lat: props.lngLat.lat, lng: props.lngLat.lng, name: props.name ?? null } : null);
        if (!props) return;
        if (popup) select(null);
        mapView.hideTooltip();
        card = new mapboxgl.Popup({
          className: 'acs-popup', maxWidth: '360px', focusAfterOpen: !fromUrl, closeOnClick: false,
        }).setLngLat(props.lngLat).setHTML(placePopupHtml(props)).addTo(map);
        card.on('close', () => {
          if (!card) return;
          card = null;
          selectPlace(null);
        });
        if (!fromUrl) log('SelectPlace_placeId', props.place_id);
      };

      const refreshCard = () => {
        if (card && selected) card.setHTML(placePopupHtml(selected));
      };

      apply(model.state);
      fetchJson(PLACES_ENDPOINT)
        .then(async (featureCollection) => {
          layer.setData(featureCollection);
          await layer.ready;
          sidebar.setPlaceCounts(layer.counts());
          // A shared link's place: the marker it names, if the feed has one there (#5340 owns the search pin). Its
          // category is drawn too, so the card sits on a marker rather than on bare map.
          const linked = urlState.place ? layer.placeNear(urlState.place) : null;
          if (linked) {
            const enabled = model.state.placeCategories;
            if (enabled !== null && !enabled.includes(linked.category)) {
              model.setState({ placeCategories: [...enabled, linked.category] });
              sidebar.setState(model.state);
              sidebar.setPlacesOpen(true);
              apply(model.state);
              urlSync.scheduleWrite();
            }
            selectPlace(layer.place(linked.place_id), { fromUrl: true });
          }
        })
        .catch((e) => {
          console.warn('AccessScore places failed to load', e);
          sidebar.setPlacesUnavailable();
        });

      return { layer, apply, select: selectPlace, refreshCard };
    }

    /**
     * The place tooltip has the street tooltip's shape — title, score, a line of context — with the score being
     * the nearest street's. An unnamed place (most playgrounds and bus stops) is titled by its category, which
     * then needs no second line.
     */
    function placeTooltipHtml(props) {
      const category = placeCategoryName(props.category);
      const street = placeStreet(props);
      const title = props.name ? util.escapeHTML(props.name) : category;
      const scoreHtml = street?.audited
        ? `<div class="acs-tooltip__score">${formatScore(street.score)}</div>`
        : '';
      return `<strong>${title}</strong>
        ${props.name ? `<div class="acs-tooltip__meta">${category}</div>` : ''}
        ${scoreHtml}
        <div class="acs-tooltip__meta">${placeStreetLine(props, street)}</div>
        ${clickHintHtml()}`;
    }

    /** The nearest street's explanation, or null when none is within reach. */
    function placeStreet(props) {
      return props.nearest_street_edge_id === null || props.nearest_street_edge_id === undefined
        ? null
        : model.explainStreet(props.nearest_street_edge_id);
    }

    /** "Street 1525 · 25 ft away", or why there is no score: no street in reach, or one not yet audited. */
    function placeStreetLine(props, street) {
      if (!street) return i18next.t('accessscore:popup-no-street-nearby');
      const distance = i18next.t('accessscore:popup-street-distance', {
        meters: Math.round(props.nearest_street_distance_m),
      });
      const status = street.audited ? '' : ` · ${i18next.t('accessscore:unaudited')}`;
      return `${streetTitle(street)} · ${distance}${status}`;
    }

    /** A category's translated name, or its id for one the locale does not know yet. */
    function placeCategoryName(category) {
      const key = `accessscore:place-${category}`;
      return i18next.exists(key) ? i18next.t(key) : category;
    }

    /**
     * The place card is the street card of the nearest street, headed by the place: the "so what" of a red block
     * next to a school is the score of the street it sits on, and what drives it. A place with no street in reach,
     * or an unaudited one, says so where the score would be.
     */
    function placePopupHtml(props) {
      const category = placeCategoryName(props.category);
      const title = props.name ? util.escapeHTML(props.name) : category;
      const region = props.region_id === null || props.region_id === undefined
        ? null
        : model.explainRegion(props.region_id);
      // An unnamed place is already titled by its category, so the meta line does not repeat it.
      const meta = [props.name ? category : null, region ? util.escapeHTML(region.name) : null]
        .filter(Boolean).join(' · ');
      const street = placeStreet(props);
      let streetHtml;
      if (!street) {
        streetHtml = `<p class="acs-popup__empty">${i18next.t('accessscore:popup-no-street-nearby')}</p>`;
      } else {
        const distance = i18next.t('accessscore:popup-street-distance', {
          meters: Math.round(props.nearest_street_distance_m),
        });
        const score = street.audited ? formatScore(street.score) : i18next.t('accessscore:unaudited');
        const drivers = street.audited
          ? `${componentsHtml(street)}
          <h4 class="acs-popup__subtitle">${i18next.t('accessscore:popup-terms')}</h4>
          ${termsTableHtml(street.terms, undefined, street)}`
          : '';
        streetHtml = `<h4 class="acs-popup__subtitle">${streetTitle(street)}</h4>
          <div class="acs-popup__meta">${i18next.t('accessscore:popup-nearest-street')} · ${distance}</div>
          <div class="acs-popup__score">${score}</div>
          ${drivers}`;
      }
      return `<h3 class="acs-popup__title">${title}</h3>
        ${meta ? `<div class="acs-popup__meta">${meta}</div>` : ''}
        ${streetHtml}
        ${hopLinksHtml(props.lngLat)}`;
    }

    /**
     * Prev/next over one cluster's labels, in the order the API listed them, for the label card's arrows. The
     * card's contract (see nearbyLabelNavigator.js) is a tour with a trail; a cluster is small enough to be a
     * plain list with ends.
     */
    function clusterNavigator(ids) {
      const at = (id) => ids.indexOf(id);
      return {
        next: (id) => (at(id) >= 0 && at(id) < ids.length - 1 ? ids[at(id) + 1] : null),
        prev: (id) => (at(id) > 0 ? ids[at(id) - 1] : null),
        hasNext: (id) => at(id) >= 0 && at(id) < ids.length - 1,
        hasPrev: (id) => at(id) > 0,
        onRefresh: () => {},
      };
    }

    /**
     * A cluster's hover card: what it is, how many labels agree on it, and — the point of drawing clusters at all —
     * what its type is doing to the score of the street it sits on.
     */
    function clusterTooltipHtml(props) {
      // A rating's words differ by type — a curb ramp is good/okay/bad, an obstacle low/medium/high — so the
      // wording comes from util.misc rather than a mapping written here.
      const type = props.label_type;
      const rating = util.misc.labelTypeHasSeverity(type) && props.median_severity
        ? i18next.t(`common:${util.misc.getRatingLevelKeys(type)[props.median_severity]}`)
        : null;
      const meta = [
        i18next.t('accessscore:cluster-size', {
          count: props.cluster_size, interpolation: { escapeValue: true },
        }),
        rating,
      ].filter(Boolean).join(' · ');
      const street = model.explainStreet(props.street_edge_id);
      const term = street?.audited ? street.terms[type] : null;
      // The term is this type's whole contribution to the street, not this one cluster's, so the wording says
      // "on this street" rather than pinning the number to the dot under the pointer.
      const effect = term
        ? `<div class="acs-tooltip__meta">${i18next.t('accessscore:cluster-effect', {
          type: typeName(type), value: signed(term.term), interpolation: { escapeValue: true } })}</div>`
        : '';
      return `<strong><span class="acs-popup__swatch" style="background-color: ${
        util.misc.getLabelColors(type)};"></span>${typeName(type)}</strong>
        <div class="acs-tooltip__meta">${meta}</div>
        ${effect}
        <div class="acs-tooltip__hint">${i18next.t('accessscore:cluster-open')}</div>`;
    }

    /** The "clusters rebuilt <date>" note under the sidebar's actions. */
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

    /** A signed per-street effect, as text ("+1.43"). */
    function signed(value) {
      return (value >= 0 ? '+' : '−') + Math.abs(value).toFixed(2);
    }

    /** The lines that say what is behind a score: the biggest help, the biggest drag, and what stands out. */
    function notableHtml(unit, id) {
      const n = model.notable(unit, id);
      if (!n) return '';
      const lines = [];
      if (n.standout) {
        // Four phrasings: a problem that costs less here is good news, a feature that helps less here is not.
        const tone = n.standout.better ? 'better' : 'worse';
        const kind = config.type_weights[n.standout.type].base_weight < 0 ? 'problem' : 'feature';
        lines.push(`<li class="acs-tooltip__standout acs-tooltip__standout--${tone}">${
          i18next.t(`accessscore:tip-standout-${kind}-${tone}`, {
            type: typeName(n.standout.type), value: signed(n.standout.value), city: signed(n.standout.cityValue),
            interpolation: { escapeValue: true },
          })}</li>`);
      }
      if (n.helped) {
        lines.push(`<li>${i18next.t('accessscore:tip-helped', {
          type: typeName(n.helped.type), value: signed(n.helped.value),
          interpolation: { escapeValue: true } })}</li>`);
      }
      if (n.hurt) {
        lines.push(`<li>${i18next.t('accessscore:tip-hurt', {
          type: typeName(n.hurt.type), value: signed(n.hurt.value),
          interpolation: { escapeValue: true } })}</li>`);
      }
      return lines.length ? `<ul class="acs-tooltip__why">${lines.join('')}</ul>` : '';
    }

    /** "Tuxedo Square · Street 1932", or just the id for an unnamed way. */
    function streetTitle(s) {
      // Markup sink, and the name is OSM's: both callers interpolate the result into a tooltip or popup.
      return s.name
        ? i18next.t('accessscore:popup-street-named', {
            name: s.name, id: s.streetId, interpolation: { escapeValue: true },
          })
        : i18next.t('accessscore:popup-street', { id: s.streetId, interpolation: { escapeValue: true } });
    }

    /** The tooltip's slope line, shown only while slope is what the map is colored by. */
    function gradeTooltipHtml(id) {
      if (!mapView.showingGrade) return '';
      const grade = model.displayGrade(id);
      const text = grade === null
        ? i18next.t('accessscore:slope-none')
        : i18next.t('accessscore:slope-tooltip', {
            grade: AccessScoreGradeRamp.percent(grade), interpolation: { escapeValue: true },
          });
      return `<div class="acs-tooltip__meta">${text}</div>`;
    }

    function streetTooltipHtml(id) {
      const s = model.explainStreet(id);
      if (!s) return null;
      const title = streetTitle(s);
      if (!s.audited) {
        return `<strong>${title}</strong><br>${i18next.t('accessscore:unaudited')}${gradeTooltipHtml(id)}`;
      }
      const { problems, features } = countClusters(s);
      return `<strong>${title}</strong>
        <div class="acs-tooltip__score">${formatScore(s.score)}</div>
        ${gradeTooltipHtml(id)}
        ${componentsHtml(s)}
        <div class="acs-tooltip__meta">${i18next.t('accessscore:tooltip-meta', {
    problems, features, interpolation: { escapeValue: true },
  })}</div>
        ${notableHtml('streets', id)}
        ${clickHintHtml()}`;
    }

    // Region names come from the database, not from a user, but they are text and go into markup as text.
    function regionTooltipHtml(id) {
      const r = model.explainRegion(id);
      if (!r) return null;
      const percent = Math.round(r.completion * 100);
      if (r.score === null || r.belowFloor) {
        return `<strong>${util.escapeHTML(r.name)}</strong><br>${i18next.t('accessscore:insufficient', {
          percent, interpolation: { escapeValue: true },
        })}`;
      }
      return `<strong>${util.escapeHTML(r.name)}</strong>
        <div class="acs-tooltip__score">${formatScore(r.score)}</div>
        <div class="acs-tooltip__meta">${i18next.t('accessscore:completion', {
    percent, interpolation: { escapeValue: true },
  })}</div>
        ${notableHtml('regions', id)}
        ${clickHintHtml()}`;
    }

    /** The line that says a hover can become a click; without it nothing marks these features as selectable. */
    function clickHintHtml() {
      return `<div class="acs-tooltip__hint">${i18next.t('accessscore:click-for-details')}</div>`;
    }

    /** The three numbers behind a street's headline: its block and the crossings at either end ("—" for none). */
    function componentsHtml(s) {
      const end = (e) => (e && e.score !== null ? formatScore(e.score) : '—');
      return `<div class="acs-popup__components">${i18next.t('accessscore:score-components', {
        segment: formatScore(s.segmentScore), start: end(s.startIntersection), end: end(s.endIntersection),
        interpolation: { escapeValue: true },
      })}</div>`;
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
     * The per-type breakdown shared by both popups: cluster count (a per-street average for a region, hence
     * the decimal) and signed term per type that has any clusters.
     */
    /**
     * The slope's row in a street's terms table (#5223): slope is part of what drives the score once a reader has
     * weighed it in, so a table headed "What drives this score" that left it out would not add up to the score
     * beside it. Under a barrier the row says so in place of a term, since the rows above it then explain a sum the
     * segment's 0 did not come from. Empty at the engine's own settings, where slope drives nothing.
     * @param {?AccessScoreStreetExplanation} street - The street the table explains, or null for a unit with no slope.
     * @returns {string} A table row, or ''.
     */
    function slopeRowHtml(street) {
      if (!street || (!street.barrier && street.slopeTerm === 0)) return '';
      const effect = street.barrier
        ? i18next.t('accessscore:popup-slope-barrier')
        : `−${Math.abs(street.slopeTerm).toFixed(2)}`;
      return `<tr>
          <td><span class="acs-popup__swatch acs-popup__swatch--slope"></span>${
  i18next.t('accessscore:popup-slope')}</td>
          <td class="acs-popup__num">—</td>
          <td class="acs-popup__num acs-popup__term--problem">${effect}</td>
        </tr>`;
    }

    function termsTableHtml(terms, clustersHeading = i18next.t('accessscore:popup-clusters'), street = null) {
      const typeRows = config.scored_types.filter((type) => terms[type].clusterCount > 0).map((type) => {
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
      const rows = `${typeRows}${slopeRowHtml(street)}`;
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

    /** The popup's one call to action: go and see the sidewalks there in Explore. */
    function hopLinksHtml(lngLat) {
      const lat = lngLat.lat.toFixed(5);
      const lng = lngLat.lng.toFixed(5);
      return `<div class="acs-popup__links">
        <a href="/explore?lat=${lat}&lng=${lng}" class="button-ps button--small button--primary"
           data-acs-hop="ExploreHere">${i18next.t('accessscore:explore-here')}</a>
      </div>`;
    }

    function streetPopupHtml(id) {
      const s = model.explainStreet(id);
      if (!s) return null;
      const lngLat = streetCenter(id) || map.getCenter();
      const score = s.audited ? formatScore(s.score) : i18next.t('accessscore:unaudited');
      const region = model.explainRegion(s.regionId);
      return `<h3 class="acs-popup__title">${streetTitle(s)}</h3>
        <div class="acs-popup__score">${score}</div>
        ${s.audited ? componentsHtml(s) : ''}
        <div class="acs-popup__meta">${region ? `${util.escapeHTML(region.name)} · ` : ''}${
    formatLength(s.lengthM)}</div>
        <h4 class="acs-popup__subtitle">${i18next.t('accessscore:popup-terms')}</h4>
        ${termsTableHtml(s.terms, undefined, s)}
        ${slopeHtml(s)}
        ${hopLinksHtml(lngLat)}`;
    }

    /**
     * The elevation models' credit line for the map's attribution control (#5223), each linked to its publisher
     * where it has a page. The names and URLs are the backend's, and text all the same, so they are escaped.
     */
    function gradeAttributionHtml() {
      return gradeSources.map((source) => {
        const credit = util.escapeHTML(source.credit);
        // Escaping keeps a URL inside its attribute; only the scheme keeps it from being a `javascript:` one.
        return /^https:\/\//i.test(source.url ?? '')
          ? `<a href="${util.escapeHTML(source.url)}" target="_blank" rel="noopener">${credit}</a>`
          : credit;
      }).join(' | ');
    }

    /** A grade as a percentage, escaped for markup. */
    function percentHtml(grade) {
      return util.escapeHTML(AccessScoreGradeRamp.percent(grade));
    }

    /**
     * The popup's slope block (#5223): the grades, the climb, how much of the street is over the walking-surface
     * limit, a slot the elevation profile loads into, and why the numbers are missing or approximate when they are.
     * Empty for a street that has not been sampled, so a city with no slope data shows no sign of the feature.
     * @param {AccessScoreStreetExplanation} s - The street.
     * @returns {string}
     */
    function slopeHtml(s) {
      const g = s.gradient;
      if (!g) return '';
      const t = (key, values = {}) => i18next.t(`accessscore:${key}`, {
        ...values, interpolation: { escapeValue: false },
      });
      const lines = [];
      if (g.meanGrade !== null && g.maxGrade !== null) {
        lines.push(t('slope-summary', { mean: percentHtml(g.meanGrade), max: percentHtml(g.maxGrade) }));
        lines.push(t('slope-climb', {
          climb: formatElevation(g.climbM ?? 0), descent: formatElevation(g.descentM ?? 0),
        }));
        const limit = config.gradient?.walking_surface_limit;
        if ((g.metersOver5pct ?? 0) > 0 && typeof limit === 'number') {
          lines.push(t('slope-over-limit', { length: formatElevation(g.metersOver5pct), limit: percentHtml(limit) }));
        }
      } else if (g.netGrade !== null) {
        lines.push(t('slope-net-only', { grade: percentHtml(Math.abs(g.netGrade)) }));
      }
      // A barrier zeroes the segment, not the street: the headline above still averages that 0 with the crossings
      // at either end, so the sentence names the segment, in the word the components line uses for it. The term
      // itself is a row of the table above.
      if (s.audited && s.barrier) {
        lines.push(`<strong>${t('slope-barrier-effect', {
          limit: percentHtml(model.state.slope.barrierThreshold),
        })}</strong>`);
      }
      const notes = [];
      if (g.quality !== 'measured') notes.push(t(`slope-quality-${g.quality.replace('_', '-')}`));
      else if (g.confidence !== 'high') notes.push(t('slope-approximate'));
      const source = gradeSources.find((d) => d.dem_source === g.demSource);
      return `<h4 class="acs-popup__subtitle">${t('popup-slope')}</h4>
        ${lines.map((line) => `<div class="acs-popup__meta">${line}</div>`).join('')}
        ${g.meanGrade !== null ? '<div class="acs-popup__profile" data-acs-profile aria-live="polite"></div>' : ''}
        ${notes.map((note) => `<p class="acs-popup__note">${note}</p>`).join('')}
        ${source ? `<p class="acs-popup__credit">${util.escapeHTML(source.credit)}</p>` : ''}`;
    }

    /**
     * The elevation profile's chart, with its scale and its accessible name in the reader's units. Everything is
     * handed over as plain text: `AccessScoreElevationProfile` escapes it where it meets the markup.
     * @param {AccessScoreProfile} profile - A street's profile, from `/v3/api/streetGradientProfile`.
     * @returns {string} The chart's markup; empty for a profile too short to draw.
     */
    function profileHtml(profile) {
      const plain = { escape: false };
      const elevations = profile.elevations_meters;
      const { low, high } = AccessScoreElevationProfile.range(profile);
      const text = { low: formatElevation(low, plain), high: formatElevation(high, plain) };
      return AccessScoreElevationProfile.html(profile, {
        ...text,
        start: i18next.t('accessscore:profile-start'),
        end: i18next.t('accessscore:profile-end'),
        label: i18next.t('accessscore:profile-label', {
          ...text,
          start: formatElevation(elevations[0], plain),
          end: formatElevation(elevations[elevations.length - 1], plain),
          interpolation: { escapeValue: false },
        }),
      });
    }

    /**
     * Fetches a street's elevation profile into its open popup. The profile is the one slope field too heavy for the
     * city-wide payload, so it is asked for a street at a time, and only where the popup made a slot for it (a
     * street with windowed statistics, which is exactly a street with a profile).
     * @param {number} streetId - The selected street.
     * @param {mapboxgl.Popup} forPopup - The popup the profile belongs in; a later selection replaces it, and a
     *                                    late answer for an earlier street is dropped.
     */
    async function loadProfile(streetId, forPopup) {
      const slot = forPopup.getElement()?.querySelector('[data-acs-profile]');
      if (!slot) return;
      slot.textContent = i18next.t('accessscore:profile-loading');
      try {
        const { profile } = await fetchJson(`/v3/api/streetGradientProfile?streetEdgeId=${streetId}`);
        if (popup !== forPopup) return;
        // The slot is a live region that has just said "loading", so every ending is said in it too: removing it
        // would leave a screen-reader user waiting on a profile that is not coming.
        const html = profile ? profileHtml(profile) : '';
        if (html) slot.innerHTML = html;
        else slot.textContent = i18next.t('accessscore:profile-none');
      } catch (e) {
        console.warn('AccessScore elevation profile failed to load', e);
        if (popup === forPopup) slot.textContent = i18next.t('accessscore:profile-failed');
      }
    }

    function regionPopupHtml(id) {
      const r = model.explainRegion(id);
      if (!r) return null;
      const percent = Math.round(r.completion * 100);
      const score = r.score === null || r.belowFloor
        ? i18next.t('accessscore:insufficient', { percent, interpolation: { escapeValue: true } })
        : formatScore(r.score);
      const lngLat = regionCenter(id) || map.getCenter();
      // A region's breakdown is the mean per audited street of its streets' and its crossings' terms and clusters.
      const { means, clusterMeans } = model.contributions({ regionIds: new Set([id]) });
      const terms = Object.fromEntries(config.scored_types.map((type) => [type, {
        clusterCount: clusterMeans[type], term: means[type],
      }]));
      return `<h3 class="acs-popup__title">${util.escapeHTML(r.name)}</h3>
        <div class="acs-popup__score">${score}</div>
        <div class="acs-popup__meta">${i18next.t('accessscore:completion', {
    percent, interpolation: { escapeValue: true },
  })} · ${i18next.t('accessscore:popup-streets', {
    audited: r.auditedStreetCount, total: r.streetCount, interpolation: { escapeValue: true },
  })}</div>
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
    const hop = e.target instanceof Element ? e.target.closest('[data-acs-hop]') : null;
    if (hop) log(hop.dataset.acsHop);
  });

  return { start, formatScore };
})();
