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
    history.replaceState(null, '', url);
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
  #noImagery = false;  // Set per-label once setPano() resolves; true when no navigable imagery could be loaded.
  #panoLoading = false;     // True from #handleData() until this label's setPano() resolves. See #interactionBlocked.
  #validationCounts = { Agree: null, Disagree: null, Unsure: null };
  #flags = { low_quality: null, incomplete: null, stale: null };
  #prevAction = null;
  #taskId = null;
  #iconBase = '';
  #aiValidation;
  #comments;
  #myCommentIdx;
  #shareWidget;
  #storySection;
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
   * @param {string} [opts.panoOverlaySource] - Source recorded when voting via the pano overlay buttons.
   * @param {string} [opts.voteColumnSource] - Source recorded when voting via the column vote buttons.
   * @param {boolean} [opts.showLabelMapLink] - Show a footer link to this label on /labelMap (for hosts that
   *     aren't the LabelMap itself).
   * @param {boolean} [opts.showExploreHereLink] - Show a footer link that opens Explore at this label's pano and
   *     point of view (#4637).
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
    this.#showLabelMapLink = !!opts.showLabelMapLink;
    this.#showExploreHereLink = !!opts.showExploreHereLink;
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
      this.#storySection = new StorySection(this.#root, { currUsername: this.#currUsername });
    }
  }

  /**
   * Mounts a PanoInfoPopover into the .label-detail__info-button-host span. Accessor closures read from
   * #currentLabelMeta, which is updated on every showLabel() call.
   */
  #initInfoPopover() {
    const host = this.#q('.label-detail__info-button-host');
    if (!host) return;

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
    els.descriptionSection = this.#q('.label-detail__description-section');
    els.description = this.#q('.label-detail__description');
    els.commentsSection = this.#q('.label-detail__comments-section');
    els.validatorComments = this.#q('.label-detail__validator-comments');
    els.commentsCount = this.#q('.label-detail__comments-count');
    els.descComments = this.#q('.label-detail__desc-comments');
    els.panHint = this.#q('.label-detail__pan-hint');
    els.labelMapLink = this.#q('.label-detail__labelmap-link');
    els.exploreHereLink = this.#q('.label-detail__explore-link');
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
        const state = this.#prevAction === action ? 'outline' : 'filled';
        const ai = this.#aiValidation === action ? '-ai' : '';
        img.src = `${this.#iconBase}${action.toLowerCase()}-${state}${ai}.svg`;
      });
      btn.addEventListener('mouseleave', () => {
        if (this.#interactionBlocked) return;
        this.#renderVoteIcons();
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
      if (this.#interactionBlocked) return;
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
      const canExploreHere = this.#showExploreHereLink && Number.isFinite(meta.lat) && Number.isFinite(meta.lng);
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
    this.#renderComments();

    // A typed-but-unsent comment belongs to the label it was typed on, so it doesn't ride along to the next one
    // (Gallery pages between labels without ever tearing the card down).
    els.commentInput.value = '';
    els.commentButton.classList.remove('is-active');

    // Lived-experience stories (#4054): lazy per-label fetch, so the metadata payload stays untouched.
    this.#storySection?.setLabel(meta.label_id);

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
    const wasOpen = els.commentRow.classList.contains('is-open');
    els.commentRow.classList.toggle('is-open', show);
    if (show) {
      const prompt = i18next.t(action === 'Disagree' ? 'labelmap:why-disagree' : 'labelmap:why-unsure');
      els.commentInput.placeholder = prompt;
      if (els.commentLabel) els.commentLabel.textContent = prompt;
      if (!wasOpen && focusOnReveal) els.commentInput.focus();
    }

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
      // Clearing a vote deletes the user's comment on the label server-side, so drop it from the list here too.
      if (undone) this.#dropOwnComment();
      this.#updateCommentRow(true);
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
   * Removes the current user's validator comment from the rendered list, mirroring the server-side delete that rides
   * along with clearing a vote. No-op when they hadn't commented.
   *
   * Re-finds the comment by identity rather than trusting the stored #myCommentIdx: the index is only valid for the
   * list as it stood when it was computed, and this runs a network round-trip later.
   */
  #dropOwnComment() {
    if (!this.#comments) return;
    const idx = this.#comments.findIndex((c) => this.#isOwnComment(c));
    if (idx < 0) return;
    this.#comments.splice(idx, 1);
    this.#myCommentIdx = -1;
    this.#renderComments();
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
    for (const btn of Object.values(els.panoOverlayButtons)) btn.disabled = blocked;
    for (const btn of Object.values(els.voteButtons)) btn.disabled = blocked;

    // Comment input and submit button.
    els.commentInput.disabled = blocked;
    els.commentInput.title = tip;
    els.commentButton.disabled = blocked;
    els.commentButton.title = tip;
    // A durable lock also hides the comment box (it only shows with a Disagree/Unsure vote); a load in flight
    // leaves it in place and just disables it, since it's about to be usable again.
    this.#updateCommentRow();
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
   */
  #renderVoteTooltips() {
    const els = this.#els;
    const lockTip = this.#lockReason();
    for (const action of Object.keys(els.voteButtons)) {
      const isVoted = !lockTip && this.#prevAction === action;
      let title;
      if (lockTip) {
        title = lockTip;
      } else if (isVoted) {
        // {{count}} is the *other* validators, so the user isn't double-counted in their own tooltip. The i18next
        // `_zero` key covers "nobody else" without a second key and a branch here — it resolves whenever count is 0,
        // even in languages (zh-TW) whose CLDR rules have no zero category, so those locales carry only _zero/_other.
        const others = Math.max(0, (this.#validationCounts[action] ?? 1) - 1);
        title = i18next.t(`labelmap:vote-tooltip-voted-${action.toLowerCase()}`, { count: others });
      } else {
        const count = this.#validationCounts[action] ?? 0;
        title = i18next.t(`labelmap:vote-tooltip-${action.toLowerCase()}`, { count });
      }
      // The AI's vote is folded into this option's count, so flag it where it applies. Sentences are appended in
      // order of usefulness, so what clicking *does* lands last rather than trailing off into a footnote.
      if (!lockTip && this.#aiValidation === action) title += ` ${i18next.t('labelmap:vote-tooltip-ai-included')}`;
      if (isVoted) title += ` ${i18next.t('labelmap:vote-tooltip-clear')}`;
      els.voteButtons[action].title = title;
      els.panoOverlayButtons[action].title = isVoted ? i18next.t('labelmap:vote-tooltip-clear') : '';
    }
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
      const state = this.#prevAction === action ? 'filled' : 'outline';
      const ai = this.#aiValidation === action ? '-ai' : '';
      img.src = `${this.#iconBase}${action.toLowerCase()}-${state}${ai}.svg`;
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
   * Keeps the meta strip on a single line (#4572, Mikey review). CSS makes the address the row's only shrinkable
   * cell, so it ellipsizes rather than letting the row wrap. When that clipping kicks in, hand the address more
   * room by dropping the least useful bits in order: first the clock time, then the "Details" word (the ⓘ and its
   * aria-label remain). Idempotent — it resets to the roomiest state before measuring, so it's safe to re-run on
   * every address change and on card resize.
   */
  #fitMetaRow() {
    const els = this.#els;
    if (!els.metaRow || !els.addressCell) return;
    els.metaRow.classList.remove('label-detail__meta-row--no-time', 'label-detail__meta-row--compact-details');
    if (els.addressCell.hidden) return; // No address competing for the row → nothing to trim.
    // +1 absorbs sub-pixel rounding so a flush-fitting address doesn't flap the classes on and off.
    const addressClipped = () => els.address.scrollWidth > els.address.clientWidth + 1;
    if (addressClipped()) els.metaRow.classList.add('label-detail__meta-row--no-time');
    if (addressClipped()) els.metaRow.classList.add('label-detail__meta-row--compact-details');
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

    if (els.severityTitle) els.severityTitle.textContent = i18next.t(`common:${titleKey}`);
    if (els.severity) els.severity.setAttribute('aria-label', i18next.t(`common:${titleKey}`));

    els.severity.querySelectorAll('.severity-button').forEach((face) => {
      const faceSev = Number(face.dataset.severity);
      const selected = faceSev === Number(severity);
      face.classList.toggle('is-selected', selected);
      face.querySelector('.severity-button__icon').src = util.misc.getSmileyIconPath(faceSev, labelType, selected);
      face.title = `${i18next.t(`common:${titleKey}`)}: ${i18next.t(`common:${levelKeys[faceSev]}`)}`;
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
      // Keep the avatar color stable across the replace-own-comment flow; new commenters take the next index.
      const commenter = this.#myCommentIdx >= 0 && this.#comments[this.#myCommentIdx]
        ? this.#comments[this.#myCommentIdx].commenter ?? 0
        : this.#comments.reduce((max, c) => Math.max(max, (c && c.commenter) ?? -1), -1) + 1;
      const newEntry = this.#admin
        ? { username: body.username, comment, time_created: timeCreated, commenter }
        : { comment, mine: true, time_created: timeCreated, commenter };
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
