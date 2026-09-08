/**
 * The score distribution in the AccessScore insights dock (#5217): twenty bins across 0–100, each bar colored by
 * the ramp at its midpoint so the chart and the map paint one score one color, with a needle at the city's score
 * and carets where the hovered and the selected feature fall.
 *
 * The bins are `<button>`s, which is what makes the chart accessible without a separate table: each is named
 * with its range and its value, carries `aria-pressed` for the brush, and takes the keyboard — Arrow keys move
 * between bins (roving tabindex), Enter or Space toggles a bin, Shift+Arrow extends the brush, Home/End jump, and
 * Escape clears. With a pointer, a click toggles one bin, Shift+click extends the brush to the clicked bin, and a
 * drag across the bars sweeps a range; the owner is told about the sweep as it goes (`final: false`) and once on
 * release. The axis under the bars doubles as the score legend: numeric ticks, the pole words, and the swatch
 * for what carries no score (an unaudited street, or a hatched neighborhood).
 *
 * Callbacks: `onBrush({from, to, final})` (bin indices, `to` exclusive; null to clear), `onHover(bin)` and
 * `onHoverEnd()` for the pointer or focus resting on a bin.
 */
class AccessScoreHistogram extends AccessScoreChart {
  #els = null;
  #brush = null;
  #drag = null;
  #focusedBin = 0;
  #unit = 'streets';

  /**
   * @param {object} data - `{shapeKey, unit, bins, needle, brush, selection, hover}`: `bins` from
   *   `AccessScoreModel#histogram`, `needle` `{score, label}` or null, `brush` `{from, to}` or null, `selection`
   *   and `hover` scores in [0, 1] or null.
   */
  render(data) {
    this.#unit = data.unit;
    const N = data.bins.length;
    const c = this.container;
    const barsLabel = AccessScoreChart.esc(i18next.t('accessscore:histogram-bars'));
    // What carries no score in this unit: an unaudited street, or a neighborhood under the completion floor.
    const noScore = data.unit === 'regions'
      ? { swatch: 'hatch', key: 'legend-insufficient' }
      : { swatch: 'unaudited', key: 'legend-unaudited' };
    // The value labels live in a gutter left of the bars, so they never sit on the tallest bar at either end.
    c.innerHTML = `
      <div class="acs-histogram__plot">
        <div class="acs-histogram__grid" aria-hidden="true">
          <div class="acs-histogram__gridline acs-histogram__gridline--top"><span></span></div>
          <div class="acs-histogram__gridline acs-histogram__gridline--mid"><span></span></div>
        </div>
        <div class="acs-histogram__area">
          <div class="acs-histogram__bars" role="group" aria-label="${barsLabel}">
            ${data.bins.map((b, k) => `
              <button type="button" class="acs-histogram__bin" data-bin="${k}" aria-pressed="false"
                      tabindex="${k === 0 ? 0 : -1}">
                <span class="acs-histogram__bar"></span>
              </button>`).join('')}
          </div>
          <div class="acs-histogram__needle" hidden aria-hidden="true">
            <span class="acs-histogram__needle-label"></span>
          </div>
          <div class="acs-histogram__caret acs-histogram__caret--selection" hidden aria-hidden="true"></div>
          <div class="acs-histogram__caret acs-histogram__caret--hover" hidden aria-hidden="true"></div>
        </div>
      </div>
      <div class="acs-histogram__axis" aria-hidden="true">
        ${[0, 25, 50, 75, 100].map((v) => `<span>${v}</span>`).join('')}
      </div>
      <div class="acs-histogram__poles">
        <span>${i18next.t('accessscore:legend-low')}</span>
        <span class="acs-histogram__swatch-row">
          <span class="acs-histogram__swatch acs-histogram__swatch--${noScore.swatch}"></span>
          ${i18next.t(`accessscore:${noScore.key}`)}
        </span>
        <span>${i18next.t('accessscore:legend-high')}</span>
      </div>
      <p class="acs-histogram__empty" hidden>${i18next.t('accessscore:histogram-empty')}</p>`;
    const bins = Array.from(c.querySelectorAll('.acs-histogram__bin'));
    this.#els = {
      bars: c.querySelector('.acs-histogram__bars'),
      bins,
      fills: bins.map((b) => b.querySelector('.acs-histogram__bar')),
      gridTop: c.querySelector('.acs-histogram__gridline--top span'),
      gridMid: c.querySelector('.acs-histogram__gridline--mid span'),
      needle: c.querySelector('.acs-histogram__needle'),
      needleLabel: c.querySelector('.acs-histogram__needle-label'),
      selection: c.querySelector('.acs-histogram__caret--selection'),
      hover: c.querySelector('.acs-histogram__caret--hover'),
      empty: c.querySelector('.acs-histogram__empty'),
    };
    // The ramp is data, not styling: each bar wears the color the map gives the scores it counts.
    this.#els.fills.forEach((fill, k) => {
      fill.style.backgroundColor = ScoreRamp.at((k + 0.5) / N);
    });
    this.#bind();
    this.#setFocusedBin(Math.min(this.#focusedBin, N - 1));
    this.update(data);
  }

  update(data) {
    this.#unit = data.unit;
    const max = AccessScoreHistogram.#niceMax(Math.max(...data.bins.map((b) => b.value)));
    data.bins.forEach((b, k) => {
      this.#els.fills[k].style.height = `${max > 0 ? Math.min(100, (b.value / max) * 100) : 0}%`;
      this.#els.bins[k].setAttribute('aria-label', this.#binLabel(b));
      this.#els.bins[k].setAttribute('data-ps-tooltip', this.#binLabel(b));
    });
    this.#els.gridTop.textContent = this.#valueLabel(max);
    this.#els.gridMid.textContent = this.#valueLabel(max / 2);
    this.#els.empty.hidden = data.total > 0;
    this.#setBrushDisplay(data.brush);
    this.#place(this.#els.needle, data.needle?.score ?? null);
    if (data.needle) this.#els.needleLabel.textContent = data.needle.label;
    this.#place(this.#els.selection, data.selection);
    this.#place(this.#els.hover, data.hover);
  }

  /**
   * Moves the transient caret — the hovered map feature, or a hovered neighborhood in the rank list — without a
   * full update.
   * @param {?number} score - A score in [0, 1], or null to hide the caret.
   */
  markHover(score) {
    if (this.#els) this.#place(this.#els.hover, score);
  }

  /**
   * The nice ceiling of the value axis: the top gridline lands on a round figure rather than the tallest bar's
   * exact value.
   * @param {number} max - The largest bin value.
   * @returns {number} A ceiling at or above it, 0 for an empty chart.
   */
  static #niceMax(max) {
    if (!(max > 0)) return 0;
    const magnitude = 10 ** Math.floor(Math.log10(max));
    const mantissa = max / magnitude;
    return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((c) => mantissa <= c) ?? 10) * magnitude;
  }

  /** Positions a marker at a score along the plot, or hides it. */
  #place(el, score) {
    const show = typeof score === 'number' && Number.isFinite(score);
    el.hidden = !show;
    if (show) el.style.left = `${Math.min(100, Math.max(0, score * 100))}%`;
  }

  /** A bin's accessible name and tooltip: its score range and what it holds. */
  #binLabel(bin) {
    const range = { from: Math.round(bin.from * 100), to: Math.round(bin.to * 100) };
    if (this.#unit === 'regions') {
      return i18next.t('accessscore:bin-regions', { ...range, count: Math.round(bin.value) });
    }
    return i18next.t('accessscore:bin-streets', { ...range, length: this.#valueLabel(bin.value) });
  }

  /** A value-axis figure: a distance (km or miles) in the streets unit, a count in the regions unit. */
  #valueLabel(value) {
    if (this.#unit === 'regions') return AccessScoreChart.number(Math.round(value));
    return i18next.t('accessscore:length-large', { km: value });
  }

  /** Reflects a brush on the bins: pressed inside, muted outside, nothing marked without one. */
  #setBrushDisplay(brush) {
    this.#brush = brush ? { ...brush } : null;
    this.#els.bins.forEach((bin, k) => {
      const inside = brush ? k >= brush.from && k < brush.to : false;
      bin.setAttribute('aria-pressed', String(inside));
      bin.classList.toggle('acs-histogram__bin--out', Boolean(brush) && !inside);
    });
  }

  #setFocusedBin(k, { focus = false } = {}) {
    this.#focusedBin = k;
    this.#els.bins.forEach((bin, i) => bin.setAttribute('tabindex', i === k ? '0' : '-1'));
    if (focus) this.#els.bins[k].focus();
  }

  /** The bin under a pointer position, clamped to the chart. */
  #binAt(clientX) {
    const rect = this.#els.bars.getBoundingClientRect();
    const N = this.#els.bins.length;
    return Math.min(N - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * N)));
  }

  /** A single-bin brush toggles off when that bin is the whole brush already. */
  #toggle(k) {
    const same = this.#brush && this.#brush.from === k && this.#brush.to === k + 1;
    this.emit('onBrush', same ? null : { from: k, to: k + 1, final: true });
  }

  /** Grows the brush to take in a bin, from whichever edge is nearer; with no brush, starts one at the focus. */
  #extend(k) {
    const from = Math.min(this.#brush?.from ?? this.#focusedBin, k);
    const to = Math.max(this.#brush?.to ?? this.#focusedBin + 1, k + 1);
    this.emit('onBrush', { from, to, final: true });
  }

  #bind() {
    const bars = this.#els.bars;
    bars.addEventListener('pointerdown', (e) => {
      const bin = e.target.closest('.acs-histogram__bin');
      if (!bin || e.button !== 0) return;
      const k = Number(bin.dataset.bin);
      this.#drag = { anchor: k, last: k, moved: false, pointerId: e.pointerId };
      bars.setPointerCapture?.(e.pointerId);
      this.#setFocusedBin(k);
    });
    bars.addEventListener('pointermove', (e) => {
      if (!this.#drag) {
        const bin = e.target.closest('.acs-histogram__bin');
        if (bin) this.emit('onHover', Number(bin.dataset.bin));
        return;
      }
      const k = this.#binAt(e.clientX);
      if (k === this.#drag.last && this.#drag.moved) return;
      if (k !== this.#drag.anchor) this.#drag.moved = true;
      this.#drag.last = k;
      if (this.#drag.moved) {
        const [from, to] = [Math.min(this.#drag.anchor, k), Math.max(this.#drag.anchor, k) + 1];
        this.emit('onBrush', { from, to, final: false });
      }
    });
    const release = (e) => {
      if (!this.#drag) return;
      const drag = this.#drag;
      this.#drag = null;
      bars.releasePointerCapture?.(drag.pointerId);
      if (drag.moved) {
        const [from, to] = [Math.min(drag.anchor, drag.last), Math.max(drag.anchor, drag.last) + 1];
        this.emit('onBrush', { from, to, final: true });
      } else if (e.shiftKey) {
        this.#extend(drag.anchor);
      } else {
        this.#toggle(drag.anchor);
      }
    };
    bars.addEventListener('pointerup', release);
    bars.addEventListener('pointercancel', release);
    bars.addEventListener('pointerleave', () => {
      if (!this.#drag) this.emit('onHoverEnd');
    });
    // Enter and Space arrive as a click with no pointer behind it (`detail` 0); a pointer's click already toggled
    // on release and is ignored here, or it would toggle the bin straight back.
    bars.addEventListener('click', (e) => {
      const bin = e.target.closest('.acs-histogram__bin');
      if (bin && e.detail === 0) this.#toggle(Number(bin.dataset.bin));
    });
    bars.addEventListener('keydown', (e) => {
      const N = this.#els.bins.length;
      const step = { ArrowLeft: -1, ArrowRight: 1, Home: -N, End: N }[e.key];
      if (step !== undefined) {
        e.preventDefault();
        const k = Math.min(N - 1, Math.max(0, this.#focusedBin + step));
        // Shift+Arrow only ever grows the brush toward the new focus; Escape and a fresh Enter shrink it. A
        // text-selection anchor would shrink it from the wrong end when focus sits on its edge.
        if (e.shiftKey) this.#extend(k);
        this.#setFocusedBin(k, { focus: true });
      } else if (e.key === 'Escape' && this.#brush) {
        e.preventDefault();
        this.emit('onBrush', null);
      }
    });
    bars.addEventListener('focusin', (e) => {
      const bin = e.target.closest('.acs-histogram__bin');
      if (bin) this.emit('onHover', Number(bin.dataset.bin));
    });
    bars.addEventListener('focusout', (e) => {
      if (!bars.contains(e.relatedTarget)) this.emit('onHoverEnd');
    });
  }
}
