/**
 * Renders the per-region coverage bar chart with Vega-Lite v5 and links it to the map. Hovering or clicking a bar
 * fires the corresponding callbacks so a coordinator can brush/pin the matching region on the map; highlightBar()/
 * clearHighlight() dim the non-selected bars in response to map interaction. Bars use the exact per-datum color
 * computed from CoverageColors so they match the choropleth precisely. The sort order (coverage vs name) is
 * switchable at runtime via setSort().
 */
class CoverageBars {
  #containerId;
  #onBarClick;
  #onBarHover;
  #onBarHoverEnd;
  #data = [];
  #sort = 'coverage';
  #view = null;
  #hoverId = null;

  /**
     * @param {string} containerId - id of the chart container element.
     * @param {{onBarClick?: function(number): void, onBarHover?: function(number): void,
     *          onBarHoverEnd?: function(): void}} [opts]
     */
  constructor(containerId, opts = {}) {
    this.#containerId = containerId;
    this.#onBarClick = opts.onBarClick || (() => {});
    this.#onBarHover = opts.onBarHover || (() => {});
    this.#onBarHoverEnd = opts.onBarHoverEnd || (() => {});
  }

  /**
     * Stores the data and renders the chart.
     * @param {Array<object>} data - Rows with region_id, name, completion_rate, color, distances, and counts.
     * @returns {Promise<void>}
     */
  render(data) {
    this.#data = data;
    return this.#embed();
  }

  /**
     * Re-renders the chart with a new sort order.
     * @param {'coverage'|'name'} mode
     * @returns {Promise<void>}
     */
  setSort(mode) {
    this.#sort = mode;
    return this.#embed();
  }

  /** Builds the Vega-Lite spec for the current data/sort and embeds it, wiring hover + click events. */
  async #embed() {
    // 'coverage' → bars descending by value; 'name' → alphabetical by region name.
    const sort = this.#sort === 'name' ? 'ascending' : '-x';
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      width: 'container',
      height: { step: 16 },
      // Include the left axis labels in the fitted width so the chart never overflows its container.
      autosize: { type: 'fit-x', contains: 'padding' },
      data: { values: this.#data },
      // A value param we can drive from outside (map interaction) to dim non-selected bars.
      params: [{ name: 'externalSelect', value: null }],
      mark: { type: 'bar', cursor: 'pointer' },
      encoding: {
        y: { field: 'name', type: 'nominal', sort, axis: { title: null, labelLimit: 160 } },
        x: {
          field: 'completion_rate', type: 'quantitative',
          scale: { domain: [0, 1] },
          axis: { title: 'Audit coverage', format: '.0%', grid: true },
        },
        color: { field: 'color', type: 'nominal', scale: null, legend: null },
        opacity: {
          condition: {
            test: 'externalSelect === null || indexof(externalSelect, datum.region_id) >= 0', value: 1,
          },
          value: 0.25,
        },
        tooltip: [
          { field: 'name', type: 'nominal', title: 'Region' },
          { field: 'completion_rate', type: 'quantitative', format: '.0%', title: 'Coverage' },
          { field: 'audited_distance_m', type: 'quantitative', format: ',.0f', title: 'Audited (m)' },
          { field: 'total_distance_m', type: 'quantitative', format: ',.0f', title: 'Total (m)' },
          { field: 'street_count', type: 'quantitative', format: ',', title: 'Streets' },
          { field: 'audit_count', type: 'quantitative', format: ',', title: 'Audits' },
          { field: 'label_count', type: 'quantitative', format: ',', title: 'Labels' },
          { field: 'user_count', type: 'quantitative', format: ',', title: 'Contributors' },
        ],
      },
      config: { view: { stroke: null }, axis: { labelFont: 'Inter, sans-serif' } },
    };

    const result = await vegaEmbed(`#${this.#containerId}`, spec, { actions: false, renderer: 'svg' });
    this.#view = result.view;
    this.#hoverId = null;
    this.#wireEvents();
  }

  /** Wires bar click (pin) and pointer hover (brush) to the callbacks. */
  #wireEvents() {
    this.#view.addEventListener('click', (event, item) => {
      const regionId = item?.datum?.region_id ?? null;
      if (regionId !== null) this.#onBarClick(Number(regionId));
    });
    this.#view.addEventListener('pointermove', (event, item) => {
      const regionId = item?.datum?.region_id ?? null;
      const id = regionId === null ? null : Number(regionId);
      if (id === this.#hoverId) return;
      this.#hoverId = id;
      if (id !== null) this.#onBarHover(id);
      else this.#onBarHoverEnd();
    });
    this.#view.addEventListener('pointerout', () => {
      if (this.#hoverId === null) return;
      this.#hoverId = null;
      this.#onBarHoverEnd();
    });
  }

  /** Dims every bar except the given regions. @param {number[]} ids */
  highlightBars(ids) {
    if (this.#view) this.#view.signal('externalSelect', ids).run();
  }

  /** Convenience for a single-region highlight. @param {number} regionId */
  highlightBar(regionId) {
    this.highlightBars([regionId]);
  }

  /** Restores all bars to full opacity. */
  clearHighlight() {
    if (this.#view) this.#view.signal('externalSelect', null).run();
  }
}
