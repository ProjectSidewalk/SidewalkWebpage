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
  /**
   * Sets or clears the ?labelId= query param without adding history entries, so the open label is shareable
   * and survives a refresh but Back still leaves the page. The single deep-link contract for every host
   * (LabelPopup, Gallery's ExpandedView, the LabelMap page).
   * @param {?number} labelId The open label's ID, or null to clear the param.
   */
  static syncUrlLabelId(labelId) {
    const url = new URL(window.location);
    if (labelId) url.searchParams.set('labelId', labelId);
    else url.searchParams.delete('labelId');
    util.url.replaceQuery(url);
  }

  /**
   * Reads the ?labelId= deep-link param syncUrlLabelId() writes.
   * @returns {?number} The label ID in the URL, or null when absent/invalid.
   */
  static urlLabelId() {
    return parseInt(new URLSearchParams(window.location.search).get('labelId'), 10) || null;
  }

  /**
   * Resolves the pano, camera position, and point of view to record with a validation or a validator comment.
   *
   * A pano viewer only describes this label while it's actually showing it. On the static-crop fallback it isn't:
   * the primary viewer still reports whatever pano it last loaded, and reports nothing at all when the crop was the
   * first thing opened. That silently stored the previous label's POV with a validation (#4711) and threw outright
   * on the null position when submitting a comment (#4697).
   *
   * The crop is a screenshot of the label's own pano at its stored POV, so the label's metadata describes it
   * exactly — the same answer Gallery's card-hover menu and the landing validation grid already submit for their
   * static images. None of these fields are optional server-side: label_validation.heading/pitch/zoom and
   * validation_task_comment.lat/lng are NOT NULL, and the comment's pano_id is a foreign key into pano_data.
   *
   * @param {?{panoId: ?string, position: ?{lat: number, lng: number},
   *     pov: ?{heading: number, pitch: number, zoom: number}}} viewer - What the viewer showing this label reports,
   *     or null when none is (the static-crop fallback). Its own fields may still be null before imagery resolves.
   * @param {Object} meta - The current label's metadata payload.
   * @returns {{panoId: ?string, lat: ?number, lng: ?number, heading: ?number, pitch: ?number, zoom: ?number}}
   */
  static submissionContext(viewer, meta) {
    const viewerPos = viewer && viewer.position;
    const position = Number.isFinite(viewerPos?.lat) && Number.isFinite(viewerPos?.lng)
      ? viewerPos
      : { lat: meta.camera_lat ?? meta.lat, lng: meta.camera_lng ?? meta.lng };
    const pov = (viewer && viewer.pov) || { heading: meta.heading, pitch: meta.pitch, zoom: meta.zoom };
    return {
      // `||` rather than `??` on purpose: an empty pano ID is as unusable as a missing one — the column is a foreign
      // key into pano_data — so "" has to fall through to the label's own instead of being sent as-is.
      panoId: (viewer && viewer.panoId) || meta.pano_id || null,
      lat: position.lat ?? null,
      lng: position.lng ?? null,
      heading: pov.heading ?? null,
      pitch: pov.pitch ?? null,
      zoom: pov.zoom ?? null,
    };
  }

  panoManager; // Public: hosts (ExpandedView, LabelPopup callsites) reach in for the pano manager.

  #root;
  #admin;
  #viewerType;
  #viewerAccessToken;
  #currUsername;
  #onVote;
  #onEdit;
  #panoOverlaySource;
  #voteColumnSource;
  #showLabelMapLink;
  #showExploreHereLink;

  // Updated in each showLabel() call so PanoInfoPopover's accessor closures see the current label.
  #currentLabelMeta = null;

  #FLAG_NAMES = ['low_quality', 'incomplete', 'stale'];

  // Field references — populated in #cacheElements().
  #els = {};

  #source = undefined;      // Set in showLabel().
  #readonly = false;        // Set per-label in #handleData() based on meta.from_current_user.
  #canEdit = false;         // Set per-label in #handleData() from meta.can_edit (#2575).
  #tagEditor;
  /** @type {number[]} The hold and fade timers for the edit-status line; both are cleared when it is re-shown. */
  #editStatusTimers = [];

  /**
   * How long an edit-status message stays fully visible, in ms, before it starts fading.
   *
   * A confirmation is short: "Saved" is a glance, and the change it describes is already on screen in the
   * highlighted face or the new pill, so the line is reassurance rather than information. A failure is held far
   * longer — it is the only place the rollback is explained, and it asks the reader to try again.
   */
  static #EDIT_STATUS_HOLD_MS = 1000;
  static #EDIT_STATUS_HOLD_ERROR_MS = 5000;

  /**
   * Fade-out duration in ms; must match the transition on .label-detail__edit-status.
   *
   * Also the reason the hold can be as short as it is: the text is not removed until the fade ends, so the node
   * outlives the hold by this much. Screen readers announce on insertion, but taking the content away within a
   * beat of adding it has been observed to lose the announcement, and hold + fade stays clear of that.
   */
  static #EDIT_STATUS_FADE_MS = 400;
  #editQueue = Promise.resolve(); // Saves run in click order, so the last response is the one shown.
  #noImagery = false;  // Set per-label once setPano() resolves; true when no navigable imagery could be loaded.
  #panoLoading = false;     // True from #handleData() until this label's setPano() resolves. See #interactionBlocked.
  #validationCounts = { Agree: null, Disagree: null, Unsure: null };
  #flags = { low_quality: null, incomplete: null, stale: null };
  #prevAction = null;
  #taskId = null;
  #aiValidation;
  #comments;
  #myCommentIdx;
  #commentStatusTimer = null;
  #editingComment = false;
  #escapeCancelledEdit = false;  // Set on an Escape keydown that ended an edit; read by the matching keyup.
  #shareWidget;
  #storySection;
  #highlightStoryId;
  #metaRowObserver;

  /**
   * @param {HTMLElement} root - The host element containing the labelDetail markup (see labelDetail.scala.html).
   * @param {Object} opts
   * @param {boolean} opts.admin - If true, this is an admin UI, so additional info can be shown.
   * @param {typeof PanoViewer} opts.viewerType - The type of pano viewer to initialize.
   * @param {string} opts.viewerAccessToken - An access token for requesting pano viewer images.
   * @param {string} [opts.currUsername] - Username of the current viewer; identifies comments from this user.
   * @param {(action: ?('Agree'|'Disagree'|'Unsure'), meta: Object) => void} [opts.onVote] - Fired after a vote is
   *      successfully submitted, with null when the user cleared their vote (#4653). Hosts use this to sync upstream
   *      UI (e.g. recolor a Gallery card).
   * @param {(meta: Object) => void} [opts.onEdit] - Fired with the updated metadata after an edit to the label's
   *      severity or tags is saved (#2575), so hosts that cache label data (Gallery's cards) can stay in sync.
   * @param {string} [opts.panoOverlaySource] - Source recorded when voting via the pano overlay buttons.
   * @param {string} [opts.voteColumnSource] - Source recorded when voting via the column vote buttons.
   * @param {boolean} [opts.showLabelMapLink] - Show a footer link to this label on /labelMap (for hosts that
   *     aren't the LabelMap itself).
   * @param {boolean} [opts.showExploreHereLink] - Show a footer link that opens Explore at this label's pano and
   *     point of view (#4637).
   * @param {?number} [opts.highlightStoryId] - Story to scroll to and highlight once its label's story list loads,
   *     for story-anchored share links (/label/:id?storyId=, #4722). One-shot; see StorySection.
   */
  constructor(root, opts) {
    this.#root = root;
    this.#admin = opts.admin;
    this.#viewerType = opts.viewerType;
    this.#viewerAccessToken = opts.viewerAccessToken;
    this.#currUsername = opts.currUsername;
    this.#onVote = opts.onVote;
    this.#onEdit = opts.onEdit;
    this.#panoOverlaySource = opts.panoOverlaySource;
    this.#voteColumnSource = opts.voteColumnSource;
    this.#showLabelMapLink = !!opts.showLabelMapLink;
    this.#showExploreHereLink = !!opts.showExploreHereLink;
    this.#highlightStoryId = opts.highlightStoryId || null;
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
    this.#tagEditor = new TagEditor(this.#els.tags);
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
    this.#initHideLabelToggle();
    this.#initShareWidget();
    this.#initStorySection();

    // Static section-header tooltip; per-control tooltips are set as content renders.
    const tagsTitle = this.#q('.label-detail__col--tags .label-detail__col-title');
    if (tagsTitle) tagsTitle.title = i18next.t('labelmap:tags-tooltip');

    // Re-fit the meta strip whenever the card's width changes (mobile, rotation, window resize). Toggling the
    // strip's own child visibility never changes the observed row's width, so this can't feed back on itself.
    if (this.#els.metaRow && typeof ResizeObserver !== 'undefined') {
      this.#metaRowObserver = new ResizeObserver(() => this.#fitMetaRow());
      this.#metaRowObserver.observe(this.#els.metaRow);
    }

    // Seed the all-time counts so a validation here can celebrate a newly unlocked validation badge.
    BadgeAchievements.seedCounts();
  }

  /**
   * Wires the pano's Hide-label toggle (#2477). Built after the pano manager, which is what its changes act on.
   */
  #initHideLabelToggle() {
    const button = this.#els.hideLabelButton;
    if (!button) return;
    new LabelVisibilityToggle({
      buttons: [button],
      text: {
        hide: i18next.t('common:hide-label'),
        show: i18next.t('common:show-label'),
        hideTooltip: i18next.t('common:hide-label-tooltip'),
        showTooltip: i18next.t('common:show-label-tooltip'),
      },
      onChange: (visible, { viaClick }) => {
        this.panoManager.setLabelsHidden(!visible);
        if (viaClick) this.#logClick(visible ? 'ShowLabel' : 'HideLabel');
      },
    });
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
   * Instantiates the StorySection on the stories disclosure (#4054). Built once; re-pointed at the current label in
   * each #handleData() call. Deliberately NOT part of #applyInteractionLock() — sharing a story about your own label
   * is a first-class use case, the inverse of the own-label validation lock.
   */
  #initStorySection() {
    const section = this.#q('.label-detail__stories');
    if (section && typeof StorySection !== 'undefined') {
      this.#storySection = new StorySection(this.#root, {
        currUsername: this.#currUsername,
        highlightStoryId: this.#highlightStoryId,
      });
    }
  }

  /**
   * Mounts a PanoInfoPopover into the .label-detail__info-button-host span. Accessor closures read from
   * #currentLabelMeta, which is updated on every showLabel() call.
   */
  #initInfoPopover() {
    const host = this.#q('.label-detail__info-button-host');
    if (!host) return;

    // Resolve panoManager.panoViewer per use rather than capturing it: it swaps between the primary viewer and
    // Pannellum as labels are opened, and a captured viewer keeps describing the previously shown pano (#4813).
    const panoViewer = () => this.panoManager.panoViewer;
    new PanoInfoPopover(
      host,
      panoViewer,
      () =>
        this.#currentLabelMeta && { lat: this.#currentLabelMeta.camera_lat, lng: this.#currentLabelMeta.camera_lng },
      () => this.#currentLabelMeta && this.#currentLabelMeta.pano_id,
      () => this.#currentLabelMeta && this.#currentLabelMeta.street_edge_id,
      () => this.#currentLabelMeta && this.#currentLabelMeta.region_id,
      () => this.#currentLabelMeta && moment(new Date(this.#currentLabelMeta.image_capture_date)),
      () => (panoViewer().currPanoData ? panoViewer().currPanoData.getProperty('address') : null),
      () => this.#currentLabelMeta && {
        heading: this.#currentLabelMeta.heading, pitch: this.#currentLabelMeta.pitch, zoom: this.#currentLabelMeta.zoom,
      },
      false, // whiteIcon
      () => this.#logClick('PanoInfoButton'),
      () => this.#logClick('PanoInfoCopyToClipboard'),
      () => this.#logClick('PanoInfoViewInPano'),
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
   * Logs a card interaction to the webpage_activity table, tagged with the shown label.
   * @param {string} action - The interaction name, e.g. 'ViewOnLabelMap' (see docs/logged-events.md).
   */
  #logClick(action) {
    const labelId = this.#currentLabelMeta?.label_id;
    window.logWebpageActivity(`Click_module=LabelDetail_action=${action}_labelId=${labelId}`);
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
    els.ownBadge = this.#q('.label-detail__own-badge');
    els.metaRow = this.#q('.label-detail__meta-row');
    els.timestamp = this.#q('.label-detail__timestamp');
    els.imageDate = this.#q('.label-detail__image-capture-date');
    els.addressCell = this.#q('.label-detail__meta-cell--address');
    els.addressDivider = this.#q('.label-detail__meta-divider--address');
    els.address = this.#q('.label-detail__address');
    els.severitySection = this.#q('.label-detail__col--severity');
    els.severity = this.#q('.label-detail__severity-faces');
    els.severityTitle = this.#q('.label-detail__severity-title');
    els.tags = this.#q('.label-detail__tags');
    els.tagsTitle = this.#q('.label-detail__tags-title');
    els.tagsEdit = this.#q('.label-detail__tags-edit');
    els.labeledWord = this.#q('.label-detail__labeled-word');
    // One status span per editable column, so a save's outcome is announced beside the control that produced it
    // rather than in a single shared slot the reader has to go looking for.
    els.editStatus = {
      severity: this.#q('.label-detail__col--severity .label-detail__edit-status'),
      tags: this.#q('.label-detail__col--tags .label-detail__edit-status'),
    };
    els.descriptionSection = this.#q('.label-detail__description-section');
    els.description = this.#q('.label-detail__description');
    els.commentsSection = this.#q('.label-detail__comments-section');
    els.validatorComments = this.#q('.label-detail__validator-comments');
    els.commentsCount = this.#q('.label-detail__comments-count');
    els.descComments = this.#q('.label-detail__desc-comments');
    els.panHint = this.#q('.label-detail__pan-hint');
    els.hideLabelButton = this.#q('.label-detail__hide-label');
    els.labelMapLink = this.#q('.label-detail__labelmap-link');
    els.exploreHereLink = this.#q('.label-detail__explore-link');
    els.commentRow = this.#q('.label-detail__comment-row');
    els.commentLabel = this.#q('.label-detail__comment-row label');
    els.commentInput = this.#q('.label-detail__comment-input');
    els.commentButton = this.#q('.label-detail__comment-submit');
    els.commentConfirm = this.#q('.label-detail__comment-confirmation');
    els.commentCancel = this.#q('.label-detail__comment-cancel');

    // Validation count display: <img> elements whose `src` is swapped between the four icon variants
    // (outline / filled / outline-ai / filled-ai) by #voteIconSrc.
    els.voteDisplay = this.#root.querySelector('.label-detail__vote-display');
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
    // Cross-surface hop into the LabelMap (only rendered on hosts that aren't the LabelMap itself).
    if (els.labelMapLink) {
      els.labelMapLink.addEventListener('click', () => this.#logClick('ViewOnLabelMap'));
    }
    if (els.exploreHereLink) {
      els.exploreHereLink.addEventListener('click', () => this.#logClick('ExploreHere'));
    }
    // The three vote controls are toggles: clicking the one you already picked clears your vote (#4653). There's no
    // separate "clear" affordance — a dedicated control would cost card space for a rare action (Mikey, #4653).
    // buttonSource overrides #source for this specific button group; falls back to #source if null.
    const voteHandler = (action, buttonSource) => () => {
      if (this.#interactionBlocked) return;
      this.#setVoteButtonsDisabled(true);
      this.#submitValidation(action, buttonSource || this.#source, this.#prevAction === action);
    };
    for (const action of Object.keys(els.panoOverlayButtons)) {
      els.panoOverlayButtons[action].addEventListener('click', voteHandler(action, this.#panoOverlaySource));
      els.voteButtons[action].addEventListener('click', voteHandler(action, this.#voteColumnSource));

      // Hover preview of what clicking would do: the filled icon variant for a vote, and — on the option already
      // voted — the outline variant, previewing the vote being cleared.
      const btn = els.voteButtons[action];
      const img = els.voteIcons[action];
      btn.addEventListener('mouseenter', () => {
        if (this.#interactionBlocked) return;
        img.src = LabelDetail.#voteIconSrc(action, this.#prevAction !== action, this.#aiValidation === action);
      });
      btn.addEventListener('mouseleave', () => {
        if (this.#interactionBlocked) return;
        this.#renderVoteIcons();
      });
    }

    // Editing (#2575): a face click saves that severity; the Tags control opens the tag editor and saves on close.
    els.severity.querySelectorAll('.severity-button').forEach((face) => {
      face.addEventListener('click', () => {
        if (!this.#editingEnabled) return;
        this.#submitEdit({ severity: Number(face.dataset.severity) });
      });
    });
    if (els.tagsEdit) {
      els.tagsEdit.addEventListener('click', () => {
        if (!this.#editingEnabled) return;
        if (this.#tagEditor.isOpen) this.#finishTagEditing();
        else this.#startTagEditing();
      });
    }

    els.commentInput.addEventListener('input', () => {
      els.commentButton.classList.toggle('is-active', els.commentInput.value.trim().length > 0);
    });
    els.commentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.#interactionBlocked) return;
        const comment = els.commentInput.value.trim();
        if (comment) this.#submitComment(comment);
      } else if (e.key === 'Escape') {
        // Swallow the first Escape so it only blurs the input. Second esc will close the dialog.
        e.preventDefault();
        e.stopPropagation();
        // Mid-edit that first Escape does more than blur: it abandons the edit, which is the way out a reader
        // reaches for when they opened the box by mistake. Focus deliberately stays in the input until the matching
        // keyup — see the keyup handler below.
        this.#escapeCancelledEdit = this.#editingComment;
        if (this.#editingComment) this.#cancelCommentEdit(false);
      }
    });
    // Same method for swallowing first Escape, but need to use 'keyup' for Gallery — where the shortcut handler is
    // on `window` and stands down only for an INPUT/TEXTAREA (`KeyboardManager.#documentKeyUp`). So the focus move
    // that ends an edit has to wait for this event: hand focus to a <button> during keydown and the keyup arrives
    // here on the button instead, past both this listener and that guard, and Escape closes the whole expanded view
    // on the same press that cancelled the edit.
    els.commentInput.addEventListener('keyup', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (this.#escapeCancelledEdit) {
          this.#escapeCancelledEdit = false;
          this.#focusCommentEditButton();
        } else {
          els.commentInput.blur();
        }
      }
    });
    els.commentButton.addEventListener('click', () => {
      if (this.#interactionBlocked) return;
      const comment = els.commentInput.value.trim();
      if (comment) this.#submitComment(comment);
    });
    els.commentCancel?.addEventListener('click', () => this.#cancelCommentEdit());

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
   * @returns {Promise<Object>} The label metadata payload that was rendered.
   */
  showLabel = async (idOrMeta, source) => {
    this.#source = source;
    this.#resetVoteButtonStyles();
    this.panoManager.clearLabels();

    if (typeof idOrMeta === 'object' && idOrMeta !== null) {
      this.#handleData(idOrMeta);
      return idOrMeta;
    }

    const labelId = idOrMeta;
    const url = this.#admin ? `/adminapi/label/id/${labelId}` : `/label/id/${labelId}`;
    const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) {
      alert('Server error. Most likely a label with this ID did not exist.');
      throw new Error(`HTTP error ${response.status}`);
    }
    const meta = await response.json();
    this.#handleData(meta);
    return meta;
  };

  /**
   * Populates the view with the label metadata fetched (or passed in directly) by showLabel().
   * @param {Object} meta - The label metadata payload.
   */
  #handleData(meta) {
    const els = this.#els;
    this.#currentLabelMeta = meta;

    // Read-only mode for the user's own labels — no validating/commenting. Imagery availability is unknown until
    // setPano() resolves below, so assume it's present for now and re-apply the lock once we know. Submitting is
    // held until then either way: there's nothing on screen to judge yet, and nothing that describes this label.
    this.#readonly = !!meta.from_current_user;
    this.#noImagery = false;
    this.#panoLoading = true;
    // The server decides who may edit (the labeler and admins, #2575); the card only mirrors its answer. Settled
    // before the lock is applied, since #applyEditLock() reads it.
    this.#canEdit = !!meta.can_edit;
    if (this.#tagEditor.isOpen) this.#tagEditor.close(); // Paging away abandons an unfinished tag pick.
    this.#applyInteractionLock();

    this.#showEditStatus('');
    this.#applyOwnLabelWording();
    if (els.ownBadge) {
      els.ownBadge.hidden = !meta.from_current_user;
      const ownLabel = i18next.t('labelmap:own-label');
      els.ownBadge.setAttribute('aria-label', ownLabel);
      LabelDetail.#setTooltip(els.ownBadge, ownLabel);
    }

    const labelPov = { heading: meta.heading, pitch: meta.pitch, zoom: meta.zoom };

    // Plain-object label shape consumed by PopupPanoManager.
    const popupLabel = {
      labelId: meta.label_id,
      label_type: meta.label_type,
      canvasX: meta.canvas_x,
      canvasY: meta.canvas_y,
      originalCanvasWidth: util.EXPLORE_CANVAS_WIDTH,
      originalCanvasHeight: util.EXPLORE_CANVAS_HEIGHT,
      pov: labelPov,
      streetEdgeId: meta.street_edge_id,
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
        this.#panoLoading = false;
        this.#applyInteractionLock();

        // The live imagery's metadata may carry an address the label payload didn't. Only read it when the shown
        // pano is actually this label's on the primary viewer — on the static-crop fallback, currPanoData still
        // describes whatever pano the viewer showed last.
        const panoData = this.panoManager.panoViewer.currPanoData;
        const livePano = imageShown && this.panoManager.activeViewerName === 'Default'
          && panoData && panoData.getPanoId() === meta.pano_id;
        const address = (livePano && panoData.getProperty('address'))
          || meta.pano_data?.address || meta.backup_image?.address || null;
        // Link the address to the provider's public viewer only when live imagery actually loaded — for an
        // expired pano the provider link would land on a "no imagery here" page.
        if (address) this.#showAddress(address, livePano ? this.#panoLink(meta) : null);

        if (imageShown) this.#showPanHintOnce();
      })
      .catch((err) => {
        // setPano() resolves its own failures into the fallback chain, so a rejection here means the pipeline broke
        // outright. Land on "no imagery" rather than leaving the card locked on a load that will never finish.
        if (this.#currentLabelMeta !== meta) return;
        console.error('setPano failed; treating the label as having no imagery:', err);
        this.#noImagery = true;
        this.#panoLoading = false;
        this.#applyInteractionLock();
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

    // Cross-surface hop to the LabelMap, which opens this label's popup and pulses its map location.
    if (this.#showLabelMapLink && els.labelMapLink) {
      els.labelMapLink.href = `/labelMap?labelId=${meta.label_id}`;
      els.labelMapLink.hidden = false;
    }

    // Drop into Explore at this label (#4637): an address-style drop-in (#4451) seeded at the label's coordinates,
    // with the label's pano + stored POV riding along so the user arrives facing what they clicked. The pano is
    // skipped when known-expired; either way the coordinates are the fallback if it fails to load (#4635). Paging
    // can move between labels with and without coordinates, so the link re-hides when there's nothing to seed.
    if (els.exploreHereLink) {
      // /explore still bounces mobile visitors to /mobileLanding, and this card ships on pages phones do reach
      // (/stories, /dashboard, /profile), so offering the link there can only throw the reader off what they
      // are looking at.
      const canExploreHere = this.#showExploreHereLink && !util.isMobile()
        && Number.isFinite(meta.lat) && Number.isFinite(meta.lng);
      if (canExploreHere) {
        const exploreParams = new URLSearchParams({ lat: meta.lat, lng: meta.lng });
        // The POV rides along even without the pano: it's Explore's signal to face the label (rather than the
        // route direction) when it has to land on a different camera.
        if ([meta.heading, meta.pitch, meta.zoom].every(Number.isFinite)) {
          exploreParams.set('heading', meta.heading);
          exploreParams.set('pitch', meta.pitch);
          exploreParams.set('zoom', Math.round(meta.zoom));
        }
        // A known-expired pano is skipped up front; the coordinates above are the seed instead.
        if (meta.pano_id && !meta.expired) exploreParams.set('panoId', meta.pano_id);
        const address = meta.pano_data?.address;
        if (address) exploreParams.set('placeName', address);
        els.exploreHereLink.href = `/explore?${exploreParams.toString()}`;
      }
      els.exploreHereLink.hidden = !canExploreHere;
    }

    // Point the share widget at this label's public permalink (#456). The /label/:id route renders the label
    // spotlight page and serves the og:image crawlers embed in the share card.
    if (this.#shareWidget) {
      // The title feeds the native sheet and the email subject, so it carries the descriptive text, not "Share".
      // escapeValue off: plain-text sinks only, and a type name can carry an apostrophe (Can't See the Sidewalk).
      const shareText = i18next.t('common:share.text', {
        labelType: labelTypeName, interpolation: { escapeValue: false },
      });
      this.#shareWidget.setTarget({
        url: `${window.location.origin}/label/${meta.label_id}`,
        title: shareText,
        text: shareText,
      });
    }

    this.#renderSeverity(meta.severity, meta.label_type);
    this.#renderTags(meta.tags);

    // Description text; #updateCommentRow shows or hides the section based on whether the labeler wrote one.
    els.description.textContent = meta.description ?? '';

    // Dates. Short month names ('ll' / 'MMM', locale-aware) keep the meta chips on one line (#4572). The clock
    // time lives in its own span so #fitMetaRow can drop it first when the row gets cramped.
    const labeled = moment(new Date(meta.timestamp));
    els.timestamp.textContent = labeled.format('ll');
    const timePart = document.createElement('span');
    timePart.className = 'label-detail__timestamp-time';
    timePart.textContent = `, ${labeled.format('LT')}`;
    els.timestamp.appendChild(timePart);
    els.imageDate.textContent = moment(new Date(meta.image_capture_date)).format('MMM YYYY');

    // Address (#4489): seed from the stored pano address; the setPano() callback above upgrades to the live
    // imagery's value once it loads, which covers panos whose address hasn't been captured server-side yet.
    this.#showAddress(meta.pano_data?.address ?? meta.backup_image?.address ?? null);

    // Validator comments. Admin endpoint returns objects {username, comment}; non-admin returns bare
    // strings. Stash them so #submitComment() can append after a successful POST.
    this.#comments = meta.comments || [];
    // Index of the current user's comment in #comments, if any. The backend replaces comments rather than adding
    // new ones, so we mirror that here.
    this.#myCommentIdx = this.#comments.findIndex((c) => this.#isOwnComment(c));
    // An edit session belongs to the label it was opened on, so paging to the next label ends it. Cleared before
    // the render so the new label's own comment draws its Edit/Delete rather than an inherited open-box state.
    this.#editingComment = false;
    this.#renderComments();

    // A typed-but-unsent comment belongs to the label it was typed on, so it doesn't ride along to the next one
    // (Gallery pages between labels without ever tearing the card down). The status message is per-label for the
    // same reason: without this, paging within its 1.5s leaves the last label's "Comment Submitted" over this one.
    els.commentInput.value = '';
    els.commentButton.classList.remove('is-active');
    clearTimeout(this.#commentStatusTimer);
    if (els.commentConfirm) els.commentConfirm.hidden = true;

    // Lived-experience stories (#4054): lazy per-label fetch, so the metadata payload stays untouched. The type name
    // rides along so the composer's title can name the label ("Write your story about this Missing Curb Ramp").
    // Withheld for the two types whose names aren't a thing you can have a story "about" — "…about this Other" and
    // "…about this Can't See the Sidewalk" don't read as English — leaving those on the generic title.
    const NO_STORY_SUBJECT = ['Other', 'Occlusion'];
    this.#storySection?.setLabel(
      meta.label_id, NO_STORY_SUBJECT.includes(meta.label_type) ? null : labelTypeName);

    // Fill in some admin-only fields at the bottom if applicable.
    if (this.#admin) {
      this.#taskId = meta.audit_task_id;
      els.adminTask.textContent = meta.audit_task_id;

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

  /** The prompt each vote puts on the comment box's label and placeholder. Its keys are also the votes that open it. */
  static #COMMENT_PROMPT_KEYS = {
    Agree: 'labelmap:why-agree',
    Disagree: 'labelmap:why-disagree',
    Unsure: 'labelmap:why-unsure',
  };

  /**
   * Shows the comment box alongside the user's vote, with a per-vote prompt: Disagree/Unsure ask for the
   * reasoning behind the dispute, Agree invites an optional note (#5015). Comments stay tied to a vote —
   * open-ended notes about a place belong to lived-experience stories (#4054), not here.
   *
   * Once the user has a comment on this label the box closes and their comment carries Edit/Delete instead, the same
   * way a story of your own replaces the "share your story" CTA (`StorySection`). A comment is unique per
   * (label, user), so a second submission silently replaced the first — an open, inviting box above your own comment
   * offered exactly the action that destroyed it.
   *
   * @param {boolean} [focusOnReveal=false] - Focus the input when this call reveals the row (fresh-vote flow).
   */
  #updateCommentRow(focusOnReveal = false) {
    const els = this.#els;
    if (!els.commentRow) return;
    const action = this.#prevAction;
    const voted = Object.hasOwn(LabelDetail.#COMMENT_PROMPT_KEYS, action ?? '');
    // Editing opens the box even with no vote: clearing a vote deletes its comment, but comments predating that rule
    // still exist, and their author must be able to reach their own text.
    const show = !this.#locked && (this.#editingComment || (voted && this.#myCommentIdx < 0));
    const wasOpen = els.commentRow.classList.contains('is-open');
    els.commentRow.classList.toggle('is-open', show);
    if (show) {
      // An edit with no vote behind it has no per-vote prompt to show, so it falls back to the neutral one.
      const prompt = voted
        ? i18next.t(LabelDetail.#COMMENT_PROMPT_KEYS[action])
        : i18next.t('labelmap:add-comment');
      els.commentInput.placeholder = prompt;
      if (els.commentLabel) els.commentLabel.textContent = prompt;
      if (!wasOpen && focusOnReveal) els.commentInput.focus();
    }
    els.commentButton.textContent = i18next.t(this.#editingComment ? 'labelmap:comment-save' : 'labelmap:comment');
    if (els.commentCancel) els.commentCancel.hidden = !this.#editingComment;

    // Show each half of the zone only when it has something to say: the labeler's description when one was
    // written, the validator comments when any exist or the comment box is open. An empty heading over nothing
    // is wasted space (#4572, Mikey review). The whole zone (and its single divider) collapses when neither half
    // would show.
    const desc = this.#currentLabelMeta?.description;
    const hasDescription = desc !== null && desc !== undefined && String(desc).trim() !== '';
    const hasComments = this.#comments && this.#comments.length > 0;
    if (els.descriptionSection) els.descriptionSection.hidden = !hasDescription;
    if (els.commentsSection) els.commentsSection.hidden = !hasComments && !show;
    if (els.descComments) els.descComments.hidden = !hasDescription && !hasComments && !show;
  }

  // ───────────────────────────────────────────────────────────────────
  // Validation submission
  // ───────────────────────────────────────────────────────────────────

  /**
   * Whether a pano viewer is rendering the label currently on the card, and so may be believed about it.
   *
   * Only 'Default' (the primary GSV/Mapillary/Infra3d viewer) and 'Pannellum' mean one is. On the static-crop
   * fallback — and before the very first pano resolves — panoViewer still points at imagery that isn't this
   * label's, so nothing it reports may be recorded against it.
   *
   * The load window is the same trap one step earlier: activeViewerName is only assigned once setPano() settles on
   * a viewer, so until then it still names the one that showed the *previous* label. #interactionBlocked keeps a
   * submission from being made in that window at all; this makes the staleness unreadable rather than merely
   * unreachable.
   *
   * @param {string} activeViewerName - PopupPanoManager's name for the viewer that last won a setPano() race.
   * @param {boolean} panoLoading - Whether this label's setPano() is still in flight.
   * @returns {boolean}
   */
  static viewerShowsLabel(activeViewerName, panoLoading) {
    if (panoLoading) return false;
    return activeViewerName === 'Default' || activeViewerName === 'Pannellum';
  }

  /**
   * What the pano viewer can truthfully report about the label on screen, or null when it isn't showing it.
   * Feeds submissionContext(), which supplies the label's own metadata in that case.
   *
   * @returns {?{panoId: ?string, position: ?{lat: number, lng: number},
   *     pov: ?{heading: number, pitch: number, zoom: number}}} Null when no viewer is showing this label; individual
   *     fields may still be null when a viewer is up but its imagery hasn't resolved.
   */
  #viewerState() {
    if (!LabelDetail.viewerShowsLabel(this.panoManager.activeViewerName, this.#panoLoading)) return null;
    return {
      panoId: this.panoManager.panoViewer.getPanoId(),
      position: this.panoManager.panoViewer.getPosition(),
      pov: this.panoManager.getPov(),
    };
  }

  /**
   * POSTs JSON to a session-requiring endpoint via util.lazyIdentityFetch (#4442): every host page renders with no
   * session for a first-time visitor, so an auth-shaped failure mints the shared anonymous session and retries once.
   * A real rejection — 409 duplicate, 429 rate limit, 400 validation — surfaces instead of being re-posted.
   *
   * @param {string} url - The endpoint to POST to.
   * @param {object} data - The JSON-serializable request body.
   * @returns {Promise<Response>} The first non-auth-failure response, or the retry's (which may itself not be OK).
   */
  #postJson(url, data) {
    return util.lazyIdentityFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(data),
    });
  }

  /**
   * POSTs a validation for the current label to /labelmap/validate, then updates the count and validation display.
   * Fires opts.onVote after a successful submission so hosts can sync upstream UI.
   *
   * @param {'Agree'|'Disagree'|'Unsure'} action - The vote being cast, or the one being cleared when `undone`.
   * @param {string} source - The UI source string to record with this validation.
   * @param {boolean} [undone=false] - Clear the user's existing `action` vote instead of casting one (#4653). The
   *     backend deletes the validation and the user's comment on the label rather than inserting a new row, so the
   *     label returns to no-vote for this user.
   */
  #submitValidation(action, source, undone = false) {
    const isNewValidation = !undone && !this.#prevAction;
    const validationTimestamp = new Date();
    const canvasWidth = this.panoManager.svHolder.width();
    const canvasHeight = this.panoManager.svHolder.height();
    const panoMarkerPov = this.panoManager.getOriginalPosition();
    // Where the validator was looking. On the static-crop fallback that's the label's stored POV — what the crop is
    // a screenshot of — rather than whatever the idle pano viewer happens to report (#4711). canvas_x/canvas_y are
    // derived from it, so they follow.
    const context = LabelDetail.submissionContext(this.#viewerState(), this.#currentLabelMeta ?? {});
    const userPov = { heading: context.heading, pitch: context.pitch, zoom: context.zoom };

    const labelRadius = 10;
    const pixelCoordinates
      = util.pano.centeredPovToCanvasCoord(panoMarkerPov, userPov, canvasWidth, canvasHeight, labelRadius);

    const data = {
      label_id: this.panoManager.label.labelId,
      label_type: this.panoManager.label.label_type,
      validation_result: action,
      // A vote from the card never carries a change: edits go through /label/edit on their own (#2575).
      severity: this.#currentLabelMeta?.severity ?? null,
      tags: this.#currentLabelMeta?.tags ?? [],
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
      undone,
      redone: !undone && action !== this.#prevAction,
      viewer_type: this.panoManager.activeViewerName,
    };

    // Paging to another label isn't blocked while this is in flight, so pin the label this vote belongs to and bail
    // if a newer one has been shown by the time it resolves — otherwise the counts, icons, and comment list of the
    // *new* label get rewritten with this label's result. Same guard the setPano() callback uses. The vote itself
    // still landed server-side; reopening this label shows it.
    const votedLabelMeta = this.#currentLabelMeta;

    this.#postJson('/labelmap/validate', data).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (this.#currentLabelMeta !== votedLabelMeta) return;
      const newAction = undone ? null : action;
      // Casting a vote is recorded by the label_validation row itself; clearing one deletes that row, so this event
      // is the only trace it happened. Logged on success so the count tracks clears that actually landed.
      if (undone) this.#logClick(`ClearVote_result=${action}`);
      this.#updateVoteCount(newAction);
      this.#highlightVote(newAction);
      // Clearing a vote — and changing one (the `redone` flag) — deletes the user's comment server-side; drop it
      // here too so the list and its vote chips (#5015) match what a reload would show.
      const commentDropped = (undone || data.redone) && this.#dropOwnComment();
      this.#updateCommentRow(true);
      if (commentDropped) this.#flashCommentStatus('labelmap:comment-cleared', 'removed');
      this.#setVoteButtonsDisabled(false);
      if (isNewValidation) BadgeAchievements.recordValidation(this.panoManager.svHolder[0]);
      if (typeof this.#onVote === 'function') this.#onVote(newAction, this.#currentLabelMeta);
    }).catch((err) => {
      console.error(err);
      this.#setVoteButtonsDisabled(false);
    });
  }

  /**
   * Whether a comment entry belongs to the current viewer. Admin payloads carry usernames; non-admin ones carry a
   * `mine` flag instead (no identifiers on public surfaces), so the test differs by surface.
   * @param {Object|string} comment - An entry from #comments.
   * @returns {boolean}
   */
  #isOwnComment(comment) {
    if (!comment || typeof comment !== 'object') return false;
    return this.#admin ? !!this.#currUsername && comment.username === this.#currUsername : !!comment.mine;
  }

  /**
   * Removes the current user's validator comments from the rendered list, mirroring the server-side delete that
   * rides along with clearing or changing a vote. No-op when they hadn't commented.
   *
   * Filters by identity rather than trusting the stored #myCommentIdx, since that index is only valid for the list as
   * it stood when it was computed and this runs a network round-trip later. Filtering also matches the breadth of
   * `ValidationTaskCommentTable.deleteIfExists`, which clears by (label, user) rather than by row id.
   *
   * @returns {boolean} Whether anything was actually removed.
   */
  #dropOwnComment() {
    if (!this.#comments) return false;
    const remaining = this.#comments.filter((c) => !this.#isOwnComment(c));
    if (remaining.length === this.#comments.length) return false;
    this.#comments = remaining;
    this.#myCommentIdx = -1;
    this.#renderComments();
    return true;
  }

  /**
   * Opens the comment box on the user's existing comment, prefilled and focused, so changing it is a deliberate act
   * rather than a side effect of typing into an empty box (#5015).
   */
  #startCommentEdit() {
    const own = this.#comments?.[this.#myCommentIdx];
    if (!own || this.#interactionBlocked) return;
    this.#editingComment = true;
    this.#updateCommentRow();
    this.#renderComments(); // Drops the Edit/Delete pair; the box below now speaks for this comment.
    const els = this.#els;
    // The last save's confirmation is about to be contradicted by an open box, so it goes now rather than on its timer.
    clearTimeout(this.#commentStatusTimer);
    if (els.commentConfirm) els.commentConfirm.hidden = true;
    // #isOwnComment only ever matches an object, so #myCommentIdx cannot point at a bare comment string.
    els.commentInput.value = own.comment;
    els.commentButton.classList.toggle('is-active', els.commentInput.value.trim().length > 0);
    els.commentInput.focus();
    els.commentInput.select();
    this.#logClick('EditCommentOpen');
  }

  /**
   * Leaves edit mode without saving, closing the box and returning focus to the Edit button that opened it.
   *
   * @param {boolean} [restoreFocus=true] - Whether to move focus to that Edit button now. The Escape path passes
   *     `false` and defers the move to its own `keyup` handler, because focus has to still be in the input when the
   *     keyup lands — see the handler for what happens in Gallery otherwise.
   */
  #cancelCommentEdit(restoreFocus = true) {
    if (!this.#editingComment) return;
    this.#editingComment = false;
    this.#els.commentInput.value = '';
    this.#els.commentButton.classList.remove('is-active');
    this.#updateCommentRow();
    this.#renderComments();
    if (restoreFocus) this.#focusCommentEditButton();
  }

  /** Moves focus to the Edit control on the user's own comment, when one is on screen. */
  #focusCommentEditButton() {
    this.#els.validatorComments.querySelector('.label-detail__comment-edit')?.focus();
  }

  /**
   * Deletes the user's own comment after a confirm, then reopens the box so they can leave a different one.
   *
   * Deleting is otherwise only reachable by clearing the vote the comment rode in on, which discards the verdict
   * along with the text — the two are worth separating (#5015).
   */
  async #deleteOwnComment() {
    if (this.#interactionBlocked) return;
    const confirmed = await ConfirmDialog.confirm({
      message: i18next.t('labelmap:comment-delete-confirm'),
      confirmText: i18next.t('labelmap:comment-delete'),
      cancelText: i18next.t('common:cancel'),
      danger: true,
      confirmIconSrc: util.assetPath('images/icons/delete-white-material.svg'),
    });
    if (!confirmed) return;
    const labelId = this.panoManager.label.labelId;
    try {
      const res = await fetch(`/labelmap/comment/${labelId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.#editingComment = false;
      this.#dropOwnComment();
      this.#updateCommentRow();
      this.#flashCommentStatus('labelmap:comment-deleted', 'removed');
      this.#logClick('DeleteComment');
      // The Delete button had focus and the re-render above just destroyed it, so focus would otherwise fall back to
      // the document. The reopened box is both the accessible landing spot and the useful one — it is where a
      // replacement comment gets typed. A comment with no vote behind it leaves the box shut, so fall back to the
      // section heading rather than stranding focus.
      const els = this.#els;
      if (els.commentRow?.classList.contains('is-open')) els.commentInput.focus();
      else this.#q('.label-detail__comments-title')?.focus();
    } catch (err) {
      console.error(err);
      // They confirmed a destructive action in a modal; silence here is indistinguishable from it having worked.
      this.#flashCommentStatus('labelmap:comment-delete-failed', 'failed');
    }
  }

  /**
   * How long a comment-status message holds, by what it is asking of the reader.
   *
   * A save can be brief: the comment appears directly below the message, so the message is a second opinion on
   * something already visible. A removal has no such backstop — it reports an absence, and an absence gives the
   * reader nothing to check it against — so it holds twice as long. A failure holds longest because it asks for
   * another attempt rather than confirming one.
   */
  static #COMMENT_STATUS_MS = { saved: 1500, removed: 3000, failed: 5000 };

  /**
   * Flashes a message in the comment section's polite live region.
   *
   * Every outcome — saved, updated, deleted, cleared by a vote, failed — shares this one announcer rather than each
   * adding an `aria-live` node for them to talk over each other with. The region sits outside the comment row on
   * purpose: saving closes that row, and a live region collapsed in the same frame its text is set announces to no
   * one and shows for no one.
   *
   * @param {string} key - i18next key for the message to announce.
   * @param {'saved'|'removed'|'failed'} [tone='saved'] - What the message is doing, which sets both its color and
   *     how long it holds. See #COMMENT_STATUS_MS.
   */
  #flashCommentStatus(key, tone = 'saved') {
    const el = this.#els.commentConfirm;
    if (!el) return;
    clearTimeout(this.#commentStatusTimer);
    el.classList.toggle('is-error', tone === 'failed');
    // Unhidden before the text lands: mutating a live region that is still `hidden` is the case screen readers are
    // least consistent about, and several skip it outright.
    el.hidden = false;
    el.textContent = i18next.t(key);
    this.#commentStatusTimer = setTimeout(() => {
      el.hidden = true;
    }, LabelDetail.#COMMENT_STATUS_MS[tone]);
  }

  /**
   * Disables the vote controls for the duration of a vote's POST, then hands them back.
   *
   * Re-enabling defers to the card's own lock: a POST that resolves after the user has paged on must not switch the
   * controls back on over a label that can't be voted on, or one whose imagery hasn't loaded yet.
   *
   * @param {boolean} disabled
   */
  #setVoteButtonsDisabled(disabled) {
    const off = disabled || this.#interactionBlocked;
    for (const btn of Object.values(this.#els.panoOverlayButtons)) {
      btn.disabled = off;
    }
    for (const btn of Object.values(this.#els.voteButtons)) {
      btn.disabled = off;
    }
  }

  #renderVoteCounts() {
    for (const action of Object.keys(this.#els.voteCounts)) {
      this.#els.voteCounts[action].textContent = this.#validationCounts[action] ?? 0;
    }
    this.#renderVoteTooltips(); // Counts are part of the tooltip text, so refresh them together.
  }

  /**
   * Adjusts the in-memory validation counts after a successful vote, and mirrors the new state onto the label
   * metadata so a host that re-renders from it (Gallery's expanded view pages through cached meta) stays in sync.
   * @param {?('Agree'|'Disagree'|'Unsure')} action - The new vote, or null when it was cleared (#4653).
   */
  #updateVoteCount(action) {
    if (this.#prevAction) {
      this.#validationCounts[this.#prevAction] = Math.max(0, this.#validationCounts[this.#prevAction] - 1);
    }
    this.#prevAction = action;
    if (action) this.#validationCounts[action] += 1;
    this.#renderVoteCounts();

    if (this.#currentLabelMeta) {
      this.#currentLabelMeta.user_validation = action;
      this.#currentLabelMeta.num_agree = this.#validationCounts.Agree;
      this.#currentLabelMeta.num_disagree = this.#validationCounts.Disagree;
      this.#currentLabelMeta.num_unsure = this.#validationCounts.Unsure;
    }
  }

  /**
   * Reflects the current vote on the pano overlay (selected button + border color around the pano). All six vote
   * controls carry `aria-pressed` so assistive tech gets the toggle semantics the filled icon and colored border
   * convey visually (#4653).
   * @param {?string} action
   */
  #highlightVote(action) {
    for (const [key, btn] of Object.entries(this.#els.panoOverlayButtons)) {
      btn.classList.toggle('is-selected', key === action);
      btn.setAttribute('aria-pressed', String(key === action));
    }
    for (const [key, btn] of Object.entries(this.#els.voteButtons)) {
      btn.setAttribute('aria-pressed', String(key === action));
    }
    // Border on the pano wrap reflects the current validation.
    if (this.#els.panoWrap) {
      this.#els.panoWrap.classList.remove('is-agree', 'is-disagree', 'is-unsure');
      if (action) this.#els.panoWrap.classList.add(`is-${action.toLowerCase()}`);
    }
    this.#renderVoteIcons();
    this.#renderVoteTooltips(); // Which option is selected changes what its tooltip says clicking will do.
  }

  #resetVoteButtonStyles() {
    for (const btn of Object.values(this.#els.panoOverlayButtons)) {
      btn.classList.remove('is-selected');
      btn.setAttribute('aria-pressed', 'false');
      if (!this.#interactionBlocked) btn.disabled = false;
    }
    for (const btn of Object.values(this.#els.voteButtons)) {
      btn.setAttribute('aria-pressed', 'false');
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
   * Whether the card's interactive controls are off right now. Everything #locked covers, plus the window where
   * this label's imagery is still loading: setPano() hides the pano holder on entry and only names the viewer it
   * settled on once it resolves, so until then there is nothing on screen to judge the label by and
   * activeViewerName still describes the *previous* label (the #4711 staleness, one step earlier).
   *
   * Kept separate from #locked because this one is transient: the comment row stays put through it rather than
   * animating shut and back open on every page-through.
   * @returns {boolean}
   */
  get #interactionBlocked() {
    return this.#locked || this.#panoLoading;
  }

  /**
   * The reason validating/commenting is blocked for the current label, or null when it's allowed. The viewer's
   * own label wins over no-imagery since it's the more specific reason to surface. A label whose imagery is merely
   * still loading gets no reason: the controls are disabled for the moment it takes, and a tooltip that appears and
   * vanishes within it would be noise (and a translated string in every locale for a state nobody can read).
   * @returns {?string}
   */
  #lockReason() {
    if (this.#readonly) return i18next.t('labelmap:own-label-disabled');
    if (this.#noImagery) return i18next.t('labelmap:no-imagery-disabled');
    return null;
  }

  /**
   * Whether severity and tags are editable on this label: the server let this viewer edit it (the labeler or an
   * admin) *and* there is an image of it on screen to judge it by.
   *
   * The imagery half is deliberately not #locked, because the two locks don't line up (#5047). On the viewer's own
   * label validating is off but editing stays on — they're its labeler, and re-rating your own label is the point.
   * No imagery blocks both: rating a label or picking tags for it from nothing is the same problem as validating it
   * from nothing. The static-crop fallback counts as imagery, so this only bites when nothing loaded at all.
   * @returns {boolean}
   */
  get #editingAllowed() {
    return this.#canEdit && !this.#noImagery;
  }

  /**
   * Whether an edit may actually be saved right now — everything #editingAllowed covers, plus the window where this
   * label's imagery is still loading and we don't yet know which way it will go.
   *
   * Kept out of what #applyEditLock() renders, mirroring the #locked / #interactionBlocked split: this one flips on
   * every page-through, and dimming the controls for the moment a pano takes to load would flicker them on each
   * label. Being a click-time guard only, the cost of that is a click in the gap doing nothing.
   * @returns {boolean}
   */
  get #editingEnabled() {
    return this.#editingAllowed && !this.#panoLoading;
  }

  /**
   * The reason editing is blocked, or null when it's allowed. Only a viewer who could otherwise edit gets one — for
   * everyone else severity and tags were never controls, so naming a lock on them would be noise. The transient
   * loading window gets none either, for the same reason #lockReason() skips it.
   * @returns {?string}
   */
  #editLockReason() {
    return this.#canEdit && this.#noImagery ? i18next.t('labelmap:no-imagery-edit-disabled') : null;
  }

  /**
   * Toggles the disabled state + tooltip on interactive elements based on the current lock reasons. Vote-control
   * tooltips are built by #renderVoteTooltips (they also depend on counts/AI, which change independently of the
   * lock); this just refreshes them and drives the disabled state + comment-box tooltips.
   */
  #applyInteractionLock() {
    const els = this.#els;
    const blocked = this.#interactionBlocked;
    this.#root.classList.toggle('label-detail--readonly', blocked);
    const tip = this.#lockReason() ?? '';

    this.#renderVoteTooltips();
    // The toggle goes with the marker it acts on; a load still in flight keeps it, since a marker is coming.
    if (els.hideLabelButton) els.hideLabelButton.hidden = this.#noImagery;
    // Your own label is never going to be validatable by you, so the overlay goes away rather than sitting there
    // greyed across the imagery (#5047). Every other lock keeps the buttons: those are states that pass, and a
    // disabled control that explains itself is the thing that tells you to come back.
    if (els.panoOverlay) els.panoOverlay.hidden = this.#readonly;
    for (const btn of Object.values(els.panoOverlayButtons)) btn.disabled = blocked;
    for (const btn of Object.values(els.voteButtons)) btn.disabled = blocked;

    // Comment input and submit button. The reason rides the row rather than the two controls it applies to: a
    // disabled control swallows the hover that opens a tooltip on it.
    els.commentInput.disabled = blocked;
    els.commentButton.disabled = blocked;
    if (els.commentCancel) els.commentCancel.disabled = blocked;
    // The Edit/Delete controls on the user's own comment lead back into that same box, so they follow its lock.
    for (const btn of els.validatorComments.querySelectorAll('.label-detail__comment-own-control')) {
      btn.disabled = blocked;
    }
    LabelDetail.#setTooltip(els.commentRow, tip);
    // A durable lock also hides the comment box (it only shows with a Disagree/Unsure vote); a load in flight
    // leaves it in place and just disables it, since it's about to be usable again.
    this.#updateCommentRow();
    this.#applyEditLock(); // Imagery availability drives both locks, so they always settle together.
  }

  /**
   * Names the meta strip's date and the two editable columns for whoever is reading (#5047).
   *
   * On the viewer's own label the card is showing them their own work, and the own-label chip alone was easy to
   * miss, so the wording says it where they are already reading: "You labeled: <date>", "Your Rating", "Your Tags".
   * On anyone else's label all three keep the neutral wording. The severity heading is set in #renderSeverity()
   * instead, which owns that element and re-runs whenever the rating does.
   */
  #applyOwnLabelWording() {
    const els = this.#els;
    const own = this.#readonly;
    if (els.labeledWord) els.labeledWord.textContent = i18next.t(own ? 'labelmap:you-labeled' : 'common:labeled');
    if (els.tagsTitle) els.tagsTitle.textContent = i18next.t(own ? 'labelmap:your-tags' : 'common:tags');
  }

  /**
   * Puts the severity faces and the Tags control into their live or inert state, with the reason on hover (#5047).
   *
   * The controls stay in place rather than disappearing when imagery is missing — a viewer who *can* edit needs to
   * be told why they can't right now, and a hidden control can't say anything. Neither carries the `disabled`
   * attribute for the same reason: a natively disabled element swallows the hover that opens its tooltip, so both
   * are marked `aria-disabled` and inert via their click guards instead, which also keeps the Tags button focusable
   * so keyboard users reach the explanation too.
   */
  #applyEditLock() {
    const els = this.#els;
    const meta = this.#currentLabelMeta;
    const allowed = this.#editingAllowed;
    const tip = this.#editLockReason() ?? '';
    // Doubles as the dimmed "not a control" cue: the same rule dims severity and tags for a viewer who can't edit.
    this.#root.classList.toggle('label-detail--editable', allowed);

    // Imagery that resolved to unavailable while the editor was open abandons the pick rather than saving it — the
    // tags were chosen against an image that turned out not to be there.
    if (this.#tagEditor.isOpen && !allowed) {
      this.#tagEditor.close();
      if (meta) this.#renderTags(meta.tags);
    }
    if (els.tagsEdit) {
      els.tagsEdit.hidden = !this.#canEdit;
      els.tagsEdit.setAttribute('aria-disabled', String(this.#canEdit && !allowed));
      LabelDetail.#setTooltip(els.tagsEdit, tip);
      this.#setTagsEditLabel(this.#tagEditor.isOpen);
    }
    if (meta) this.#renderSeverity(meta.severity, meta.label_type);
  }

  /**
   * Sets the count-aware tooltip on each column vote control (the thumbs in the Validations section) so hovering
   * anywhere on one — icon, count, or word — reads what clicking does, how many validators have already voted that
   * way, and whether our AI's vote is among them (#4572). When the label is locked, the lock reason wins instead.
   *
   * The option the user voted for gets its own phrasing: it counts the user separately from the others ("You and 2
   * other validators have agreed…" rather than "3 validators have agreed", Jon #4653) and says that clicking again
   * clears the vote, since for that one button the visible word no longer describes what clicking does.
   *
   * That last point is also why the pano hover-overlay buttons get a tooltip only while selected: unselected, their
   * full-width Agree/Disagree/Unsure labels already say what they do (Jon, #4574), so a tooltip would just repeat
   * them — but the selected one now clears rather than casts, which nothing else on it says.
   *
   * While the label is locked the reason goes on the vote column as a whole: these sentences don't apply, and a
   * disabled button swallows the hover that would open a tooltip on it anyway.
   */
  #renderVoteTooltips() {
    const els = this.#els;
    const lockTip = this.#lockReason();
    LabelDetail.#setTooltip(els.voteDisplay, lockTip ?? '');
    for (const action of Object.keys(els.voteButtons)) {
      const isVoted = !lockTip && this.#prevAction === action;
      let tip = '';
      if (!lockTip) {
        if (isVoted) {
          // {{count}} is the *other* validators, so the user isn't double-counted in their own tooltip. The i18next
          // `_zero` key covers "nobody else" without a second key and a branch here — it resolves whenever count is
          // 0, even in languages (zh-TW) whose CLDR rules have no zero category, so those carry only _zero/_other.
          const others = Math.max(0, (this.#validationCounts[action] ?? 1) - 1);
          tip = i18next.t(`labelmap:vote-tooltip-voted-${action.toLowerCase()}`, { count: others });
        } else {
          const count = this.#validationCounts[action] ?? 0;
          tip = i18next.t(`labelmap:vote-tooltip-${action.toLowerCase()}`, { count });
        }
        // The AI's vote is folded into this option's count, so flag it where it applies. Sentences are appended in
        // order of usefulness, so what clicking *does* lands last rather than trailing off into a footnote.
        if (this.#aiValidation === action) tip += ` ${i18next.t('labelmap:vote-tooltip-ai-included')}`;
        if (isVoted) tip += ` ${i18next.t('labelmap:vote-tooltip-clear')}`;
      }
      LabelDetail.#setTooltip(els.voteButtons[action], tip);
      LabelDetail.#setTooltip(els.panoOverlayButtons[action], isVoted ? i18next.t('labelmap:vote-tooltip-clear') : '');
    }
  }

  /**
   * Points the shared tooltip (psTooltip.js) at an element, or takes it away. The card's own tooltips go through
   * this rather than the native `title` attribute so a long sentence wraps inside a bounded card instead of
   * stretching into a single browser-drawn line the width of the card (#4778).
   * @param {?Element} el - The trigger; ignored when the host's markup doesn't include it.
   * @param {string} text - The tooltip text, or an empty string to remove the tooltip.
   */
  static #setTooltip(el, text) {
    if (!el) return;
    if (text) el.setAttribute('data-ps-tooltip', text);
    else el.removeAttribute('data-ps-tooltip');
  }

  /**
   * The URL of one vote icon variant: the four are the cross of filled/outline with the `-ai` suffix.
   *
   * @param {string} action - 'Agree', 'Disagree', or 'Unsure'.
   * @param {boolean} filled - Whether to fill the icon in, which reads as "this is the vote".
   * @param {boolean} isAi - Whether the AI validated this option, which the `-ai` variant marks.
   * @returns {string} The icon's asset URL.
   */
  static #voteIconSrc(action, filled, isAi) {
    const state = filled ? 'filled' : 'outline';
    return util.assetPath(`images/icons/validation/${action.toLowerCase()}-${state}${isAi ? '-ai' : ''}.svg`);
  }

  /**
   * Updates the three column icons to the right variant based on the user's current vote and the AI validation:
   *   - filled when the user voted this option, otherwise outline
   *   - `-ai` suffix when the AI validated this option
   * The icon carries no title of its own; hovering it falls through to the vote button's unified tooltip
   * (#renderVoteTooltips), so the icon and the button never show two competing explanations.
   */
  #renderVoteIcons() {
    for (const [action, img] of Object.entries(this.#els.voteIcons)) {
      img.src = LabelDetail.#voteIconSrc(action, this.#prevAction === action, this.#aiValidation === action);
    }
  }

  /**
   * Briefly shows the "drag to look around" hint over the imagery, once per session — nothing else signals
   * that the pano is pannable until the cursor is already over it.
   */
  #showPanHintOnce() {
    const hint = this.#els.panHint;
    if (!hint) return;
    try {
      if (sessionStorage.getItem('psLabelDetailPanHintShown')) return;
      sessionStorage.setItem('psLabelDetailPanHintShown', 'true');
    } catch {
      return; // Storage access throws under "block all site data" settings; skip the hint rather than reject.
    }
    hint.hidden = false;
    requestAnimationFrame(() => hint.classList.add('is-visible'));
    setTimeout(() => {
      hint.classList.remove('is-visible');
      setTimeout(() => {
        hint.hidden = true;
      }, 400); // Matches the CSS opacity transition.
    }, 5500);
  }

  /**
   * Shows or hides the address meta cell. The whole cell is hidden when no address is known so the meta row
   * doesn't render a dangling "Address:" label (non-GSV imagery and never-captured panos have none).
   * @param {?string} address - The street-level address to display, or null/empty to hide the cell.
   * @param {?{url: string, tooltip: string}} [link] - Imagery-provider link for the address; plain text when null.
   */
  #showAddress(address, link = null) {
    const els = this.#els;
    if (!els.addressCell) return;
    els.address.textContent = address || '';
    els.addressCell.hidden = !address;
    if (els.addressDivider) els.addressDivider.hidden = !address;
    if (address && link) {
      els.address.href = link.url;
      els.address.target = '_blank';
      els.address.rel = 'noopener noreferrer';
      // Full address (the strip may ellipsize it) plus where the link goes.
      els.address.title = `${address} — ${link.tooltip}`;
    } else {
      els.address.removeAttribute('href');
      els.address.removeAttribute('target');
      els.address.removeAttribute('rel');
      els.address.title = address || ''; // Native tooltip reveals the full address when the strip ellipsizes it.
    }
    this.#fitMetaRow(); // The address is the row's widest, most variable cell, so re-fit whenever it changes.
  }

  /**
   * Keeps the meta strip on a single line (#4572, Mikey review), giving up room in order: the clock time, then the
   * "Details" word (the ⓘ and its aria-label remain), then wrapping.
   *
   * Out of room means the address clips or the fixed cells overflow the row outright. With no address only the
   * row's own overflow reports it — unhandled, it scrolls the whole card sideways (#5021).
   *
   * Idempotent: resets to the roomiest state before measuring, so it is safe to re-run on every address change and
   * card resize. Reset and re-measure are synchronous, so the driving ResizeObserver sees no net size change.
   */
  #fitMetaRow() {
    const els = this.#els;
    if (!els.metaRow) return;
    els.metaRow.classList.remove('label-detail__meta-row--no-time', 'label-detail__meta-row--compact-details',
      'label-detail__meta-row--wrap');
    // +1 absorbs sub-pixel rounding so a flush-fitting row doesn't flap the classes on and off.
    const rowOverflows = () => els.metaRow.scrollWidth > els.metaRow.clientWidth + 1;
    const addressClipped = () => Boolean(els.address) && !els.addressCell?.hidden
      && els.address.scrollWidth > els.address.clientWidth + 1;
    const cramped = () => addressClipped() || rowOverflows();

    if (cramped()) els.metaRow.classList.add('label-detail__meta-row--no-time');
    if (cramped()) els.metaRow.classList.add('label-detail__meta-row--compact-details');
    if (rowOverflows()) els.metaRow.classList.add('label-detail__meta-row--wrap');
  }

  /**
   * External link for viewing the label's pano on its imagery provider's own site, at the label's stored POV.
   * @param {Object} meta - The label metadata payload (pano id + the label's POV).
   * @returns {?{url: string, tooltip: string}} The provider link, or null for providers without a public
   *     viewer (e.g. Infra3d).
   */
  #panoLink(meta) {
    const link = this.panoManager.panoViewer.publicViewerLink(meta.pano_id, {
      heading: meta.heading,
      pitch: meta.pitch,
    });
    return link && { url: link.url, tooltip: i18next.t(link.i18nKey) };
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

    // On the viewer's own label the column is titled "Your Rating" rather than the per-type "Quality"/"Severity"
    // (#5047): the point of the heading there is whose rating it is, and the faces and their level words carry the
    // positive/negative scale the type-specific word would have named.
    const title = this.#readonly ? i18next.t('labelmap:your-rating') : i18next.t(`common:${titleKey}`);
    if (els.severityTitle) els.severityTitle.textContent = title;
    if (els.severity) els.severity.setAttribute('aria-label', title);

    const editable = this.#editingAllowed;
    // A face that can't be clicked because the imagery didn't load explains that instead of naming its own level:
    // "Severity: Low" reads like an offer, and the lock is the more useful thing to say (#5047).
    const lockTip = this.#editLockReason();

    els.severity.querySelectorAll('.severity-button').forEach((face) => {
      const faceSev = Number(face.dataset.severity);
      const selected = faceSev === Number(severity);
      face.classList.toggle('is-selected', selected);
      face.querySelector('.severity-button__icon').src = util.misc.getSmileyIconPath(faceSev, labelType, selected);
      face.title = lockTip ? '' : `${i18next.t(`common:${titleKey}`)}: ${i18next.t(`common:${levelKeys[faceSev]}`)}`;
      LabelDetail.#setTooltip(face, lockTip ?? '');
      const labelSpan = face.querySelector('.severity-button__label');
      if (labelSpan) labelSpan.textContent = i18next.t(`common:${levelKeys[faceSev]}`);

      // Editable faces are a focusable pick-one control (#2575); read-only ones stay out of the tab order.
      face.classList.toggle('severity-button--static', !editable);
      face.setAttribute('aria-pressed', String(selected));
      if (editable) face.removeAttribute('aria-disabled');
      else face.setAttribute('aria-disabled', 'true');
      // A face that's off but has a reason to give stays focusable so a keyboard user can land on it and hear the
      // reason; aria-disabled marks it inert without taking it out of reach. Plain read-only faces say nothing.
      if (editable || lockTip) face.removeAttribute('tabindex');
      else face.setAttribute('tabindex', '-1');
    });
  }

  /**
   * Renders the label's tags as read-only pills, or "None".
   * @param {string[]} tags
   */
  #renderTags(tags) {
    const els = this.#els;
    els.tags.replaceChildren();
    els.tags.classList.remove('label-detail__empty');
    if (tags && tags.length) {
      for (const tag of tags) {
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
  }

  // ───────────────────────────────────────────────────────────────────
  // Editing severity and tags (#2575)
  // ───────────────────────────────────────────────────────────────────

  /**
   * Labels the Tags control for the state it's in: "Done" with the editor open, otherwise "Add" over a label with no
   * tags and "Edit" over one that has some — the list below an untagged label reads "None", so there is nothing to
   * edit yet (#5047).
   *
   * The visible word stays terse because the control sits inline beside the "Tags" heading, so the noun rides an
   * aria-label instead: a card can show two bare "Edit" buttons (this one and a story's), which is exactly the
   * ambiguity WCAG 2.4.6 is about.
   *
   * @param {boolean} editing - Whether the tag editor is open.
   */
  #setTagsEditLabel(editing) {
    const btn = this.#els.tagsEdit;
    if (!btn) return;
    let key = 'done-editing-tags';
    if (!editing) key = this.#currentLabelMeta?.tags?.length ? 'edit-tags' : 'add-tags';
    btn.textContent = i18next.t(`labelmap:${key}`);
    btn.setAttribute('aria-label', i18next.t(`labelmap:${key}-label`));
    btn.setAttribute('aria-expanded', String(editing));
  }

  /**
   * Shows a short status beside an editable column's heading, clearing it after a few seconds.
   *
   * Severity and tags save the moment they're clicked, with no button to press and no dialog to dismiss, so the
   * only thing telling the user their change was kept is this line (#5047). It rides the column's `aria-live`
   * span, which announces the outcome without moving focus off the control they just used.
   *
   * The message is held, then faded out over LabelDetail.#EDIT_STATUS_FADE_MS rather than cut, and the text is
   * only removed once the fade has finished — long enough that a screen reader has announced it.
   *
   * A success is held for a fraction of a failure's time: "Saved" is glanced at, if it's read at all, while a
   * failure asks the reader to do something about it.
   *
   * @param {string} text - The visible word. Empty to clear every column's status.
   * @param {Object} [opts]
   * @param {string[]} [opts.columns] - Which columns to show it on ('severity' and/or 'tags'); all when omitted.
   * @param {boolean} [opts.error=false] - Style it as a failure rather than a confirmation.
   * @param {string} [opts.detail=''] - The full sentence, when the visible word is only a summary of it.
   */
  #showEditStatus(text, { columns, error = false, detail = '' } = {}) {
    const spans = this.#els.editStatus;
    if (!spans) return;
    for (const timer of this.#editStatusTimers) clearTimeout(timer);
    this.#editStatusTimers = [];
    const shown = text ? (columns ?? Object.keys(spans)) : [];
    for (const [name, el] of Object.entries(spans)) {
      if (!el) continue;
      const on = shown.includes(name);
      LabelDetail.#fillEditStatus(el, on ? text : '', on ? detail : '');
      el.classList.toggle('label-detail__edit-status--error', on && error);
      el.classList.remove('label-detail__edit-status--fading');
    }
    if (!text) return;

    const hold = error ? LabelDetail.#EDIT_STATUS_HOLD_ERROR_MS : LabelDetail.#EDIT_STATUS_HOLD_MS;
    this.#editStatusTimers.push(setTimeout(() => {
      for (const el of Object.values(spans)) {
        if (el) el.classList.add('label-detail__edit-status--fading');
      }
    }, hold));
    this.#editStatusTimers.push(setTimeout(() => {
      for (const el of Object.values(spans)) {
        if (!el) continue;
        LabelDetail.#fillEditStatus(el, '', '');
        el.classList.remove('label-detail__edit-status--fading');
      }
    }, hold + LabelDetail.#EDIT_STATUS_FADE_MS));
  }

  /**
   * Fills one column's status span: a terse word for the eye, the full sentence for the screen reader and the
   * tooltip.
   *
   * The two are separate nodes because the long form cannot sit in the flow. `.label-detail__col--severity` is
   * `flex: 0 0 auto`, so anything in its header sets the column's width outright — a sentence there widened it by
   * roughly its own length, squeezing the tags column to its 120px floor (and wrapping the row on a narrow host)
   * for as long as the message was up. An `sr-only` node is out of flow, so it costs no width at all.
   *
   * @param {HTMLElement} el - The column's status span.
   * @param {string} text - The visible word, or '' to clear.
   * @param {string} detail - The full sentence, or '' when the visible word is the whole message.
   */
  static #fillEditStatus(el, text, detail) {
    el.replaceChildren();
    LabelDetail.#setTooltip(el, detail);
    if (!text) return;
    if (!detail) {
      el.textContent = text;
      return;
    }
    // The summary is hidden from the accessibility tree so the live region announces the sentence once rather than
    // the summary and then a restatement of it.
    const summary = document.createElement('span');
    summary.setAttribute('aria-hidden', 'true');
    summary.textContent = text;
    const announced = document.createElement('span');
    announced.className = 'sr-only';
    announced.textContent = detail;
    el.append(summary, announced);
  }

  /** The failure status: a terse word inline, the sentence explaining the rollback announced and on hover. */
  #showEditFailure(columns) {
    this.#showEditStatus(i18next.t('labelmap:edit-failed-short'), {
      columns, error: true, detail: i18next.t('labelmap:edit-failed'),
    });
  }

  /** Replaces the read-only pills with the tag editor's pick-any pills for this label's type. */
  #startTagEditing() {
    const meta = this.#currentLabelMeta;
    if (!meta) return;
    this.#logClick('EditTagsOpen');
    this.#setTagsEditLabel(true);
    this.#els.tags.classList.remove('label-detail__empty');
    this.#els.tags.textContent = '';
    this.#tagEditor.open(meta.label_type, meta.tags || []).catch((err) => {
      console.error('Could not load the tag list for editing:', err);
      this.#tagEditor.close();
      this.#setTagsEditLabel(false);
      this.#renderTags(meta.tags);
      this.#showEditFailure(['tags']);
    });
  }

  /** Closes the tag editor and saves the picked tags if they differ from the label's. */
  #finishTagEditing() {
    const picked = this.#tagEditor.close();
    this.#setTagsEditLabel(false);
    this.#submitEdit({ tags: picked });
  }

  /**
   * Queues a change for saving; serializing keeps two quick clicks from racing each other's responses.
   * @param {{severity?: ?number, tags?: string[]}} change - The fields to change; an omitted one keeps its value.
   * @returns {Promise<void>}
   */
  #submitEdit(change) {
    // The label the change was made on, captured at click time rather than read at the queue's turn: a save can
    // wait behind an in-flight one for longer than it takes to page to the next label, and #currentLabelMeta by
    // then names that one — which is the label this change would otherwise be written to.
    const meta = this.#currentLabelMeta;
    const save = () => this.#saveEdit(change, meta);
    this.#editQueue = this.#editQueue.then(save, save);
    return this.#editQueue;
  }

  /**
   * Saves a change through /label/edit, rendering it optimistically and rolling back on failure. The server's
   * response is what's rendered in the end, since it may drop tags invalid for the label type.
   *
   * The save goes through even if the user has paged on — the edit was made and is theirs to keep — but nothing it
   * would draw reaches a card showing some other label; see the guard in `render`.
   *
   * @param {{severity?: ?number, tags?: string[]}} change
   * @param {Object} meta - The metadata of the label the change was made on.
   */
  async #saveEdit(change, meta) {
    if (!meta || !meta.can_edit) return;
    const severity = Object.hasOwn(change, 'severity') ? change.severity : meta.severity;
    const tags = change.tags ?? meta.tags ?? [];
    const prev = { severity: meta.severity ?? null, tags: meta.tags ?? [] };
    const sameTags = tags.length === prev.tags.length && tags.every((t) => prev.tags.includes(t));
    // The tag editor's pills are the tag display while it's open; redrawing would wipe the picks.
    const render = () => {
      if (this.#currentLabelMeta !== meta) return; // Paged on; this label's card isn't the one on screen.
      this.#renderSeverity(meta.severity, meta.label_type);
      if (!this.#tagEditor.isOpen) this.#renderTags(meta.tags);
      // The control reads "Add" or "Edit" by whether the label has tags, so the first tag saved (or a rollback to
      // none) flips it.
      this.#setTagsEditLabel(this.#tagEditor.isOpen);
    };
    if (severity === prev.severity && sameTags) {
      render(); // The tag editor may have just closed over an unchanged pick.
      return;
    }

    // Which columns this save speaks for, so its outcome is announced beside the control the user actually
    // touched. Derived rather than passed in, so a change carrying both fields would name both.
    const columns = [];
    if (severity !== prev.severity) columns.push('severity');
    if (!sameTags) columns.push('tags');

    meta.severity = severity;
    meta.tags = tags;
    render();

    try {
      const res = await this.#postJson('/label/edit', {
        label_id: meta.label_id, severity, tags, source: this.#source,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      // Paging isn't blocked while the save is in flight; a newer label's card must not be rewritten with this one.
      if (this.#currentLabelMeta !== meta) return;
      meta.severity = body.severity ?? null;
      meta.tags = body.tags ?? [];
      render();
      this.#showEditStatus(i18next.t('labelmap:edit-saved'), { columns });
      if (meta.severity !== prev.severity) {
        this.#logClick(`EditSeverity_old=${prev.severity}_new=${meta.severity}`);
      }
      if (!sameTags) this.#logClick(`EditTags_old=${prev.tags.join('|')}_new=${meta.tags.join('|')}`);
      if (typeof this.#onEdit === 'function') this.#onEdit(meta);
    } catch (err) {
      console.error(err);
      if (this.#currentLabelMeta !== meta) return;
      meta.severity = prev.severity;
      meta.tags = prev.tags;
      render();
      this.#showEditFailure(columns);
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Comment submission
  // ───────────────────────────────────────────────────────────────────

  /**
   * The thumbs-up / thumbs-down / question glyphs the vote chip draws, keyed by vote. These are the path data from
   * images/icons/validation/{vote}-outline.svg, inlined for the same two reasons AVATAR_SVG below is: the icon files
   * hardcode their stroke color, and their `stroke-width: 1` over a 20-unit viewBox thins to a sub-pixel hairline at
   * chip size. Inlined they inherit `currentColor` — so the glyph's contrast is the chip text's contrast — at a
   * stroke tuned for this size (#5015).
   */
  static #VOTE_GLYPH_PATHS = {
    Agree: ['M7.04837 9.16083L9.48707 3C9.97215 3 10.4374 3.19651 10.7804 3.54631C11.1234 3.8961 11.3161 4.93574 '
      + '11.3161 5.43042V7.91736H14.7668C14.9436 7.91532 15.1187 7.95249 15.2799 8.0263C15.4412 8.10011 15.5848 '
      + '8.20879 15.7008 8.34482C15.8168 8.48084 15.9024 8.64095 15.9516 8.81406C16.0009 8.98717 16.0127 9.16914 '
      + '15.9862 9.34736L15.1448 14.943C15.1008 15.2395 14.9531 15.5097 14.729 15.704C14.5049 15.8982 14.2196 '
      + '16.0033 13.9255 15.9999H7.04837M7.04837 9.16083V15.9999M7.04837 9.16083H5.21935C4.89596 9.16083 4.58581 '
      + '9.29184 4.35714 9.52504C4.12847 9.75823 4 10.0745 4 10.4043V14.7565C4 15.0862 4.12847 15.4025 4.35714 '
      + '15.6357C4.58581 15.8689 4.89596 15.9999 5.21935 15.9999H7.04837'],
    Disagree: ['M7.04837 10.8392L9.48707 17C9.97215 17 10.4374 16.8035 10.7804 16.4537C11.1234 16.1039 11.3161 '
      + '15.0643 11.3161 14.5696V12.0826H14.7668C14.9436 12.0847 15.1187 12.0475 15.2799 11.9737C15.4412 11.8999 '
      + '15.5848 11.7912 15.7008 11.6552C15.8168 11.5192 15.9024 11.359 15.9516 11.1859C16.0009 11.0128 16.0127 '
      + '10.8309 15.9862 10.6526L15.1448 5.05703C15.1008 4.76052 14.9531 4.49025 14.729 4.29602C14.5049 4.10179 '
      + '14.2196 3.99669 13.9255 4.00008H7.04837M7.04837 10.8392V4.00008M7.04837 10.8392H5.21935C4.89596 10.8392 '
      + '4.58581 10.7082 4.35714 10.475C4.12847 10.2418 4 9.92548 4 9.5957V5.24355C4 4.91376 4.12847 4.59748 '
      + '4.35714 4.36428C4.58581 4.13109 4.89596 4.00008 5.21935 4.00008H7.04837'],
    Unsure: ['M4.66667 9.25L5.99026 9.25C6.54865 9.25 7.10308 9.34353 7.63056 9.52671L12.1812 11.107C12.8428 '
      + '11.3368 13.3361 11.896 13.4815 12.5812L13.5848 13.0682M4.66667 9.25V15.2955M4.66667 9.25H3C2.44772 9.25 '
      + '2 9.69772 2 10.25V14.2955C2 14.8477 2.44772 15.2955 3 15.2955H4.66667M4.66667 15.2955L9.84287 '
      + '16.0901C10.5297 16.1955 11.2309 16.1567 11.9018 15.976L17.3819 14.5001C17.7447 14.4024 18.0602 14.0948 '
      + '17.9507 13.7354C17.8166 13.295 17.3792 12.8963 16.2852 13.0682C14.3724 13.2803 10.0743 13.3227 8.18396 '
      + '11.7955',
    'M10 5.19823C10.1026 4.87321 10.4787 4.33616 11.2308 4.54819C12.1538 4.80844 12.4615 6.1733 10.9231 '
    + '6.82334V7.47337M10.9231 8.94841V9'],
  };

  /**
   * Builds the chip that pairs a comment with its author's vote on the label.
   *
   * The vote is the commenter's *current* one — the server joins it per (label_id, user_id) rather than storing it
   * with the comment — so a comment from someone whose vote was since cleared gets no chip (#5015).
   *
   * @param {Object|string} c - An entry from #comments. Bare strings and entries with no vote yield null.
   * @returns {?HTMLSpanElement} The chip, or null when there is no vote to show.
   */
  static voteChipFor(c) {
    const vote = typeof c === 'object' && c !== null ? c.validation : null;
    if (!Object.hasOwn(LabelDetail.#VOTE_GLYPH_PATHS, vote)) return null;
    const word = i18next.t(`common:${util.camelToKebab(vote)}`);

    const chip = document.createElement('span');
    chip.className = `label-detail__comment-vote label-detail__comment-vote--${util.camelToKebab(vote)}`;
    // Read as one labeled node rather than a bare verb running into the comment text: `role="img"` collapses the
    // glyph and the word into a single announcement, and the label says whose verdict this is.
    chip.setAttribute('role', 'img');
    chip.setAttribute('aria-label', i18next.t('labelmap:commenter-voted', { vote: word }));

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of LabelDetail.#VOTE_GLYPH_PATHS[vote]) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    chip.appendChild(svg);
    chip.appendChild(document.createTextNode(word));
    return chip;
  }

  /**
   * Renders the validator comments list. Admin mode receives {username, …} entries and hyperlinks the username to
   * /admin/user/<username>; non-admin mode receives {comment, mine, …} entries with no identifiers on them. Both
   * carry the commenter's vote, drawn as a chip beside the text.
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
      els.validatorComments.textContent = i18next.t('labelmap:no-comments-yet');
      return;
    }
    // Anonymous avatar: a person glyph on a color keyed by the backend's per-label commenter index, so each
    // validator reads as a consistent "someone" within this card without any usernames on public surfaces.
    // The glyph is images/icons/user-feather.svg's path data, inlined (the icon files hardcode their stroke
    // color) so it inherits currentColor, with a heavier stroke tuned for this tiny size.
    const AVATAR_SVG = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
      </svg>`;
    const avatarFor = (c) => {
      const idx = typeof c === 'object' && c !== null && Number.isInteger(c.commenter) ? c.commenter : 0;
      const avatar = document.createElement('span');
      avatar.className = `label-detail__comment-avatar label-detail__comment-avatar--${idx % 6}`;
      avatar.innerHTML = AVATAR_SVG; // Static markup above — no user data involved.
      return avatar;
    };

    // Newest first, so a just-submitted comment lands right beneath the input above the list.
    [...this.#comments].reverse().forEach((c, i) => {
      if (i > 0) els.validatorComments.appendChild(document.createElement('hr'));
      const p = document.createElement('p');
      p.style.margin = '0';
      p.appendChild(avatarFor(c));

      // Relative-time pill; the exact date lives in the tooltip.
      const timeCreated = typeof c === 'object' && c !== null ? c.time_created : null;
      const whenPill = () => {
        const when = document.createElement('span');
        when.className = 'label-detail__comment-when';
        when.textContent = moment(timeCreated).fromNow();
        when.title = moment(timeCreated).format('ll, LT');
        return when;
      };

      // Edit/Delete on your own comment, matching the pair a story of your own carries (`StorySection`). They trail
      // the comment text rather than leading it, so the reader meets what was said before what can be done to it.
      // Rendered only while the box is closed: mid-edit the box below is already acting on this comment, and a
      // second Edit beside it would just reopen what is open.
      const ownControls = () => {
        if (!this.#isOwnComment(c) || this.#locked || this.#editingComment) return [];
        const make = (cls, key, onClick) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `label-detail__comment-own-control ${cls}`;
          btn.textContent = i18next.t(key);
          btn.disabled = this.#interactionBlocked;
          btn.addEventListener('click', onClick);
          return btn;
        };
        return [
          make('label-detail__comment-edit', 'labelmap:comment-edit', () => this.#startCommentEdit()),
          make('label-detail__comment-delete', 'labelmap:comment-delete', () => this.#deleteOwnComment()),
        ];
      };

      const voteChip = LabelDetail.voteChipFor(c);
      if (this.#admin && typeof c === 'object' && c !== null) {
        const a = document.createElement('a');
        a.href = `/admin/user/${encodeURI(c.username)}`;
        a.textContent = c.username;
        p.appendChild(a);
        if (timeCreated) {
          p.appendChild(document.createTextNode(' '));
          p.appendChild(whenPill());
        }
        if (voteChip) {
          if (!timeCreated) p.appendChild(document.createTextNode(' '));
          p.appendChild(voteChip);
        }
        p.appendChild(document.createTextNode(`: ${c.comment}`));
        for (const btn of ownControls()) p.appendChild(btn);
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
        if (voteChip) p.appendChild(voteChip);
        p.appendChild(document.createTextNode(typeof c === 'object' && c !== null ? c.comment : c));
        for (const btn of ownControls()) p.appendChild(btn);
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
    const context = LabelDetail.submissionContext(this.#viewerState(), this.#currentLabelMeta ?? {});

    els.commentButton.disabled = true;

    const data = {
      label_id: this.panoManager.label.labelId,
      label_type: this.panoManager.label.label_type,
      comment,
      pano_id: context.panoId,
      heading: context.heading,
      pitch: context.pitch,
      zoom: context.zoom,
      lat: context.lat,
      lng: context.lng,
    };

    this.#postJson('/labelmap/comment', data).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const wasEdit = this.#editingComment;
      els.commentInput.value = '';
      els.commentButton.classList.remove('is-active');
      if (wasEdit) this.#logClick('EditComment');

      // Update the visible list. Admin views render objects with a username; non-admin views render bare comment
      // strings. Replace the user's existing comment (if any) rather than appending — the backend deletes prior
      // comments from the same user before inserting, so the visible list should match.
      if (!this.#comments) this.#comments = [];
      const timeCreated = new Date().toISOString();
      // Keep the avatar color stable across the replace-own-comment flow; new commenters take the next index.
      const commenter = this.#myCommentIdx >= 0 && this.#comments[this.#myCommentIdx]
        ? this.#comments[this.#myCommentIdx].commenter ?? 0
        : this.#comments.reduce((max, c) => Math.max(max, (c && c.commenter) ?? -1), -1) + 1;
      // The chip mirrors the server's (label_id, user_id) join: the commenter's current vote, or none.
      const validation = this.#prevAction ?? null;
      const newEntry = this.#admin
        ? { username: body.username, comment, time_created: timeCreated, commenter, validation }
        : { comment, mine: true, time_created: timeCreated, commenter, validation };
      if (this.#myCommentIdx >= 0 && this.#myCommentIdx < this.#comments.length) {
        this.#comments[this.#myCommentIdx] = newEntry;
      } else {
        this.#comments.push(newEntry);
        this.#myCommentIdx = this.#comments.length - 1;
      }
      // The box closes now that a comment of theirs exists; Edit on the entry below is the way back into it.
      this.#editingComment = false;
      this.#updateCommentRow();
      this.#renderComments();
      // Announced after the row has settled — the live region sits outside it, so the collapse doesn't take the
      // message with it, and the reader hears the outcome of a card that is already in its final state.
      this.#flashCommentStatus(wasEdit ? 'labelmap:comment-updated' : 'labelmap:comment-submitted');
    }).catch((err) => {
      console.error(err);
      this.#flashCommentStatus('labelmap:comment-save-failed', 'failed');
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
