/**
 * Renders the coverage *distribution* — regions binned into 10% coverage buckets — with Vega-Lite v5. This scales to
 * any number of regions (constant height) where per-region bars don't, and answers "how is coverage distributed
 * across the city?". Hovering or clicking a bucket fires its index so the coordinator can brush every region in that
 * coverage range on the map and table at once (range brushing). Buckets are pre-binned by the coordinator so colors
 * match the choropleth exactly and the index maps cleanly back to a set of regions.
 */
class CoverageHistogram {
    #containerId;
    #onBinClick;
    #onBinHover;
    #onBinHoverEnd;
    #view = null;
    #hoverIndex = null;

    /**
     * @param {string} containerId - id of the chart container element.
     * @param {{onBinClick?: function(number): void, onBinHover?: function(number): void,
     *          onBinHoverEnd?: function(): void}} [opts]
     */
    constructor(containerId, opts = {}) {
        this.#containerId = containerId;
        this.#onBinClick = opts.onBinClick || (() => {});
        this.#onBinHover = opts.onBinHover || (() => {});
        this.#onBinHoverEnd = opts.onBinHoverEnd || (() => {});
    }

    /**
     * Renders the histogram.
     * @param {Array<{index: number, label: string, count: number, color: string}>} buckets
     * @returns {Promise<void>}
     */
    async render(buckets) {
        const spec = {
            $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
            width: 'container',
            height: 180,
            autosize: { type: 'fit-x', contains: 'padding' },
            data: { values: buckets },
            mark: { type: 'bar', cursor: 'pointer' },
            encoding: {
                x: {
                    field: 'label', type: 'ordinal', sort: { field: 'index' },
                    axis: { title: 'Audit coverage', labelAngle: 0 },
                },
                y: { field: 'count', type: 'quantitative', axis: { title: 'Regions', tickMinStep: 1 } },
                color: { field: 'color', type: 'nominal', scale: null, legend: null },
                tooltip: [
                    { field: 'label', type: 'nominal', title: 'Coverage' },
                    { field: 'count', type: 'quantitative', title: 'Regions' },
                ],
            },
            config: { view: { stroke: null }, axis: { labelFont: 'Inter, sans-serif' } },
        };

        const result = await vegaEmbed(`#${this.#containerId}`, spec, { actions: false, renderer: 'svg' });
        this.#view = result.view;
        this.#hoverIndex = null;
        this.#wireEvents();
    }

    #wireEvents() {
        this.#view.addEventListener('click', (event, item) => {
            if (item && item.datum && item.datum.index != null) this.#onBinClick(Number(item.datum.index));
        });
        this.#view.addEventListener('pointermove', (event, item) => {
            const idx = item && item.datum && item.datum.index != null ? Number(item.datum.index) : null;
            if (idx === this.#hoverIndex) return;
            this.#hoverIndex = idx;
            if (idx != null) this.#onBinHover(idx);
            else this.#onBinHoverEnd();
        });
        this.#view.addEventListener('pointerout', () => {
            if (this.#hoverIndex === null) return;
            this.#hoverIndex = null;
            this.#onBinHoverEnd();
        });
    }
}
