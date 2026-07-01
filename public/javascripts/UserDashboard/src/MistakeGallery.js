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
            if (this.seeAllEl) this.seeAllEl.style.display = 'none';
            return;
        }
        mistakes.forEach(m => this.root.appendChild(this.#renderCard(m)));
        if (this.seeAllEl) this.seeAllEl.style.display = '';
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
            note.style.fontStyle = 'italic';
        }
        body.appendChild(note);

        // Contest affordance (non-functional in this phase — wires up with the contest backend, #2996/#1680).
        const actions = document.createElement('div');
        actions.className = 'ud-card-actions';
        actions.appendChild(MistakeGallery.#chip('ud-chip-agree', '👍 I agree', 'I agree this label was incorrect'));
        actions.appendChild(MistakeGallery.#chip('ud-chip-disagree', '✋ It was correct',
            'I disagree — my label was correct (contest the validation)'));
        body.appendChild(actions);

        const comment = document.createElement('a');
        comment.className = 'ud-card-comment-link';
        comment.href = '#';
        comment.textContent = '💬 Add a comment';
        body.appendChild(comment);

        card.appendChild(body);
        return card;
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
