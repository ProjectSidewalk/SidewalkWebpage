/**
 * Controller for the label popup dialog used on LabelMap, the User Dashboard, and various Admin UIs.
 *
 * Markup lives in `app/views/common/labelPopup.scala.html` (included on each host page); this module only
 * handles wiring: opening/closing the native <dialog>, fetching label metadata, populating fields,
 * and submitting validations / comments / admin flags.
 *
 * @param {boolean} admin If true, this is an admin UI, so additional info can be shown.
 * @param {typeof PanoViewer} viewerType The type of pano viewer to initialize.
 * @param {string} viewerAccessToken An access token used to request images for the pano viewer.
 * @param {string} [cityName] Current city name (used by PanoInfoPopover's clipboard-copy).
 * @param {string} [currUsername] Username of the current viewer. Used (in admin mode) to identify comments from this user
 * @returns {Promise<object>} Resolves once the pano viewer has been initialized.
 */
async function AdminGSVLabelView(admin, viewerType, viewerAccessToken, cityName, currUsername) {
    const self = {};
    self.admin = admin;
    self.source = undefined; // Set in showLabel().
    self.readonly = false;   // Set per-label in _handleData() based on meta.from_current_user.

    // Updated in each showLabel() call so PanoInfoPopover's accessor closures see the current label.
    let currentLabelMeta = null;

    // Result codes accepted by /labelmap/validate.
    const RESULT_OPTIONS = { Agree: 1, Disagree: 2, Unsure: 3 };
    const FLAG_NAMES = ['low_quality', 'incomplete', 'stale'];

    const dialog = document.getElementById('label-modal');
    if (!dialog) {
        throw new Error('AdminGSVLabelView: #label-modal not found. Did you include common.labelPopup() on the page?');
    }

    // Field references — populated in _init().
    const $ = (sel) => dialog.querySelector(sel);
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

        // The pano viewer needs a visible host element on init (Mapillary in particular). Open the dialog inside an
        // "initializing" class that hides both the dialog and its ::backdrop, init the viewer, then close. Future
        // showLabel() calls just toggle the dialog open without re-initializing.
        dialog.classList.add('label-popup--initializing');
        dialog.showModal();
        self.panoManager = await AdminPanorama(
            els.svHolder,
            els.validationSection,
            admin,
            viewerType,
            viewerAccessToken
        );
        dialog.close();
        dialog.classList.remove('label-popup--initializing');

        _initInfoPopover();
    }

    /**
     * Mounts a PanoInfoPopover into #label-popup-info-button-host. Accessor closures read from `currentLabelMeta`,
     * which is updated on every showLabel() call. The popover must be appended to the dialog (not the body) so it
     * renders inside the native <dialog> top layer instead of behind the modal backdrop.
     */
    function _initInfoPopover() {
        const host = $('#label-popup-info-button-host');
        if (!host) return;

        const noopLog = () => {};
        self.infoPopover = new PanoInfoPopover(
            host,
            self.panoManager.panoViewer,
            () => self.panoManager.panoViewer.getPosition(),
            () => currentLabelMeta && currentLabelMeta.pano_id,
            () => currentLabelMeta && currentLabelMeta.street_edge_id,
            () => currentLabelMeta && currentLabelMeta.region_id,
            () => currentLabelMeta && moment(new Date(currentLabelMeta.image_capture_date)),
            () => null, // pano address — not exposed in the label metadata payload
            () => self.panoManager.getPov(),
            cityName || '',
            false,         // whiteIcon
            noopLog,       // infoLogging
            noopLog,       // clipboardLogging
            noopLog,       // viewPanoLogging
            () => currentLabelMeta && currentLabelMeta.label_id,
            () => currentLabelMeta && moment(new Date(currentLabelMeta.timestamp)),
            dialog         // popoverContainer — keep popover in the dialog's top layer
        );
    }

    /**
     * Records jQuery references to elements within the popup. We use those references to update when showing labels.
     * @private
     */
    function _cacheElements() {
        els.svHolder           = $('#sv-holder-label');
        els.validationSection  = $('#validation-input-holder');
        els.title              = $('#label-popup-title');
        els.timestamp          = $('#timestamp');
        els.imageDate          = $('#image-capture-date');
        els.severity           = $('#severity');
        els.tags               = $('#tags');
        els.description        = $('#label-description');
        els.validatorComments  = $('#validator-comments');
        els.commentInput       = $('#comment-textarea');
        els.commentButton      = $('#comment-button');
        els.commentConfirm     = $('#comment-confirmation');

        // Validation count display: <img> elements whose `src` is swapped between the four icon variants (outline /
        // filled / outline-ai / filled-ai). The base URL for the icon files is read from a data attribute on the
        // container so JS doesn't need to know the assets' path.
        const voteDisplay = dialog.querySelector('.label-popup__vote-display');
        self.iconBase = voteDisplay ? voteDisplay.dataset.iconBase : '';
        els.voteIcons = {
            Agree:    $('#validation-agree-icon'),
            Disagree: $('#validation-disagree-icon'),
            Unsure:   $('#validation-unsure-icon')
        };
        els.voteButtons = {
            Agree:    $('#validation-agree-button'),
            Disagree: $('#validation-disagree-button'),
            Unsure:   $('#validation-unsure-button')
        };
        // Hover-reveal overlay buttons on the pano. Both these and the column buttons fire a vote.
        els.panoOverlayButtons = {
            Agree:    $('#pano-overlay-agree-button'),
            Disagree: $('#pano-overlay-disagree-button'),
            Unsure:   $('#pano-overlay-unsure-button')
        };
        els.panoWrap = dialog.querySelector('.label-popup__pano-wrap');
        els.voteCounts = {
            Agree:    $('#validation-agree-count'),
            Disagree: $('#validation-disagree-count'),
            Unsure:   $('#validation-unsure-count')
        };

        if (admin) {
            els.adminUsername     = $('#admin-username');
            els.adminTask         = $('#task');
            els.adminPrevVals     = $('#prev-validations');
            els.flagButtons = {
                low_quality: $('#flag-low-quality-button'),
                incomplete:  $('#flag-incomplete-button'),
                stale:       $('#flag-stale-button')
            };
        }
    }

    /**
     * Adds event listeners to the various buttons on the label popup.
     * @private
     */
    function _wireHandlers() {
        // Close button + ESC + backdrop click.
        dialog.querySelector('[data-action="close-label-popup"]').addEventListener('click', () => dialog.close());
        dialog.addEventListener('click', (e) => {
            // Click outside the dialog box (i.e. on the backdrop) closes it. We compare against the bounding rect
            // rather than e.target===dialog because clicks on the dialog's own padding also have e.target===dialog
            // and shouldn't dismiss.
            if (e.target !== dialog) return;
            const r = dialog.getBoundingClientRect();
            const inside = r.top <= e.clientY && e.clientY <= r.bottom
                && r.left <= e.clientX && e.clientX <= r.right;
            if (!inside) dialog.close();
        });

        const voteHandler = (action) => () => {
            if (self.readonly) return;
            if (self.prevAction !== action) {
                _setVoteButtonsDisabled(true);
                _validateLabel(action);
            }
        };
        for (const action of Object.keys(els.panoOverlayButtons)) {
            els.panoOverlayButtons[action].addEventListener('click', voteHandler(action));
            els.voteButtons[action].addEventListener('click', voteHandler(action));
        }

        els.commentInput.addEventListener('input', () => {
            els.commentButton.classList.toggle('is-active', els.commentInput.value.trim().length > 0);
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
     * Requests data on the label, shows it on the pano, and fills in the popup with the label's metadata.
     * @param {number} labelId  The ID of the label to show.
     * @param {string} source   The UI that created the popup (recorded with validations).
     */
    async function showLabel(labelId, source) {
        self.source = source;
        _resetVoteButtonStyles();
        self.panoManager.clearLabels();

        if (!dialog.open) dialog.showModal();

        const url = admin ? `/adminapi/label/id/${labelId}` : `/label/id/${labelId}`;
        const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        if (!response.ok) {
            alert('Server error. Most likely a label with this ID did not exist.');
            throw new Error(`HTTP error ${response.status}`);
        }
        _handleData(await response.json());
    }

    /**
     * Populates the popup with the label metadata fetched in showLabel()
     * @param {object} meta The label metadata payload from /label/id/:id (or /adminapi/label/id/:id in admin mode).
     * @private
     */
    function _handleData(meta) {
        currentLabelMeta = meta;
        console.log(currentLabelMeta);

        // Read-only mode for the viewer's own labels — no validating, no commenting. The CSS class hides the pano
        // vote overlay + comment row and turns off the count-icon click affordance; `self.readonly` is also checked
        // by the click handlers as a safety net.
        self.readonly = !!meta.from_current_user;
        dialog.classList.toggle('label-popup--readonly', self.readonly);

        const labelPov = { heading: meta.heading, pitch: meta.pitch, zoom: meta.zoom };

        const adminPanoramaLabel = AdminPanoramaLabel(
            meta.label_id, meta.label_type, meta.canvas_x, meta.canvas_y,
            util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT,
            labelPov, meta.street_edge_id, meta.severity, meta.tags, meta.ai_generated
        );
        self.panoManager.setLabel(adminPanoramaLabel);
        self.panoManager.setPano(meta.pano_id, labelPov, meta.crop_url, meta.expired);

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
        _renderSeverity(meta.severity);

        // Tag pills.
        els.tags.replaceChildren();
        els.tags.classList.remove('label-popup__empty');
        if (meta.tags && meta.tags.length) {
            for (const tag of meta.tags) {
                const pill = document.createElement('span');
                pill.className = 'label-popup__tag';
                pill.textContent = i18next.t(`common:tag.${tag.replace(/:/g, '-')}`);
                els.tags.appendChild(pill);
            }
        } else {
            els.tags.classList.add('label-popup__empty');
            els.tags.textContent = i18next.t('common:none');
        }

        // Description.
        if (meta.description != null) {
            els.description.classList.remove('label-popup__empty');
            els.description.textContent = meta.description;
        } else {
            els.description.classList.add('label-popup__empty');
            els.description.textContent = i18next.t('common:no-description');
        }

        // Dates.
        els.timestamp.textContent = moment(new Date(meta.timestamp)).format('LL, LT');
        els.imageDate.textContent = moment(new Date(meta.image_capture_date)).format('MMMM YYYY');

        // Validator comments. Admin endpoint returns objects {username, comment}; non-admin returns bare strings.
        // Stash on `self` so _submitComment() can append after a successful POST.
        self.comments = meta.comments || [];
        // Index of the current user's comment in self.comments, if any. The backend deletes any previous comment from
        // the same (user, label, mission) before inserting a new one, so we mirror that on the frontend by replacing
        // rather than appending. In admin mode we can find an existing comment by username on initial load. In
        // non-admin mode comments are bare strings with no usernames, so we can only track the user's own comment
        // after they submit one in this session.
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
     * POSTs a validation for the current label to /labelmap/validate, then updates the count and validation display.
     * @param {'Agree'|'Disagree'|'Unsure'} action
     * @private
     */
    function _validateLabel(action) {
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
            validation_result: RESULT_OPTIONS[action],
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
            source: self.source,
            undone: false,
            redone: action !== self.prevAction
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
        // Border on the pano wrap reflects the current validation, like Gallery's expanded view.
        if (els.panoWrap) {
            els.panoWrap.classList.remove('is-agree', 'is-disagree', 'is-unsure');
            if (action) els.panoWrap.classList.add(`is-${action.toLowerCase()}`);
        }
        _renderVoteIcons();
    }

    function _resetVoteButtonStyles() {
        for (const btn of Object.values(els.panoOverlayButtons)) {
            btn.classList.remove('is-selected');
            btn.disabled = false;
        }
        if (els.panoWrap) {
            els.panoWrap.classList.remove('is-agree', 'is-disagree', 'is-unsure');
        }
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
     * @param {number} [severity]
     * @private
     */
    function _renderSeverity(severity) {
        const faces = els.severity.querySelectorAll('.label-popup__face');
        const selectedIdx = severity ? severity - 1 : -1;
        faces.forEach((face, i) => face.classList.toggle('is-selected', i === selectedIdx));
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
        els.validatorComments.classList.remove('label-popup__empty');
        if (!self.comments || self.comments.length === 0) {
            els.validatorComments.classList.add('label-popup__empty');
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

            // Update the visible list. Admin views render objects with a username; non-admin views render bare
            // comment strings. Replace the user's existing comment (if any) rather than appending — the backend
            // deletes prior comments from the same user before inserting, so the visible list should match.
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
     * Sets or clears one of the admin task flags (low_quality / incomplete / stale) on the current label's audit
     * task via /adminapi/setTaskFlag, then re-renders the flag buttons to reflect the new state.
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
