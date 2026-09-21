/**
 * A street's elevation profile, colored by how steep each stretch is (#5223): distance along the street across,
 * elevation up, each ~10 m stretch of the line and the ground beneath it in the slope map's color for its grade, so
 * the popup's chart and the street on the map say the same thing about the same stretch.
 *
 * The stretch the score reads, `max_grade`'s steepest baseline, is bracketed and labeled with its length and grade. Its
 * place comes from the backend (`max_grade_from_meters`), since the ~10 m profile is too coarse to find it again. A
 * legend under the chart lists how much of the street falls in each slope class, steepest first, as toggle buttons:
 * hovering or focusing a row previews its stretches on the chart, pressing pins it, and several can be pinned. Going
 * the other way, pointing at the chart (or arrowing along it) lights the legend row of the stretch under the pointer
 * and states that stretch's grade and direction in a live readout.
 *
 * The vertical scale is exaggerated to fit, as every elevation profile is, but never beyond a minimum span, so a
 * gentle street reads as gentle; the colors and the legend carry the grade the shape cannot.
 *
 * @typedef {object} AccessScoreProfile
 * @property {number} spacing_meters - Distance between consecutive samples.
 * @property {number[]} elevations_meters - Elevations from the street's first vertex to its last.
 *
 * @typedef {object} AccessScoreProfileResponse - A street's `/v3/api/streetGradientProfile` answer, as far as the
 *   chart reads it.
 * @property {?AccessScoreProfile} profile - The profile; null where the street has none.
 * @property {?number} max_grade - The street's steepest grade.
 * @property {?number} max_grade_from_meters - Where the stretch that set it starts, along the street.
 * @property {?number} max_grade_to_meters - Where it ends.
 *
 * @typedef {object} AccessScoreProfileStretch
 * @property {number} grade - Signed grade over the stretch, positive uphill in the street's digitized direction.
 * @property {number} classIndex - Its slope class, an index into `AccessScoreGradeRamp.classes`.
 */
class AccessScoreElevationProfile {
  static #WIDTH = 340;
  static #HEIGHT = 132;
  /** Side margins hold the endpoint elevations beside the line, where they cannot collide with the bracket above it. */
  static #PAD = { top: 28, right: 48, bottom: 20, left: 48 };
  /**
   * The least elevation span the chart stretches to fill. Without it a 3% street 190 m long draws as a steep hill,
   * since every profile would be scaled to the full height; with it, anything under this much rise stays low.
   */
  static #MIN_SPAN_METERS = 8;
  /** A crest or dip is labeled only when it stands this far beyond both ends; smaller ones are sample noise. */
  static #EXTREME_METERS = 1;

  /** @type {HTMLElement} */ #root;
  /** @type {SVGSVGElement} */ #svg;
  /** @type {Element} */ #cursorLine;
  /** @type {HTMLElement} */ #readout;
  /** @type {HTMLButtonElement[]} */ #rows;
  /** @type {Element[]} */ #marks;
  /** @type {AccessScoreProfile} */ #profile;
  /** @type {{stretches: AccessScoreProfileStretch[], lengths: Map<number, number>, length: number}} */ #analysis;
  /** @type {(kind: string, value?: string) => void} */ #onLog;
  /** Classes pinned by pressing their legend rows. */
  #pinned = new Set();
  /** The class a hovered or focused legend row previews, over whatever is pinned; null for none. */
  #preview = null;
  /** The stretch under the pointer or the arrow keys; -1 for none. */
  #cursor = -1;
  /** The chart is scrubbed in a continuous sweep, so it is logged once per popup, not per stretch. */
  #scrubLogged = false;

  /**
   * Draws the profile into `slot`, replacing what it held, and wires the legend and the chart to each other.
   * @param {HTMLElement} slot - Where the chart goes.
   * @param {AccessScoreProfile} profile - The street's profile; call [[canDraw]] first.
   * @param {object} options - What the chart needs besides the samples.
   * @param {number[]} options.breaks - The slope classes' breaks, `gradient.map_class_breaks` from the config.
   * @param {?{from: number, to: number, grade: number}} options.steepest - The stretch that set `max_grade`, in
   *   meters along the street, with that grade; null where the backend reports none.
   * @param {string} options.label - The chart's accessible name, as plain text.
   * @param {(kind: string, value?: string) => void} [options.onLog] - Records an interaction.
   */
  constructor(slot, profile, { breaks, steepest, label, onLog = () => {} }) {
    this.#profile = profile;
    this.#onLog = onLog;
    this.#analysis = AccessScoreElevationProfile.analyze(profile, breaks);
    const colors = AccessScoreGradeRamp.colors(breaks.length + 1);
    slot.innerHTML = this.#html(breaks, steepest, label);
    this.#root = /** @type {HTMLElement} */ (slot.querySelector('.acs-profile'));
    this.#svg = /** @type {SVGSVGElement} */ (this.#root.querySelector('.acs-profile__chart'));
    this.#cursorLine = this.#root.querySelector('.acs-profile__cursor');
    this.#readout = /** @type {HTMLElement} */ (this.#root.querySelector('.acs-profile__readout'));
    this.#rows = /** @type {HTMLButtonElement[]} */ ([...this.#root.querySelectorAll('.acs-profile__class')]);
    this.#marks = [...this.#svg.querySelectorAll('[data-class]')];
    // The colors are data read from the tokens, set as properties like the map legend's swatches.
    for (const el of this.#root.querySelectorAll('[data-class]')) {
      const color = colors[Number(/** @type {HTMLElement} */ (el).dataset.class)];
      const style = /** @type {HTMLElement} */ (el).style;
      if (el.classList.contains('acs-profile__stroke')) style.stroke = color;
      else if (el.tagName.toLowerCase() === 'path' || el.tagName.toLowerCase() === 'rect') style.fill = color;
    }
    for (const el of this.#root.querySelectorAll('.acs-profile__swatch, .acs-profile__share-fill')) {
      const style = /** @type {HTMLElement} */ (el).style;
      style.background = colors[Number(/** @type {HTMLElement} */ (el.closest('[data-class]')).dataset.class)];
      const share = /** @type {HTMLElement} */ (el).dataset.share;
      if (share !== undefined) style.width = `${share}%`;
    }
    this.#wire();
  }

  /**
   * Whether a profile has a shape to draw.
   * @param {?AccessScoreProfile} profile - A street's profile, or null.
   * @returns {boolean}
   */
  static canDraw(profile) {
    return (profile?.elevations_meters?.length ?? 0) >= 2 && profile.spacing_meters > 0;
  }

  /**
   * Each stretch between consecutive samples, its grade and slope class, and how much of the street each class
   * covers. The lengths are summed from the same stretches the chart colors, so the legend and the chart cannot
   * disagree; they can differ by a stretch from the stored `meters_over_5pct`, which the sampler measured on its
   * full-resolution samples.
   * @param {AccessScoreProfile} profile - The street's profile.
   * @param {number[]} breaks - The slope classes' breaks.
   * @returns {{stretches: AccessScoreProfileStretch[], lengths: Map<number, number>, length: number}} The stretches in
   *   street order, meters per class index, and the profile's length.
   */
  static analyze(profile, breaks) {
    const { spacing_meters: spacing, elevations_meters: z } = profile;
    const stretches = z.slice(1).map((elevation, i) => {
      const grade = (elevation - z[i]) / spacing;
      return { grade, classIndex: AccessScoreGradeRamp.classIndexOf(Math.abs(grade), breaks) };
    });
    const lengths = new Map();
    for (const { classIndex } of stretches) lengths.set(classIndex, (lengths.get(classIndex) ?? 0) + spacing);
    return { stretches, lengths, length: spacing * (z.length - 1) };
  }

  /**
   * The chart, its legend and its readout.
   * @param {number[]} breaks - The slope classes' breaks.
   * @param {?{from: number, to: number, grade: number}} steepest - The stretch that set `max_grade`.
   * @param {string} label - The accessible name, as plain text.
   * @returns {string}
   */
  #html(breaks, steepest, label) {
    const self = AccessScoreElevationProfile;
    const { top, bottom } = self.#PAD;
    const base = self.#HEIGHT - bottom;
    const pts = this.#points();
    const n = pts.length - 1;
    const at = ([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`;
    const ground = this.#analysis.stretches.map((s, i) => `<path class="acs-profile__ground"
        data-class="${s.classIndex}" d="M${at(pts[i])} L${at(pts[i + 1])} L${at([pts[i + 1][0], base])}
        L${at([pts[i][0], base])} Z"></path>`).join('');
    const line = this.#analysis.stretches.map((s, i) => `<path class="acs-profile__stroke"
        data-class="${s.classIndex}" d="M${at(pts[i])} L${at(pts[i + 1])}"></path>`).join('');
    const z = this.#profile.elevations_meters;
    const text = (x, y, content, anchor = 'start', kind = 'end') => `<text class="acs-profile__${kind}"
        x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">${content}</text>`;
    const [x0, xn] = [pts[0][0], pts[n][0]];
    const spacing = self.#elevationValue(this.#profile.spacing_meters);
    const legendTitle = self.#t('profile-legend-title', { spacing });
    return `<figure class="acs-profile">
        <svg class="acs-profile__chart" viewBox="0 0 ${self.#WIDTH} ${self.#HEIGHT}" role="img" tabindex="0"
             aria-label="${util.escapeHTML(label)}">
          <g aria-hidden="true">
            ${ground}${line}
            <line class="acs-profile__axis" x1="${x0.toFixed(1)}" x2="${xn.toFixed(1)}" y1="${base}" y2="${base}">
            </line>
            ${text(x0 - 6, pts[0][1] + 4, self.#elevation(z[0]), 'end')}
            ${text(xn + 6, pts[n][1] + 4, self.#elevation(z[n]))}
            ${this.#extremesHtml(pts, steepest)}${this.#bracketHtml(steepest, pts, top)}
            ${text(x0, base + 14, self.#elevation(0), 'start', 'tick')}
            ${text(xn, base + 14, self.#elevation(this.#analysis.length), 'end', 'tick')}
            <line class="acs-profile__cursor" x1="0" x2="0" y1="${top - 6}" y2="${base}" visibility="hidden"></line>
          </g>
        </svg>
        <figcaption class="acs-profile__legend-title">${legendTitle}</figcaption>
        <ul class="acs-profile__legend">${this.#legendHtml(breaks)}</ul>
        <p class="acs-profile__readout" aria-live="polite"></p>
      </figure>`;
  }

  /**
   * Each sample's place in the chart's box.
   * @returns {Array<[number, number]>} x and y per sample, first vertex first.
   */
  #points() {
    const { x, y } = this.#scales();
    const spacing = this.#profile.spacing_meters;
    return this.#profile.elevations_meters.map((e, i) => /** @type {[number, number]} */ ([x(i * spacing), y(e)]));
  }

  /**
   * One toggle per slope class the street has, steepest first, since the steep rows are the ones that matter for
   * access. Each carries its length and a bar for its share of the street.
   * @param {number[]} breaks - The slope classes' breaks.
   * @returns {string}
   */
  #legendHtml(breaks) {
    const { lengths, length } = this.#analysis;
    return [...lengths.keys()].sort((a, b) => b - a).map((classIndex) => {
      const meters = lengths.get(classIndex);
      const share = Math.min(100, (100 * meters) / length).toFixed(1);
      return `<li><button type="button" class="acs-profile__class" data-class="${classIndex}" aria-pressed="false">
          <span class="acs-profile__swatch" aria-hidden="true"></span>
          <span>${AccessScoreElevationProfile.#classLabel(classIndex, breaks)}</span>
          <span class="acs-profile__share" aria-hidden="true"><span class="acs-profile__share-fill"
            data-share="${share}"></span></span>
          <span class="acs-profile__length">${AccessScoreElevationProfile.#elevation(meters)}</span>
        </button></li>`;
    }).join('');
  }

  /**
   * The bracket over the stretch that set `max_grade`, with its length and grade.
   * @param {?{from: number, to: number, grade: number}} steepest - The stretch, or null.
   * @param {Array<[number, number]>} pts - Each sample's x and y, as drawn.
   * @param {number} top - The plot's top edge.
   * @returns {string} Empty where there is no stretch to mark.
   */
  #bracketHtml(steepest, pts, top) {
    if (!steepest) return '';
    const self = AccessScoreElevationProfile;
    const { x } = this.#scales();
    const spacing = this.#profile.spacing_meters;
    const [x1, x2] = [x(steepest.from), x(steepest.to)];
    const { left, right } = self.#PAD;
    const cx = Math.min(Math.max((x1 + x2) / 2, left + 50), self.#WIDTH - right - 50);
    // Above the highest sample under the bracket or under its label, which is wider than a 30 m stretch, so the
    // text clears the line where the street is higher beside the stretch than on it. At worst it sits in the top pad.
    const [from, to] = [Math.min(x1, cx - 55), Math.max(x2, cx + 55)];
    const under = pts.filter(([px], i) => (px >= from && px <= to)
      || (i * spacing >= steepest.from && i * spacing <= steepest.to));
    const y = Math.max(top - 8, Math.min(...under.map((p) => p[1])) - 8);
    const text = self.#t('profile-steepest', {
      length: self.#elevationValue(steepest.to - steepest.from), grade: AccessScoreGradeRamp.percent(steepest.grade),
    });
    const f = (v) => v.toFixed(1);
    return `<path class="acs-profile__bracket" d="M${f(x1)},${f(y + 5)} V${f(y)} H${f(x2)} V${f(y + 5)}"></path>
        <text class="acs-profile__callout" x="${f(cx)}" y="${f(y - 5)}" text-anchor="middle">${text}</text>`;
  }

  /**
   * A crest or a dip partway along, the one elevation the two end labels cannot imply. Both are labeled above the
   * line, in the open space over it, except a crest under the bracket, which is labeled beneath the line instead.
   * @param {Array<[number, number]>} pts - Each sample's x and y, as drawn.
   * @param {?{from: number, to: number}} steepest - The bracketed stretch, which a crest label must clear.
   * @returns {string}
   */
  #extremesHtml(pts, steepest) {
    const self = AccessScoreElevationProfile;
    const z = this.#profile.elevations_meters;
    const n = z.length - 1;
    const interior = (i) => i > 1 && i < n - 1;
    // Half a label's width either side of the bracket: a crest label centered closer than this would overlap its text.
    const { x } = this.#scales();
    const underBracket = (i) => Boolean(steepest)
      && pts[i][0] > x(steepest.from) - 45 && pts[i][0] < x(steepest.to) + 45;
    const mark = (i, dy, key) => {
      const [px, py] = pts[i].map((v) => v.toFixed(1));
      const words = self.#t(key, { elevation: self.#elevationValue(z[i]) });
      return `<circle class="acs-profile__extreme" cx="${px}" cy="${py}" r="2.5"></circle>
        <text class="acs-profile__end" x="${px}" y="${(pts[i][1] + dy).toFixed(1)}"
          text-anchor="middle">${words}</text>`;
    };
    const high = z.indexOf(Math.max(...z));
    const low = z.indexOf(Math.min(...z));
    let out = '';
    if (interior(high) && z[high] - Math.max(z[0], z[n]) > self.#EXTREME_METERS) {
      out += mark(high, underBracket(high) ? 16 : -8, 'profile-high');
    }
    if (interior(low) && Math.min(z[0], z[n]) - z[low] > self.#EXTREME_METERS) out += mark(low, -8, 'profile-low');
    return out;
  }

  /**
   * The chart's two scales.
   * @returns {{x: (meters: number) => number, y: (elevation: number) => number}} Meters along the street to x, and
   *   an elevation to y, centered on the street's own range so a near-level street draws through the middle.
   */
  #scales() {
    const { top, right, bottom, left } = AccessScoreElevationProfile.#PAD;
    const z = this.#profile.elevations_meters;
    const width = AccessScoreElevationProfile.#WIDTH - left - right;
    const height = AccessScoreElevationProfile.#HEIGHT - top - bottom;
    const low = Math.min(...z);
    const high = Math.max(...z);
    const span = Math.max(high - low, AccessScoreElevationProfile.#MIN_SPAN_METERS);
    const floor = (low + high) / 2 - span / 2;
    const length = this.#analysis.length;
    return {
      x: (meters) => left + (width * Math.min(Math.max(meters, 0), length)) / length,
      y: (elevation) => top + height * (1 - (elevation - floor) / span),
    };
  }

  /** Connects the legend rows and the chart in both directions. */
  #wire() {
    for (const row of this.#rows) {
      const classIndex = Number(row.dataset.class);
      row.addEventListener('click', () => {
        if (this.#pinned.has(classIndex)) this.#pinned.delete(classIndex);
        else this.#pinned.add(classIndex);
        this.#preview = null;
        this.#paint();
        this.#onLog('ProfileClass', `${classIndex}_value=${this.#pinned.has(classIndex)}`);
      });
      const preview = (on) => () => {
        this.#preview = on ? classIndex : null;
        this.#paint();
      };
      row.addEventListener('pointerenter', preview(true));
      row.addEventListener('pointerleave', preview(false));
      row.addEventListener('focus', preview(true));
      row.addEventListener('blur', preview(false));
    }
    this.#svg.addEventListener('pointermove', (e) => {
      const box = this.#svg.getBoundingClientRect();
      const { left, right } = AccessScoreElevationProfile.#PAD;
      const width = AccessScoreElevationProfile.#WIDTH;
      const vx = ((e.clientX - box.left) / box.width) * width;
      const along = (vx - left) / (width - left - right);
      this.#point(Math.floor(along * this.#analysis.stretches.length));
    });
    this.#svg.addEventListener('pointerleave', () => this.#point(-1));
    this.#svg.addEventListener('blur', () => this.#point(-1));
    this.#svg.addEventListener('focus', () => this.#point(0));
    this.#svg.addEventListener('keydown', (e) => {
      const last = this.#analysis.stretches.length - 1;
      const next = { ArrowRight: this.#cursor + 1, ArrowLeft: this.#cursor - 1, Home: 0, End: last }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      this.#point(Math.max(0, Math.min(last, next)));
    });
  }

  /**
   * Puts the cursor on a stretch: the rule over it, its legend row lit, its grade in the readout.
   * @param {number} index - The stretch, clamped to the street; -1 clears the cursor.
   */
  #point(index) {
    const stretches = this.#analysis.stretches;
    this.#cursor = index < 0 ? -1 : Math.min(index, stretches.length - 1);
    const stretch = stretches[this.#cursor];
    for (const row of this.#rows) {
      row.classList.toggle('acs-profile__class--at', Number(row.dataset.class) === stretch?.classIndex);
    }
    if (!stretch) {
      this.#cursorLine.setAttribute('visibility', 'hidden');
      this.#paint();
      return;
    }
    if (!this.#scrubLogged) {
      this.#scrubLogged = true;
      this.#onLog('ProfileScrub');
    }
    const spacing = this.#profile.spacing_meters;
    const along = (this.#cursor + 0.5) * spacing;
    const x = this.#scales().x(along).toFixed(1);
    this.#cursorLine.setAttribute('x1', x);
    this.#cursorLine.setAttribute('x2', x);
    this.#cursorLine.setAttribute('visibility', 'visible');
    const z = this.#profile.elevations_meters;
    this.#readout.textContent = AccessScoreElevationProfile.#t(
      stretch.grade >= 0 ? 'profile-readout-up' : 'profile-readout-down',
      {
        along: AccessScoreElevationProfile.#elevationValue(along),
        grade: AccessScoreGradeRamp.percent(Math.abs(stretch.grade)),
        elevation: AccessScoreElevationProfile.#elevationValue((z[this.#cursor] + z[this.#cursor + 1]) / 2),
      },
      false,
    );
  }

  /**
   * Fades every stretch outside the highlighted classes, marks the pinned rows, and, while nothing is under the
   * cursor, says in the readout how much of the street the highlight covers.
   */
  #paint() {
    const active = this.#preview !== null ? new Set([this.#preview]) : this.#pinned;
    this.#root.classList.toggle('acs-profile--filtered', active.size > 0);
    for (const mark of this.#marks) {
      const classIndex = Number(/** @type {HTMLElement} */ (mark).dataset.class);
      mark.classList.toggle('acs-profile__mark--on', active.has(classIndex));
    }
    for (const row of this.#rows) row.setAttribute('aria-pressed', String(this.#pinned.has(Number(row.dataset.class))));
    if (this.#cursor >= 0) return;
    if (active.size === 0) {
      this.#readout.textContent = '';
      return;
    }
    const { stretches, lengths, length } = this.#analysis;
    const meters = [...active].reduce((sum, c) => sum + (lengths.get(c) ?? 0), 0);
    // Separate runs, not stretches: three adjacent 10 m stretches in one class are one steep stretch to a reader.
    const count = stretches.filter((s, i) => active.has(s.classIndex)
      && !(i > 0 && active.has(stretches[i - 1].classIndex))).length;
    this.#readout.textContent = AccessScoreElevationProfile.#t('profile-highlight', {
      length: AccessScoreElevationProfile.#elevationValue(meters),
      total: AccessScoreElevationProfile.#elevationValue(length),
      count,
    }, false);
  }

  /**
   * A slope class as the legend names it, in the words the map legend uses.
   * @param {number} classIndex - The class.
   * @param {number[]} breaks - The slope classes' breaks.
   * @returns {string} Escaped for markup.
   */
  static #classLabel(classIndex, breaks) {
    const percent = (g) => AccessScoreGradeRamp.percent(g);
    if (classIndex === 0) return AccessScoreElevationProfile.#t('grade-class-under', { to: percent(breaks[0]) });
    if (classIndex === breaks.length) {
      return AccessScoreElevationProfile.#t('grade-class-over', { from: percent(breaks[classIndex - 1]) });
    }
    return AccessScoreElevationProfile.#t('grade-class-between',
      { from: percent(breaks[classIndex - 1]), to: percent(breaks[classIndex]) });
  }

  /**
   * A translated string from the tool's namespace.
   * @param {string} key - The key, without its namespace.
   * @param {object} values - Its interpolation values, as plain text.
   * @param {boolean} [escape=true] - Escape the values, for text headed into markup; false for `textContent`.
   * @returns {string}
   */
  static #t(key, values, escape = true) {
    return i18next.t(`accessscore:${key}`, { ...values, interpolation: { escapeValue: escape } });
  }

  /** A length or elevation in the reader's units, escaped for markup. */
  static #elevation(meters) {
    return i18next.t('accessscore:elevation', { meters, interpolation: { escapeValue: true } });
  }

  /** The same as plain text, for use as a value that `#t` escapes (or not) itself. */
  static #elevationValue(meters) {
    return i18next.t('accessscore:elevation', { meters, interpolation: { escapeValue: false } });
  }
}
