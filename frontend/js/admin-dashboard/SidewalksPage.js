/**
 * Coordinator for the admin Sidewalks page (#5724): where the labels say each side of each street has a sidewalk, and
 * which of those calls most need a person to check them.
 *
 * Two fetches: the street GeoJSON from `/v3/api/streets`, and `/adminapi/sidewalkPresence`, which carries each open
 * street's two faces with their verdict and evidence. They are joined on street_edge_id into one feature per face,
 * and the joined rows drive the map, the KPIs, the review lists and the region table, so none of them can disagree.
 *
 * Most cities have no sidewalk inventory to score against, so the review lists stand in for one: each names a kind of
 * call the #5222 study (Planning PR #20) found to be wrong more often than the rest.
 */

import { util } from '../common/utilities.js';
import { AdminShell } from './AdminShell.js';
import { SidewalkPresenceMap, SidewalkPresenceStyle } from './SidewalkPresenceMap.js';
import { StreetPriorityTable } from './StreetPriorityTable.js';

/**
 * The review lists. Each `test` picks the faces (or, for a street-level list, the left face standing for its street)
 * that belong on it; `streetLevel` marks the latter, whose per-face columns then read for both sides. `evidence`
 * says in words why a row is there.
 *
 * @type {Array<{key: string, label: string, description: string, streetLevel?: boolean,
 *   test: (face: Record<string, any>) => boolean, evidence: (face: Record<string, any>) => string, weight: (face: Record<string, any>) => number}>}
 */
const FLAGS = [
  {
    key: 'single_labeler',
    label: 'No sidewalk on one person\'s word',
    description: 'One labeler, no validator confirmation. In Seattle, 92% of the wrong "no sidewalk" calls looked '
      + 'like this.',
    test: (f) => f.presence === 'absent' && f.presence_basis === 'no_sidewalk_labels'
      && f.no_sidewalk_user_count === 1 && f.validated_no_sidewalk_count === 0,
    evidence: (f) => `${AdminShell.num(f.no_sidewalk_label_count)} NoSidewalk label`
      + `${f.no_sidewalk_label_count === 1 ? '' : 's'}, 1 user`,
    weight: (f) => f.no_sidewalk_label_count,
  },
  {
    key: 'other_side_tag',
    label: 'No sidewalk only from the other side\'s tag',
    description: 'Nobody labeled this side; the other side carries "street has no sidewalks". Right 78% of the time '
      + 'in Seattle.',
    test: (f) => f.presence_basis === 'other_side_tag',
    evidence: (f) => `Other side tagged "street has no sidewalks"; ${AdminShell.num(f.label_count)} label`
      + `${f.label_count === 1 ? '' : 's'} on this side`,
    weight: (f) => f.label_count,
  },
  {
    key: 'curb_ramps',
    label: 'No sidewalk on either side, but curb ramps',
    streetLevel: true,
    description: 'Both sides called absent while the street has curb ramp labels, which usually lead onto a sidewalk.',
    test: (f) => f.street_side === 'left' && f.presence === 'absent' && f.other_presence === 'absent'
      && f.street_curb_ramp_count > 0,
    evidence: (f) => `${AdminShell.num(f.street_curb_ramp_count)} curb ramp`
      + `${f.street_curb_ramp_count === 1 ? '' : 's'} on the street`,
    weight: (f) => f.street_curb_ramp_count,
  },
  {
    key: 'problem_labels',
    label: 'No sidewalk, with obstacle or surface labels',
    description: 'Mixed evidence. Often real: on a street without a sidewalk these labels mark hazards in the roadway '
      + 'people walk in.',
    test: (f) => f.presence === 'absent' && f.problem_label_count > 0,
    evidence: (f) => `${AdminShell.num(f.problem_label_count)} obstacle/surface label`
      + `${f.problem_label_count === 1 ? '' : 's'}`,
    weight: (f) => f.problem_label_count,
  },
  {
    key: 'not_audited',
    label: 'Not audited',
    description: 'Streets with no completed audit. A side can still carry a no-sidewalk verdict from labels placed '
      + 'in an audit nobody finished. A street only a meter or two long is an artifact of the street network, too '
      + 'short to show on the map or to audit, rather than unfinished work.',
    streetLevel: true,
    // Keyed on the street, not a face's basis: a face's own NoSidewalk labels outrank the audit check, so one side
    // can be `absent` while the other is `unaudited`.
    test: (f) => f.street_side === 'left' && f.audit_count === 0,
    evidence: (f) => `${f.length_m < 10 ? f.length_m.toFixed(1) : AdminShell.num(Math.round(f.length_m))} m long`,
    weight: (f) => f.length_m,
  },
];

export class SidewalksPage {
  #mapboxToken;
  #streetsUrl;
  #presenceUrl;

  #map = null;
  #flagTable = null;
  #regionTable = null;

  #faces = [];                   // Joined face rows, two per street with geometry.
  #streetsByRegion = new Map();  // region_id -> number[] of street_edge_ids.
  #rebuiltAt = null;
  #focusedRegion = null;
  #focusedFlagRow = null;

  /**
   * @param {{mapboxToken: string, streetsUrl: string, presenceUrl: string}} opts - Mapbox token and the two
   *   endpoints, injected from the Twirl template.
   */
  constructor(opts) {
    this.#mapboxToken = opts.mapboxToken;
    this.#streetsUrl = opts.streetsUrl;
    this.#presenceUrl = opts.presenceUrl;
  }

  async init() {
    try {
      const [geojson, presence] = await Promise.all([
        util.fetchJson(this.#streetsUrl),
        util.fetchJson(this.#presenceUrl),
      ]);
      this.#rebuiltAt = presence.rebuilt_at;
      const features = SidewalksPage.join(geojson, presence.streets || []);
      this.#faces = features.map((feature) => feature.properties);

      if (this.#faces.length === 0) {
        this.#setStatus('No open street has a sidewalk verdict yet. Rebuild sidewalk presence from Management, '
          + 'or wait for the nightly run.', false);
        this.#renderKpis();
        return;
      }

      for (const face of this.#faces) {
        if (face.street_side !== 'left') continue;
        const regionId = Number(face.region_id);
        if (!this.#streetsByRegion.has(regionId)) this.#streetsByRegion.set(regionId, []);
        this.#streetsByRegion.get(regionId).push(Number(face.street_edge_id));
      }

      this.#renderKpis();
      this.#renderLegend();
      this.#buildFilters();
      this.#buildFlagList();
      this.#buildRegionTable();

      this.#map = new SidewalkPresenceMap('sidewalks-map', { mapboxToken: this.#mapboxToken });
      await this.#map.init({ type: 'FeatureCollection', features });
      this.#applyFilters();
      this.#setStatus('', false, true);
    } catch (err) {
      console.error('Sidewalks page failed to load:', err);
      this.#setStatus('Could not load sidewalk presence data. Please try again.', true);
    }
  }

  /**
   * Joins the presence rows onto street geometry as one feature per face, keeping only streets in both.
   *
   * Each face also carries what the review lists need from its street: the other side's verdict and the street's
   * curb ramp total. Exposed (rather than private) so the join can be unit-tested without a map.
   *
   * @param {GeoJSON.FeatureCollection} geojson - FeatureCollection from /v3/api/streets.
   * @param {Array<Record<string, any>>} streets - The `streets` rows from /adminapi/sidewalkPresence.
   * @returns {GeoJSON.Feature[]} Two LineString features per joined street, ids in `face_id`.
   */
  static join(geojson, streets) {
    const geometry = new Map((geojson.features || [])
      .filter((feature) => feature.geometry)
      .map((feature) => [Number(feature.properties.street_edge_id), feature.geometry]));
    const features = [];
    for (const street of streets) {
      const geom = geometry.get(Number(street.street_edge_id));
      if (!geom) continue;
      const { faces, ...streetProps } = street;
      const curbRamps = faces.reduce((sum, face) => sum + face.curb_ramp_count, 0);
      // ISO-8601 strings in one zone, so the lexical max is the latest.
      const streetLastNoSidewalk = faces.map((face) => face.last_no_sidewalk_label_at).filter(Boolean).sort().pop()
        || null;
      for (const face of faces) {
        const other = faces.find((candidate) => candidate.street_side !== face.street_side);
        features.push({
          type: 'Feature',
          geometry: geom,
          properties: {
            ...streetProps,
            ...face,
            face_id: `${street.street_edge_id}:${face.street_side}`,
            other_presence: other ? other.presence : null,
            street_curb_ramp_count: curbRamps,
            street_last_no_sidewalk_label_at: streetLastNoSidewalk,
          },
        });
      }
    }
    return features;
  }

  /** The headline numbers, over every face regardless of the map's filters. */
  #renderKpis() {
    // "With a verdict" rather than "audited": a side with NoSidewalk labels is called absent even on a street whose
    // audit was never completed.
    const audited = this.#faces.filter((f) => f.presence !== 'unknown');
    const absent = audited.filter((f) => f.presence === 'absent');
    const absentKm = absent.reduce((sum, f) => sum + f.length_m, 0) / 1000;
    const single = absent.filter((f) => FLAGS[0].test(f));
    const confirmed = absent.filter((f) => f.validated_no_sidewalk_count > 0);

    AdminShell.setText('kpi-absent', audited.length ? `${SidewalksPage.#pct(absent.length, audited.length)}%` : '—');
    AdminShell.setText('kpi-absent-note', `${AdminShell.num(absent.length)} of ${AdminShell.num(audited.length)} `
    + `sides with a verdict, ${absentKm.toFixed(1)} km`);
    AdminShell.setText('kpi-single', absent.length ? `${SidewalksPage.#pct(single.length, absent.length)}%` : '—');
    AdminShell.setText('kpi-single-note', `${AdminShell.num(single.length)} sides rest on one labeler`);
    AdminShell.setText('kpi-confirmed', AdminShell.num(confirmed.length));
    AdminShell.setText('kpi-confirmed-note', absent.length
      ? `${SidewalksPage.#pct(confirmed.length, absent.length)}% of no-sidewalk sides`
      : 'no no-sidewalk sides yet');
    AdminShell.setText('kpi-rebuilt', this.#rebuiltAt ? AdminShell.relativeTime(this.#rebuiltAt) : 'never');
    AdminShell.setText('kpi-rebuilt-note', this.#rebuiltAt
      ? 'verdicts are as of this rebuild; curb ramp and obstacle counts are live'
      : 'no successful rebuild recorded in this city');
  }

  #renderLegend() {
    const legend = document.getElementById('sidewalks-legend');
    if (!legend) return;
    const counts = SidewalksPage.#countBy(this.#faces, 'presence');
    legend.innerHTML = Object.entries(SidewalkPresenceStyle.PRESENCE).map(([value, { label, token }]) => `
      <span class="street-status-legend-item">
        <span class="street-status-swatch" style="background:var(${util.escapeHTML(token)})" aria-hidden="true"></span>
        ${util.escapeHTML(label)} (${AdminShell.num(counts[value] || 0)})
      </span>`).join('');
  }

  /** Builds the basis checkboxes from the payload's own values and wires every filter control to the map. */
  #buildFilters() {
    const host = document.getElementById('sidewalks-basis-filters');
    if (host) {
      const counts = SidewalksPage.#countBy(this.#faces, 'presence_basis');
      host.innerHTML = Object.keys(counts).map((basis) => `
        <label class="sidewalks-filter-check">
          <input type="checkbox" name="sidewalks-basis" value="${util.escapeHTML(basis)}" checked>
          ${util.escapeHTML(SidewalkPresenceStyle.basisLabel(basis))} (${AdminShell.num(counts[basis])})
        </label>`).join('');
    }
    const form = document.getElementById('sidewalks-filters');
    form?.addEventListener('change', () => {
      // The halo has its own layer filter, so a chosen street would stay marked after the filters hid it.
      this.#clearFlagFocus();
      this.#map?.focusStreets([]);
      this.#applyFilters();
    });
    form?.addEventListener('submit', (e) => e.preventDefault());
  }

  /** Reads the filter controls into a Mapbox filter expression over face properties. */
  #applyFilters() {
    const minUsers = Number(/** @type {HTMLSelectElement} */ (document.getElementById('sidewalks-min-users'))?.value
      || 1);
    const confirmedOnly = /** @type {HTMLInputElement} */ (document.getElementById('sidewalks-confirmed-only'))
      ?.checked;
    const bases = Array.from(document.querySelectorAll('input[name="sidewalks-basis"]:checked'))
      .map((input) => /** @type {HTMLInputElement} */ (input).value);

    const isAbsent = ['==', ['get', 'presence'], 'absent'];
    /** @type {Array<any>} */
    const expression = [
      'all',
      ['in', ['get', 'presence_basis'], ['literal', bases]],
      // The labeler minimum only means something for a call made from this side's own labels.
      ['any', ['!=', ['get', 'presence_basis'], 'no_sidewalk_labels'],
        ['>=', ['get', 'no_sidewalk_user_count'], minUsers]],
    ];
    if (confirmedOnly) expression.push(['any', ['!', isAbsent], ['>=', ['get', 'validated_no_sidewalk_count'], 1]]);
    this.#map?.setFilter(expression);

    const shown = this.#faces.filter((f) => bases.includes(f.presence_basis)
      && (f.presence_basis !== 'no_sidewalk_labels' || f.no_sidewalk_user_count >= minUsers)
      && (!confirmedOnly || f.presence !== 'absent' || f.validated_no_sidewalk_count >= 1));
    AdminShell.setText('sidewalks-filter-note', `Showing ${AdminShell.num(shown.length)} of `
    + `${AdminShell.num(this.#faces.length)} sides.`);
  }

  /** Builds the review-list picker and its table; picking a row focuses that street on the map. */
  #buildFlagList() {
    const select = /** @type {HTMLSelectElement} */ (document.getElementById('sidewalks-flag'));
    const rowsByFlag = new Map(FLAGS.map((flag) => [flag.key, this.#faces.filter(flag.test)]));
    if (select) {
      select.innerHTML = FLAGS.map((flag) => `<option value="${flag.key}">${util.escapeHTML(flag.label)} `
        + `(${AdminShell.num(rowsByFlag.get(flag.key).length)})</option>`).join('');
    }

    this.#flagTable = new StreetPriorityTable('sidewalks-flag-table', {
      // Rows are faces, and both faces of a street can be on one list, so the street id alone would repeat. The
      // table's row ids are numbers, hence a numeric face key rather than face_id.
      rowKey: 'row_id',
      searchId: 'sidewalks-flag-search',
      searchFields: ['region_name', 'street_edge_id'],
      sortKey: 'weight',
      columns: [
        {
          key: 'street_edge_id',
          label: 'Street',
          // A button, so the row can be reached and activated from the keyboard; the click bubbles to the row.
          format: (r) => `<button type="button" class="button button--secondary button--tiny">`
            + `Street ${util.escapeHTML(r.street_edge_id)}</button>`,
        },
        { key: 'street_side', label: 'Side', numeric: false },
        { key: 'region_name', label: 'Region', numeric: false },
        { key: 'weight', label: 'Evidence', format: (r) => util.escapeHTML(r.evidence) },
        { key: 'audit_count', label: 'Audits', format: (r) => AdminShell.num(r.audit_count) },
        {
          key: 'last_no_sidewalk_label_at',
          label: 'Last NoSidewalk',
          sortValue: (r) => (r.last_no_sidewalk_label_at ? Date.parse(r.last_no_sidewalk_label_at) : 0),
          format: (r) => (r.last_no_sidewalk_label_at
            ? util.escapeHTML(new Date(r.last_no_sidewalk_label_at).toLocaleDateString())
            : '—'),
        },
        {
          key: 'explore',
          label: 'Explore',
          sortValue: () => 0,
          format: (r) => `<a href="/explore?streetEdgeId=${encodeURIComponent(r.street_edge_id)}" target="_blank" `
            + 'rel="noopener">Open</a>',
        },
      ],
      onRowClick: (rowId) => this.#focusFlagRow(rowId),
      // Sorting or searching re-renders the rows, which would otherwise drop the chosen street's highlight.
      onRender: () => {
        if (this.#focusedFlagRow !== null) this.#flagTable?.highlightRows([this.#focusedFlagRow]);
      },
    });

    const render = () => {
      const flag = FLAGS.find((candidate) => candidate.key === select?.value) || FLAGS[0];
      AdminShell.setText('sidewalks-flag-description', flag.description);
      // A street-level list stands for the whole street, so its per-face columns read for both sides.
      this.#flagTable.render(rowsByFlag.get(flag.key)
        .map((face) => ({
          ...face,
          row_id: face.street_edge_id * 2 + (face.street_side === 'right' ? 1 : 0),
          street_side: flag.streetLevel ? 'both' : face.street_side,
          last_no_sidewalk_label_at: flag.streetLevel
            ? face.street_last_no_sidewalk_label_at
            : face.last_no_sidewalk_label_at,
          evidence: flag.evidence(face),
          weight: flag.weight(face),
        })));
    };
    select?.addEventListener('change', () => {
      this.#clearFlagFocus();
      this.#map?.focusStreets([]);
      render();
    });
    render();
  }

  /** Builds the per-region table; picking a region fits the map to it, and picking it again clears that. */
  #buildRegionTable() {
    const byRegion = new Map();
    for (const face of this.#faces) {
      const regionId = Number(face.region_id);
      if (!byRegion.has(regionId)) {
        byRegion.set(regionId, {
          region_id: regionId, region_name: face.region_name, sides: 0, audited: 0, absent: 0, absent_km: 0,
          single: 0, confirmed: 0,
        });
      }
      const row = byRegion.get(regionId);
      row.sides += 1;
      if (face.presence !== 'unknown') row.audited += 1;
      if (face.presence === 'absent') {
        row.absent += 1;
        row.absent_km += face.length_m / 1000;
        if (FLAGS[0].test(face)) row.single += 1;
        if (face.validated_no_sidewalk_count > 0) row.confirmed += 1;
      }
    }
    const rows = Array.from(byRegion.values()).map((row) => ({
      ...row,
      absent_share: row.audited ? row.absent / row.audited : 0,
      audited_share: row.sides ? row.audited / row.sides : 0,
    }));

    this.#regionTable = new StreetPriorityTable('sidewalks-region-table', {
      rowKey: 'region_id',
      searchId: 'sidewalks-region-search',
      searchFields: ['region_name'],
      sortKey: 'absent_share',
      columns: [
        {
          key: 'region_name',
          label: 'Region',
          numeric: false,
          // A button, so a region can be fit from the keyboard; the click bubbles to the row.
          format: (r) => `<button type="button" class="button button--secondary button--tiny" `
            + `aria-pressed="${r.region_id === this.#focusedRegion}">${util.escapeHTML(r.region_name)}</button>`,
        },
        { key: 'audited_share', label: 'Sides with a verdict', format: (r) => `${Math.round(r.audited_share * 100)}%` },
        { key: 'absent_share', label: 'No sidewalk', format: (r) => `${Math.round(r.absent_share * 100)}%` },
        { key: 'absent_km', label: 'No sidewalk km', format: (r) => r.absent_km.toFixed(1) },
        { key: 'single', label: 'On one labeler', format: (r) => AdminShell.num(r.single) },
        { key: 'confirmed', label: 'Confirmed', format: (r) => AdminShell.num(r.confirmed) },
      ],
      onRowClick: (id) => this.#focusRegion(id),
      // Sorting or searching re-renders the rows, which would otherwise drop the focused region's highlight.
      onRender: () => {
        if (this.#focusedRegion !== null) this.#regionTable?.highlightRows([this.#focusedRegion]);
        this.#syncRegionPressed();
      },
    });
    this.#regionTable.render(rows);
  }

  #focusRegion(regionId) {
    this.#focusedRegion = this.#focusedRegion === regionId ? null : regionId;
    this.#clearFlagFocus();
    this.#map?.focusStreets([]);
    if (this.#focusedRegion === null) {
      this.#regionTable.clearHighlight();
      this.#syncRegionPressed();
      return;
    }
    this.#regionTable.highlightRows([regionId]);
    this.#syncRegionPressed();
    // A whole region is too many streets to halo usefully, so the region is shown by the fit alone.
    this.#map?.fitStreets(this.#streetsByRegion.get(regionId) || [], 15);
    SidewalksPage.#scrollToMap();
  }

  /**
   * Shows a review-list street on the map. The map sits above the list, so it is scrolled into view and the choice
   * is announced; otherwise a keyboard or screen-reader user would get no sign anything happened.
   *
   * @param {number} rowId - The row's id, street_edge_id * 2 plus 1 for the right face.
   */
  #focusFlagRow(rowId) {
    const streetEdgeId = Math.floor(rowId / 2);
    if (this.#focusedRegion !== null) {
      this.#focusedRegion = null;
      this.#regionTable?.clearHighlight();
      this.#syncRegionPressed();
    }
    this.#focusedFlagRow = rowId;
    this.#flagTable?.highlightRows([rowId]);
    this.#map?.focusStreets([streetEdgeId]);
    AdminShell.setText('sidewalks-flag-focus', `Showing street ${streetEdgeId} on the map.`);
    SidewalksPage.#scrollToMap();
  }

  #clearFlagFocus() {
    this.#focusedFlagRow = null;
    this.#flagTable?.clearHighlight();
    AdminShell.setText('sidewalks-flag-focus', '');
  }

  /** The region buttons are toggles, so each says whether it is pressed (WCAG 4.1.2), not just a row color. */
  #syncRegionPressed() {
    document.querySelectorAll('#sidewalks-region-table tbody tr[data-row-id]').forEach((tr) => {
      const pressed = Number(/** @type {HTMLElement} */ (tr).dataset.rowId) === this.#focusedRegion;
      tr.querySelector('button')?.setAttribute('aria-pressed', String(pressed));
    });
  }

  static #scrollToMap() {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('sidewalks-map')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'center' });
  }

  /** Updates the status line; pass hide=true to remove it once data has loaded. */
  #setStatus(message, isError, hide = false) {
    const status = document.getElementById('sidewalks-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', !!isError);
    status.classList.toggle('ps-hidden', hide);
  }

  /**
   * @param {Array<Record<string, any>>} rows - Rows to tally.
   * @param {string} key - The property to tally by.
   * @returns {Record<string, number>} How many rows carry each value of `key`.
   */
  static #countBy(rows, key) {
    const counts = {};
    for (const row of rows) counts[row[key]] = (counts[row[key]] || 0) + 1;
    return counts;
  }

  /**
   * @param {number} part - The numerator.
   * @param {number} whole - The denominator; must be positive.
   * @returns {number} The share as a whole-number percentage.
   */
  static #pct(part, whole) {
    return Math.round((part / whole) * 100);
  }
}
