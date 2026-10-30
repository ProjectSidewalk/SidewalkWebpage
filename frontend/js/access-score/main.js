/**
 * Bootstraps the AccessScore tool page (#5217): loads the engine config, the city's streets, and the region
 * polygons and completion rates in parallel with the map, then wires the model, the map view, the cluster evidence
 * layer, the sidebar, the insights dock, the street panel (#5748), and the URL together. Everything the page does
 * after load is an event flowing sidebar → model → map/dock/panel/URL, or dock → map.
 */

import mapboxgl from '../common/mapboxgl.js';
import i18next from 'i18next';
import { AccessScoreClusterFeed } from './AccessScoreClusterFeed.js';
import { AccessScoreClusterLayer } from './AccessScoreClusterLayer.js';
import { AccessScoreClusterSheet } from './AccessScoreClusterSheet.js';
import { AccessScoreDock } from './AccessScoreDock.js';
import { AccessScoreFetch } from './AccessScoreFetch.js';
import { AccessScoreMapView } from './AccessScoreMapView.js';
import { AccessScoreModel } from './AccessScoreModel.js';
import { AccessScorePlacesLayer } from './AccessScorePlacesLayer.js';
import { AccessScoreSidebar } from './AccessScoreSidebar.js';
import { AccessScoreStreetPanel } from './AccessScoreStreetPanel.js';
import {
  componentsHtml, formatScore, hopLinksHtml, signed, streetTitle,
} from './AccessScoreText.js';
import { AccessScoreUrlSync } from './AccessScoreUrlSync.js';
import { AccessScoreGradeRamp } from '../common/AccessScoreGradeRamp.js';
import { featureCollectionBounds } from '../common/geoBounds.js';
import { LabelPopup } from '../common/label-detail/LabelPopup.js';
import { util } from '../common/utilities.js';
import { initLabelMapLocationSearch } from '../labelMapLocationSearch.js';
import { MapLoadingOverlay } from '../ps-map/MapLoadingOverlay.js';
import { MapSidebarUrlSync } from '../ps-map/MapSidebarUrlSync.js';
import { MapStatusPill } from '../ps-map/MapStatusPill.js';
import { ViewportLabelLoader } from '../ps-map/ViewportLabelLoader.js';
import { createPSMap } from '../ps-map/createPSMap.js';
import { PanoViewer } from '../common/pano-viewer/PanoViewer.js';
import '../common/utilitiesSidewalk.js';
/** @typedef {import('./AccessScoreModel.js').AccessScoreConfig} AccessScoreConfig */

export const AccessScoreApp = (function () {
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
  const DRAG_KINDS = new Set(['Weight', 'GradeWeight']);
  /** Close enough to read one block and its neighbors, where a rank row's street lands (#5223). */
  const STREET_ZOOM = 15;
  const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };

  /**
   * Fetches one of the whole-city score feeds, waiting out a server that is not ready to answer yet (#5418) and
   * telling the overlay so the wait reads as progress rather than a hang.
   *
   * The wording never claims the server is computing: the same retry path covers the proxy's own `503` while the
   * backend is down mid-deploy, when nothing is being computed at all.
   *
   * @param {string} url - The feed's URL.
   * @param {MapLoadingOverlay} overlay - Where the wait is announced.
   * @returns {Promise<GeoJSON.FeatureCollection>} The feed.
   */
  function fetchScores(url, overlay) {
    return AccessScoreFetch.fetchJsonWithRetry(url, {
      // The first attempt is the ordinary page load, which the overlay's own spinner and clock already cover. A retry
      // can sit for up to the server's 45 s cold wait with no countdown running, so it needs its own line.
      onAttempt: (attempt) => {
        if (attempt >= 2) overlay.setStatus(i18next.t('labelmap:waiting-for-scores'));
      },
      onWait: (_attempt, seconds) => overlay.setStatus(i18next.t('labelmap:waiting-for-scores-retry', { seconds })),
    });
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
   *   clusterLayer: AccessScoreClusterLayer, panel: AccessScoreStreetPanel, placeSearch: ?{clear: () => boolean}}>}
   *   Resolves once the map is scored
   *   (also exposed as `window.accessScore` for the browser tests).
   */
  async function start({ mapboxApiKey, viewerType, imageryAccessToken, username = null }) {
    const overlay = new MapLoadingOverlay({ onRetry: () => window.location.reload() });
    const sidebarEl = document.getElementById('filter-sidebar');
    /** @type {mapboxgl.Map} */
    let map = null;

    const dataPromise = Promise.all([
      util.fetchJson('/v3/api/accessScoreConfig'),
      fetchScores(SCORE_ENDPOINT, overlay),
      // Without the crossings the page still works, every street just keeps its segment score — better than a
      // dead page for one feed's outage, and the console says which half is missing. The retry comes first: the two
      // feeds share one cache, so a cold start fails both, and without it the page would quietly load segment-only.
      fetchScores(INTERSECTIONS_ENDPOINT, overlay).catch((e) => {
        console.warn('AccessScore intersections failed to load; scores are segment-only', e);
        return EMPTY_COLLECTION;
      }),
      util.fetchJson('/regions'),
      util.fetchJson('/regions/completionRates'),
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
    const mapPromise = createPSMap({
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
    const gradeSources = config.grade?.sources ?? [];
    /** The slope classes the map colors and the legend brushes by; null where the city has no slope at all. */
    const gradeBreaks = gradeSources.length > 0 ? config.grade.map_class_breaks : null;
    const urlState = AccessScoreUrlSync.read(config);
    const model = new AccessScoreModel(config, streets, intersections, completion, urlState.state);
    const sidebar = new AccessScoreSidebar(sidebarEl, config, () => model.slopeImpact());
    const urlSync = new AccessScoreUrlSync(model, map);
    /** The region popup; a street opens the panel instead (#5748). @type {?mapboxgl.Popup} */
    let popup = null;
    /** @type {?AccessScoreDock} */
    let dock = null;
    /** @type {?AccessScoreStreetPanel} */
    let panel = null;
    /** The clusters behind the scores, fetched once per region for the panel and the dock's photo strip. */
    const feed = new AccessScoreClusterFeed({ types: config.scored_types });

    const select = (selection, { fromUrl = false } = {}) => {
      // Mapbox fires `close` synchronously from `remove()`, so the reference is dropped first: the close handler
      // below sees no popup and stays out, rather than deselecting everything under a selection in progress.
      const previous = popup;
      popup = null;
      previous?.remove();
      // One card at a time: a street or region takes the place card's spot.
      if (selection) places?.select(null);
      if (!selection) {
        panel?.close();
        dock?.setFolded(false);
        mapView.setSelection(null);
        urlSync.setSelection(null);
        dock?.setSelection(null);
        return;
      }
      mapView.setSelection(selection);
      mapView.hideTooltip();
      urlSync.setSelection(selection.id);
      dock?.setSelection(selection);
      if (selection.unit === 'streets') {
        // The panel takes the map's right edge and the dock folds to its bar: the street's own insights are what
        // the panel shows, and three open panels would leave no map.
        if (panel?.showStreet(selection.id, { fromUrl })) dock?.setFolded(true);
      } else {
        panel?.close();
        dock?.setFolded(false);
        const html = regionPopupHtml(selection.id);
        if (!html) return;
        // Not closeOnClick: the popup is opened from a map click, and Mapbox would close it on that same click. A
        // click on bare map deselects through the map view instead.
        popup = new mapboxgl.Popup({
          className: 'acs-popup', maxWidth: '360px', focusAfterOpen: !fromUrl, closeOnClick: false,
        })
          .setLngLat(selection.lngLat).setHTML(html).addTo(map);
        popup.on('close', () => {
          if (!popup) return;
          popup = null;
          select(null);
        });
      }
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
      gradeCoarse: AccessScoreModel.gradesApproximate(config),
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
      // A rank row goes to what it ranks: a street row selects the street and opens its card, exactly as a click
      // on the map would; a neighborhood row selects the region in the regions unit, where the map has regions to
      // select, and in the streets unit the fly-to plus the dock's own focus is the whole answer.
      onRankSelect: ({ unit, id }) => {
        if (unit === 'streets') {
          const lngLat = streetCenter(id);
          if (!lngLat) return;
          map.flyTo({ center: lngLat, zoom: Math.max(map.getZoom(), STREET_ZOOM) });
          select({ unit, id, lngLat });
          return;
        }
        mapView.flyToRegion(id);
        const lngLat = regionCenter(id);
        if (lngLat) select({ unit: 'regions', id, lngLat });
      },
      onOpenLabel: (labelId, ids) => evidence.openLabel(labelId, ids),
      onStateChange: () => urlSync.setDock(dock.state),
      log,
      gradeBreaks,
      feed,
    });
    panel = new AccessScoreStreetPanel(document.getElementById('acs-panel'), {
      model,
      config,
      map,
      feed,
      gradeSources,
      streetCenter,
      // A reader's close is a deselect: the street or the place, whichever the panel is headed by.
      onClose: () => {
        if (places?.selected) places.select(null);
        else select(null);
      },
      onOpenLabel: (labelId, ids) => evidence.openLabel(labelId, ids),
      onOpenSheet: (props, effect) => evidence.openSheet(props, effect),
      onHoverCluster: (props) => evidence.layer.setHovered(props),
      log,
    });
    evidence.onHover((props) => panel.lightCluster(props?.label_cluster_id ?? null));

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
      if (meta.kind === 'GradeStat' || meta.kind === 'GradeReset') mapView.setGradeStatistic();
      if (meta.kind === 'ShowClusters') evidence.setVisible(state.showClusters);
      if (PLACE_CHANGE_KINDS.has(meta.kind)) places?.apply(state);
      mapView.applyScores();
      // A reset moves every slider; a slider mid-drag already shows its own value.
      if (meta.final || !DRAG_KINDS.has(meta.kind)) sidebar.setState(model.state);
      sidebar.setContributions(model.contributions().means);
      // A region's popup is rebuilt from scratch, so it closes; the street panel, and the place card it also is,
      // stay open across a reweighting and re-read their effects, as the markers' discs do.
      if (popup) select(null);
      panel.refresh();
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
      map, model, mapView, sidebar, dock, panel, config, streets, regions, clusterLoader: evidence.loader,
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
            panel?.refreshLabel(label);
          })
          .catch((e) => console.warn('AccessScore: could not refresh a voted label', e)),
      });
      const openLabel = (labelId, ids) => {
        popupLabelViewer.setNearbyNavigator(clusterNavigator(ids));
        popupLabelViewer.showLabel(labelId, 'AccessScore');
      };
      sheet = new AccessScoreClusterSheet({ log, onOpenLabel: openLabel });
      /** @type {Array<(props: ?import('./AccessScoreClusterLayer.js').AccessScoreClusterProps) => void>} */
      const hoverListeners = [];
      const layer = new AccessScoreClusterLayer(map, {
        types: config.scored_types,
        tooltipHtml: clusterTooltipHtml,
        onSelect: (props) => {
          if (!props.label_ids?.length) return;
          log('SelectCluster_labelType', props.label_type);
          const street = model.explainStreet(props.street_edge_id);
          const term = street?.audited ? street.terms[props.label_type] : null;
          const effect = term
            ? i18next.t('accessscore:cluster-effect', {
                type: util.misc.labelTypeName(props.label_type), value: signed(term.term),
              })
            : '';
          sheet.open(props, effect);
        },
        onHover: (props) => hoverListeners.forEach((listener) => listener(props)),
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
        /** The label card, paging over a list — the cluster sheet's, the photo strip's and the panel's shared exit. */
        openLabel,
        /** The cluster sheet, for a panel tile whose cluster holds more than one label (#5748). */
        openSheet: (props, effect) => sheet.open(props, effect),
        /** Subscribes to the pointer landing on, and leaving, a cluster dot. */
        onHover: (listener) => hoverListeners.push(listener),
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
      // reverse). The place card is the street panel headed by the place (#5748): the "so what" of a red block next
      // to a school is the score of the street it sits on, and what drives it.
      const selectPlace = (props, { fromUrl = false } = {}) => {
        const wasSelected = selected !== null;
        selected = props ?? null;
        urlSync.setPlace(props ? { lat: props.lngLat.lat, lng: props.lngLat.lng, name: props.name ?? null } : null);
        if (!props) {
          if (wasSelected) {
            panel?.close();
            dock?.setFolded(false);
          }
          return;
        }
        if (popup || panel?.streetId !== null) select(null);
        mapView.hideTooltip();
        panel?.showPlace(props, { fromUrl });
        dock?.setFolded(true);
        if (!fromUrl) log('SelectPlace_placeId', props.place_id);
      };

      apply(model.state);
      util.fetchJson(PLACES_ENDPOINT)
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

      return {
        layer,
        apply,
        select: selectPlace,
        /** The selected place's properties, or null. */
        get selected() {
          return selected;
        },
      };
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
      return i18next.t(`accessscore:place-${category}`, { defaultValue: category });
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
      const typeName = util.misc.labelTypeName(type);
      const effect = term
        ? `<div class="acs-tooltip__meta">${i18next.t('accessscore:cluster-effect', {
          type: typeName, value: signed(term.term), interpolation: { escapeValue: true } })}</div>`
        : '';
      return `<strong><span class="acs-popup__swatch" style="background-color: ${
        util.misc.getLabelColors(type)};"></span>${typeName}</strong>
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
      const date = new Date(iso).toLocaleDateString(i18next.language, util.SHORT_DATE);
      el.textContent = i18next.t('accessscore:updated-at', { date });
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
            type: util.misc.labelTypeName(n.standout.type), value: signed(n.standout.value),
            city: signed(n.standout.cityValue),
            interpolation: { escapeValue: true },
          })}</li>`);
      }
      if (n.helped) {
        lines.push(`<li>${i18next.t('accessscore:tip-helped', {
          type: util.misc.labelTypeName(n.helped.type), value: signed(n.helped.value),
          interpolation: { escapeValue: true } })}</li>`);
      }
      if (n.hurt) {
        lines.push(`<li>${i18next.t('accessscore:tip-hurt', {
          type: util.misc.labelTypeName(n.hurt.type), value: signed(n.hurt.value),
          interpolation: { escapeValue: true } })}</li>`);
      }
      return lines.length ? `<ul class="acs-tooltip__why">${lines.join('')}</ul>` : '';
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
     * The region popup's per-type breakdown: cluster count (a per-street average, hence the decimal) and signed
     * term per type that has any clusters.
     */
    function termsTableHtml(terms, clustersHeading = i18next.t('accessscore:popup-clusters')) {
      const rows = config.scored_types.filter((type) => terms[type].clusterCount > 0).map((type) => {
        const t = terms[type];
        const sign = t.term >= 0 ? '+' : '−';
        const count = Number.isInteger(t.clusterCount) ? t.clusterCount : t.clusterCount.toFixed(1);
        return `<tr>
          <td><span class="acs-popup__swatch" style="background-color: ${util.misc.getLabelColors(type)};"></span>${
    util.misc.labelTypeName(type)}</td>
          <td class="acs-popup__num">${count}</td>
          <td class="acs-popup__num acs-popup__term--${t.term >= 0 ? 'feature' : 'problem'}">${sign}${
    Math.abs(t.term).toFixed(2)}</td>
        </tr>`;
      }).join('');
      if (!rows) return `<p class="acs-popup__empty">${i18next.t('accessscore:popup-no-clusters')}</p>`;
      return `<table class="acs-popup__table">
        <thead><tr>
          <th>${i18next.t('accessscore:popup-type')}</th>
          <th class="acs-popup__num">${clustersHeading}</th>
          <th class="acs-popup__num">${i18next.t('accessscore:popup-term')}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
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

  // Hops out of a popup or the panel are logged by delegation, since their DOM is rebuilt on every selection.
  document.addEventListener('click', (e) => {
    const hop = e.target instanceof Element ? e.target.closest('[data-acs-hop]') : null;
    if (hop) log(hop.dataset.acsHop);
  });

  return { start, formatScore };
})();
