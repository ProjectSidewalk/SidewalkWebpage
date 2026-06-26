/**
 * MiniLineChart — a tiny, dependency-free SVG line chart for the admin dashboard. Renders one or more series over a
 * shared set of x categories, with a fixed or auto y-max, gridlines, hover tooltips, and a legend (when >1 series).
 * Series colors come from CSS classes (`.mini-line--<key>` / `.mini-pt--<key>` / `.mini-swatch--<key>`) so callers
 * style them with design tokens. Shared by the Data Quality (agreement-over-time) and API Analytics (usage-over-time)
 * pages so the chart isn't duplicated.
 */
class MiniLineChart {
    /**
     * @param {string[]} categories - x-axis labels (one per data index).
     * @param {Array<{name: string, key: string, values: Array<number|null>, tooltips?: string[]}>} series -
     *   each series' values align to `categories`; null = gap. Optional per-point tooltip strings.
     * @param {{yMax?: number, tickFormat?: function(number): string, valueFormat?: function(number): string,
     *          ariaLabel?: string, dotRadius?: number}} [opts] - yMax defaults to the data max; tickFormat labels the
     *   y-axis; valueFormat formats values in the default tooltip; dotRadius sizes the point markers (default 3).
     * @returns {string} SVG markup plus an optional HTML legend.
     */
    static svg(categories, series, opts = {}) {
        const W = 760, H = 220, m = { l: 48, r: 14, t: 14, b: 30 };
        const iw = W - m.l - m.r, ih = H - m.t - m.b, n = categories.length;
        const x = i => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
        const yFrac = f => m.t + (1 - f) * ih; // f in [0, 1]
        const allVals = series.flatMap(s => s.values.filter(v => v != null));
        const yMax = opts.yMax || Math.max(1, ...allVals);
        const tickFormat = opts.tickFormat || (v => Math.round(v).toLocaleString());
        const valueFormat = opts.valueFormat || (v => Math.round(v).toLocaleString());
        const dotRadius = opts.dotRadius != null ? opts.dotRadius : 3;

        let grid = '';
        for (const f of [0, 0.25, 0.5, 0.75, 1]) {
            const yy = yFrac(f).toFixed(1);
            grid += `<line class="mini-grid" x1="${m.l}" y1="${yy}" x2="${W - m.r}" y2="${yy}"/>` +
                `<text class="mini-axis" x="${m.l - 6}" y="${(yFrac(f) + 3).toFixed(1)}" text-anchor="end">${MiniLineChart.#esc(tickFormat(f * yMax))}</text>`;
        }

        let body = '';
        for (const s of series) {
            let d = '';
            let move = true;
            s.values.forEach((v, i) => {
                if (v == null) { move = true; return; }
                d += `${move ? 'M' : 'L'}${x(i).toFixed(1)},${yFrac(v / yMax).toFixed(1)} `;
                move = false;
            });
            const dots = s.values.map((v, i) => {
                if (v == null) return '';
                const tip = (s.tooltips && s.tooltips[i] != null)
                    ? s.tooltips[i]
                    : `${categories[i]} · ${s.name}: ${valueFormat(v)}`;
                return `<circle class="mini-pt mini-pt--${s.key}" cx="${x(i).toFixed(1)}" cy="${yFrac(v / yMax).toFixed(1)}" r="${dotRadius}">` +
                    `<title>${MiniLineChart.#esc(tip)}</title></circle>`;
            }).join('');
            body += `<path class="mini-line mini-line--${s.key}" d="${d.trim()}"/>${dots}`;
        }

        const step = Math.max(1, Math.ceil(n / 6));
        let xlab = '';
        for (let i = 0; i < n; i += step) {
            xlab += `<text class="mini-axis" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${MiniLineChart.#esc(categories[i])}</text>`;
        }
        const svg = `<svg class="mini-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" ` +
            `aria-label="${MiniLineChart.#esc(opts.ariaLabel || 'Line chart')}"><g>${grid}</g>${body}<g>${xlab}</g></svg>`;
        const legend = series.length > 1
            ? '<div class="mini-legend">' + series.map(s =>
                `<span class="mini-legend-item"><span class="mini-swatch mini-swatch--${s.key}"></span>${MiniLineChart.#esc(s.name)}</span>`
            ).join('') + '</div>'
            : '';
        return svg + legend;
    }

    static #esc(s) {
        return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
}
