/**
 * SharedLabelPage — client controller for the public single-label spotlight page (/label/:id, issue #456).
 *
 * Composes three reused pieces around a server-rendered shell (sharedLabel.scala.html):
 *   1. The shared LabelDetail component (same as the Gallery expanded view / LabelMap popup) mounted inline as the
 *      hero — interactive pano, agree/disagree/unsure validation, severity/quality, tags, comments, description. Runs
 *      in non-admin mode (no usernames).
 *   2. A "nearby labels" minimap, built from the cheap, bbox-bounded public /v3/api/rawLabels API — deliberately NOT
 *      the city-wide /labels/all layer the full LabelMap loads. Nearby markers open a native popup linking to that
 *      label's own spotlight page.
 *   3. A city-stats band (from /v3/api/overallStats) + Explore/Validate calls to action.
 */
class SharedLabelPage {
  #data;
  #detail;

  // Half-width/height of the nearby-labels bounding box, in degrees (~330m of latitude). Small on purpose: the map is
  // a proximal sample for context, not a comprehensive view — that's what the "Explore the full map" CTA is for.
  #BBOX_RADIUS_DEG = 0.003;

  // Cap on nearby markers drawn, after sorting by distance. A tight bbox rarely exceeds this; it's a safety valve so
  // a dense downtown block can't drop thousands of features onto a context minimap.
  #MAX_NEARBY = 250;

  /**
   * @param {object} data - The server-rendered config (window.sharedLabelData). See sharedLabel.scala.html.
   */
  constructor(data) {
    this.#data = data;
    this.#initDetail();
    this.#initMap();
    this.#initLegend();
    this.#initStats();
    this.#initLogging();
  }

  // ───────────────────────────────────────────────────────────────────
  // Hero: the shared LabelDetail component
  // ───────────────────────────────────────────────────────────────────

  /**
   * Resolves the pano-viewer class for the city's imagery provider. Mirrors the LabelMap / Gallery selection.
   * @returns {typeof PanoViewer}
   */
  #viewerType() {
    const src = this.#data.imagerySource;
    if (src === 'mapillary') return MapillaryViewer;
    if (src === 'infra3d') return Infra3dViewer;
    return GsvViewer;
  }

  /** Mounts LabelDetail inline in the hero host and shows this label. */
  async #initDetail() {
    const root = document.querySelector('.spotlight__detail');
    if (!root || typeof LabelDetail === 'undefined') return;
    try {
      this.#detail = await LabelDetail.create(root, {
        admin: false,
        viewerType: this.#viewerType(),
        viewerAccessToken: this.#data.imageryAccessToken,
        currUsername: null,
        panoOverlaySource: 'SharedLabelImage',
        voteColumnSource: 'SharedLabelThumbs',
      });
      await this.#detail.showLabel(this.#data.labelId, 'SharedLabel');
    } catch (err) {
      console.error('SharedLabel: failed to mount label detail', err);
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // City stats band + outbound-click logging
  // ───────────────────────────────────────────────────────────────────

  /** Fetches this city's overall stats and fills the footer band (labels, validations, miles explored). */
  async #initStats() {
    const band = document.getElementById('spotlight-stats');
    if (!band) return;
    try {
      const res = await fetch('/v3/api/overallStats');
      if (!res.ok) return;
      const s = await res.json();
      const KM_TO_MI = 0.621371;
      const km = s.km_explored_no_overlap;
      const values = {
        labels: s.labels?.label_count,
        validations: s.validations?.combined?.total_validations,
        miles: km === null || km === undefined ? null : Math.round(km * KM_TO_MI),
      };
      let any = false;
      for (const [key, val] of Object.entries(values)) {
        const el = band.querySelector(`[data-stat="${key}"]`);
        if (el && val !== null && val !== undefined) {
          el.textContent = Number(val).toLocaleString();
          any = true;
        }
      }
      if (any) band.hidden = false;
    } catch (err) {
      console.error('SharedLabel: failed to fetch city stats', err);
    }
  }

  /** Logs clicks on the CTAs that leave this page, so we can see whether the spotlight drives engagement. */
  #initLogging() {
    const clicks = {
      'spotlight-explore-cta': 'Click_module=SharedLabel_target=Explore',
      'spotlight-validate-cta': 'Click_module=SharedLabel_target=Validate',
      'spotlight-full-map': 'Click_module=SharedLabel_target=FullMap',
    };
    for (const [id, activity] of Object.entries(clicks)) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => this.#log(activity));
    }
  }

  /**
   * Logs a webpage-activity string if the global logger is available (it is once AppManager has initialized).
   * @param {string} activity
   */
  #log(activity) {
    if (typeof window.logWebpageActivity === 'function') window.logWebpageActivity(activity);
  }

  // ───────────────────────────────────────────────────────────────────
  // Nearby-labels map
  // ───────────────────────────────────────────────────────────────────

  /**
   * Colors the legend swatches from util.misc.getLabelColors() — the same source the map markers use, so the legend
   * can't drift from the marker colors (and the markup needs no inline styles).
   */
  #initLegend() {
    const colors = util.misc.getLabelColors();
    for (const swatch of document.querySelectorAll('.spotlight-legend__swatch[data-label-type]')) {
      const color = colors[swatch.dataset.labelType];
      if (color) swatch.style.backgroundColor = color.fillStyle;
    }
  }

  /**
   * Builds the nearby-labels minimap: a base ps-map centered on this label, plus label markers fetched from the cheap
   * public rawLabels API (adapted to the shape addLabelsToMap expects) and this label highlighted at the center.
   */
  async #initMap() {
    const d = this.#data;
    const holder = document.getElementById('spotlight-map');
    const hasLocation = [d.lat, d.lng].every((v) => v !== null && v !== undefined);
    if (!holder || !hasLocation) return; // No location → the section isn't rendered.

    let map;
    try {
      const rendered = await createPSMap($, {
        mapName: 'spotlight-map',
        mapStyle: 'mapbox://styles/mapbox/light-v11?optimize=true',
        mapboxApiKey: d.mapboxApiKey,
        mapboxLogoLocation: 'bottom-right',
        navigationControlPosition: 'top-right',
        scrollWheelZoom: false,
      });
      map = rendered[0];
    } catch (err) {
      console.error('SharedLabel: failed to create nearby map', err);
      return;
    }

    // /cityMapParams centers on the whole city; recenter on the label itself.
    map.jumpTo({ center: [d.lng, d.lat], zoom: 16 });

    const geojson = await this.#fetchNearbyLabels(d.lat, d.lng);
    const adapted = this.#adaptRawLabels(geojson, d);
    const mapData = await addLabelsToMap(map, adapted, {}); // No popupLabelViewer → no heavy validation modal.

    this.#addFocalHighlight(map, d);
    this.#wireNearbyPopups(map, mapData);
  }

  /**
   * Fetches nearby labels from the public v3 API, bounded to a small bbox around the label and restricted to
   * high-quality contributors. Returns an empty FeatureCollection on any error so the map still renders.
   * @param {number} lat
   * @param {number} lng
   * @returns {Promise<object>} A GeoJSON FeatureCollection.
   */
  async #fetchNearbyLabels(lat, lng) {
    const r = this.#BBOX_RADIUS_DEG;
    const bbox = `${lng - r},${lat - r},${lng + r},${lat + r}`; // rawLabels wants minLng,minLat,maxLng,maxLat.
    const url = `/v3/api/rawLabels?bbox=${bbox}&highQualityUserOnly=true&filetype=geojson`;
    try {
      const res = await fetch(url);
      if (!res.ok) return { type: 'FeatureCollection', features: [] };
      return await res.json();
    } catch (err) {
      console.error('SharedLabel: failed to fetch nearby labels', err);
      return { type: 'FeatureCollection', features: [] };
    }
  }

  /**
   * Adapts a rawLabels FeatureCollection to what addLabelsToMap + its default filter expect: excludes the focal label
   * (drawn separately), keeps the nearest #MAX_NEARBY, and derives `has_validations` — the one property the filter
   * reads that rawLabels doesn't emit (it sends per-vote counts instead).
   * @param {object} geojson
   * @param {object} d - Config (for the focal label id + center).
   * @returns {object} An adapted FeatureCollection.
   */
  #adaptRawLabels(geojson, d) {
    const features = (geojson.features || []).filter(
      (f) => f.properties && f.properties.label_id !== d.labelId,
    );
    // Sort by squared planar distance to the center — fine at this scale — so the cap keeps the closest labels.
    features.sort((a, b) => this.#dist2(a, d) - this.#dist2(b, d));
    const kept = features.slice(0, this.#MAX_NEARBY);
    for (const f of kept) {
      const p = f.properties;
      p.has_validations = ((p.agree_count || 0) + (p.disagree_count || 0) + (p.unsure_count || 0)) > 0;
    }
    return { type: 'FeatureCollection', features: kept };
  }

  /**
   * Squared planar distance from a feature's point to the center. Only used for relative ordering, so no need for a
   * true geodesic distance.
   * @param {object} feature
   * @param {object} d - Config with center lat/lng.
   * @returns {number}
   */
  #dist2(feature, d) {
    const [lng, lat] = feature.geometry.coordinates;
    const dLng = lng - d.lng;
    const dLat = lat - d.lat;
    return dLng * dLng + dLat * dLat;
  }

  /**
   * Adds a distinct, non-interactive highlight marker for the focal label at the map center so viewers can tell which
   * of the nearby dots is the one they came to see.
   * @param {object} map
   * @param {object} d
   */
  #addFocalHighlight(map, d) {
    const color = util.misc.getLabelColors()[d.labelType].fillStyle;
    const el = document.createElement('div');
    el.className = 'spotlight-focal-marker';
    el.style.setProperty('--lt-color', color);
    const img = document.createElement('img');
    img.src = `/assets/images/icons/label_type_icons/${d.labelType}_small.png`;
    img.alt = '';
    el.appendChild(img);
    new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([d.lng, d.lat]).addTo(map);
  }

  /**
   * Gives the nearby markers a lightweight native popup (label type + a link to that label's spotlight page) plus a
   * pointer cursor on hover. Kept intentionally minimal — no validation UI, no PII.
   * @param {object} map
   * @param {object} mapData - The layer tracker returned by addLabelsToMap.
   */
  #wireNearbyPopups(map, mapData) {
    const layerNames = Object.values(mapData.layerNames).filter((name) => name && map.getLayer(name));
    if (layerNames.length === 0) return;

    const popup = new mapboxgl.Popup({
      closeButton: true, closeOnClick: true, offset: 12, className: 'spotlight-popup',
    });

    map.on('click', layerNames, (event) => {
      const props = event.features[0].properties;
      popup.setLngLat(event.lngLat).setDOMContent(this.#buildNearbyPopup(props)).addTo(map);
      this.#log(`Click_module=SharedLabel_target=NearbyLabel_labelId=${props.label_id}`);
    });
    map.on('mouseenter', layerNames, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layerNames, () => {
      map.getCanvas().style.cursor = '';
    });
  }

  /**
   * Builds the DOM for a nearby-marker popup. Uses DOM APIs (not innerHTML) so nothing needs escaping.
   * @param {object} props - The clicked feature's GeoJSON properties.
   * @returns {HTMLElement}
   */
  #buildNearbyPopup(props) {
    const root = document.createElement('div');

    const head = document.createElement('div');
    head.className = 'spotlight-popup__head';
    const icon = document.createElement('img');
    icon.src = `/assets/images/icons/label_type_icons/${props.label_type}_small.png`;
    icon.alt = '';
    icon.className = 'spotlight-popup__icon';
    const name = document.createElement('span');
    name.textContent = this.#data.labelTypeNames[props.label_type] || props.label_type;
    head.append(icon, name);

    const link = document.createElement('a');
    link.className = 'spotlight-popup__link';
    link.href = `/label/${props.label_id}`;
    link.textContent = this.#data.i18n.viewThisLabel;

    root.append(head, link);
    return root;
  }
}
