/**
 * A label at a glance, with a vote (#5217): its crop (or backup image, or type icon), a type badge, its rating,
 * and agree / disagree / unsure chips that validate it in place. For any surface that shows many labels at once
 * (the AccessScore cluster sheet and photo strip today), so a picture is never shown without the means to say
 * whether it is right.
 *
 * A vote posts to `/labelmap/validate` with the payload the label card and the Gallery card send. The crop is a
 * screenshot of the label's stored point of view, so the vote carries that POV and the pano canvas the label was
 * placed on (`CANVAS`, mirroring `LabelPointTable.canvasWidth/Height`), never the thumbnail's own size. Counts
 * update optimistically and roll back with a toast if the server refuses.
 *
 * Reads `util.misc`, `util.assetPath`, `util.lazyIdentityFetch`, `i18next`, `Toast` and `BadgeAchievements`, all
 * loaded before it on every host page.
 */
class LabelMiniCard {
  /** The pano canvas a label's stored `canvas_x`/`canvas_y` refer to; a static-crop vote reports that canvas. */
  static CANVAS = Object.freeze({ width: 720, height: 480 });

  /** The votes, in the order the chips are drawn. */
  static ACTIONS = Object.freeze(['Agree', 'Disagree', 'Unsure']);

  #label;
  #opts;
  #el;
  #els;
  #busy = false;

  /**
   * @param {object} label - A `/label/id/:id` JSON.
   * @param {object} options - Presentation and callbacks.
   * @param {string} [options.size='sheet'] - 'sheet' (a grid card with a caption) or 'strip' (a bare thumbnail).
   * @param {function} [options.onOpen] - Called with the label id when the picture is chosen.
   * @param {function} [options.onVote] - Called with `(action|null, label)` after a vote has landed server-side.
   * @param {string} options.source - The `source` recorded with a vote, naming the surface (e.g. 'AccessScoreStrip').
   * @param {function} [options.log] - Called with an event name for an interaction worth logging.
   * @param {string} [options.className] - Extra class(es) for the root, for the host's layout rules.
   * @param {string} [options.tag='li'] - The root element's tag.
   */
  constructor(label, { size = 'sheet', onOpen = () => {}, onVote = () => {}, source, log = () => {}, className = '',
    tag = 'li' } = {}) {
    this.#label = { ...label };
    this.#opts = { size, onOpen, onVote, source, log, className };
    this.#el = document.createElement(tag);
    this.#el.className = ['lmc', `lmc--${size}`, className].filter(Boolean).join(' ');
    this.#el.dataset.labelId = String(label.label_id);
    this.#render();
  }

  /** @returns {HTMLElement} The card's root, for the host to place. */
  get element() {
    return this.#el;
  }

  /** @returns {number} The label's id. */
  get labelId() {
    return this.#label.label_id;
  }

  /**
   * Re-renders from fresh label JSON (after a vote elsewhere, say), keeping the root element in place.
   * @param {object} label - A `/label/id/:id` JSON.
   */
  update(label) {
    this.#label = { ...label };
    this.#render();
  }

  /**
   * The stand-in for a label with no picture: its type icon on a neutral panel, so every host says "no image"
   * the same way.
   * @param {string} type - The label type.
   * @returns {HTMLElement} The placeholder element.
   */
  static placeholder(type) {
    const el = document.createElement('span');
    el.className = 'lmc__placeholder';
    el.innerHTML = `<img src="${util.misc.getIconImagePaths(type).iconImagePath}" alt="">
      <span>${LabelMiniCard.esc(i18next.t('common:mini-card.no-image'))}</span>`;
    return el;
  }

  /**
   * HTML-escapes a value for interpolation into markup.
   * @param {*} value - Anything; stringified.
   * @returns {string} The escaped string.
   */
  static esc(value) {
    return util.escapeHTML(String(value ?? ''));
  }

  /** The rating word for a rated label, or null. */
  #ratingWord() {
    const { label_type: type, severity } = this.#label;
    if (!util.misc.labelTypeHasSeverity(type) || !severity) return null;
    const key = util.misc.getRatingLevelKeys(type)[severity];
    return key ? i18next.t(`common:${key}`) : null;
  }

  /** Why the chips are locked, as a translated reason, or null when the reader may vote. */
  #lockReason() {
    if (this.#label.from_current_user) return i18next.t('labelmap:own-label-disabled');
    if (!(this.#label.crop_url || this.#label.backup_image_url)) return i18next.t('common:mini-card.no-image-to-judge');
    return null;
  }

  #render() {
    const label = this.#label;
    const type = label.label_type;
    const esc = LabelMiniCard.esc;
    const typeName = i18next.t(`common:${util.camelToKebab(type)}`).replace('&shy;', '');
    const rating = this.#ratingWord();
    const name = [typeName, rating].filter(Boolean).join(', ');
    const src = label.crop_url || label.backup_image_url;
    const image = src
      ? `<img class="lmc__image" src="${esc(src)}" alt="" loading="lazy">`
      : LabelMiniCard.placeholder(type).outerHTML;
    const colors = rating ? util.misc.getSeverityLevelColors(label.severity, type) : null;
    const tags = (label.tags || []).map((tag) =>
      `<span class="lmc__tag">${esc(i18next.t(`common:tag.${tag}`, { defaultValue: tag }))}</span>`).join('');
    const date = label.timestamp
      ? new Intl.DateTimeFormat(i18next.language, { dateStyle: 'medium' }).format(new Date(label.timestamp))
      : '';
    // "Quality: Good" rather than a bare "Good": which scale a rating is on is the label card's wording too.
    const ratingHeader = rating
      ? i18next.t(util.misc.isPositiveLabelType(type) ? 'common:quality' : 'common:severity')
      : '';
    const ratingHtml = rating
      ? `<span class="lmc__rating" style="--lmc-wash: ${esc(colors?.wash ?? '')}">${esc(ratingHeader)}: ${
        esc(rating)}</span>`
      : '';
    const body = this.#opts.size === 'sheet'
      ? `<div class="lmc__body">
          <span class="lmc__meta">
            ${ratingHtml}
            ${date ? `<span class="lmc__date">${esc(date)}</span>` : ''}
          </span>
          ${tags ? `<span class="lmc__tags">${tags}</span>` : ''}
        </div>`
      : '';
    const lock = this.#lockReason();
    // The name is interpolated unescaped and then escaped exactly once for the attribute: i18next's own escaping
    // would double up with `esc` and print an apostrophe as `&#39;`.
    const openLabel = i18next.t('common:mini-card.open', { label: name, interpolation: { escapeValue: false } });
    this.#el.innerHTML = `
      <button type="button" class="lmc__open" aria-label="${esc(openLabel)}" data-ps-tooltip="${esc(name)}">
        <span class="lmc__figure">${image}</span>
        <img class="lmc__badge" src="${util.misc.getIconImagePaths(type).iconImagePath}" alt="">
      </button>
      ${body}
      <div class="lmc__votes" role="group" aria-label="${esc(i18next.t('common:mini-card.votes'))}">
        ${LabelMiniCard.ACTIONS.map((action) => this.#chipHtml(action, lock)).join('')}
      </div>`;
    this.#els = {
      open: this.#el.querySelector('.lmc__open'),
      image: this.#el.querySelector('.lmc__image'),
      chips: Object.fromEntries(LabelMiniCard.ACTIONS.map((a) => [a, this.#el.querySelector(`[data-action="${a}"]`)])),
    };
    this.#els.open.addEventListener('click', () => this.#opts.onOpen(label.label_id));
    // A picture that fails to load falls back to the type icon, like one that never had a picture.
    this.#els.image?.addEventListener('error', () => {
      this.#els.image.replaceWith(LabelMiniCard.placeholder(type));
    }, { once: true });
    for (const [action, chip] of Object.entries(this.#els.chips)) {
      chip.addEventListener('click', () => this.#vote(action));
    }
  }

  /** One vote chip: the filled icon and pressed state when it is the reader's own vote. */
  #chipHtml(action, lock) {
    const esc = LabelMiniCard.esc;
    const mine = this.#label.user_validation === action;
    const count = this.#label[`num_${action.toLowerCase()}`] || 0;
    const variant = mine ? 'filled' : 'outline';
    const iconSrc = util.assetPath(`images/icons/validation/${action.toLowerCase()}-${variant}.svg`);
    const word = i18next.t(`common:${action.toLowerCase()}`);
    const tip = lock ?? this.#tooltip(action, mine, count);
    return `
      <button type="button" class="lmc__vote lmc__vote--${action.toLowerCase()}" data-action="${action}"
              aria-pressed="${mine}" aria-label="${esc(word)}" data-ps-tooltip="${esc(tip)}"${lock ? ' disabled' : ''}>
        <img class="lmc__vote-icon" src="${iconSrc}" alt="">
        <span class="lmc__vote-count">${count}</span>
      </button>`;
  }

  /** The label card's own tooltip wording: what a click does, and who has voted this way so far. */
  #tooltip(action, mine, count) {
    const a = action.toLowerCase();
    if (mine) {
      return `${i18next.t(`labelmap:vote-tooltip-voted-${a}`, { count: Math.max(0, count - 1) })} ${
        i18next.t('labelmap:vote-tooltip-clear')}`;
    }
    return i18next.t(`labelmap:vote-tooltip-${a}`, { count });
  }

  /**
   * Casts `action`, or clears it when it is already the reader's vote (#4653). Optimistic: the counts and the
   * pressed chip change at once and are put back if the server refuses.
   * @param {string} action - 'Agree', 'Disagree' or 'Unsure'.
   */
  async #vote(action) {
    if (this.#busy || this.#lockReason()) return;
    const before = this.#label;
    const prev = before.user_validation ?? null;
    const undone = prev === action;
    const next = undone ? null : action;
    const after = { ...before, user_validation: next };
    if (prev) after[`num_${prev.toLowerCase()}`] = Math.max(0, (after[`num_${prev.toLowerCase()}`] || 0) - 1);
    if (next) after[`num_${next.toLowerCase()}`] = (after[`num_${next.toLowerCase()}`] || 0) + 1;
    this.#label = after;
    this.#busy = true;
    this.#render();
    for (const chip of Object.values(this.#els.chips)) chip.disabled = true;
    try {
      const res = await util.lazyIdentityFetch('/labelmap/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.#payload(action, undone, prev)),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Casting is recorded by the label_validation row; clearing deletes it, so the event is the only trace.
      if (undone) this.#opts.log(`ClearVote_result=${action}_labelId=${before.label_id}`);
      else if (prev === null) BadgeAchievements.recordValidation(this.#el);
      this.#opts.onVote(next, this.#label);
    } catch (err) {
      console.error('LabelMiniCard: vote failed', err);
      this.#label = before;
      Toast.show({ message: i18next.t('common:mini-card.vote-failed'), reference: this.#el, compact: true });
    } finally {
      this.#busy = false;
      this.#render();
    }
  }

  /** The validation POST body, the shape `/labelmap/validate` expects from every static-image surface. */
  #payload(action, undone, prev) {
    const label = this.#label;
    const now = new Date();
    return {
      label_id: label.label_id,
      label_type: label.label_type,
      validation_result: action,
      severity: label.severity ?? null,
      tags: label.tags ?? [],
      canvas_x: label.canvas_x ?? null,
      canvas_y: label.canvas_y ?? null,
      heading: label.heading ?? null,
      pitch: label.pitch ?? null,
      zoom: label.zoom ?? null,
      canvas_height: LabelMiniCard.CANVAS.height,
      canvas_width: LabelMiniCard.CANVAS.width,
      start_timestamp: now,
      end_timestamp: now,
      source: this.#opts.source,
      undone,
      redone: !undone && prev !== null,
      viewer_type: 'StaticCrop',
    };
  }
}
