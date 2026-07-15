/**
 * LabelDetail — host-agnostic controller for the label detail view.
 *
 * Two hosts use this:
 *   - LabelPopup wrapper (label-popup.js): mounts inside a <dialog id="label-modal" class="label-detail">.
 *   - Gallery's expanded view: mounts inline inside a <div class="label-detail label-detail--inline">.
 *
 * The controller scopes all DOM queries to `root` and never touches the document outside of it. Multiple instances on
 * different pages cannot collide. The host is responsible for ensuring that `root` is laid out (visible in the DOM with
 * non-zero dimensions) before create() is called, because the pano viewer needs to measure its container at init.
 */
class LabelDetail {
  panoManager; // Public: hosts (ExpandedView, LabelPopup callsites) reach in for the pano manager.

  #root;
  #admin;
  #viewerType;
  #viewerAccessToken;
  #currUsername;
  #onVote;
  #panoOverlaySource;
  #voteColumnSource;

  // Updated in each showLabel() call so PanoInfoPopover's accessor closures see the current label.
  #currentLabelMeta = null;

  #FLAG_NAMES = ['low_quality', 'incomplete', 'stale'];

  // Field references — populated in #cacheElements().
  #els = {};

  #source = undefined; // Set in showLabel().
  #readonly = false;   // Set per-label in #handleData() based on meta.from_current_user.
  #noImagery = false;  // Set per-label once setPano() resolves; true when no navigable imagery could be loaded.
  #validationCounts = { Agree: null, Disagree: null, Unsure: null };
  #flags = { low_quality: null, incomplete: null, stale: null };
  #prevAction = null;
  #taskId = null;
  #iconBase = '';
  #aiValidation;
  #comments;
  #myCommentIdx;
  #shareWidget;

  /**
   * @param {HTMLElement} root - The host element containing the labelDetail markup (see labelDetail.scala.html).
   * @param {Object} opts
   * @param {boolean} opts.admin - If true, this is an admin UI, so additional info can be shown.
   * @param {typeof PanoViewer} opts.viewerType - The type of pano viewer to initialize.
   * @param {string} opts.viewerAccessToken - An access token for requesting pano viewer images.
   * @param {string} [opts.currUsername] - Username of the current viewer; identifies comments from this user.
   * @param {(action: 'Agree'|'Disagree'|'Unsure', meta: Object) => void} [opts.onVote] - Fired after a vote is
   *      successfully submitted. Hosts use this to sync upstream UI (e.g. recolor a Gallery card).
   * @param {string} [opts.panoOverlaySource] - Source recorded when voting via the pano overlay buttons.
   * @param {string} [opts.voteColumnSource] - Source recorded when voting via the column vote buttons.
   */
  constructor(root, opts) {
    this.#root = root;
    this.#admin = opts.admin;
    this.#viewerType = opts.viewerType;
    this.#viewerAccessToken = opts.viewerAccessToken;
    this.#currUsername = opts.currUsername;
    this.#onVote = opts.onVote;
    this.#panoOverlaySource = opts.panoOverlaySource;
    this.#voteColumnSource = opts.voteColumnSource;
  }

  /**
   * Builds a LabelDetail and initializes its pano viewer.
   *
   * Async because the pano viewer must be created before the controller is usable; a constructor cannot be async.
   *
   * @param {HTMLElement} root
   * @param {Object} opts - See the constructor.
   * @returns {Promise<LabelDetail>} Resolves once the pano viewer has been initialized.
   */
  static async create(root, opts) {
    const detail = new LabelDetail(root, opts);
    await detail.#init();
    return detail;
  }

  /**
   * Scoped querySelector: finds a single element within the host root.
   * @param {string} sel
   * @returns {?Element}
   */
  #q(sel) {
    return this.#root.querySelector(sel);
  }

  // ───────────────────────────────────────────────────────────────────
  // Init
  // ───────────────────────────────────────────────────────────────────

  /**
   * One-time setup: caches element references, wires event handlers, and initializes the pano viewer.
   */
  async #init() {
    this.#cacheElements();
    this.#wireHandlers();

    // Pano viewer needs a visible host element on init. The wrapping host (LabelPopup or Gallery) is responsible
    // for ensuring this is the case before constructing LabelDetail.
    this.panoManager = await PopupPanoManager.create(
      this.#els.svHolder,
      this.#els.panoOverlay,
      this.#admin,
      this.#viewerType,
      this.#viewerAccessToken,
    );

    this.#initInfoPopover();
    this.#initShareWidget();

    // Seed the all-time counts so a validation here can celebrate a newly unlocked validation badge.
    BadgeAchievements.seedCounts();
  }

  /**
   * Instantiates the ShareWidget on the footer share button. The widget is built once and re-pointed at the current
   * label in each #handleData() call via this.#shareWidget.setTarget().
   */
  #initShareWidget() {
    const trigger = this.#q('.label-detail__share-trigger');
    if (trigger && typeof ShareWidget !== 'undefined') {
      this.#shareWidget = new ShareWidget(trigger);
    }
  }

  /**
   * Mounts a PanoInfoPopover into the .label-detail__info-button-host span. Accessor closures read from
   * #currentLabelMeta, which is updated on every showLabel() call.
   */
  #initInfoPopover() {
    const host = this.#q('.label-detail__info-button-host');
    if (!host) return;

    const noopLog = () => {};
    const panoViewer = this.panoManager.panoViewer;
    new PanoInfoPopover(
      host,
      this.panoManager.panoViewer,
      () =>
        this.#currentLabelMeta && { lat: this.#currentLabelMeta.camera_lat, lng: this.#currentLabelMeta.camera_lng },
      () => this.#currentLabelMeta && this.#currentLabelMeta.pano_id,
      () => this.#currentLabelMeta && this.#currentLabelMeta.street_edge_id,
      () => this.#currentLabelMeta && this.#currentLabelMeta.region_id,
      () => this.#currentLabelMeta && moment(new Date(this.#currentLabelMeta.image_capture_date)),
      () => (panoViewer.currPanoData ? panoViewer.currPanoData.getProperty('address') : null),
      () => this.#currentLabelMeta && {
        heading: this.#currentLabelMeta.heading, pitch: this.#currentLabelMeta.pitch, zoom: this.#currentLabelMeta.zoom,
      },
      false,    // whiteIcon
      noopLog,  // infoLogging
      noopLog,  // clipboardLogging
      noopLog,  // viewPanoLogging
      () => this.#currentLabelMeta && this.#currentLabelMeta.label_id,
    );

    // The popover's own trigger is the (i) icon it appends into the host span; forward clicks on the rest of the
    // Details chip to it so the whole pill is one hit target. stopPropagation keeps the popover's outside-click
    // light-dismiss from seeing the original event and instantly re-closing the popover it just opened.
    const chip = this.#q('.label-detail__meta-cell--details');
    const infoImg = host.querySelector('img');
    if (chip && infoImg) {
      infoImg.alt = ''; // The chip's visible "Details" text labels the control; a non-empty alt would be read twice.
      chip.addEventListener('click', (e) => {
        if (e.target !== infoImg) {
          e.stopPropagation();
          infoImg.click();
        }
      });
    }
  }

  /**
   * Caches element references inside the host root. We use these to update content when showing labels.
   */
  #cacheElements() {
    const els = this.#els;
    els.svHolder = this.#q('.label-detail__pano');
    els.panoWrap = this.#q('.label-detail__pano-wrap');
    els.panoOverlay = this.#q('.label-detail__pano-overlay');
    els.title = this.#q('.label-detail__title');
    els.timestamp = this.#q('.label-detail__timestamp');
    els.imageDate = this.#q('.label-detail__image-capture-date');
    els.addressCell = this.#q('.label-detail__meta-cell--address');
    els.address = this.#q('.label-detail__address');
    els.severitySection = this.#q('.label-detail__col--severity');
    els.severity = this.#q('.label-detail__severity-faces');
    els.severityTitle = this.#q('.label-detail__severity-title');
    els.tags = this.#q('.label-detail__tags');
    els.description = this.#q('.label-detail__description');
    els.validatorComments = this.#q('.label-detail__validator-comments');
    els.commentsCount = this.#q('.label-detail__comments-count');
    els.commentRow = this.#q('.label-detail__comment-row');
    els.commentLabel = this.#q('.label-detail__comment-row label');
    els.commentInput = this.#q('.label-detail__comment-input');
    els.commentButton = this.#q('.label-detail__comment-submit');
    els.commentConfirm = this.#q('.label-detail__comment-confirmation');

    // Validation count display: <img> elements whose `src` is swapped between the four icon variants
    // (outline / filled / outline-ai / filled-ai). The base URL for the icon files is read from a data
    // attribute on the container so JS doesn't need to know the assets' path.
    const voteDisplay = this.#root.querySelector('.label-detail__vote-display');
    this.#iconBase = voteDisplay ? voteDisplay.dataset.iconBase : '';
    const voteEl = (variant, child) => this.#root.querySelector(`.label-detail__vote--${variant} ${child}`);
    els.voteIcons = {
      Agree:    voteEl('agree', '.label-detail__vote-icon'),
      Disagree: voteEl('disagree', '.label-detail__vote-icon'),
      Unsure:   voteEl('unsure', '.label-detail__vote-icon'),
    };
    els.voteButtons = {
      Agree:    this.#root.querySelector('.label-detail__vote--agree'),
      Disagree: this.#root.querySelector('.label-detail__vote--disagree'),
      Unsure:   this.#root.querySelector('.label-detail__vote--unsure'),
    };
    els.voteCounts = {
      Agree:    voteEl('agree', '.label-detail__vote-count'),
      Disagree: voteEl('disagree', '.label-detail__vote-count'),
      Unsure:   voteEl('unsure', '.label-detail__vote-count'),
    };
    // Hover-reveal overlay buttons on the pano. Both these and the column buttons fire a vote.
    els.panoOverlayButtons = {
      Agree:    this.#root.querySelector('.label-detail__pano-overlay-button--agree'),
      Disagree: this.#root.querySelector('.label-detail__pano-overlay-button--disagree'),
      Unsure:   this.#root.querySelector('.label-detail__pano-overlay-button--unsure'),
    };

    if (this.#admin) {
      els.adminUsername = this.#q('.label-detail__admin-username');
      els.adminTask = this.#q('.label-detail__admin-task');
      els.adminPrevVals = this.#q('.label-detail__admin-prev-validations');
      els.flagButtons = {
        low_quality: this.#q('.label-detail__flag-button[data-flag="low_quality"]'),
        incomplete:  this.#q('.label-detail__flag-button[data-flag="incomplete"]'),
        stale:       this.#q('.label-detail__flag-button[data-flag="stale"]'),
      };
    }
  }

  /**
   * Adds event listeners to buttons inside the host root. The host wrapper is responsible for the close button (popup
   * closes the dialog; gallery hides the inline panel) and for prev/next paging (gallery only). LabelDetail just emits
   * the close event via the data-action attribute.
   */
  #wireHandlers() {
    const els = this.#els;
    // buttonSource overrides #source for this specific button group; falls back to #source if null.
    const voteHandler = (action, buttonSource) => () => {
      if (this.#locked) return;
      if (this.#prevAction !== action) {
        this.#setVoteButtonsDisabled(true);
        this.#validateLabel(action, buttonSource || this.#source);
      }
    };
    for (const action of Object.keys(els.panoOverlayButtons)) {
      els.panoOverlayButtons[action].addEventListener('click', voteHandler(action, this.#panoOverlaySource));
      els.voteButtons[action].addEventListener('click', voteHandler(action, this.#voteColumnSource));

      // Hover preview: show the filled icon variant while the pointer is over the vote button.
      const btn = els.voteButtons[action];
      const img = els.voteIcons[action];
      btn.addEventListener('mouseenter', () => {
        if (this.#locked) return;
        const ai = this.#aiValidation === action ? '-ai' : '';
        img.src = `${this.#iconBase}${action.toLowerCase()}-filled${ai}.svg`;
      });
      btn.addEventListener('mouseleave', () => {
        if (this.#locked) return;
        this.#renderVoteIcons();
      });
    }

    els.commentInput.addEventListener('input', () => {
      els.commentButton.classList.toggle('is-active', els.commentInput.value.trim().length > 0);
    });
    els.commentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.#locked) return;
        const comment = els.commentInput.value.trim();
        if (comment) this.#submitComment(comment);
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
      if (this.#locked) return;
      const comment = els.commentInput.value.trim();
      if (comment) this.#submitComment(comment);
    });

    if (this.#admin) {
      for (const flag of this.#FLAG_NAMES) {
        els.flagButtons[flag].addEventListener('click', () => this.#setFlag(flag, !this.#flags[flag]));
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
   * An arrow instance field (not a prototype method) because LabelPopup detaches and re-invokes it.
   *
   * @param {number|Object} idOrMeta - Either a label id (number) to fetch, or a pre-built meta object.
   * @param {string} source - The UI that created the popup (recorded with validations).
   */
  showLabel = async (idOrMeta, source) => {
    this.#source = source;
    this.#resetVoteButtonStyles();
    this.panoManager.clearLabels();

    if (typeof idOrMeta === 'object' && idOrMeta !== null) {
      this.#handleData(idOrMeta);
      return;
    }

    const labelId = idOrMeta;
    const url = this.#admin ? `/adminapi/label/id/${labelId}` : `/label/id/${labelId}`;
    const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) {
      alert('Server error. Most likely a label with this ID did not exist.');
      throw new Error(`HTTP error ${response.status}`);
    }
    this.#handleData(await response.json());
  };

  /**
   * Populates the view with the label metadata fetched (or passed in directly) by showLabel().
   * @param {Object} meta - The label metadata payload.
   */
  #handleData(meta) {
    const els = this.#els;
    this.#currentLabelMeta = meta;

    // Read-only mode for the user's own labels — no validating/commenting. Imagery availability is unknown until
    // setPano() resolves below, so assume it's present for now and re-apply the lock once we know.
    this.#readonly = !!meta.from_current_user;
    this.#noImagery = false;
    this.#applyInteractionLock();

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
      aiGenerated: meta.ai_generated,
    };
    this.panoManager.setLabel(popupLabel);
    // Accept a pre-constructed backup_image object (Gallery path) or build from server fields (API path).
    const backupImage = meta.backup_image || buildBackupImageData(meta);
    // setPano() resolves to whether a viewable image of the label was shown — live/Pannellum imagery or the static
    // crop. It's only false for the "imagery not available" panel, i.e. nothing to look at. Lock validating/
    // commenting only in that case: if the user can see the label in an image (crop included), they can validate it.
    this.panoManager.setPano(meta.pano_id, labelPov, meta.crop_url, meta.expired, backupImage)
      .then((imageShown) => {
        // Guard against a newer label having been opened while this resolved.
        if (this.#currentLabelMeta !== meta) return;
        this.#noImagery = !imageShown;
        this.#applyInteractionLock();

        // The live imagery's metadata may carry an address the label payload didn't. Only read it when the shown
        // pano is actually this label's on the primary viewer — on the static-crop fallback, currPanoData still
        // describes whatever pano the viewer showed last.
        const panoData = this.panoManager.panoViewer.currPanoData;
        const livePano = imageShown && this.panoManager.activeViewerName === 'Default'
          && panoData && panoData.getPanoId() === meta.pano_id;
        const address = (livePano && panoData.getProperty('address')) || this.#els.address.textContent;
        // Link the address to the provider's public viewer only when live imagery actually loaded — for an
        // expired pano the provider link would land on a "no imagery here" page.
        if (address) this.#showAddress(address, livePano ? this.#panoUrl(meta) : null);
      });

    // Validation counts + AI validation.
    this.#validationCounts.Agree = meta.num_agree;
    this.#validationCounts.Disagree = meta.num_disagree;
    this.#validationCounts.Unsure = meta.num_unsure;
    this.#prevAction = meta.user_validation;
    this.#aiValidation = meta.ai_validation;
    this.#renderVoteCounts();
    this.#renderVoteIcons();

    // Admin flags.
    if (this.#admin) {
      this.#flags.low_quality = meta.low_quality;
      this.#flags.incomplete = meta.incomplete;
      this.#flags.stale = meta.stale;
      this.#renderFlagButtons();
    }

    // Title is just the label-type name (e.g. "Curb Ramp") — the popup is self-evidently about a label.
    const labelTypeName = i18next.t(`common:${camelToKebab(meta.label_type)}`);
    els.title.textContent = labelTypeName;

    // Point the share widget at this label's public permalink (#456). The /label/:id route renders the label
    // spotlight page and serves the og:image crawlers embed in the share card.
    if (this.#shareWidget) {
      this.#shareWidget.setTarget({
        url: `${window.location.origin}/label/${meta.label_id}`,
        title: i18next.t('common:share.button'),
        text: i18next.t('common:share.text', { labelType: labelTypeName }),
      });
    }

    // Severity faces.
    this.#renderSeverity(meta.severity, meta.label_type);

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
    if (meta.description !== null && meta.description !== undefined) {
      els.description.classList.remove('label-detail__empty');
      els.description.textContent = meta.description;
    } else {
      els.description.classList.add('label-detail__empty');
      els.description.textContent = i18next.t('common:no-description');
    }

    // Dates. Short month names ('ll' / 'MMM', locale-aware) keep the meta chips on one line (#4572).
    els.timestamp.textContent = moment(new Date(meta.timestamp)).format('ll, LT');
    els.imageDate.textContent = moment(new Date(meta.image_capture_date)).format('MMM YYYY');

    // Address (#4489): seed from the stored pano address; the setPano() callback above upgrades to the live
    // imagery's value once it loads, which covers panos whose address hasn't been captured server-side yet.
    this.#showAddress(meta.pano_data?.address ?? meta.backup_image?.address ?? null);

    // Validator comments. Admin endpoint returns objects {username, comment}; non-admin returns bare
    // strings. Stash them so #submitComment() can append after a successful POST.
    this.#comments = meta.comments || [];
    // Index of the current user's comment in #comments, if any. The backend replaces comments rather than adding
    // new ones, so we mirror that here. Admin payloads carry usernames; non-admin ones carry a `mine` flag instead
    // (no identifiers on public surfaces).
    this.#myCommentIdx = -1;
    if (this.#admin && this.#currUsername) {
      this.#myCommentIdx = this.#comments.findIndex((c) => c && c.username === this.#currUsername);
    } else if (!this.#admin) {
      this.#myCommentIdx = this.#comments.findIndex((c) => c && typeof c === 'object' && c.mine);
    }
    this.#renderComments();

    // Fill in some admin-only fields at the bottom if applicable.
    if (this.#admin) {
      this.#taskId = meta.audit_task_id;

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
            document.createTextNode(`: ${i18next.t(`common:${camelToKebab(pv.validation)}`)}`),
          );
        });
      }
    }

    // If the user has already validated this label, mark the chosen vote on the pano overlay.
    if (meta.user_validation && !this.#readonly) this.#highlightVote(meta.user_validation);
    else this.#highlightVote(null);
    this.#updateCommentRow();
  }

  /**
   * Shows the comment box only alongside a Disagree/Unsure vote, prompting for the reasoning behind it (#4572).
   * Validator comments exist to justify a disputed label; open-ended notes about a place belong to
   * lived-experience stories (#4054), not here.
   * @param {boolean} [focusOnReveal=false] - Focus the input when this call reveals the row (fresh-vote flow).
   */
  #updateCommentRow(focusOnReveal = false) {
    const els = this.#els;
    if (!els.commentRow) return;
    const action = this.#prevAction;
    const show = !this.#locked && (action === 'Disagree' || action === 'Unsure');
    const wasHidden = els.commentRow.hidden;
    els.commentRow.hidden = !show;
    if (show) {
      const prompt = i18next.t(action === 'Disagree' ? 'labelmap:why-disagree' : 'labelmap:why-unsure');
      els.commentInput.placeholder = prompt;
      if (els.commentLabel) els.commentLabel.textContent = prompt;
      if (wasHidden && focusOnReveal) els.commentInput.focus();
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Validation submission
  // ───────────────────────────────────────────────────────────────────

  /**
   * POSTs JSON to a session-requiring endpoint, minting the shared anonymous session first if it's missing.
   *
   * The public spotlight page (#456) is reachable with no session at all, and SecuredAction answers a session-less
   * POST by bouncing it through /anonSignUp — which mints the session but swallows the submission. So on a failed
   * first attempt, mint the session explicitly (idempotent: signUpAnon just redirects when a session exists) and
   * retry once. redirect: 'manual' keeps the mint cheap — the Set-Cookie on the redirect response is stored without
   * fetching the page it points at. On every other surface a session always exists, so the retry never fires.
   *
   * @param {string} url - The endpoint to POST to.
   * @param {object} data - The JSON-serializable request body.
   * @returns {Promise<Response>} The first OK response, or the retry's response (which may itself not be OK).
   */
  async #postJson(url, data) {
    const post = () => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(data),
    });
    let res = await post();
    if (!res.ok) {
      await fetch('/anonSignUp?url=%2F', { redirect: 'manual' });
      res = await post();
    }
    return res;
  }

  /**
   * POSTs a validation for the current label to /labelmap/validate, then updates the count and validation display.
   * Fires opts.onVote after a successful submission so hosts can sync upstream UI.
   * @param {'Agree'|'Disagree'|'Unsure'} action
   * @param {string} source - The UI source string to record with this validation.
   */
  #validateLabel(action, source) {
    const isNewValidation = !this.#prevAction;
    const validationTimestamp = new Date();
    const canvasWidth = this.panoManager.svHolder.width();
    const canvasHeight = this.panoManager.svHolder.height();
    const panoMarkerPov = this.panoManager.getOriginalPosition();
    const userPov = this.panoManager.getPov();

    const labelRadius = 10;
    const pixelCoordinates
            = util.pano.centeredPovToCanvasCoord(panoMarkerPov, userPov, canvasWidth, canvasHeight, labelRadius);

    const data = {
      label_id: this.panoManager.label.labelId,
      label_type: this.panoManager.label.label_type,
      validation_result: action,
      old_severity: this.panoManager.label.oldSeverity,
      new_severity: this.panoManager.label.newSeverity,
      old_tags: this.panoManager.label.oldTags,
      new_tags: this.panoManager.label.newTags,
      canvas_x: pixelCoordinates ? Math.round(pixelCoordinates.x) : null,
      canvas_y: pixelCoordinates ? Math.round(pixelCoordinates.y) : null,
      heading: userPov.heading,
      pitch: userPov.pitch,
      zoom: userPov.zoom,
      canvas_height: canvasHeight,
      canvas_width: canvasWidth,
      start_timestamp: validationTimestamp,
      end_timestamp: validationTimestamp,
      source,
      undone: false,
      redone: action !== this.#prevAction,
      viewer_type: this.panoManager.activeViewerName,
    };

    this.#postJson('/labelmap/validate', data).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.#updateVoteCount(action);
      this.#highlightVote(action);
      this.#updateCommentRow(true);
      this.#setVoteButtonsDisabled(false);
      if (isNewValidation) BadgeAchievements.recordValidation(this.panoManager.svHolder[0]);
      if (typeof this.#onVote === 'function') this.#onVote(action, this.#currentLabelMeta);
    }).catch((err) => {
      console.error(err);
      this.#setVoteButtonsDisabled(false);
    });
  }

  /**
   * @param {boolean} disabled
   */
  #setVoteButtonsDisabled(disabled) {
    for (const btn of Object.values(this.#els.panoOverlayButtons)) {
      btn.disabled = disabled;
    }
    for (const btn of Object.values(this.#els.voteButtons)) {
      btn.disabled = disabled;
    }
  }

  #renderVoteCounts() {
    for (const action of Object.keys(this.#els.voteCounts)) {
      this.#els.voteCounts[action].textContent = this.#validationCounts[action] ?? 0;
    }
  }

  /**
   * Adjusts the in-memory validation counts after a successful vote.
   * @param {'Agree'|'Disagree'|'Unsure'} action
   */
  #updateVoteCount(action) {
    if (this.#prevAction) {
      this.#validationCounts[this.#prevAction] = Math.max(0, this.#validationCounts[this.#prevAction] - 1);
    }
    this.#prevAction = action;
    this.#validationCounts[action] += 1;
    this.#renderVoteCounts();
  }

  /**
   * Reflects the current vote on the pano overlay (selected button + border color around the pano).
   * @param {?string} action
   */
  #highlightVote(action) {
    for (const [key, btn] of Object.entries(this.#els.panoOverlayButtons)) {
      btn.classList.toggle('is-selected', key === action);
    }
    // Border on the pano wrap reflects the current validation.
    if (this.#els.panoWrap) {
      this.#els.panoWrap.classList.remove('is-agree', 'is-disagree', 'is-unsure');
      if (action) this.#els.panoWrap.classList.add(`is-${action.toLowerCase()}`);
    }
    this.#renderVoteIcons();
  }

  #resetVoteButtonStyles() {
    for (const btn of Object.values(this.#els.panoOverlayButtons)) {
      btn.classList.remove('is-selected');
      if (!this.#locked) btn.disabled = false;
    }
    if (this.#els.panoWrap) {
      this.#els.panoWrap.classList.remove('is-agree', 'is-disagree', 'is-unsure');
    }
  }

  /**
   * Whether validating/commenting is blocked for the current label — the viewer's own label or no available imagery.
   * navigable imagery is available for it.
   * @returns {boolean}
   */
  get #locked() {
    return this.#readonly || this.#noImagery;
  }

  /**
   * Toggles the disabled state + tooltip on interactive elements based on the current lock reasons. The viewer's
   * own label and no-imagery both disable validating/commenting; own-label wins the tooltip since it's the more
   * specific reason to surface.
   */
  #applyInteractionLock() {
    const els = this.#els;
    const locked = this.#locked;
    this.#root.classList.toggle('label-detail--readonly', locked);
    const tip = this.#readonly
      ? i18next.t('labelmap:own-label-disabled')
      : this.#noImagery ? i18next.t('labelmap:no-imagery-disabled') : '';

    // Pano overlay buttons.
    for (const btn of Object.values(els.panoOverlayButtons)) {
      btn.disabled = locked;
      btn.title = tip;
    }

    // Validation column buttons.
    for (const btn of Object.values(els.voteButtons)) {
      btn.disabled = locked;
      btn.title = tip;
    }

    // Comment input and submit button.
    els.commentInput.disabled = locked;
    els.commentInput.title = tip;
    els.commentButton.disabled = locked;
    els.commentButton.title = tip;
    this.#updateCommentRow(); // Locking also hides the comment box (it only shows with a Disagree/Unsure vote).
  }

  /**
   * Updates the three column icons to the right variant based on the user's current vote and the AI validation:
   *   - filled when the user voted this option, otherwise outline
   *   - `-ai` suffix when the AI validated this option
   */
  #renderVoteIcons() {
    for (const [action, img] of Object.entries(this.#els.voteIcons)) {
      const state = this.#prevAction === action ? 'filled' : 'outline';
      const ai = this.#aiValidation === action ? '-ai' : '';
      img.src = `${this.#iconBase}${action.toLowerCase()}-${state}${ai}.svg`;
      if (this.#aiValidation === action) {
        img.title = i18next.t('labelmap:ai-val-included', { aiVal: action.toLowerCase() });
      } else {
        img.removeAttribute('title');
      }
    }
  }

  /**
   * Shows or hides the address meta cell. The whole cell is hidden when no address is known so the meta row
   * doesn't render a dangling "Address:" label (non-GSV imagery and never-captured panos have none).
   * @param {?string} address - The street-level address to display, or null/empty to hide the cell.
   * @param {?string} [url] - External imagery-provider URL to link the address to; plain text when null.
   */
  #showAddress(address, url = null) {
    const els = this.#els;
    if (!els.addressCell) return;
    els.address.textContent = address || '';
    els.address.title = address || ''; // Native tooltip reveals the full address when the strip ellipsizes it.
    els.addressCell.hidden = !address;
    if (address && url) {
      els.address.href = url;
      els.address.target = '_blank';
      els.address.rel = 'noopener noreferrer';
    } else {
      els.address.removeAttribute('href');
      els.address.removeAttribute('target');
      els.address.removeAttribute('rel');
    }
  }

  /**
   * External URL for viewing the label's pano on its imagery provider's own site. Mirrors the URL shapes
   * PanoInfoPopover builds for its view-in-pano link.
   * @param {Object} meta - The label metadata payload (pano id + the label's POV).
   * @returns {?string} The provider URL, or null for providers without a public viewer (e.g. Infra3d).
   */
  #panoUrl(meta) {
    const viewerType = this.panoManager.panoViewer.getViewerType();
    if (viewerType === 'gsv') {
      return `https://www.google.com/maps/@?api=1&map_action=pano&pano=${meta.pano_id}`
        + `&heading=${meta.heading}&pitch=${meta.pitch}`;
    } else if (viewerType === 'mapillary') {
      return `https://www.mapillary.com/app/?pKey=${meta.pano_id}&focus=photo`;
    }
    return null;
  }

  /**
   * Highlights one of the three severity faces based on the label's numeric severity.
   * @param {number} [severity] - The label's 1–3 severity, or null for unrated.
   * @param {string} labelType - The label type (drives positive/negative icon set).
   */
  #renderSeverity(severity, labelType) {
    const els = this.#els;
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
  #renderComments() {
    const els = this.#els;
    const count = this.#comments ? this.#comments.length : 0;

    // Count badge next to the section eyebrow — signals comments exist before the reader reaches the list.
    if (els.commentsCount) {
      els.commentsCount.textContent = String(count);
      els.commentsCount.hidden = count === 0;
    }

    els.validatorComments.replaceChildren();
    els.validatorComments.classList.remove('label-detail__empty');
    if (count === 0) {
      els.validatorComments.classList.add('label-detail__empty');
      els.validatorComments.textContent = i18next.t('common:none');
      return;
    }
    // Newest first, so a just-submitted comment lands right beneath the input above the list.
    [...this.#comments].reverse().forEach((c, i) => {
      if (i > 0) els.validatorComments.appendChild(document.createElement('hr'));
      const p = document.createElement('p');
      p.style.margin = '0';

      // Relative-time pill; the exact date lives in the tooltip.
      const timeCreated = typeof c === 'object' && c !== null ? c.time_created : null;
      const whenPill = () => {
        const when = document.createElement('span');
        when.className = 'label-detail__comment-when';
        when.textContent = moment(timeCreated).fromNow();
        when.title = moment(timeCreated).format('ll, LT');
        return when;
      };

      if (this.#admin && typeof c === 'object' && c !== null) {
        const a = document.createElement('a');
        a.href = `/admin/user/${encodeURI(c.username)}`;
        a.textContent = c.username;
        p.appendChild(a);
        if (timeCreated) {
          p.appendChild(document.createTextNode(' '));
          p.appendChild(whenPill());
        }
        p.appendChild(document.createTextNode(`: ${c.comment}`));
      } else {
        // Non-admin: {comment, mine} objects. A small "You" chip marks the signed-in user's own comment; the
        // admin branch above doesn't need one since it shows usernames. textContent/createTextNode escape — no
        // HTML injection.
        if (typeof c === 'object' && c !== null && c.mine) {
          const you = document.createElement('span');
          you.className = 'label-detail__comment-you';
          you.textContent = i18next.t('labelmap:you');
          p.appendChild(you);
        }
        if (timeCreated) p.appendChild(whenPill());
        p.appendChild(document.createTextNode(typeof c === 'object' && c !== null ? c.comment : c));
      }
      els.validatorComments.appendChild(p);
    });
  }

  /**
   * POSTs a comment for the current label to /labelmap/comment. On success, clears the input, briefly shows the
   * confirmation message, and updates the visible comments list — replacing the user's previous entry if one exists.
   * @param {string} comment - Trimmed, non-empty comment text.
   */
  #submitComment(comment) {
    const els = this.#els;
    const userPov = this.panoManager.getPov();
    const pos = this.panoManager.panoViewer.getPosition();

    els.commentButton.disabled = true;

    const data = {
      label_id: this.panoManager.label.labelId,
      label_type: this.panoManager.label.label_type,
      comment,
      pano_id: this.panoManager.panoViewer.getPanoId(),
      heading: userPov.heading,
      pitch: userPov.pitch,
      zoom: userPov.zoom,
      lat: pos.lat,
      lng: pos.lng,
    };

    this.#postJson('/labelmap/comment', data).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      els.commentInput.value = '';
      els.commentButton.classList.remove('is-active');
      els.commentConfirm.hidden = false;
      setTimeout(() => {
        els.commentConfirm.hidden = true;
      }, 1500);

      // Update the visible list. Admin views render objects with a username; non-admin views render bare comment
      // strings. Replace the user's existing comment (if any) rather than appending — the backend deletes prior
      // comments from the same user before inserting, so the visible list should match.
      if (!this.#comments) this.#comments = [];
      const timeCreated = new Date().toISOString();
      const newEntry = this.#admin
        ? { username: body.username, comment, time_created: timeCreated }
        : { comment, mine: true, time_created: timeCreated };
      if (this.#myCommentIdx >= 0 && this.#myCommentIdx < this.#comments.length) {
        this.#comments[this.#myCommentIdx] = newEntry;
      } else {
        this.#comments.push(newEntry);
        this.#myCommentIdx = this.#comments.length - 1;
      }
      this.#renderComments();
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
   */
  #setFlag(flag, state) {
    fetch('/adminapi/setTaskFlag', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ auditTaskId: this.#taskId, flag, state }),
    }).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.#flags[flag] = state;
      this.#renderFlagButtons();
    }).catch((err) => console.error(err));
  }

  #renderFlagButtons() {
    for (const flag of this.#FLAG_NAMES) {
      this.#els.flagButtons[flag].classList.toggle('is-active', !!this.#flags[flag]);
    }
  }
}
