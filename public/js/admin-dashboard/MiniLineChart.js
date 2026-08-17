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
   * @param {Array<{name: string, key: string, values: Array<number|null>, tooltips?: string[],
   *          tooltipsHtml?: string[]}>} series -
   *   each series' values align to `categories`; null = gap. Optional per-point tooltip strings, and optional
   *   per-point rich cards: where `tooltipsHtml` has an entry, the point trades its native `<title>` for a
   *   `data-ps-tooltip` card and becomes focusable, so the breakdown is reachable by keyboard as well as hover (the
   *   plain `tooltips` string stays on as its accessible name). Card markup is first-party only — escape any name or
   *   other data that came from a user before putting it in one.
   * @param {{yMax?: number, tickFormat?: function(number): string, valueFormat?: function(number): string,
   *          ariaLabel?: string, dotRadius?: number, kind?: string, maxXLabels?: number, barValues?: boolean,
   *          emphasisIndex?: number, minMarginL?: number, minMarginR?: number}} [opts] - yMax defaults to a nice
   *   rounded max above the data; tickFormat labels the y-axis (abbreviated by default, e.g. "1.6M") while
   *   valueFormat formats values in the default tooltip and in bar value labels, so hovering still gives the exact
   *   count;
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
    // Scaling the axis to the exact data max makes every gridline an arbitrary number (350,037 · 700,073 · 1,050,110);
    // rounding the top up to a nice step lands them on values a reader can compare at a glance. Tooltips keep the
    // exact counts, so the axis can trade precision for legibility.
    const yMax = opts.yMax || MiniLineChart.#niceMax(Math.max(1, ...allVals), allVals.every(Number.isInteger));
    const tickFormat = opts.tickFormat || MiniLineChart.#compact;
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
          // A zero value draws no bar, so the interaction lives on a full-height invisible rect instead of on the bar
          // itself. Otherwise a zero-value category would have nothing to hover or focus — and a day can read zero here
          // while still having something to say (an AI-only day, or one whose other charts are non-zero). It doubles as
          // a bigger target for the non-zero bars.
          let out = h <= 0
            ? ''
            : `<rect class="mini-bar mini-bar--${s.key}${emph ? ' mini-bar--emphasis' : ''}" x="${bx.toFixed(1)}" `
              + `y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}"/>`;
          out += `<rect class="mini-bar-hit" x="${bx.toFixed(1)}" y="${m.t.toFixed(1)}" `
            + `width="${barW.toFixed(1)}" height="${ih.toFixed(1)}"`
            + `${MiniLineChart.#pointTip(tip, s.tooltipsHtml?.[i])}</rect>`;
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
            + `cy="${yFrac(v / yMax).toFixed(1)}" r="${dotRadius}"`
            + `${MiniLineChart.#pointTip(tip, s.tooltipsHtml?.[i])}</circle>`;
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
    // `role="img"` makes an element's subtree presentational, which would prune the per-point roles and labels below it
    // out of the accessibility tree. So a chart whose points are individually focusable is a `group` instead, leaving
    // them reachable and announced; a chart that is just a picture keeps `img`.
    const hasFocusablePoints = series.some((s) => s.tooltipsHtml?.some(Boolean));
    const svg = `<svg class="mini-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" `
      + `role="${hasFocusablePoints ? 'group' : 'img'}" `
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
    // The measured correction below depends on label text and font, not on width, so it's the same at every width
    // once known — cache it per draw and skip re-measuring (a forced-layout getBBox() pass) on every resize tick.
    let grownMargins = null;
    // Store the latest draw on the container so a persistent container re-rendered with new data (e.g. a trend that
    // re-fetches on a range change) keeps the resize observer pointed at the current data, not the first call's.
    container._miniDraw = () => {
      const width = Math.max(280, Math.round(container.clientWidth) || 760);
      container.innerHTML = MiniLineChart.svg(categories, series, { ...opts, width, ...grownMargins });
      if (grownMargins) return;
      // svg() can only estimate label widths from character counts, and the axis font is whatever the page resolves
      // `--font-sans` to. Now that the SVG is in the document its text can be measured for real, so widen the margins
      // and redraw if anything still overhangs the viewBox — the estimate stays the fast path, this is the guarantee.
      const grown = MiniLineChart.#marginsForOverhang(container, width);
      if (grown) {
        grownMargins = grown;
        container.innerHTML = MiniLineChart.svg(categories, series, { ...opts, width, ...grown });
      }
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

  /**
   * Rounds a data max up so the four gridline gaps below it are a nice step (400,000 rather than 350,036.5). The
   * candidate steps are the round-looking mantissas; the finer ones (1.5, 3, 6, 8) keep the headroom small, since a
   * coarse 1-2-5 ladder can push a 2.28M series onto a 4M axis and leave the line hugging the floor.
   *
   * @param {number} dataMax - Largest value in the data (> 0).
   * @param {boolean} integral - Whether the data are whole numbers, in which case fractional ticks read as noise.
   * @returns {number} A y-max whose quarter is a nice step.
   */
  static #niceMax(dataMax, integral) {
    const rawStep = dataMax / 4;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const mantissa = rawStep / magnitude;
    let step = ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((c) => mantissa <= c) ?? 10) * magnitude;
    if (integral && !Number.isInteger(step)) step = Math.ceil(step);
    return step * 4;
  }

  /**
   * Abbreviates a tick value ("1.6M", "800k", "250"). Axis room is scarce and the exact figure is a hover away in the
   * tooltip, so ticks trade digits for readability. Matches the dashboard's own compact style — lowercase k, capital
   * M/B — so an axis and a KPI tile spell the same number the same way.
   *
   * @param {number} v - The value to label.
   * @returns {string} Abbreviated label.
   */
  static #compact(v) {
    const abs = Math.abs(v);
    const unit = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']].find(([min]) => abs >= min);
    if (!unit) return Math.round(v).toLocaleString();
    return `${(v / unit[0]).toFixed(1).replace(/\.0$/, '')}${unit[1]}`;
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

  /**
   * Closes a point's opening tag and gives it a tooltip: a native `<title>` normally, or a psTooltip card plus the
   * focusability and accessible name that card needs when the caller supplied rich markup for this point.
   *
   * The two are exclusive on purpose — a point carrying both would answer a hover with a card and a native tooltip
   * stacked on top of each other.
   *
   * @param {string} tip - Plain-text summary of the point.
   * @param {string} [html] - Rich card markup for the point; already escaped for any user-supplied text it contains.
   * @returns {string} Markup closing the point's opening tag, with its `<title>` child when there is one.
   */
  static #pointTip(tip, html) {
    if (!html) return `><title>${MiniLineChart.#esc(tip)}</title>`;
    return ` tabindex="0" role="img" aria-label="${MiniLineChart.#esc(tip)}" `
      + `data-ps-tooltip="${MiniLineChart.#esc(html)}">`;
  }

  static #esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
}
