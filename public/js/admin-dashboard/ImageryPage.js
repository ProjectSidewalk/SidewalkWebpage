/**
 * Coordinator for the admin Imagery page (#4908).
 *
 * Two fetches back everything above the pipeline section: the street GeoJSON the Street Status page already serves
 * from `/v3/api/streets`, and `/adminapi/streetPriority`, which carries each routable street's priority plus the audit
 * counts behind it. They are joined on street_edge_id — geometry from one, meaning from the other — and that single
 * joined list then drives the map, the KPIs, both tables, the rotation roll-up, and the freshness histogram, so no
 * two of them can disagree about how many streets need a re-audit.
 *
 * Selection mirrors the Coverage and Street Status pages: hovering brushes transiently, clicking pins (click again to
 * unpin), and the effective highlight is the hovered region if any, else the pinned region.
 */
class ImageryPage {
  /** Rows the "next streets" table shows when no region is pinned; enough to plan from, short enough to read. */
  static #TOP_STREETS = 50;

  /**
   * How far behind the imagery an audit is, in days. Streets whose imagery is not newer than their audit are not
   * backlog and are reported as a rotation-table row instead, so every bar here is work.
   */
  static #FRESHNESS_BUCKETS = [
    { label: '≤ 3 months', max: 90 },
    { label: '3–12 months', max: 365 },
    { label: '1–2 years', max: 730 },
    { label: '2–5 years', max: 1825 },
    { label: '5+ years', max: Infinity },
  ];

  #mapboxToken;
  #streetsUrl;
  #priorityUrl;
  #pipelineUrl;
  #pipelineDays;

  #map = null;
  #regionTable = null;
  #streetTable = null;

  #streets = [];                 // Joined priority rows, one per routable street.
  #regions = [];                 // Per-region aggregate rows.
  #streetsByRegion = new Map();  // region_id -> number[] of street_edge_ids.
  #report = null;                // Latest pipeline report, once it arrives.

  #pinnedIds = [];
  #hoverIds = null; // null = no active hover.

  /**
   * @param {{mapboxToken: string, streetsUrl: string, priorityUrl: string, pipelineUrl: string,
   *          pipelineDays: number}} opts - Mapbox token and the three endpoints, injected from the Twirl template so
   *   the JS has no server-config coupling.
   */
  constructor(opts = {}) {
    this.#mapboxToken = opts.mapboxToken;
    this.#streetsUrl = opts.streetsUrl;
    this.#priorityUrl = opts.priorityUrl;
    this.#pipelineUrl = opts.pipelineUrl;
    this.#pipelineDays = opts.pipelineDays;
  }

  async init() {
    StreetPriorityTiers.publishCssVars();

    // Started first and deliberately not awaited: the pipeline section draws from a different endpoint and needs
    // nothing from the whole-city GeoJSON, so a slow street fetch must not hold it blank. Nothing awaits it, so it
    // carries its own catch — an unhandled rejection here would fail the e2e smoke suite.
    new ImageryPipelinePanel({
      pipelineUrl: this.#pipelineUrl,
      days: this.#pipelineDays,
      onLoaded: (report) => {
        this.#report = report;
        this.#renderLastPollKpi();
        this.#renderRotation();
      },
    }).init().catch((e) => console.error('Could not initialize the imagery pipeline section.', e));

    try {
      const [geojson, priority] = await Promise.all([
        ImageryPage.#fetchJson(this.#streetsUrl),
        ImageryPage.#fetchJson(this.#priorityUrl),
      ]);
      this.#streets = priority.streets || [];

      if (this.#streets.length === 0) {
        this.#setStatus('No routable streets in this city yet, so there is no priority ranking to show.', false);
        return;
      }

      const joined = this.#join(geojson, this.#streets);
      this.#aggregate();
      this.#renderKpis();
      this.#renderLegend();
      this.#renderRotation();
      this.#renderFreshness();

      // A joined set with no geometry would hand Mapbox a bounds box of infinities; the tables still have something
      // to say, so the page keeps them and explains the missing map rather than failing whole.
      if (joined.features.length > 0) {
        this.#map = new StreetPriorityMap('imagery-priority-map', {
          mapboxToken: this.#mapboxToken,
          onRegionClick: (id) => this.#pin([id]),
          onRegionHover: (id) => this.#hover([id]),
          onRegionHoverEnd: () => this.#hoverEnd(),
        });
        await this.#map.init(joined);
      }

      this.#buildTables();
      this.#setStatus(joined.features.length > 0
        ? ''
        : 'No geometry matched the routable streets, so the map is empty; the tables below still show the ranking.',
      false, joined.features.length > 0);
    } catch (err) {
      console.error('Imagery page failed to load:', err);
      this.#setStatus('Could not load street priority data. Please try again.', true);
    }
  }

  static async #fetchJson(url) {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`Request failed: ${resp.status} (${url})`);
    return resp.json();
  }

  /**
   * Joins the priority rows onto the street geometry, keeping only streets that appear in both.
   *
   * The priority endpoint returns exactly the streets Explore can route to (open, non-tutorial), while the GeoJSON
   * carries every street including retired and closed ones — so the intersection is the map's subject, and dropping
   * the rest is what keeps a retired street from rendering as "never audited, highest priority".
   *
   * @param {object} geojson - FeatureCollection from /v3/api/streets.
   * @param {Array<object>} streets - Rows from /adminapi/streetPriority.
   * @returns {object} A FeatureCollection of the joined streets.
   */
  #join(geojson, streets) {
    // Tier is computed once, onto the rows, and the features then carry a copy — so the map colors a street exactly
    // the way the tables and roll-ups classify it.
    for (const street of streets) street.priority_tier = StreetPriorityTiers.tierFor(street);
    const byId = new Map(streets.map((street) => [Number(street.street_edge_id), street]));
    const features = (geojson.features || [])
      .filter((feature) => byId.has(Number(feature.properties.street_edge_id)))
      .map((feature) => ({ ...feature, properties: { ...byId.get(Number(feature.properties.street_edge_id)) } }));
    return { type: 'FeatureCollection', features };
  }

  /** Builds the per-region aggregate rows and the region → street-id index the brushing needs. */
  #aggregate() {
    const byRegion = new Map();
    for (const street of this.#streets) {
      const regionId = Number(street.region_id);
      let row = byRegion.get(regionId);
      if (!row) {
        row = {
          region_id: regionId,
          region_name: street.region_name,
          streets: 0,
          unaudited: 0,
          reaudit: 0,
          audited_once: 0,
          audited_multi: 0,
          reaudit_miles: 0,
          priority_sum: 0,
        };
        byRegion.set(regionId, row);
        this.#streetsByRegion.set(regionId, []);
      }
      row.streets += 1;
      row[street.priority_tier] += 1;
      row.priority_sum += street.priority;
      if (street.priority_tier === 'reaudit') row.reaudit_miles += ImageryPage.#miles(street.length_m);
      this.#streetsByRegion.get(regionId).push(Number(street.street_edge_id));
    }
    this.#regions = Array.from(byRegion.values())
      .map((row) => ({ ...row, mean_priority: row.streets ? row.priority_sum / row.streets : 0 }));
  }

  #buildTables() {
    this.#regionTable = new StreetPriorityTable('imagery-region-table', {
      rowKey: 'region_id',
      searchId: 'imagery-region-search',
      searchFields: ['region_name'],
      sortKey: 'mean_priority',
      columns: [
        { key: 'region_name', label: 'Region', numeric: false },
        { key: 'mean_priority', label: 'Mean priority', format: (r) => r.mean_priority.toFixed(3) },
        { key: 'unaudited', label: 'Never audited', format: (r) => AdminShell.num(r.unaudited) },
        { key: 'reaudit', label: 'Needs re-audit', format: (r) => ImageryPage.#tierCell(r.reaudit, 'reaudit') },
        { key: 'reaudit_miles', label: 'Re-audit miles', format: (r) => r.reaudit_miles.toFixed(1) },
        { key: 'audited_once', label: 'Audited once', format: (r) => AdminShell.num(r.audited_once) },
        { key: 'audited_multi', label: 'Audited 2+', format: (r) => AdminShell.num(r.audited_multi) },
        { key: 'streets', label: 'Streets', format: (r) => AdminShell.num(r.streets) },
      ],
      onRowClick: (id) => this.#pin([id]),
      onRowHover: (id) => this.#hover([id]),
      onRowHoverEnd: () => this.#hoverEnd(),
    });
    this.#regionTable.render(this.#regions);

    const regionNote = document.getElementById('imagery-region-note');
    if (regionNote) {
      regionNote.textContent = `${this.#regions.length.toLocaleString()} regions, highest mean priority first — `
        + 'scroll for the rest; sorting and the search box cover all of them. The top five are the pool Explore '
        + 'draws from, so a region just below the fold is one audit away from being in it.';
    }

    this.#streetTable = new StreetPriorityTable('imagery-street-table', {
      rowKey: 'street_edge_id',
      sortKey: 'priority',
      columns: [
        {
          key: 'street_edge_id',
          label: 'Street',
          format: (r) => `<a href="/explore?streetEdgeId=${r.street_edge_id}" target="_blank" rel="noopener">`
            + `${r.street_edge_id}</a>`,
        },
        { key: 'region_name', label: 'Region', numeric: false },
        { key: 'priority', label: 'Priority', format: (r) => r.priority.toFixed(3) },
        {
          key: 'priority_tier',
          label: 'Tier',
          numeric: false,
          format: (r) => ImageryPage.#tierCell(StreetPriorityTiers.labelFor(r.priority_tier), r.priority_tier),
        },
        { key: 'fresh_good_count', label: 'Current audits', format: (r) => AdminShell.num(r.fresh_good_count) },
        { key: 'outdated_good_count', label: 'Outdated audits', format: (r) => AdminShell.num(r.outdated_good_count) },
        { key: 'bad_count', label: 'Low-quality audits', format: (r) => AdminShell.num(r.bad_count) },
        {
          key: 'last_audit_date',
          label: 'Last audited',
          numeric: false,
          format: (r) => AdminShell.esc(r.last_audit_date || 'never'),
        },
        {
          key: 'median_newest_capture',
          label: 'Imagery (median)',
          numeric: false,
          format: (r) => AdminShell.esc(r.median_newest_capture || 'not polled'),
        },
      ],
    });
    this.#renderStreetTable();
  }

  /** Fills the street table with the pinned region's queue, or the city-wide top of the ranking. */
  #renderStreetTable() {
    if (!this.#streetTable) return;
    const regionId = this.#pinnedIds.length ? Number(this.#pinnedIds[0]) : null;
    const pool = regionId === null
      ? this.#streets
      : this.#streets.filter((street) => Number(street.region_id) === regionId);
    // Ties at the top of the ranking are the norm (every never-audited street sits at exactly 1.0), and Explore picks
    // among them at random — so this is a sample of the frontier, not the order labelers will see.
    const ranked = [...pool].sort((a, b) => b.priority - a.priority).slice(0, ImageryPage.#TOP_STREETS);
    this.#streetTable.render(ranked);

    const regionName = regionId === null ? null : this.#regions.find((r) => r.region_id === regionId)?.region_name;
    const intro = document.getElementById('imagery-street-intro');
    if (intro) {
      intro.textContent = regionId === null
        ? 'The highest-priority streets city-wide, with the audit counts that produced each value. Pin a region above'
        + ' to narrow this to that region’s queue.'
        : `The highest-priority streets in ${regionName}. Click the pinned region again to go back to the city-wide`
          + ' ranking.';
    }
    const note = document.getElementById('imagery-street-note');
    if (note) {
      note.textContent = `The top ${ranked.length.toLocaleString()} by priority, of `
        + `${pool.length.toLocaleString()} routable streets — capped so the list stays readable in a large city. `
        + 'Read it as a sample of the frontier rather than a queue: Explore picks a region first, then a street at '
        + 'random among that region\u2019s top-priority ties, and ties at the top are the norm (every never-audited '
        + 'street sits at exactly 1.000). Pin a region above to see that region\u2019s own top of the list.';
    }
  }

  /** Click handler: toggles the pinned region (clicking the same one again clears it). */
  #pin(ids) {
    this.#pinnedIds = ImageryPage.#sameSet(this.#pinnedIds, ids) ? [] : ids;
    this.#applyHighlight();
    this.#renderStreetTable();
  }

  /** Hover handler: transiently brushes a region without disturbing the pinned one. */
  #hover(ids) {
    this.#hoverIds = ids;
    this.#applyHighlight();
  }

  /** Hover-end handler: drops the transient brush, reverting to the pinned region (if any). */
  #hoverEnd() {
    this.#hoverIds = null;
    this.#applyHighlight();
  }

  /** Applies the effective highlight (hovered region, else pinned region, else none) to the map and the table. */
  #applyHighlight() {
    const regionIds = this.#hoverIds !== null ? this.#hoverIds : this.#pinnedIds;
    if (regionIds.length === 0) {
      this.#map?.clearHighlight();
      this.#regionTable?.clearHighlight();
      return;
    }
    const streetIds = regionIds.flatMap((id) => this.#streetsByRegion.get(Number(id)) || []);
    this.#map?.highlightSegments(streetIds);
    this.#regionTable?.highlightRows(regionIds);
  }

  #renderKpis() {
    const counts = this.#tierCounts();
    // The KPI counts the site-wide re-audit flag (audited, no up-to-date audit left) rather than the map's tier, so
    // it reads the same as the Overview and Coverage pages. The two differ slightly -- the tier counts only audits
    // that carry weight in the priority formula -- and the map note below says so when they do.
    const flagged = this.#streets.filter((street) => street.outdated);
    const reauditMiles = flagged.reduce((sum, street) => sum + ImageryPage.#miles(street.length_m), 0);

    AdminShell.setText('kpi-needs-reaudit', flagged.length.toLocaleString());
    AdminShell.setText('kpi-needs-reaudit-note', `${reauditMiles.toFixed(1)} mi of audited street with newer `
    + 'imagery');
    AdminShell.setText('kpi-unaudited', counts.unaudited.toLocaleString());
    AdminShell.setText('kpi-unaudited-note', `of ${this.#streets.length.toLocaleString()} routable streets`);

    const audited = this.#streets.filter((street) => street.last_audit_date);
    const polled = audited.filter((street) => street.median_newest_capture);
    const share = audited.length ? Math.round((polled.length / audited.length) * 100) : 0;
    AdminShell.setText('kpi-rotation', `${share}%`);
    AdminShell.setText('kpi-rotation-note', `${polled.length.toLocaleString()} of `
    + `${audited.length.toLocaleString()} audited streets have a polled capture date`);
  }

  /** The last-poll KPI, which needs the pipeline report rather than the street rows. */
  #renderLastPollKpi() {
    const poll = (this.#report?.jobs || []).find((job) => job.job_name === this.#report?.poll_job);
    if (!poll || poll.last_status === 'never_run') {
      AdminShell.setText('kpi-last-poll', 'never');
      AdminShell.setText('kpi-last-poll-note', 'the nightly poll has no recorded run in this deployment');
      return;
    }
    const polled = poll.last_details?.streets_polled;
    const selected = poll.last_details?.streets_selected;
    const hours = poll.hours_since_last_run;
    AdminShell.setText('kpi-last-poll', hours === null || hours === undefined
      ? '—'
      : (hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`));
    AdminShell.setText('kpi-last-poll-note', polled === undefined
      ? poll.last_details?.not_polled_reason || 'no counts recorded for that run'
      : `${Number(polled).toLocaleString()} of ${Number(selected || 0).toLocaleString()} selected streets refreshed`);
  }

  /**
   * Renders the tier table under the map: legend, per-tier counts, and the reason the four tiers are one ordering,
   * in one place. The priority column reports each tier's *observed* range rather than its nominal value, because
   * low-quality audits pull streets away from it — and that is exactly what makes two tiers' ranges overlap.
   */
  #renderLegend() {
    const stats = this.#tierStats();
    const legend = document.getElementById('imagery-legend');
    if (!legend) return;
    const total = this.#streets.length;
    const rows = StreetPriorityTiers.TIERS.map((tier) => {
      const stat = stats[tier.key];
      const swatch = `<span class="imagery-tier-swatch imagery-swatch--${tier.key.replace(/_/g, '-')}"`
        + ' aria-hidden="true"></span>';
      const range = stat.count === 0
        ? '—'
        : (stat.min === stat.max ? stat.min.toFixed(3) : `${stat.min.toFixed(3)} – ${stat.max.toFixed(3)}`);
      return `
        <tr>
          <td><span class="imagery-tier-name">${swatch}${AdminShell.esc(tier.label)}</span></td>
          <td class="imagery-tier-what">${AdminShell.esc(tier.description)}</td>
          <td class="imagery-tier-num">${range}</td>
          <td class="imagery-tier-num">${AdminShell.num(stat.count)}</td>
          <td class="imagery-tier-num">${ImageryPage.#share(stat.count, total)}</td>
          <td class="imagery-tier-num">${stat.miles.toFixed(1)}</td>
        </tr>`;
    }).join('');
    legend.innerHTML = `
      <div class="imagery-tier-wrap">
        <table class="ps-table ps-table--compact imagery-tier-table">
        <caption class="sr-only">Street priority tiers, highest priority first</caption>
        <thead>
          <tr>
            <th scope="col">Tier</th>
            <th scope="col">What it means</th>
            <th scope="col" class="imagery-tier-num">Priority</th>
            <th scope="col" class="imagery-tier-num">Streets</th>
            <th scope="col" class="imagery-tier-num">Share</th>
            <th scope="col" class="imagery-tier-num">Miles</th>
          </tr>
        </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    const note = document.getElementById('imagery-priority-note');
    if (note) {
      const counts = this.#tierCounts();
      // Folded rather than spread: `Math.min(...values)` passes one argument per street, which overflows the call
      // stack in a city with tens of thousands of them.
      const min = this.#streets.reduce((lowest, street) => Math.min(lowest, street.priority), Infinity);
      const max = this.#streets.reduce((highest, street) => Math.max(highest, street.priority), -Infinity);
      // Low-quality audits also carry weight, so a tier's range can dip into the one below it. Naming the pair that
      // actually crosses beats a general warning: the map looks wrong until a reader knows why it can.
      const crossing = StreetPriorityTiers.TIERS.find((tier, i) => {
        const below = StreetPriorityTiers.TIERS[i + 1];
        return below && stats[tier.key].count > 0 && stats[below.key].count > 0
          && stats[tier.key].min < stats[below.key].max;
      });
      const overlap = crossing
        ? ` Low-quality audits count too, at a quarter weight, so the tiers are not strictly ordered by priority: `
        + `some ${crossing.label.toLowerCase()} streets sit below some `
        + `${StreetPriorityTiers.TIERS[StreetPriorityTiers.TIERS.indexOf(crossing) + 1].label.toLowerCase()} ones.`
        : ' Low-quality audits count too, at a quarter weight, which is why two streets in the same tier can carry '
          + 'different values.';
      const flagged = this.#streets.filter((street) => street.outdated).length;
      const tierGap = counts.reaudit === flagged
        ? ''
        : ` ${counts.reaudit.toLocaleString()} streets sit in the `
          + `re-audit tier while ${flagged.toLocaleString()} carry the site-wide re-audit flag: the tier counts only `
          + 'the audits that carry weight in the priority formula, the flag counts every completed audit.';
      note.textContent = `Priority currently ranges from ${min.toFixed(3)} to ${max.toFixed(3)} across `
        + `${this.#streets.length.toLocaleString()} routable streets.${overlap} Tier is the honest bucket for what a `
        + 'street has been audited on; priority is what Explore actually sorts by, so read the number when the two '
        + `disagree.${tierGap}`;
    }
  }

  /** Counts of streets per tier, city-wide. */
  #tierCounts() {
    const counts = Object.fromEntries(StreetPriorityTiers.TIERS.map((tier) => [tier.key, 0]));
    for (const street of this.#streets) counts[street.priority_tier] += 1;
    return counts;
  }

  /**
   * Count, mileage, and observed priority range per tier.
   *
   * @returns {Object<string, {count: number, miles: number, min: number, max: number}>} Keyed by tier key; an empty
   *   tier reports min/max of 0 rather than the +/-Infinity the fold would otherwise leave behind.
   */
  #tierStats() {
    const stats = Object.fromEntries(StreetPriorityTiers.TIERS.map((tier) =>
      [tier.key, { count: 0, miles: 0, min: Infinity, max: -Infinity }]));
    for (const street of this.#streets) {
      const stat = stats[street.priority_tier];
      if (!stat) continue;
      stat.count += 1;
      stat.miles += ImageryPage.#miles(street.length_m);
      stat.min = Math.min(stat.min, street.priority);
      stat.max = Math.max(stat.max, street.priority);
    }
    for (const stat of Object.values(stats)) {
      if (stat.count === 0) {
        stat.min = 0;
        stat.max = 0;
      }
    }
    return stats;
  }

  /**
   * The rotation roll-up: how much of the city the poll has actually reached, and how long a full pass takes at the
   * rate it has been managing. Needs both fetches, so it renders on whichever arrives second.
   */
  #renderRotation() {
    const host = document.getElementById('imagery-rotation');
    if (!host || this.#streets.length === 0) return;

    const audited = this.#streets.filter((street) => street.last_audit_date);
    const withRow = this.#streets.filter((street) => street.imagery_updated_at);
    const withMedian = this.#streets.filter((street) => street.median_newest_capture);
    const auditedWithMedian = audited.filter((street) => street.median_newest_capture);
    const behind = auditedWithMedian.filter((street) =>
      ImageryPage.#daysBetween(street.last_audit_date, street.median_newest_capture) > 0).length;
    const stillCurrent = auditedWithMedian.length - behind;
    const recent = ImageryPage.#refreshedWithin(this.#streets, 30);
    // Compared as instants, not as strings: these timestamps carry the server's UTC offset, so "2026-01-01T23:00Z"
    // and "2026-01-02T00:00+02:00" sort the wrong way round lexically.
    const oldest = withRow.length
      ? withRow.reduce((min, street) =>
          (Date.parse(street.imagery_updated_at) < Date.parse(min) ? street.imagery_updated_at : min),
        withRow[0].imagery_updated_at)
      : null;

    const nights = (this.#report?.run_days || []).filter((day) => day.streets_polled > 0);
    const perNight = nights.length
      ? Math.round(nights.reduce((sum, day) => sum + day.streets_polled, 0) / nights.length)
      : 0;
    const batchSize = this.#report?.poll_batch_size;
    const rotationNights = perNight > 0 ? Math.ceil(audited.length / perNight) : null;

    const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '—');
    const row = (label, value, note) => `
      <tr>
        <td>${label}</td>
        <td class="ac-num">${value}</td>
        <td class="ac-muted">${note}</td>
      </tr>`;
    host.innerHTML = `
      <div class="ac-table-wrap">
        <table class="ps-table ps-table--compact ac-table">
          <thead>
            <tr><th class="ac-th-text">Rotation</th><th>Streets</th><th class="ac-th-text">Notes</th></tr>
          </thead>
          <tbody>
            ${row('Routable streets', this.#streets.length.toLocaleString(),
              `${audited.length.toLocaleString()} of them audited at least once`)}
            ${row('With any imagery record', withRow.length.toLocaleString(),
              `${pct(withRow.length, this.#streets.length)} of routable streets, from any feeder`)}
            ${row('With a polled capture date', withMedian.length.toLocaleString(),
              'only the nightly poll writes this, and only it can raise a re-audit flag')}
            ${row('Audited and polled', auditedWithMedian.length.toLocaleString(),
              `${pct(auditedWithMedian.length, audited.length)} of audited streets; the rest are unmeasured, `
              + 'not up to date')}
            ${row('Audits still current', stillCurrent.toLocaleString(),
              'polled imagery is no newer than the last audit, so the labels still describe what is there')}
            ${row('Audits behind the imagery', behind.toLocaleString(),
              'the backlog charted below, by how far behind it is')}
            ${row('Refreshed in the last 30 days', recent.toLocaleString(),
              'streets whose imagery record was written or re-confirmed recently')}
            ${row('Full pass over audited streets', rotationNights === null ? '—' : `~${rotationNights} nights`,
              perNight > 0
                ? `at ${perNight.toLocaleString()} streets a night observed, batch size ${
                  (batchSize || 0).toLocaleString()}`
                : 'no night in the window polled a street, so the rotation is not advancing')}
            ${row('Oldest imagery record', oldest ? oldest.slice(0, 10) : '—',
              'the street the rotation has left longest without a look')}
          </tbody>
        </table>
      </div>`;
  }

  /**
   * The histogram of how far behind their imagery the audits are.
   *
   * Only streets whose imagery is genuinely newer are plotted. Including the ones still up to date put the single
   * largest bar on the outcome that needs no action, which buried the distribution that does.
   */
  #renderFreshness() {
    const measured = this.#streets.filter((street) => street.median_newest_capture && street.last_audit_date);
    const behind = measured.filter((street) =>
      ImageryPage.#daysBetween(street.last_audit_date, street.median_newest_capture) > 0);
    const buckets = ImageryPage.#FRESHNESS_BUCKETS.map((bucket) => ({ ...bucket, count: 0 }));
    for (const street of behind) {
      const days = ImageryPage.#daysBetween(street.last_audit_date, street.median_newest_capture);
      const bucket = buckets.find((b) => days <= b.max) || buckets[buckets.length - 1];
      bucket.count += 1;
    }
    MiniLineChart.renderInto(document.getElementById('imagery-freshness-chart'),
      buckets.map((bucket) => bucket.label),
      [{ name: 'Streets', key: 'freshness', values: buckets.map((bucket) => bucket.count) }],
      {
        kind: 'bar',
        barValues: true,
        ariaLabel: 'Streets by how much newer their polled imagery is than their most recent audit',
        valueFormat: (v) => `${Math.round(v).toLocaleString()} street${Math.round(v) === 1 ? '' : 's'}`,
      });

    const audited = this.#streets.filter((street) => street.last_audit_date);
    const unmeasured = audited.length - measured.length;
    const note = document.getElementById('imagery-freshness-note');
    if (note) {
      note.textContent = `${behind.length.toLocaleString()} audited streets have imagery newer than their last `
        + `audit. ${(measured.length - behind.length).toLocaleString()} more are still current, and `
        + `${unmeasured.toLocaleString()} have not been polled conclusively yet, so neither group is plotted here. `
        + 'The gap is measured against each street’s most recent audit while the flag is raised per audit, so a '
        + 'street can be absent from this chart and still have an older audit flagged.';
    }
  }

  /** Streets whose imagery record was written within the last `days` days. */
  static #refreshedWithin(streets, days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return streets.filter((street) => street.imagery_updated_at && Date.parse(street.imagery_updated_at) >= cutoff)
      .length;
  }

  /** Whole days from `from` to `to`, both YYYY-MM-DD; negative when `to` is the earlier date. */
  static #daysBetween(from, to) {
    return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  }

  /**
   * A tier's share of the city, rounded but never to a figure that contradicts its own count: a tier holding nine
   * streets reads "<1%", not "0%".
   *
   * @param {number} count - Streets in the tier.
   * @param {number} total - Routable streets city-wide.
   * @returns {string} A percentage, or an em dash when there is nothing to divide by.
   */
  static #share(count, total) {
    if (!total) return '—';
    const pct = (count / total) * 100;
    if (count > 0 && pct < 0.5) return '<1%';
    return `${Math.round(pct)}%`;
  }

  /** Meters to miles, matching the units the Overview page reports re-audit distance in. */
  static #miles(meters) {
    return (meters || 0) * 0.000621371;
  }

  /** A count or label carrying its tier's color, used in both tables. */
  static #tierCell(value, tierKey) {
    const swatch = `<span class="street-status-swatch imagery-swatch--${tierKey.replace(/_/g, '-')}"`
      + ' aria-hidden="true"></span>';
    const text = typeof value === 'number' ? AdminShell.num(value) : AdminShell.esc(value);
    return `${swatch}${text}`;
  }

  /** Updates the status line; pass hide=true to remove it once data has loaded. */
  #setStatus(message, isError, hide = false) {
    const status = document.getElementById('imagery-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', !!isError);
    status.classList.toggle('hidden', hide);
  }

  /** True if two id lists contain the same set of ids (order-independent). */
  static #sameSet(a, b) {
    if (a.length !== b.length) return false;
    const set = new Set(a);
    return b.every((id) => set.has(id));
  }
}
