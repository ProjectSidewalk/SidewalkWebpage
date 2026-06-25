/**
 * LabelDetail — host-agnostic controller for the label detail view.
 *
 * Two hosts use this:
 *   - LabelPopup wrapper (label-popup.js): mounts inside a <dialog id="label-modal" class="label-detail">.
 *   - Gallery's expanded view (Gallery/.../ExpandedView.js): mounts inline inside a <div class="label-detail label-detail--inline">.
 *
 * The controller scopes all DOM queries to `root` and never touches the document outside of it. Multiple instances on
 * different pages cannot collide. The host is responsible for ensuring that `root` is laid out (visible in the DOM with
 * non-zero dimensions) before LabelDetail() is called, because the pano viewer needs to measure its container at init.
 *
 * @param {HTMLElement} root The host element containing the labelDetail markup (see labelDetail.scala.html).
 * @param {object} opts
 * @param {boolean} opts.admin If true, this is an admin UI, so additional info can be shown.
 * @param {typeof PanoViewer} opts.viewerType The type of pano viewer to initialize.
 * @param {string} opts.viewerAccessToken An access token used to request images for the pano viewer.
 * @param {string} [opts.currUsername] Username of the current viewer. Used to identify comments from this user.
 * @param {(action: 'Agree'|'Disagree'|'Unsure', meta: object) => void} [opts.onVote] Optional callback fired after a
 *      vote is successfully submitted. Hosts use this to sync upstream UI (e.g. recolor a Gallery card after the user
 *      vote from inside the expanded view).
 * @param {string} [opts.panoOverlaySource] Source string recorded when the user votes via the pano overlay buttons.
 *      Overrides the source passed to showLabel(). Defaults to that source if omitted.
 * @param {string} [opts.voteColumnSource] Source string recorded when the user votes via the column vote
 *     buttons. Overrides the source passed to showLabel(). Defaults to that source if omitted.
 * @returns {Promise<object>} Resolves once the pano viewer has been initialized.
 */
async function LabelDetail(root, opts) {
    const self = {};
    const {
        admin, viewerType, viewerAccessToken, currUsername, onVote, panoOverlaySource, voteColumnSource
    } = opts;
    self.admin = admin;
    self.source = undefined; // Set in showLabel().
    self.readonly = false;   // Set per-label in _handleData() based on meta.from_current_user.

    // Updated in each showLabel() call so PanoInfoPopover's accessor closures see the current label.
    let currentLabelMeta = null;

    const FLAG_NAMES = ['low_quality', 'incomplete', 'stale'];

    // Field references — populated in _init().
    const $ = (sel) => root.querySelector(sel);
    const els = {};

    self.validationCounts = { Agree: null, Disagree: null, Unsure: null };
    self.flags = { low_quality: null, incomplete: null, stale: null };
    self.prevAction = null;
    self.taskId = null;

    // ───────────────────────────────────────────────────────────────────
    // Init
    // ───────────────────────────────────────────────────────────────────

    /**
     * One-time setup: caches element references, wires event handlers, and initializes the pano viewer.
     * @private
     */
    async function _init() {
        _cacheElements();
        _wireHandlers();

        // Pano viewer needs a visible host element on init. The wrapping host (LabelPopup or Gallery) is responsible
        // for ensuring this is the case before constructing LabelDetail.
        self.panoManager = await PopupPanoManager(
            els.svHolder,
            els.panoOverlay,
            admin,
            viewerType,
            viewerAccessToken
        );

        _initInfoPopover();

        // Seed the all-time counts so a validation here can celebrate a newly unlocked validation badge.
        BadgeAchievements.seedCounts();
    }

    /**
     * Mounts a PanoInfoPopover into the .label-detail__info-button-host span. Accessor closures read from
     * `currentLabelMeta`, which is updated on every showLabel() call.
     */
    function _initInfoPopover() {
        const host = $('.label-detail__info-button-host');
        if (!host) return;

        const noopLog = () => {};
        const panoViewer = self.panoManager.panoViewer;
        self.infoPopover = new PanoInfoPopover(
            host,
            self.panoManager.panoViewer,
            () => currentLabelMeta && { lat: currentLabelMeta.camera_lat, lng: currentLabelMeta.camera_lng },
            () => currentLabelMeta && currentLabelMeta.pano_id,
            () => currentLabelMeta && currentLabelMeta.street_edge_id,
            () => currentLabelMeta && currentLabelMeta.region_id,
            () => currentLabelMeta && moment(new Date(currentLabelMeta.image_capture_date)),
            () => panoViewer.currPanoData ? panoViewer.currPanoData.getProperty('address') : null,
            () => currentLabelMeta && { heading: currentLabelMeta.heading, pitch: currentLabelMeta.pitch, zoom: currentLabelMeta.zoom },
            false,    // whiteIcon
            noopLog,  // infoLogging
            noopLog,  // clipboardLogging
            noopLog,  // viewPanoLogging
            () => currentLabelMeta && currentLabelMeta.label_id
        );
    }

    /**
     * Caches element references inside the host root. We use these to update content when showing labels.
     * @private
     */
    function _cacheElements() {
        els.svHolder           = $('.label-detail__pano');
        els.panoWrap           = $('.label-detail__pano-wrap');
        els.panoOverlay        = $('.label-detail__pano-overlay');
        els.title              = $('.label-detail__title');
        els.timestamp          = $('.label-detail__timestamp');
        els.imageDate          = $('.label-detail__image-capture-date');
        els.severitySection    = $('.label-detail__col--severity');
        els.severity           = $('.label-detail__severity-faces');
        els.severityTitle      = $('.label-detail__severity-title');
        els.tags               = $('.label-detail__tags');
        els.description        = $('.label-detail__description');
        els.validatorComments  = $('.label-detail__validator-comments');
        els.commentInput       = $('.label-detail__comment-input');
        els.commentButton      = $('.label-detail__comment-submit');
        els.commentConfirm     = $('.label-detail__comment-confirmation');

        // Validation count display: <img> elements whose `src` is swapped between the four icon variants
        // (outline / filled / outline-ai / filled-ai). The base URL for the icon files is read from a data
        // attribute on the container so JS doesn't need to know the assets' path.
        const voteDisplay = root.querySelector('.label-detail__vote-display');
        self.iconBase = voteDisplay ? voteDisplay.dataset.iconBase : '';
        const voteEl = (variant, child) => root.querySelector(`.label-detail__vote--${variant} ${child}`);
        els.voteIcons = {
            Agree:    voteEl('agree',    '.label-detail__vote-icon'),
            Disagree: voteEl('disagree', '.label-detail__vote-icon'),
            Unsure:   voteEl('unsure',   '.label-detail__vote-icon')
        };
        els.voteButtons = {
            Agree:    root.querySelector('.label-detail__vote--agree'),
            Disagree: root.querySelector('.label-detail__vote--disagree'),
            Unsure:   root.querySelector('.label-detail__vote--unsure')
        };
        els.voteCounts = {
            Agree:    voteEl('agree',    '.label-detail__vote-count'),
            Disagree: voteEl('disagree', '.label-detail__vote-count'),
            Unsure:   voteEl('unsure',   '.label-detail__vote-count')
        };
        // Hover-reveal overlay buttons on the pano. Both these and the column buttons fire a vote.
        els.panoOverlayButtons = {
            Agree:    root.querySelector('.label-detail__pano-overlay-button--agree'),
            Disagree: root.querySelector('.label-detail__pano-overlay-button--disagree'),
            Unsure:   root.querySelector('.label-detail__pano-overlay-button--unsure')
        };

        if (admin) {
            els.adminUsername = $('.label-detail__admin-username');
            els.adminTask     = $('.label-detail__admin-task');
            els.adminPrevVals = $('.label-detail__admin-prev-validations');
            els.flagButtons = {
                low_quality: $('.label-detail__flag-button[data-flag="low_quality"]'),
                incomplete:  $('.label-detail__flag-button[data-flag="incomplete"]'),
                stale:       $('.label-detail__flag-button[data-flag="stale"]')
            };
        }
    }

    /**
     * Adds event listeners to buttons inside the host root. The host wrapper is responsible for the
     * close button (popup closes the dialog; gallery hides the inline panel) and for prev/next paging
     * (gallery only). LabelDetail just emits the close event via the data-action attribute.
     * @private
     */
    function _wireHandlers() {
        // buttonSource overrides self.source for this specific button group; falls back to self.source if null.
        const voteHandler = (action, buttonSource) => () => {
            if (self.readonly) return;
            if (self.prevAction !== action) {
                _setVoteButtonsDisabled(true);
                _validateLabel(action, buttonSource || self.source);
            }
        };
        for (const action of Object.keys(els.panoOverlayButtons)) {
            els.panoOverlayButtons[action].addEventListener('click', voteHandler(action, panoOverlaySource));
            els.voteButtons[action].addEventListener('click', voteHandler(action, voteColumnSource));

            // Hover preview: show the filled icon variant while the pointer is over the vote button.
            const btn = els.voteButtons[action];
            const img = els.voteIcons[action];
            btn.addEventListener('mouseenter', () => {
                if (self.readonly) return;
                const ai = self.aiValidation === action ? '-ai' : '';
                img.src = `${self.iconBase}${action.toLowerCase()}-filled${ai}.svg`;
            });
            btn.addEventListener('mouseleave', () => {
                if (self.readonly) return;
                _renderVoteIcons();
            });
        }

        els.commentInput.addEventListener('input', () => {
            els.commentButton.classList.toggle('is-active', els.commentInput.value.trim().length > 0);
        });
        els.commentInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (self.readonly) return;
                const comment = els.commentInput.value.trim();
                if (comment) _submitComment(comment);
            } else if (e.key === 'Escape') {
                // Swallow the first Escape so it only blurs the input. Second esc will close the dialog.
                e.preventDefault();
                e.stopPropagation();
            }
        });
        // Same method for swallowing first Escape, but need to use 'keyup' for Gallery.
        els.commentInput.addEventListener('keyup', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                els.commentInput.blur();
            }
        });
        els.commentButton.addEventListener('click', () => {
            if (self.readonly) return;
            const comment = els.commentInput.value.trim();
            if (comment) _submitComment(comment);
        });

        if (admin) {
            for (const flag of FLAG_NAMES) {
                els.flagButtons[flag].addEventListener('click', () => _setFlag(flag, !self.flags[flag]));
            }
        }
    }

    // ───────────────────────────────────────────────────────────────────
    // Show a label
    // ───────────────────────────────────────────────────────────────────

    /**
     * Shows the given label. Accepts either a label id (in which case the metadata is fetched from the server) or a
     * pre-built meta object (in which case it's rendered directly — used by Gallery, which already has the data in
     * memory from its initial fetch).
     *
     * @param {number|object} idOrMeta Either a label id (number) to fetch, or a pre-built meta object.
     * @param {string} source The UI that created the popup (recorded with validations).
     */
    async function showLabel(idOrMeta, source) {
        self.source = source;
        _resetVoteButtonStyles();
        self.panoManager.clearLabels();

        if (typeof idOrMeta === 'object' && idOrMeta !== null) {
            _handleData(idOrMeta);
            return;
        }

        const labelId = idOrMeta;
        const url = admin ? `/adminapi/label/id/${labelId}` : `/label/id/${labelId}`;
        const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        if (!response.ok) {
            alert('Server error. Most likely a label with this ID did not exist.');
            throw new Error(`HTTP error ${response.status}`);
        }
        _handleData(await response.json());
    }

    /**
     * Populates the view with the label metadata fetched (or passed in directly) by showLabel().
     * @param {object} meta The label metadata payload.
     * @private
     */
    function _handleData(meta) {
        currentLabelMeta = meta;

        // Read-only mode for the user's own labels — no validating/commenting.
        self.readonly = !!meta.from_current_user;
        root.classList.toggle('label-detail--readonly', self.readonly);
        _setReadonlyState(self.readonly);

        const labelPov = { heading: meta.heading, pitch: meta.pitch, zoom: meta.zoom };

        // Plain-object label shape consumed by PopupPanoManager. The old/new severity + tags split exists so
        // the popup can track edits to those fields against the original values from the API payload.
        const popupLabel = {
            labelId: meta.label_id,
            label_type: meta.label_type,
            canvasX: meta.canvas_x,
            canvasY: meta.canvas_y,
            originalCanvasWidth: util.EXPLORE_CANVAS_WIDTH,
            originalCanvasHeight: util.EXPLORE_CANVAS_HEIGHT,
            pov: labelPov,
            streetEdgeId: meta.street_edge_id,
            oldSeverity: meta.severity,
            newSeverity: meta.severity,
            oldTags: meta.tags,
            newTags: meta.tags,
            aiGenerated: meta.ai_generated
        };
        self.panoManager.setLabel(popupLabel);
        // Accept a pre-constructed backup_image object (Gallery path) or build from server fields (API path).
        const backupImage = meta.backup_image || buildBackupImageData(meta);
        self.panoManager.setPano(meta.pano_id, labelPov, meta.crop_url, meta.expired, backupImage);

        // Validation counts + AI validation.
        self.validationCounts.Agree    = meta.num_agree;
        self.validationCounts.Disagree = meta.num_disagree;
        self.validationCounts.Unsure   = meta.num_unsure;
        self.prevAction                = meta.user_validation;
        self.aiValidation              = meta.ai_validation;
        _renderVoteCounts();
        _renderVoteIcons();

        // Admin flags.
        if (admin) {
            self.flags.low_quality = meta.low_quality;
            self.flags.incomplete  = meta.incomplete;
            self.flags.stale       = meta.stale;
            _renderFlagButtons();
        }

        // Title: "Label Type : Curb Ramp"
        const labelTypeName = i18next.t(`common:${camelToKebab(meta.label_type)}`);
        els.title.textContent = `${i18next.t('labelmap:label-type')} : ${labelTypeName}`;

        // Severity faces.
        _renderSeverity(meta.severity, meta.label_type);

        // Tag pills.
        els.tags.replaceChildren();
        els.tags.classList.remove('label-detail__empty');
        if (meta.tags && meta.tags.length) {
            for (const tag of meta.tags) {
                const pill = document.createElement('span');
                pill.className = 'tag-pill';
                const pillLabel = document.createElement('span');
                pillLabel.className = 'tag-pill__label';
                pillLabel.textContent = i18next.t(`common:tag.${tag.replace(/:/g, '-')}`);
                pill.appendChild(pillLabel);
                els.tags.appendChild(pill);
            }
        } else {
            els.tags.classList.add('label-detail__empty');
            els.tags.textContent = i18next.t('common:none');
        }

        // Description.
        if (meta.description != null) {
            els.description.classList.remove('label-detail__empty');
            els.description.textContent = meta.description;
        } else {
            els.description.classList.add('label-detail__empty');
            els.description.textContent = i18next.t('common:no-description');
        }

        // Dates.
        els.timestamp.textContent = moment(new Date(meta.timestamp)).format('LL, LT');
        els.imageDate.textContent = moment(new Date(meta.image_capture_date)).format('MMMM YYYY');

        // Validator comments. Admin endpoint returns objects {username, comment}; non-admin returns bare
        // strings. Stash on `self` so _submitComment() can append after a successful POST.
        self.comments = meta.comments || [];
        // Index of the current user's comment in self.comments, if any. The backend replaces comments rather than just
        // adding new ones, so we mirror that here (but in non-admin, who added comments, so we just always append).
        self.myCommentIdx = -1;
        if (admin && currUsername) {
            self.myCommentIdx = self.comments.findIndex(c => c && c.username === currUsername);
        }
        _renderComments();

        // Fill in some admin-only fields at the bottom if applicable.
        if (admin) {
            self.taskId = meta.audit_task_id;

            const taskLink = document.createElement('a');
            taskLink.href = `/admin/task/${meta.audit_task_id}`;
            taskLink.textContent = meta.audit_task_id;
            els.adminTask.replaceChildren(taskLink);

            const userLink = document.createElement('a');
            userLink.href = `/admin/user/${encodeURI(meta.username)}`;
            userLink.textContent = meta.username;
            els.adminUsername.replaceChildren(userLink);

            const prevVals = meta.admin_data.previous_validations;
            els.adminPrevVals.replaceChildren();
            if (prevVals.length === 0) {
                els.adminPrevVals.textContent = i18next.t('common:none');
            } else {
                prevVals.forEach((pv, i) => {
                    if (i > 0) els.adminPrevVals.appendChild(document.createElement('br'));
                    const a = document.createElement('a');
                    a.href = `/admin/user/${encodeURI(pv.username)}`;
                    a.textContent = pv.username;
                    els.adminPrevVals.appendChild(a);
                    els.adminPrevVals.appendChild(
                        document.createTextNode(`: ${i18next.t(`common:${camelToKebab(pv.validation)}`)}`)
                    );
                });
            }
        }

        // If the user previously validated this label, mark the chosen vote on the pano overlay.
        if (meta.user_validation && !self.readonly) _highlightVote(meta.user_validation);
        else _highlightVote(null);
    }

    // ───────────────────────────────────────────────────────────────────
    // Validation submission
    // ───────────────────────────────────────────────────────────────────

    /**
     * POSTs a validation for the current label to /labelmap/validate, then updates the count and validation
     * display. Fires opts.onVote after a successful submission so hosts can sync upstream UI.
     * @param {'Agree'|'Disagree'|'Unsure'} action
     * @param {string} source The UI source string to record with this validation.
     * @private
     */
    function _validateLabel(action, source) {
        const isNewValidation = !self.prevAction;
        const validationTimestamp = new Date();
        const canvasWidth  = self.panoManager.svHolder.width();
        const canvasHeight = self.panoManager.svHolder.height();
        const panoMarkerPov = self.panoManager.getOriginalPosition();
        const userPov = self.panoManager.getPov();

        const labelRadius = 10;
        const pixelCoordinates =
            util.pano.centeredPovToCanvasCoord(panoMarkerPov, userPov, canvasWidth, canvasHeight, labelRadius);

        const data = {
            label_id: self.panoManager.label.labelId,
            label_type: self.panoManager.label.label_type,
            validation_result: action,
            old_severity: self.panoManager.label.oldSeverity,
            new_severity: self.panoManager.label.newSeverity,
            old_tags: self.panoManager.label.oldTags,
            new_tags: self.panoManager.label.newTags,
            canvas_x: pixelCoordinates ? Math.round(pixelCoordinates.x) : null,
            canvas_y: pixelCoordinates ? Math.round(pixelCoordinates.y) : null,
            heading: userPov.heading,
            pitch: userPov.pitch,
            zoom: userPov.zoom,
            canvas_height: canvasHeight,
            canvas_width: canvasWidth,
            start_timestamp: validationTimestamp,
            end_timestamp: validationTimestamp,
            source: source,
            undone: false,
            redone: action !== self.prevAction,
            viewer_type: self.panoManager.activeViewerName
        };

        fetch('/labelmap/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(data)
        }).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            _updateVoteCount(action);
            _highlightVote(action);
            _setVoteButtonsDisabled(false);
            if (isNewValidation) BadgeAchievements.recordValidation(self.panoManager.svHolder[0]);
            if (typeof onVote === 'function') onVote(action, currentLabelMeta);
        }).catch((err) => {
            console.error(err);
            _setVoteButtonsDisabled(false);
        });
    }

    function _setVoteButtonsDisabled(disabled) {
        for (const btn of Object.values(els.panoOverlayButtons)) {
            btn.disabled = disabled;
        }
        for (const btn of Object.values(els.voteButtons)) {
            btn.disabled = disabled;
        }
    }

    function _renderVoteCounts() {
        for (const action of Object.keys(els.voteCounts)) {
            els.voteCounts[action].textContent = self.validationCounts[action] ?? 0;
        }
    }

    /**
     * Adjusts the in-memory validation counts after a successful vote.
     * @private
     */
    function _updateVoteCount(action) {
        if (self.prevAction) {
            self.validationCounts[self.prevAction] = Math.max(0, self.validationCounts[self.prevAction] - 1);
        }
        self.prevAction = action;
        self.validationCounts[action] += 1;
        _renderVoteCounts();
    }

    /**
     * Reflects the current vote on the pano overlay (selected button + border color around the pano).
     */
    function _highlightVote(action) {
        for (const [key, btn] of Object.entries(els.panoOverlayButtons)) {
            btn.classList.toggle('is-selected', key === action);
        }
        // Border on the pano wrap reflects the current validation.
        if (els.panoWrap) {
            els.panoWrap.classList.remove('is-agree', 'is-disagree', 'is-unsure');
            if (action) els.panoWrap.classList.add(`is-${action.toLowerCase()}`);
        }
        _renderVoteIcons();
    }

    function _resetVoteButtonStyles() {
        for (const btn of Object.values(els.panoOverlayButtons)) {
            btn.classList.remove('is-selected');
            if (!self.readonly) btn.disabled = false;
        }
        if (els.panoWrap) {
            els.panoWrap.classList.remove('is-agree', 'is-disagree', 'is-unsure');
        }
    }

    /**
     * Toggles the disabled state + tooltip on interactive elements when viewing your own label.
     * @param {boolean} readonly
     * @private
     */
    function _setReadonlyState(readonly) {
        const tip = readonly ? i18next.t('labelmap:own-label-disabled') : '';

        // Pano overlay buttons.
        for (const btn of Object.values(els.panoOverlayButtons)) {
            btn.disabled = readonly;
            btn.title = tip;
        }

        // Validation column buttons.
        for (const btn of Object.values(els.voteButtons)) {
            btn.disabled = readonly;
            btn.title = tip;
        }

        // Comment input and submit button.
        els.commentInput.disabled = readonly;
        els.commentInput.title = tip;
        els.commentButton.disabled = readonly;
        els.commentButton.title = tip;
    }

    /**
     * Updates the three column icons to the right variant based on the user's current vote
     * (`self.prevAction`) and the AI validation (`self.aiValidation`):
     *   - filled when the user voted this option, otherwise outline
     *   - `-ai` suffix when the AI validated this option
     */
    function _renderVoteIcons() {
        for (const [action, img] of Object.entries(els.voteIcons)) {
            const state = self.prevAction === action ? 'filled' : 'outline';
            const ai    = self.aiValidation === action ? '-ai' : '';
            img.src = `${self.iconBase}${action.toLowerCase()}-${state}${ai}.svg`;
            if (self.aiValidation === action) {
                img.title = i18next.t('labelmap:ai-val-included', { aiVal: action.toLowerCase() });
            } else {
                img.removeAttribute('title');
            }
        }
    }

    /**
     * Highlights one of the three severity faces based on the label's numeric severity.
     * @param {number} [severity] The label's 1–3 severity, or null for unrated.
     * @param {string} labelType The label type (drives positive/negative icon set).
     * @private
     */
    function _renderSeverity(severity, labelType) {
        // Hide entire section if the label type doesn't support severity ratings.
        if (els.severitySection) els.severitySection.hidden = !util.misc.labelTypeHasSeverity(labelType);
        if (!util.misc.labelTypeHasSeverity(labelType)) return;

        const positive = util.misc.isPositiveLabelType(labelType);
        const titleKey = positive ? 'quality' : 'severity';
        const levelKeys = util.misc.getRatingLevelKeys(labelType);

        if (els.severityTitle) els.severityTitle.textContent = i18next.t(`common:${titleKey}`);
        if (els.severity) els.severity.setAttribute('aria-label', i18next.t(`common:${titleKey}`));

        els.severity.querySelectorAll('.severity-button').forEach((face) => {
            const faceSev = Number(face.dataset.severity);
            const selected = faceSev === Number(severity);
            face.classList.toggle('is-selected', selected);
            face.querySelector('.severity-button__icon').src = util.misc.getSmileyIconPath(faceSev, labelType, selected);
            const labelSpan = face.querySelector('.severity-button__label');
            if (labelSpan) labelSpan.textContent = i18next.t(`common:${levelKeys[faceSev]}`);
        });
    }

    // ───────────────────────────────────────────────────────────────────
    // Comment submission
    // ───────────────────────────────────────────────────────────────────

    /**
     * Renders the validator comments list. In admin mode each entry is an object {username, comment} and the username
     * is hyperlinked to /admin/user/<username>. Non-admin mode receives bare strings, so we just render the text.
     */
    function _renderComments() {
        els.validatorComments.replaceChildren();
        els.validatorComments.classList.remove('label-detail__empty');
        if (!self.comments || self.comments.length === 0) {
            els.validatorComments.classList.add('label-detail__empty');
            els.validatorComments.textContent = i18next.t('common:none');
            return;
        }
        self.comments.forEach((c, i) => {
            if (i > 0) els.validatorComments.appendChild(document.createElement('hr'));
            const p = document.createElement('p');
            p.style.margin = '0';
            if (admin && typeof c === 'object' && c !== null) {
                const a = document.createElement('a');
                a.href = `/admin/user/${encodeURI(c.username)}`;
                a.textContent = c.username;
                p.appendChild(a);
                p.appendChild(document.createTextNode(`: ${c.comment}`));
            } else {
                // Non-admin: bare comment string. textContent escapes — no HTML injection.
                p.textContent = typeof c === 'object' ? c.comment : c;
            }
            els.validatorComments.appendChild(p);
        });
    }

    /**
     * POSTs a comment for the current label to /labelmap/comment. On success, clears the input, briefly shows the
     * confirmation message, and updates the visible comments list — replacing the user's previous entry if one exists.
     * @param {string} comment Trimmed, non-empty comment text.
     * @private
     */
    function _submitComment(comment) {
        const userPov = self.panoManager.getPov();
        const pos = self.panoManager.panoViewer.getPosition();

        els.commentButton.disabled = true;

        const data = {
            label_id: self.panoManager.label.labelId,
            label_type: self.panoManager.label.label_type,
            comment,
            pano_id: self.panoManager.panoViewer.getPanoId(),
            heading: userPov.heading,
            pitch: userPov.pitch,
            zoom: userPov.zoom,
            lat: pos.lat,
            lng: pos.lng
        };

        fetch('/labelmap/comment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(data)
        }).then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            els.commentInput.value = '';
            els.commentButton.classList.remove('is-active');
            els.commentConfirm.hidden = false;
            setTimeout(() => { els.commentConfirm.hidden = true; }, 1500);

            // Update the visible list. Admin views render objects with a username; non-admin views render bare comment
            // strings. Replace the user's existing comment (if any) rather than appending — the backend deletes prior
            // comments from the same user before inserting, so the visible list should match.
            if (!self.comments) self.comments = [];
            const newEntry = admin ? { username: body.username, comment } : comment;
            if (self.myCommentIdx >= 0 && self.myCommentIdx < self.comments.length) {
                self.comments[self.myCommentIdx] = newEntry;
            } else {
                self.comments.push(newEntry);
                self.myCommentIdx = self.comments.length - 1;
            }
            _renderComments();
        }).catch((err) => {
            console.error(err);
        }).finally(() => {
            els.commentButton.disabled = false;
        });
    }

    // ───────────────────────────────────────────────────────────────────
    // Admin flag controls
    // ───────────────────────────────────────────────────────────────────

    /**
     * Sets or clears one of the admin task flags (low_quality / incomplete / stale) on the current label's
     * audit task via /adminapi/setTaskFlag, then re-renders the flag buttons to reflect the new state.
     * @param {'low_quality'|'incomplete'|'stale'} flag
     * @param {boolean} state
     * @private
     */
    function _setFlag(flag, state) {
        fetch('/adminapi/setTaskFlag', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ auditTaskId: self.taskId, flag, state })
        }).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            self.flags[flag] = state;
            _renderFlagButtons();
        }).catch((err) => console.error(err));
    }

    function _renderFlagButtons() {
        for (const flag of FLAG_NAMES) {
            els.flagButtons[flag].classList.toggle('is-active', !!self.flags[flag]);
        }
    }

    await _init();

    self.showLabel = showLabel;
    return self;
}
