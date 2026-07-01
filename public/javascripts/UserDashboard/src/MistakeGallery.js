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
     */
    constructor(rootEl, opts) {
        this.root = rootEl;
        this.userId = opts.userId;
        this.limit = opts.limit || 6;
        this.seeAllEl = opts.seeAllEl || null;
        // Explore canvas dimensions (fallback if util.EXPLORE_CANVAS_* isn't loaded on this page).
        this.canvasW = (window.util && util.EXPLORE_CANVAS_WIDTH) || 720;
        this.canvasH = (window.util && util.EXPLORE_CANVAS_HEIGHT) || 480;
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
        Object.keys(data || {}).forEach(type => (data[type] || []).forEach(label => all.push(label)));
        all.sort((a, b) => new Date(b.time_validated) - new Date(a.time_validated));
        const mistakes = all.slice(0, this.limit);

        this.root.innerHTML = '';
        if (mistakes.length === 0) {
            this.#renderEmpty();
            if (this.seeAllEl) this.seeAllEl.hidden = true;
            return;
        }
        mistakes.forEach(m => this.root.appendChild(this.#renderCard(m)));
        if (this.seeAllEl) this.seeAllEl.hidden = false;
    }

    /** Encouraging state when the user has no incorrectly-validated labels. */
    #renderEmpty() {
        const div = document.createElement('div');
        div.className = 'ud-nudge';
        div.textContent = "🎉 No mistakes to review — your labels are holding up great. Keep it up!";
        this.root.appendChild(div);
    }

    /**
     * Builds one mistake card.
     * @param {Object} m - A label record from the endpoint.
     * @returns {HTMLElement}
     */
    #renderCard(m) {
        const type = m.label_type;
        const color = util.misc.getLabelColors(type) || '#b3b3b3';
        const iconPath = util.misc.getIconImagePaths(type)?.iconImagePath;

        const card = document.createElement('figure');
        card.className = 'ud-card';

        const img = document.createElement('div');
        img.className = 'ud-card-img';
        if (m.image_url) img.style.backgroundImage = `url("${m.image_url}")`;

        const icon = document.createElement('span');
        icon.className = 'ud-card-type-icon';
        icon.style.borderColor = color;
        if (iconPath) {
            const iconImg = document.createElement('img');
            iconImg.src = iconPath;
            iconImg.alt = '';
            icon.appendChild(iconImg);
        }
        img.appendChild(icon);

        const verdict = document.createElement('span');
        verdict.className = 'ud-card-verdict';
        verdict.textContent = 'Marked incorrect';
        img.appendChild(verdict);
        card.appendChild(img);

        const body = document.createElement('figcaption');
        body.className = 'ud-card-body';

        const title = document.createElement('span');
        title.className = 'ud-card-title';
        title.textContent = MistakeGallery.#prettyType(type);
        body.appendChild(title);

        const note = document.createElement('span');
        note.className = 'ud-card-note';
        if (m.validator_comment) {
            note.textContent = `“${m.validator_comment}”`;
        } else {
            note.textContent = 'No comment left by validators.';
            note.classList.add('ud-card-note-muted');
        }
        body.appendChild(note);

        // Interactive controls, extracted so they can be re-rendered when the user edits their response.
        body.appendChild(this.#buildControls(card, m, ''));

        card.appendChild(body);
        return card;
    }

    /**
     * Builds a card's response controls: the two answer buttons plus an expandable note.
     *
     * @param {HTMLElement} card - The card element (threaded through to #submit).
     * @param {Object} m - The label record.
     * @param {string} prefillNote - Note to pre-fill and auto-expand (when re-editing); '' for a fresh card.
     * @returns {HTMLElement} The controls container.
     */
    #buildControls(card, m, prefillNote) {
        const controls = document.createElement('div');
        controls.className = 'ud-card-controls';

        const prompt = document.createElement('p');
        prompt.className = 'ud-card-prompt';
        prompt.textContent = 'Do you agree this was a mistake?';
        controls.appendChild(prompt);

        const actions = document.createElement('div');
        actions.className = 'ud-card-actions';
        const agreeBtn = MistakeGallery.#chip('ud-chip-agree', '👍 I agree I made a mistake',
            'Records that you agree this label was incorrect');
        const contestBtn = MistakeGallery.#chip('ud-chip-disagree', '✋ No — my label was correct',
            'Contests the validation — you stand by your label');
        actions.append(agreeBtn, contestBtn);
        controls.appendChild(actions);

        // "Add a note" reveals a textarea + its own "Submit note" button (a contest with your explanation).
        const commentLink = document.createElement('a');
        commentLink.className = 'ud-card-comment-link';
        commentLink.href = '#';
        commentLink.textContent = '💬 Add a note';
        controls.appendChild(commentLink);

        const noteWrap = document.createElement('div');
        noteWrap.className = 'ud-card-note-wrap';
        noteWrap.hidden = prefillNote === '';
        const textarea = document.createElement('textarea');
        textarea.className = 'ud-card-comment-input';
        textarea.rows = 2;
        textarea.placeholder = 'Explain why you think your label was correct…';
        textarea.value = prefillNote;
        const submitNoteBtn = document.createElement('button');
        submitNoteBtn.type = 'button';
        submitNoteBtn.className = 'ud-btn-primary ud-card-note-submit';
        submitNoteBtn.textContent = 'Submit note';
        noteWrap.append(textarea, submitNoteBtn);
        controls.appendChild(noteWrap);

        commentLink.addEventListener('click', e => {
            e.preventDefault();
            noteWrap.hidden = !noteWrap.hidden;
            if (!noteWrap.hidden) textarea.focus();
        });
        agreeBtn.addEventListener('click', () => this.#submit(card, controls, m, true, ''));
        contestBtn.addEventListener('click', () => this.#submit(card, controls, m, false, ''));
        submitNoteBtn.addEventListener('click', () => this.#submit(card, controls, m, false, textarea.value));

        return controls;
    }

    /**
     * Records the user's response and, on success, swaps the controls for a confirmed summary with an Edit button.
     * Re-responding upserts the same (label, user) row, so editing is just a re-submit.
     *
     * @param {HTMLElement} card - The card element.
     * @param {HTMLElement} controls - The controls container to replace on success.
     * @param {Object} m - The label record.
     * @param {boolean} agrees - True = agrees it was incorrect; false = contests it.
     * @param {string} comment - Optional note.
     */
    async #submit(card, controls, m, agrees, comment) {
        controls.querySelectorAll('button, textarea, a').forEach(el => el.setAttribute('disabled', 'disabled'));
        const trimmed = (comment || '').trim();
        try {
            const res = await fetch('/userapi/contestMistake', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ label_id: m.label_id, agrees: agrees, comment: trimmed })
            });
            if (!res.ok) throw new Error(`contest failed: ${res.status}`);
            card.classList.add('ud-card-resolved');
            controls.replaceWith(this.#buildResolved(card, m, agrees, trimmed));
        } catch (e) {
            console.error('Failed to record mistake response', e);
            controls.querySelectorAll('button, textarea, a').forEach(el => el.removeAttribute('disabled'));
        }
    }

    /**
     * The confirmed-response summary: what the user chose, their note (if any), and an Edit button that restores the
     * pre-filled controls so they can change and re-submit.
     *
     * @param {HTMLElement} card - The card element.
     * @param {Object} m - The label record.
     * @param {boolean} agrees - The recorded choice.
     * @param {string} comment - The recorded note.
     * @returns {HTMLElement}
     */
    #buildResolved(card, m, agrees, comment) {
        const wrap = document.createElement('div');
        wrap.className = 'ud-card-resolved-body';

        const msg = document.createElement('p');
        msg.className = 'ud-card-resolved-msg';
        msg.textContent = agrees
            ? '👍 You agreed this was a mistake — noted, thanks.'
            : "✋ You're standing by your label. We'll take another look.";
        wrap.appendChild(msg);

        if (comment) {
            const noteEcho = document.createElement('p');
            noteEcho.className = 'ud-card-resolved-note';
            noteEcho.textContent = `Your note: “${comment}”`;
            wrap.appendChild(noteEcho);
        }

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'ud-btn-secondary ud-card-edit';
        editBtn.textContent = 'Edit response';
        editBtn.addEventListener('click', () => {
            card.classList.remove('ud-card-resolved');
            wrap.replaceWith(this.#buildControls(card, m, comment));
        });
        wrap.appendChild(editBtn);

        return wrap;
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
