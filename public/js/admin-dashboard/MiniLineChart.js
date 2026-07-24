/**
 * MiniLineChart — a tiny, dependency-free SVG chart for the admin dashboard. Renders one or more series over a shared
 * set of x categories as lines (default) or bars (`kind: 'bar'`), with a fixed or auto y-max, gridlines, hover
 * tooltips, and a legend (when >1 series). Series colors come from CSS classes (`.mini-line--<key>` /
 * `.mini-pt--<key>` / `.mini-bar--<key>` / `.mini-swatch--<key>`) so callers style them with design tokens. Shared by
 * the Data Quality (agreement-over-time), API Analytics (usage-over-time), and Across Cities pages so the chart isn't
 * duplicated.
 */
class MiniLineChart {
  /**
   * @param {string[]} categories - x-axis labels (one per data index).
   * @param {Array<{name: string, key: string, values: Array<number|null>, tooltips?: string[]}>} series -
   *   each series' values align to `categories`; null = gap. Optional per-point tooltip strings.
   * @param {{yMax?: number, tickFormat?: function(number): string, valueFormat?: function(number): string,
   *          ariaLabel?: string, dotRadius?: number, kind?: string, maxXLabels?: number}} [opts] - yMax defaults to
   *   the data max; tickFormat labels the y-axis; valueFormat formats values in the default tooltip; dotRadius sizes
   *   the point markers (default 3); kind 'bar' draws bars instead of lines; maxXLabels caps how many x labels are
   *   drawn (default 6).
   * @returns {string} SVG markup plus an optional HTML legend.
   */
  static svg(categories, series, opts = {}) {
    const W = opts.width || 760;
    const H = 220;
    const m = { l: 48, r: 14, t: 14, b: 30 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const n = categories.length;
    const isBar = opts.kind === 'bar';
    // Bars sit on band centers; line points span the full width edge to edge.
    const x = (i) => (isBar ? m.l + ((i + 0.5) / n) * iw : m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw));
    const yFrac = (f) => m.t + (1 - f) * ih; // f in [0, 1]
    const allVals = series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined));
    const yMax = opts.yMax || Math.max(1, ...allVals);
    const tickFormat = opts.tickFormat || ((v) => Math.round(v).toLocaleString());
    const valueFormat = opts.valueFormat || ((v) => Math.round(v).toLocaleString());
    const dotRadius = opts.dotRadius ?? 3;

    let grid = '';
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const yy = yFrac(f).toFixed(1);
      grid += `<line class="mini-grid" x1="${m.l}" y1="${yy}" x2="${W - m.r}" y2="${yy}"/>`
        + `<text class="mini-axis" x="${m.l - 6}" y="${(yFrac(f) + 3).toFixed(1)}" text-anchor="end">`
        + `${MiniLineChart.#esc(tickFormat(f * yMax))}</text>`;
    }

    let body = '';
    if (isBar) {
      // With multiple series, each band is split into side-by-side bars (grouped, not stacked).
      const band = iw / n;
      const groupW = Math.min(band * 0.62, 48 * series.length);
      const barW = groupW / series.length;
      series.forEach((s, si) => {
        body += s.values.map((v, i) => {
          if (v === null || v === undefined) return '';
          const top = yFrac(v / yMax);
          const h = m.t + ih - top;
          if (h <= 0) return ''; // Zero values draw no bar; the x label still marks the category.
          const bx = x(i) - groupW / 2 + si * barW;
          const tip = s.tooltips?.[i] ?? `${categories[i]} · ${s.name}: ${valueFormat(v)}`;
          return `<rect class="mini-bar mini-bar--${s.key}" x="${bx.toFixed(1)}" y="${top.toFixed(1)}" `
            + `width="${barW.toFixed(1)}" height="${h.toFixed(1)}">`
            + `<title>${MiniLineChart.#esc(tip)}</title></rect>`;
        }).join('');
      });
    } else {
      for (const s of series) {
        let d = '';
        let move = true;
        s.values.forEach((v, i) => {
          if (v === null || v === undefined) {
            move = true;
            return;
          }
          d += `${move ? 'M' : 'L'}${x(i).toFixed(1)},${yFrac(v / yMax).toFixed(1)} `;
          move = false;
        });
        const dots = s.values.map((v, i) => {
          if (v === null || v === undefined) return '';
          const tip = s.tooltips?.[i] ?? `${categories[i]} · ${s.name}: ${valueFormat(v)}`;
          return `<circle class="mini-pt mini-pt--${s.key}" cx="${x(i).toFixed(1)}" `
            + `cy="${yFrac(v / yMax).toFixed(1)}" r="${dotRadius}">`
            + `<title>${MiniLineChart.#esc(tip)}</title></circle>`;
        }).join('');
        body += `<path class="mini-line mini-line--${s.key}" d="${d.trim()}"/>${dots}`;
      }
    }

    const step = Math.max(1, Math.ceil(n / (opts.maxXLabels || 6)));
    let xlab = '';
    for (let i = 0; i < n; i += step) {
      xlab += `<text class="mini-axis" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">`
        + `${MiniLineChart.#esc(categories[i])}</text>`;
    }
    const svg = `<svg class="mini-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" `
      + `aria-label="${MiniLineChart.#esc(opts.ariaLabel || 'Line chart')}"><g>${grid}</g>${body}<g>${xlab}</g></svg>`;
    const legendItems = series.map((s) =>
      `<span class="mini-legend-item"><span class="mini-swatch mini-swatch--${s.key}"></span>`
      + `${MiniLineChart.#esc(s.name)}</span>`,
    ).join('');
    const legend = series.length > 1 ? `<div class="mini-legend">${legendItems}</div>` : '';
    return svg + legend;
  }

  /**
   * Renders the chart into a container sized to the container's *current pixel width*, and re-renders on resize. This
   * keeps the chart full-width and responsive while font sizes, line widths, and dot radii stay a constant on-screen
   * size — a fixed-viewBox SVG stretched to 100% width would scale all of those up together on wide screens.
   *
   * @param {HTMLElement} container - The element to render into (its innerHTML is replaced).
   * @param {string[]} categories - x-axis labels (see svg()).
   * @param {Array<object>} series - data series (see svg()).
   * @param {object} [opts] - same options as svg(); `width` is supplied automatically from the container.
   */
  static renderInto(container, categories, series, opts = {}) {
    if (!container) return;
    // Store the latest draw on the container so a persistent container re-rendered with new data (e.g. a trend that
    // re-fetches on a range change) keeps the resize observer pointed at the current data, not the first call's.
    container._miniDraw = () => {
      const width = Math.max(280, Math.round(container.clientWidth) || 760);
      container.innerHTML = MiniLineChart.svg(categories, series, { ...opts, width });
    };
    container._miniDraw();
    if (typeof ResizeObserver !== 'undefined' && !container._miniResizeObserver) {
      // Setting innerHTML doesn't change the container's own box, so observing it won't loop.
      const ro = new ResizeObserver(() => container._miniDraw && container._miniDraw());
      ro.observe(container);
      container._miniResizeObserver = ro;
    }
  }

  static #esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
}
