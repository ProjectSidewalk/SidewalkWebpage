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
   *          ariaLabel?: string, dotRadius?: number, kind?: string, maxXLabels?: number, barValues?: boolean,
   *          emphasisIndex?: number, minMarginL?: number, minMarginR?: number}} [opts] - yMax defaults to the data
   *   max; tickFormat labels the y-axis; valueFormat formats values in the default tooltip and in bar value labels;
   *   dotRadius sizes the point markers (default 3); kind 'bar' draws bars instead of lines; maxXLabels caps how many
   *   x labels are drawn (default 6); barValues draws each bar's value above it (meant for single-series bar charts —
   *   grouped bars would collide); emphasisIndex marks that index's bar and labels with `--emphasis` classes (e.g. an
   *   in-progress "today" bar); minMarginL/minMarginR raise the axis margins, which renderInto uses to redraw at
   *   measured label widths.
   * @returns {string} SVG markup plus an optional HTML legend.
   */
  static svg(categories, series, opts = {}) {
    const W = opts.width || 760;
    const H = 220;
    const n = categories.length;
    const isBar = opts.kind === 'bar';
    const allVals = series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined));
    const yMax = opts.yMax || Math.max(1, ...allVals);
    const tickFormat = opts.tickFormat || ((v) => Math.round(v).toLocaleString());
    const valueFormat = opts.valueFormat || ((v) => Math.round(v).toLocaleString());
    const dotRadius = opts.dotRadius ?? 3;

    const tickFracs = [0, 0.25, 0.5, 0.75, 1];
    const tickText = tickFracs.map((f) => tickFormat(f * yMax));
    const step = Math.max(1, Math.ceil(n / (opts.maxXLabels || 6)));
    const xLabelIdx = [];
    for (let i = 0; i < n; i += step) xLabelIdx.push(i);

    // Margins are sized to the labels rather than fixed: anything drawn outside the viewBox is clipped by the SVG, so
    // a fixed left margin beheaded seven-digit y ticks ("1,400,146" → "400,146") and a fixed right margin cut the last
    // x label in half (#4855). The end-anchored y ticks need their full width plus the gap; the centered outermost x
    // labels need half of theirs. Floors keep the usual small-number case looking exactly as before.
    const yTickW = Math.max(...tickText.map((t) => MiniLineChart.#labelWidth(t)));
    const xEdgeHalf = (i) => (i === undefined ? 0 : MiniLineChart.#labelWidth(categories[i]) / 2);
    const m = {
      l: Math.ceil(Math.max(48, yTickW + MiniLineChart.#AXIS_GAP + 2, xEdgeHalf(xLabelIdx[0]), opts.minMarginL || 0)),
      r: Math.ceil(Math.max(14, xEdgeHalf(xLabelIdx[xLabelIdx.length - 1]) + 2, opts.minMarginR || 0)),
      t: 14,
      b: 30,
    };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    // Bars sit on band centers; line points span the full width edge to edge.
    const x = (i) => (isBar ? m.l + ((i + 0.5) / n) * iw : m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw));
    const yFrac = (f) => m.t + (1 - f) * ih; // f in [0, 1]

    let grid = '';
    tickFracs.forEach((f, ti) => {
      const yy = yFrac(f).toFixed(1);
      grid += `<line class="mini-grid" x1="${m.l}" y1="${yy}" x2="${W - m.r}" y2="${yy}"/>`
        + `<text class="mini-axis" x="${m.l - MiniLineChart.#AXIS_GAP}" y="${(yFrac(f) + 3).toFixed(1)}" `
        + `text-anchor="end">${MiniLineChart.#esc(tickText[ti])}</text>`;
    });

    let body = '';
    if (isBar) {
      // With multiple series, each band is split into side-by-side bars (grouped, not stacked).
      const band = iw / n;
      const groupW = Math.min(band * 0.62, 48 * series.length);
      const barW = groupW / series.length;
      series.forEach((s, si) => {
        body += s.values.map((v, i) => {
          if (v === null || v === undefined) return '';
          const emph = i === opts.emphasisIndex;
          const top = yFrac(v / yMax);
          const h = m.t + ih - top;
          const bx = x(i) - groupW / 2 + si * barW;
          const tip = s.tooltips?.[i] ?? `${categories[i]} · ${s.name}: ${valueFormat(v)}`;
          // Zero values draw no bar; the x label (and value label, if enabled) still mark the category.
          let out = h <= 0
            ? ''
            : `<rect class="mini-bar mini-bar--${s.key}${emph ? ' mini-bar--emphasis' : ''}" x="${bx.toFixed(1)}" `
              + `y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}">`
              + `<title>${MiniLineChart.#esc(tip)}</title></rect>`;
          if (opts.barValues) {
            out += `<text class="mini-value${emph ? ' mini-value--emphasis' : ''}" x="${(bx + barW / 2).toFixed(1)}" `
              + `y="${((h > 0 ? top : yFrac(0)) - 4).toFixed(1)}" text-anchor="middle">`
              + `${MiniLineChart.#esc(valueFormat(v))}</text>`;
          }
          return out;
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

    let xlab = '';
    for (const i of xLabelIdx) {
      const emph = i === opts.emphasisIndex ? ' mini-axis--emphasis' : '';
      xlab += `<text class="mini-axis${emph}" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">`
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
      // svg() can only estimate label widths from character counts, and the axis font is whatever the page resolves
      // `--font-sans` to. Now that the SVG is in the document its text can be measured for real, so widen the margins
      // and redraw if anything still overhangs the viewBox — the estimate stays the fast path, this is the guarantee.
      const grown = MiniLineChart.#marginsForOverhang(container, width);
      if (grown) container.innerHTML = MiniLineChart.svg(categories, series, { ...opts, width, ...grown });
    };
    container._miniDraw();
    if (typeof ResizeObserver !== 'undefined' && !container._miniResizeObserver) {
      // Setting innerHTML doesn't change the container's own box, so observing it won't loop.
      const ro = new ResizeObserver(() => container._miniDraw && container._miniDraw());
      ro.observe(container);
      container._miniResizeObserver = ro;
    }
  }

  /**
   * Measures the rendered labels of a drawn chart and returns margins wide enough to hold the ones that overhang the
   * viewBox, or null when everything already fits (the usual case) or nothing can be measured — a container that is
   * display:none has no layout, and getBBox is absent under jsdom.
   *
   * @param {HTMLElement} container - Container holding a chart drawn by svg().
   * @param {number} width - The viewBox width the chart was drawn at.
   * @returns {?{minMarginL: number, minMarginR: number}} Margin floors for a redraw, or null to keep the current draw.
   */
  static #marginsForOverhang(container, width) {
    const grid = container.querySelector('line.mini-grid');
    const labels = container.querySelectorAll('text');
    if (!grid || !labels.length || typeof labels[0].getBBox !== 'function') return null;
    let left = 0;
    let right = 0;
    for (const label of labels) {
      let box;
      try {
        box = label.getBBox();
      } catch {
        return null; // Not laid out (e.g. a hidden container); a later resize-driven draw will measure it.
      }
      if (!box.width) continue;
      left = Math.max(left, -box.x);
      right = Math.max(right, box.x + box.width - width);
    }
    // Sub-pixel overhang is antialiasing, not a clipped glyph; redrawing for it would just churn.
    if (left < 0.5 && right < 0.5) return null;
    return {
      minMarginL: Math.ceil(Number(grid.getAttribute('x1')) + Math.max(0, left)),
      minMarginR: Math.ceil(width - Number(grid.getAttribute('x2')) + Math.max(0, right)),
    };
  }

  /** Font size of `.mini-axis` / `.mini-value` in px — keep in sync with admin-dashboard.css. */
  static #AXIS_FONT_PX = 11;

  /** Gap in px between a y-axis tick label and the axis it labels. */
  static #AXIS_GAP = 6;

  /**
   * Estimates the rendered width of an axis label so the margins can make room for it. The chart is built as a string
   * with no DOM to measure against, so widths come from per-character advances for a generic sans face; digits,
   * separators, and caps differ too much for a flat average to size something like "1,400,146". The estimate rounds
   * up on purpose — a few px of over-reserved margin is invisible, an underestimate clips the label.
   *
   * @param {string} s - The label text.
   * @returns {number} Estimated width in px.
   */
  static #labelWidth(s) {
    let em = 0;
    for (const ch of String(s)) {
      if (ch >= '0' && ch <= '9') em += 0.56;
      else if (' ,.:'.includes(ch)) em += 0.3;
      else if (ch === '%') em += 0.9;
      else if (ch >= 'A' && ch <= 'Z') em += 0.72;
      else em += 0.58;
    }
    return em * MiniLineChart.#AXIS_FONT_PX;
  }

  static #esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
}
