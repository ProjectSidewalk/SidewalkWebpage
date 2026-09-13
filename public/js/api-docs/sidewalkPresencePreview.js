/**
 * Sidewalk Presence Map Preview Generator.
 *
 * Renders one live map of a region's block faces, fed directly from /v3/api/sidewalkPresence: every street is drawn
 * twice, its left and right face offset to either side of the centerline and colored by what the labels say about
 * that side's sidewalk.
 *
 * @requires DOM elem with id sidewalk-presence-preview.
 * @requires mapbox-gl and js/api-docs/apiDocsMap.js
 */

(function () {
  const REGION_SOURCE = 'preview-region';
  const FACE_SOURCE = 'sidewalk-presence';
  const FACE_LAYER = 'face-lines';
  const REGION_COLOR = ApiDocsTheme.color('--color-neutral-white');

  // How far each face sits from its street's centerline, in pixels so the gap holds at any zoom. Mapbox's line-offset
  // is positive to the right of the line's coordinate direction, the same frame `street_side` is defined in, so the
  // left face takes the negative offset.
  const FACE_OFFSET_PX = 3.5;

  // Swatches keyed by the API's `presence` values. Absent takes the NoSidewalk label's own color, since that label is
  // what produces the call. These three strings are the backend's sidewalk_presence_status enum; the legend is built
  // from whichever of them the response actually contains, so a value added there still draws (in the fallback
  // color) and shows up in the legend as itself.
  const PRESENCE = {
    absent: { color: ApiDocsTheme.color('--color-label-no-sidewalk'), label: 'No sidewalk' },
    present: { color: ApiDocsTheme.color('--color-success-200'), label: 'Sidewalk' },
    unknown: { color: ApiDocsTheme.color('--color-neutral-400'), label: 'Unknown (street not audited)' },
  };
  const FALLBACK_COLOR = ApiDocsTheme.color('--color-neutral-500');

  // An unaudited face has nothing to say, so it's drawn thinner and fainter than one that does.
  const UNKNOWN = ['==', ['get', 'presence'], 'unknown'];

  let config = {
    apiBaseUrl: '/v3/api',
    mapboxApiKey: '',
    sidewalkPresenceEndpoint: '/sidewalkPresence',
    regionWithMostLabelsEndpoint: '/regionWithMostLabels',
  };

  /**
   * Gives every feature an id of its own. Hover styling keys on the feature id, and the two faces of a street share
   * its `street_edge_id`, so that alone can't tell them apart.
   *
   * @param {object} faces - The GeoJSON FeatureCollection from the API.
   * @returns {object} The same collection with `face_id` on every feature.
   */
  function withFaceIds(faces) {
    return {
      ...faces,
      features: (faces.features || []).map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          face_id: `${feature.properties.street_edge_id}:${feature.properties.street_side}`,
        },
      })),
    };
  }

  /**
   * Rolls up the figures the summary panel draws on.
   *
   * @param {Array<object>} features - The face features.
   * @returns {object} Face counts by verdict, streets with a face called absent, and absent faces by label tier.
   */
  function summarize(features) {
    const stats = {
      faces: features.length, byPresence: {}, streetsAbsent: new Set(), tier1: 0, tier2: 0, tier3: 0,
    };
    features.forEach(({ properties }) => {
      stats.byPresence[properties.presence] = (stats.byPresence[properties.presence] || 0) + 1;
      if (properties.presence === 'absent') {
        stats.streetsAbsent.add(properties.street_edge_id);
        const n = properties.no_sidewalk_label_count || 0;
        if (n >= 3) stats.tier3++;
        else if (n === 2) stats.tier2++;
        else if (n === 1) stats.tier1++;
      }
    });
    return stats;
  }

  function percent(count, total) {
    return total > 0 ? Math.round(((count || 0) / total) * 100) : 0;
  }

  function plural(count, noun) {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
  }

  /**
   * The evidence behind a face's verdict, in words. The four cases are the backend's sidewalk_presence_basis enum.
   *
   * @param {object} props - A face feature's properties.
   * @returns {string} e.g. '3 NoSidewalk labels from 2 users'.
   */
  function describeBasis(props) {
    switch (props.presence_basis) {
      case 'no_sidewalk_labels':
        return `${plural(props.no_sidewalk_label_count, 'NoSidewalk label')} from `
          + `${plural(props.no_sidewalk_user_count, 'user')}`;
      case 'other_side_tag':
        return 'the other side is tagged "street has no sidewalks"';
      case 'audited_no_labels':
        return `audited ${plural(props.audit_count, 'time')} with no NoSidewalk label on this side`;
      default:
        return 'the street has not been audited yet';
    }
  }

  function presenceLabel(presence) {
    return PRESENCE[presence] ? PRESENCE[presence].label : presence;
  }

  window.SidewalkPresencePreview = {
    setup(options) {
      config = Object.assign(config, options);
      return this;
    },

    /**
     * Build the preview map.
     * @returns {Promise} Resolves once the map has been rendered
     */
    async init() {
      const container = document.getElementById('sidewalk-presence-preview');
      if (!container) {
        console.error('Sidewalk presence preview container element not found.');
        return;
      }

      const loading = document.createElement('div');
      loading.className = 'loading-message';
      loading.textContent = 'Loading sidewalk presence data...';
      container.appendChild(loading);

      try {
        const regionData = await this.fetchRegionWithMostLabels();
        const faces = withFaceIds(await this.fetchFacesByRegionId(regionData.properties.region_id));
        await this.renderMap(container, regionData, faces, summarize(faces.features));
      } catch (error) {
        this.showError(container, error);
      }
    },

    /**
     * Replace the preview's contents with a failure message.
     * @param {HTMLElement} container - The preview's container
     * @param {Error} error - What went wrong
     */
    showError(container, error) {
      console.error('Sidewalk presence preview error:', error);
      container.innerHTML = `<div class="message message-error" role="alert">Failed to load sidewalk presence: `
        + `${error.message}</div>`;
    },

    /**
     * Fetch the region the preview is scoped to.
     * @returns {Promise} Resolves with the region data
     */
    fetchRegionWithMostLabels() {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.regionWithMostLabelsEndpoint}`)
        .catch((error) => {
          console.error('Error fetching region with most labels:', error);
          throw new Error('Failed to fetch region with most labels');
        });
    },

    fetchFacesByRegionId(regionId) {
      return ApiDocsMap.fetchJson(`${config.apiBaseUrl}${config.sidewalkPresenceEndpoint}?regionId=${regionId}`);
    },

    /**
     * Build the map, tearing it back down if anything fails to draw.
     *
     * @param {HTMLElement} container - Container element for the map
     * @param {object} regionData - GeoJSON Feature for the region the preview is scoped to
     * @param {object} faces - GeoJSON FeatureCollection of block faces, after withFaceIds()
     * @param {object} stats - The rollup from summarize()
     * @returns {Promise} Resolves once the map has loaded and drawn
     */
    async renderMap(container, regionData, faces, stats) {
      container.innerHTML = '';
      const map = await ApiDocsMap.create({
        container,
        mapboxApiKey: config.mapboxApiKey,
        bounds: ApiDocsMap.geometryBounds(regionData.geometry),
      });
      try {
        this.drawMap(map, regionData, faces, stats);
      } catch (error) {
        // A half-drawn map still holds a WebGL context, and browsers cap how many can be live.
        map.remove();
        throw error;
      }
    },

    /**
     * Draw the region outline, the faces, the legend, and the summary onto a loaded map.
     *
     * @param {object} map - The loaded Mapbox map
     * @param {object} regionData - GeoJSON Feature for the region the preview is scoped to
     * @param {object} faces - GeoJSON FeatureCollection of block faces, after withFaceIds()
     * @param {object} stats - The rollup from summarize()
     */
    drawMap(map, regionData, faces, stats) {
      map.addSource(REGION_SOURCE, { type: 'geojson', data: regionData });
      map.addLayer({
        id: 'region-fill',
        type: 'fill',
        source: REGION_SOURCE,
        paint: { 'fill-color': REGION_COLOR, 'fill-opacity': 0.05 },
      });
      map.addLayer({
        id: 'region-outline',
        type: 'line',
        source: REGION_SOURCE,
        paint: { 'line-color': REGION_COLOR, 'line-width': 1, 'line-opacity': 0.6 },
      });

      const regionTitle = ApiDocsMap.addOverlay(map, 'top-right', 'map-chip');
      regionTitle.innerHTML = `<strong>Region:</strong> ${regionData.properties.name || 'Sample Region'}`;

      if (!faces.features.length) {
        const message = ApiDocsMap.addOverlay(map, 'top-right', 'map-chip');
        message.setAttribute('role', 'status');
        message.textContent = 'No streets found in this region.';
        return;
      }

      const colorExpression = ['match', ['get', 'presence']];
      Object.entries(PRESENCE).forEach(([value, { color }]) => colorExpression.push(value, color));
      colorExpression.push(FALLBACK_COLOR);

      map.addSource(FACE_SOURCE, { type: 'geojson', data: faces, promoteId: 'face_id' });
      map.addLayer({
        id: FACE_LAYER,
        type: 'line',
        source: FACE_SOURCE,
        // Round joins keep a bent street's two faces continuous; caps are left square because a rounded end on an
        // offset line pokes past the corner it meets.
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': colorExpression,
          'line-offset': ['match', ['get', 'street_side'], 'left', -FACE_OFFSET_PX, FACE_OFFSET_PX],
          'line-width': ApiDocsMap.whenHovered(5, ['case', UNKNOWN, 1.5, 3]),
          'line-opacity': ApiDocsMap.whenHovered(1, ['case', UNKNOWN, 0.45, 0.9]),
        },
      });
      ApiDocsMap.addHoverState(map, FACE_LAYER, FACE_SOURCE);
      this.addFacePopups(map, faces);

      const present = Object.keys(PRESENCE).filter((value) => stats.byPresence[value]);
      const legend = ApiDocsMap.addOverlay(map, 'bottom-left', 'map-legend');
      ApiDocsMap.renderSwatchLegend(legend, 'Sidewalk presence',
        present.map((value) => PRESENCE[value]),
        'Each street is drawn twice: its left and right side.');

      const summary = ApiDocsMap.addOverlay(map, 'top-right', 'map-stats');
      const absent = stats.byPresence.absent || 0;
      summary.innerHTML = `
        <h4>Summary</h4>
        <div><strong>Street sides:</strong> ${stats.faces}</div>
        <div><strong>No sidewalk:</strong> ${percent(absent, stats.faces)}%</div>
        <div><strong>Sidewalk:</strong> ${percent(stats.byPresence.present, stats.faces)}%</div>
        <div><strong>Unknown:</strong> ${percent(stats.byPresence.unknown, stats.faces)}%</div>
        <div><strong>Streets missing a side:</strong> ${stats.streetsAbsent.size}</div>
        <div><strong>By label count (1 / 2 / 3+):</strong> ${stats.tier1} / ${stats.tier2} / ${stats.tier3}</div>
      `;
    },

    /**
     * Wire up the click popup for the face layer, showing the clicked face beside the other side of its street.
     *
     * @param {object} map - The Mapbox map object
     * @param {object} faces - GeoJSON FeatureCollection of block faces, for the other side's lookup
     */
    addFacePopups(map, faces) {
      // Both faces of a street arrive as separate features, so the popup finds the opposite one by id.
      const byFaceId = new Map(faces.features.map((feature) => [feature.properties.face_id, feature.properties]));

      map.on('click', FACE_LAYER, (e) => {
        const props = e.features[0].properties;
        const otherSide = props.street_side === 'left' ? 'right' : 'left';
        const other = byFaceId.get(`${props.street_edge_id}:${otherSide}`);
        const firstLabel = props.first_no_sidewalk_label_date
          ? new Date(props.first_no_sidewalk_label_date).toLocaleDateString()
          : null;
        const lastLabel = props.last_no_sidewalk_label_date
          ? new Date(props.last_no_sidewalk_label_date).toLocaleDateString()
          : null;
        const osmLink = props.osm_way_id
          ? `<a href="https://www.openstreetmap.org/way/${props.osm_way_id}" target="_blank"
              rel="noopener noreferrer">${props.osm_way_id}</a>`
          : 'N/A';

        ApiDocsMap.popup(map, e.lngLat, `
          <h4>Street ${props.street_edge_id}, ${props.street_side} side</h4>
          <p><strong>Verdict:</strong> ${presenceLabel(props.presence)}</p>
          <p><strong>Basis:</strong> ${describeBasis(props)}</p>
          ${firstLabel ? `<p><strong>NoSidewalk labels placed:</strong> ${firstLabel} to ${lastLabel}</p>` : ''}
          <p><strong>Labels on this side:</strong> ${props.label_count || 0}</p>
          <p><strong>Other side:</strong> ${other ? presenceLabel(other.presence) : 'N/A'}</p>
          <p><strong>Type:</strong> ${props.way_type || 'Unknown'}</p>
          <p><strong>OSM ID:</strong> ${osmLink}</p>
          <a href="/explore?streetEdgeId=${props.street_edge_id}" class="button-ps button--primary button--tiny"
            target="_blank">
            Explore Street in Project Sidewalk
          </a>
        `);
      });
    },
  };
})();
