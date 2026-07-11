/**
 * Renders the dashboard's "Recent mistakes" as gallery-style cards (#4388) from the user's own labels that others
 * validated as incorrect.
 *
 * Fetches `/userapi/mistakes` (a map of label type -> recent incorrectly-validated labels), flattens and sorts by
 * recency, and renders each as a card: the GSV crop, the label-type icon (canonical color + icon from util.misc), the
 * "Marked incorrect" verdict, the validator's comment, and the contest affordance (agree / "it was correct" / comment).
 * Shows an encouraging empty state when the user has no mistakes.
 */
class MistakeGallery {
  /**
     * @param {HTMLElement} rootEl - Container to fill with cards.
     * @param {Object} opts
     * @param {string} opts.userId - The signed-in user's id (the endpoint is self-or-admin only).
     * @param {number} [opts.limit=6] - Max cards to show.
     * @param {HTMLElement} [opts.seeAllEl] - Optional "see all" link, shown only when there are mistakes.
     * @param {object} [opts.labelPopup] - Optional shared LabelPopup instance; when present, clicking a card image
     *      opens the interactive pano + detail view and the vote/note controls are mirrored inside it.
     */
  constructor(rootEl, opts) {
    this.root = rootEl;
    this.userId = opts.userId;
    this.limit = opts.limit || 6;
    this.seeAllEl = opts.seeAllEl || null;
    this.labelPopup = opts.labelPopup || null;
    // Per-label response state shared between a card and the popup so they stay in sync in-session.
    this.responses = new Map(); // label_id -> { agrees: boolean|null, note: string }
    this.popupPanel = null; // the vote/note panel injected into the popup dialog
    // Explore canvas dimensions (fallback if util.EXPLORE_CANVAS_* isn't loaded on this page).
    this.canvasW = (window.util && util.EXPLORE_CANVAS_WIDTH) || 720;
    this.canvasH = (window.util && util.EXPLORE_CANVAS_HEIGHT) || 480;
  }

  /** Returns (creating if needed) the mutable response state for a label. */
  #stateFor(labelId) {
    if (!this.responses.has(labelId)) this.responses.set(labelId, { agrees: null, note: '' });
    return this.responses.get(labelId);
  }

  /**
     * Re-renders every vote/note section currently in the DOM for a label (its card + the popup panel), so a change in
     * one place is reflected in the other.
     * @param {Object} m - The label record.
     */
  #sync(m) {
    document.querySelectorAll(`[data-ud-vote="${m.label_id}"]`)
      .forEach((el) => el.replaceWith(this.#voteSection(m)));
    document.querySelectorAll(`[data-ud-note="${m.label_id}"]`)
      .forEach((el) => el.replaceWith(this.#noteSection(m)));
  }

  /** Fetches the mistakes and renders them (or the empty state). */
  async render() {
    let data;
    try {
      const res = await fetch(`/userapi/mistakes?userId=${encodeURIComponent(this.userId)}&n=${this.limit}`,
        { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`mistakes fetch failed: ${res.status}`);
      data = await res.json();
    } catch (e) {
      console.error('Failed to load recent mistakes', e);
      return;
    }

    // Flatten the per-type map into one list, tag each with its type, and show the most recent first.
    const all = [];
    Object.keys(data || {}).forEach((type) => (data[type] || []).forEach((label) => all.push(label)));
    all.sort((a, b) => new Date(b.time_validated) - new Date(a.time_validated));
    const mistakes = all.slice(0, this.limit);

    this.root.innerHTML = '';
    if (mistakes.length === 0) {
      this.#renderEmpty();
      if (this.seeAllEl) this.seeAllEl.hidden = true;
      return;
    }
    mistakes.forEach((m) => this.root.appendChild(this.#renderCard(m)));
    if (this.seeAllEl) this.seeAllEl.hidden = false;
  }

  /** Encouraging state when the user has no incorrectly-validated labels. */
  #renderEmpty() {
    const div = document.createElement('div');
    div.className = 'ud-nudge';
    div.textContent = '🎉 No mistakes to review — your labels are holding up great. Keep it up!';
    this.root.appendChild(div);
  }

  /**
     * Builds one mistake card.
     * @param {Object} m - A label record from the endpoint.
     * @returns {HTMLElement}
     */
  #renderCard(m) {
    const type = m.label_type;
    const iconPath = util.misc.getIconImagePaths(type)?.iconImagePath;

    const card = document.createElement('figure');
    card.className = 'ud-card';

    // Mark the label on the pano at its real position (canvas_x/y over the 720x480 Explore canvas), the same way
    // the Gallery does — the label is NOT necessarily centered. The image is a 3:2 crop of the pano so the
    // percentages line up. Falls back to the icon centered on the gradient if there's no pano image.
    const img = document.createElement('div');
    img.className = 'ud-card-img';
    if (m.image_url) img.style.backgroundImage = `url("${m.image_url}")`;
    if (iconPath) {
      const canvasW = (typeof util !== 'undefined' && util.EXPLORE_CANVAS_WIDTH) || 720;
      const canvasH = (typeof util !== 'undefined' && util.EXPLORE_CANVAS_HEIGHT) || 480;
      const marker = document.createElement('img');
      marker.className = 'ud-card-label-marker';
      marker.src = iconPath;
      marker.alt = '';
      marker.style.left = typeof m.canvas_x === 'number' ? `${(100 * m.canvas_x) / canvasW}%` : '50%';
      marker.style.top = typeof m.canvas_y === 'number' ? `${(100 * m.canvas_y) / canvasH}%` : '50%';
      img.appendChild(marker);
    }
    const verdict = document.createElement('span');
    verdict.className = 'ud-card-verdict';
    verdict.textContent = 'Marked incorrect';
    img.appendChild(verdict);

    // Clicking the image opens the shared interactive label popup (pano + detail), when available.
    if (this.labelPopup) {
      img.classList.add('ud-card-img-clickable');
      img.setAttribute('role', 'button');
      img.setAttribute('tabindex', '0');
      img.title = 'Open the interactive label view';
      const open = () => this.#openPopup(m);
      img.addEventListener('click', open);
      img.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
      const hint = document.createElement('span');
      hint.className = 'ud-card-expand-hint';
      hint.textContent = '⤢ Open';
      img.appendChild(hint);
    }
    card.appendChild(img);

    const body = document.createElement('figcaption');
    body.className = 'ud-card-body';

    const title = document.createElement('span');
    title.className = 'ud-card-title';
    title.textContent = MistakeGallery.#prettyType(type);
    body.appendChild(title);

    const valNote = document.createElement('span');
    valNote.className = 'ud-card-note';
    if (m.validator_comment) {
      valNote.textContent = `“${m.validator_comment}”`;
    } else {
      valNote.textContent = 'No comment left by validators.';
      valNote.classList.add('ud-card-note-muted');
    }
    body.appendChild(valNote);

    // Two independent controls: the vote (instant, changeable) and the note (optional). Both read shared state so
    // the card and the popup panel mirror each other.
    body.appendChild(this.#voteSection(m));
    body.appendChild(this.#noteSection(m));

    card.appendChild(body);
    return card;
  }

  /**
     * Opens the interactive label popup for a card and mirrors the vote/note controls inside it.
     * @param {Object} m - The label record.
     */
  async #openPopup(m) {
    try {
      await this.labelPopup.showLabel(m.label_id, 'UserDashboard');
      // These are always the viewer's own labels, so prefix the (already-localized) title with "Your label:".
      const titleEl = document.querySelector('#label-modal .label-detail__title');
      if (titleEl) titleEl.textContent = `Your label: ${titleEl.textContent}`;
      this.#mountPopupPanel(m);
    } catch (e) {
      console.error('Failed to open the label popup', e);
    }
  }

  /**
     * Injects (or replaces) the vote/note panel inside the popup dialog for the given label.
     * @param {Object} m - The label record.
     */
  #mountPopupPanel(m) {
    const dialog = document.getElementById('label-modal');
    if (!dialog) return;
    if (this.popupPanel) this.popupPanel.remove();
    const panel = document.createElement('div');
    panel.className = 'ud-mistake-response';
    const heading = document.createElement('p');
    heading.className = 'ud-mistake-response-heading';
    heading.textContent = 'Your label was validated as incorrect. Do you agree this was a mistake?';
    panel.append(heading, this.#voteSection(m), this.#noteSection(m));
    dialog.appendChild(panel);
    this.popupPanel = panel;
  }

  /**
     * The agree/contest vote control, driven by shared per-label state. Unvoted shows the two buttons; voted shows the
     * choice + a "Change response" button. Instant (no separate submit). Tagged with data-ud-vote for #sync.
     * @param {Object} m - The label record.
     * @returns {HTMLElement} The vote-section element.
     */
  #voteSection(m) {
    const agrees = this.#stateFor(m.label_id).agrees;
    const sec = document.createElement('div');
    sec.className = 'ud-card-vote';
    sec.dataset.udVote = m.label_id;

    if (agrees === null) {
      const prompt = document.createElement('p');
      prompt.className = 'ud-card-prompt';
      prompt.textContent = 'Do you agree this was a mistake?';
      const actions = document.createElement('div');
      actions.className = 'ud-card-actions';
      const agreeBtn = MistakeGallery.#chip('ud-chip-agree', '👍 Yes, a mistake.',
        'You agree this label was a mistake');
      const contestBtn = MistakeGallery.#chip('ud-chip-disagree', '✋ No, it\'s correct.',
        'You stand by your label — it was correct');
      agreeBtn.addEventListener('click', () => this.#vote(m, sec, true));
      contestBtn.addEventListener('click', () => this.#vote(m, sec, false));
      actions.append(agreeBtn, contestBtn);
      sec.append(prompt, actions);
    } else {
      sec.classList.add('ud-card-vote--done');
      const msg = document.createElement('p');
      msg.className = 'ud-card-voted-msg';
      msg.textContent = agrees
        ? '👍 You agreed this was a mistake.'
        : '✋ You said your label was correct — we\'ll take another look.';
      const change = document.createElement('button');
      change.type = 'button';
      change.className = 'ud-btn-secondary ud-card-change';
      change.textContent = 'Change response';
      change.addEventListener('click', () => {
        this.#stateFor(m.label_id).agrees = null;
        this.#sync(m);
      });
      sec.append(msg, change);
    }
    return sec;
  }

  /**
     * Records a vote and, on success, updates shared state and re-renders every vote section for this label.
     * @param {Object} m - The label record.
     * @param {HTMLElement} sec - The vote section (buttons disabled during the request).
     * @param {boolean} agrees - True = agree it was a mistake; false = contest.
     */
  async #vote(m, sec, agrees) {
    sec.querySelectorAll('button').forEach((b) => b.setAttribute('disabled', 'disabled'));
    try {
      const res = await fetch('/userapi/mistakeVote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ label_id: m.label_id, agrees }),
      });
      if (!res.ok) throw new Error(`vote failed: ${res.status}`);
      this.#stateFor(m.label_id).agrees = agrees;
      this.#sync(m);
    } catch (e) {
      console.error('Failed to record vote', e);
      sec.querySelectorAll('button').forEach((b) => b.removeAttribute('disabled'));
    }
  }

  /**
     * The optional note control, independent of the vote. Shows the saved note (if any) plus an "Add/Edit note" link
     * that reveals a textarea + "Save note". A note can be left with or without a vote.
     *
     * @param {Object} m - The label record.
     * @returns {HTMLElement} The note-section element (tagged data-ud-note for #sync).
     */
  #noteSection(m) {
    const note = this.#stateFor(m.label_id).note;
    const sec = document.createElement('div');
    sec.className = 'ud-card-note-section';
    sec.dataset.udNote = m.label_id;

    if (note) {
      const saved = document.createElement('p');
      saved.className = 'ud-card-your-note';
      saved.textContent = `Your note: “${note}”`;
      sec.appendChild(saved);
    }

    const link = document.createElement('a');
    link.className = 'ud-card-note-link';
    link.href = '#';
    link.textContent = note ? '✏️ Edit note' : '💬 Add a note';
    sec.appendChild(link);

    const wrap = document.createElement('div');
    wrap.className = 'ud-card-note-wrap';
    wrap.hidden = true;
    const textarea = document.createElement('textarea');
    textarea.className = 'ud-card-comment-input';
    textarea.rows = 2;
    textarea.placeholder = 'Add a note about this label (optional)…';
    textarea.value = note;
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ud-btn-primary ud-card-note-submit';
    saveBtn.textContent = 'Save note';
    wrap.append(textarea, saveBtn);
    sec.appendChild(wrap);

    link.addEventListener('click', (e) => {
      e.preventDefault();
      wrap.hidden = !wrap.hidden;
      if (!wrap.hidden) textarea.focus();
    });
    saveBtn.addEventListener('click', () => this.#saveNote(m, sec, textarea.value));

    return sec;
  }

  /**
     * Saves a note and, on success, updates shared state and re-renders every note section for this label.
     * @param {Object} m - The label record.
     * @param {HTMLElement} sec - The note section (disabled during the request).
     * @param {string} comment - The note text.
     */
  async #saveNote(m, sec, comment) {
    const trimmed = (comment || '').trim();
    sec.querySelectorAll('button, textarea, a').forEach((el) => el.setAttribute('disabled', 'disabled'));
    try {
      const res = await fetch('/userapi/mistakeNote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ label_id: m.label_id, comment: trimmed }),
      });
      if (!res.ok) throw new Error(`note failed: ${res.status}`);
      this.#stateFor(m.label_id).note = trimmed;
      this.#sync(m);
    } catch (e) {
      console.error('Failed to save note', e);
      sec.querySelectorAll('button, textarea, a').forEach((el) => el.removeAttribute('disabled'));
    }
  }

  /**
     * @param {string} cls - Extra class.
     * @param {string} label - Button text.
     * @param {string} title - Tooltip.
     * @returns {HTMLButtonElement}
     */
  static #chip(cls, label, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ud-chip ${cls}`;
    b.textContent = label;
    b.title = title;
    return b;
  }

  /**
     * "NoCurbRamp" -> "No Curb Ramp".
     * @param {string} type - LabelTypeEnum name.
     * @returns {string}
     */
  static #prettyType(type) {
    return String(type).replace(/([A-Z])/g, ' $1').trim();
  }
}
