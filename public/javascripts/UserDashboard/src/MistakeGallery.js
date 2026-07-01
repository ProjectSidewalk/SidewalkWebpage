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
        const iconPath = util.misc.getIconImagePaths(type)?.iconImagePath;

        const card = document.createElement('figure');
        card.className = 'ud-card';

        // The pano is aimed at the label's POV, so the label sits at the image center — mark it with its own icon so
        // it's clear which feature is theirs (falls back to just the icon on the gradient if no pano image).
        const img = document.createElement('div');
        img.className = 'ud-card-img';
        if (m.image_url) img.style.backgroundImage = `url("${m.image_url}")`;
        if (iconPath) {
            const marker = document.createElement('img');
            marker.className = 'ud-card-label-marker';
            marker.src = iconPath;
            marker.alt = '';
            img.appendChild(marker);
        }
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

        const valNote = document.createElement('span');
        valNote.className = 'ud-card-note';
        if (m.validator_comment) {
            valNote.textContent = `“${m.validator_comment}”`;
        } else {
            valNote.textContent = 'No comment left by validators.';
            valNote.classList.add('ud-card-note-muted');
        }
        body.appendChild(valNote);

        // Two independent controls: the vote (instant on click, changeable) and the note (optional, stands alone).
        body.appendChild(this.#voteSection(card, m, null));
        body.appendChild(this.#noteSection(card, m, ''));

        card.appendChild(body);
        return card;
    }

    /**
     * The agree/contest vote control. When unvoted it shows the two buttons; once voted it shows the choice and a
     * "Change response" button. Voting is instant (no separate submit) and re-rendered in place.
     *
     * @param {HTMLElement} card - The card element (for the voted tint).
     * @param {Object} m - The label record.
     * @param {boolean|null} agrees - The current vote, or null if not yet voted.
     * @returns {HTMLElement} The vote-section element.
     */
    #voteSection(card, m, agrees) {
        const sec = document.createElement('div');
        sec.className = 'ud-card-vote';

        if (agrees === null) {
            card.classList.remove('ud-card-voted');
            const prompt = document.createElement('p');
            prompt.className = 'ud-card-prompt';
            prompt.textContent = 'Do you agree this was a mistake?';
            const actions = document.createElement('div');
            actions.className = 'ud-card-actions';
            const agreeBtn = MistakeGallery.#chip('ud-chip-agree', '👍 I agree I made a mistake',
                'Records that you agree this label was incorrect');
            const contestBtn = MistakeGallery.#chip('ud-chip-disagree', '✋ No — my label was correct',
                'Stand by your label — contest the validation');
            agreeBtn.addEventListener('click', () => this.#vote(m, sec, card, true));
            contestBtn.addEventListener('click', () => this.#vote(m, sec, card, false));
            actions.append(agreeBtn, contestBtn);
            sec.append(prompt, actions);
        } else {
            card.classList.add('ud-card-voted');
            const msg = document.createElement('p');
            msg.className = 'ud-card-voted-msg';
            msg.textContent = agrees
                ? '👍 You agreed this was a mistake.'
                : "✋ You said your label was correct — we'll take another look.";
            const change = document.createElement('button');
            change.type = 'button';
            change.className = 'ud-btn-secondary ud-card-change';
            change.textContent = 'Change response';
            change.addEventListener('click', () => sec.replaceWith(this.#voteSection(card, m, null)));
            sec.append(msg, change);
        }
        return sec;
    }

    /**
     * Records a vote and, on success, re-renders the vote section in its voted state.
     * @param {Object} m - The label record.
     * @param {HTMLElement} sec - The vote section to replace.
     * @param {HTMLElement} card - The card element.
     * @param {boolean} agrees - True = agree it was a mistake; false = contest.
     */
    async #vote(m, sec, card, agrees) {
        sec.querySelectorAll('button').forEach(b => b.setAttribute('disabled', 'disabled'));
        try {
            const res = await fetch('/userapi/mistakeVote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ label_id: m.label_id, agrees: agrees })
            });
            if (!res.ok) throw new Error(`vote failed: ${res.status}`);
            sec.replaceWith(this.#voteSection(card, m, agrees));
        } catch (e) {
            console.error('Failed to record vote', e);
            sec.querySelectorAll('button').forEach(b => b.removeAttribute('disabled'));
        }
    }

    /**
     * The optional note control, independent of the vote. Shows the saved note (if any) plus an "Add/Edit note" link
     * that reveals a textarea + "Save note". A note can be left with or without a vote.
     *
     * @param {HTMLElement} card - The card element.
     * @param {Object} m - The label record.
     * @param {string} note - The current note ('' if none).
     * @returns {HTMLElement} The note-section element.
     */
    #noteSection(card, m, note) {
        const sec = document.createElement('div');
        sec.className = 'ud-card-note-section';

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

        link.addEventListener('click', e => {
            e.preventDefault();
            wrap.hidden = !wrap.hidden;
            if (!wrap.hidden) textarea.focus();
        });
        saveBtn.addEventListener('click', () => this.#saveNote(m, sec, card, textarea.value));

        return sec;
    }

    /**
     * Saves a note and, on success, re-renders the note section showing it (with an Edit affordance).
     * @param {Object} m - The label record.
     * @param {HTMLElement} sec - The note section to replace.
     * @param {HTMLElement} card - The card element.
     * @param {string} comment - The note text.
     */
    async #saveNote(m, sec, card, comment) {
        const trimmed = (comment || '').trim();
        sec.querySelectorAll('button, textarea, a').forEach(el => el.setAttribute('disabled', 'disabled'));
        try {
            const res = await fetch('/userapi/mistakeNote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ label_id: m.label_id, comment: trimmed })
            });
            if (!res.ok) throw new Error(`note failed: ${res.status}`);
            sec.replaceWith(this.#noteSection(card, m, trimmed));
        } catch (e) {
            console.error('Failed to save note', e);
            sec.querySelectorAll('button, textarea, a').forEach(el => el.removeAttribute('disabled'));
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
