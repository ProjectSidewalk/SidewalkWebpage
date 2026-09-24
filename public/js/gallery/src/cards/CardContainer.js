/**
 * Card Container module. This is responsible for managing the Card objects that are to be rendered.
 *
 * Construct instances via the `static async create()` factory, which fetches the first batch of labels and builds
 * the ExpandedView before resolving.
 */
class CardContainer {
  // The number of labels to grab from database on initial page load.
  static #initialLoad = 30;

  // Cards per page, by mode. Review-list mode has no sidebar, so its grid runs full width and falls to four, three
  // and two columns as the window narrows; twelve fills every one of those evenly, where nine leaves a ragged row
  // on four. The filtered grid sits beside the 275px sidebar and never reaches four columns, so it keeps nine.
  static #listCardsPerPage = 12;

  static #filteredCardsPerPage = 9;

  #uiCardContainer;
  #initialFilters;
  #panoViewerType;
  #viewerAccessToken;
  #currUsername;

  #currentLabelTypes;
  #currentPage = 1;
  #lastPage = false;
  #pageNumberDisplay = null;
  #expandedView;

  // Map Cards to a CardBucket containing Cards of their label type.
  #cardsByType = {
    CurbRamp: new CardBucket(),
    NoCurbRamp: new CardBucket(),
    Obstacle: new CardBucket(),
    SurfaceProblem: new CardBucket(),
    Other: new CardBucket(),
    Occlusion: new CardBucket(),
    NoSidewalk: new CardBucket(),
    Crosswalk: new CardBucket(),
    Signal: new CardBucket(),
  };

  // Keep track of labels we have loaded already as to not grab the same label from the backend.
  #loadedLabelIds = new Set();

  // Current labels being displayed of current type based off filters.
  #currentCards = new CardBucket();

  // Review-list mode (#5444): the page was opened with ?labelIds=, so these exact labels are shown in this order and
  // the filter sidebar isn't rendered at all. Nothing is fetched after the first query — the list is the whole set.
  /** @type {number[]} */
  #listLabelIds = [];
  #listMode = false;

  // Set when a page rendered before the expanded view existed, so #init can hand it that page once it does. The
  // opening query is fired before the view is built and can land first; see #notifyExpandedViewRendered().
  #expandedViewHooksDeferred = false;

  // Whether the page just rendered has any cards on it, so the deferred handover knows whether the paging control
  // belongs on screen.
  #pageHasCards = false;

  /**
   * @param {*} uiCardContainer - UI element tied with this CardContainer.
   * @param {Record<string, any>} initialFilters - Object containing initial set of filters in sidebar.
   * @param {typeof PanoViewer} panoViewerType - The type of pano viewer to initialize.
   * @param {string} viewerAccessToken - An access token that authorizes image requests for the pano viewer.
   * @param {?string} currUsername - The viewer's username when signed in to a real account, else null.
   */
  constructor(uiCardContainer, initialFilters, panoViewerType, viewerAccessToken, currUsername) {
    this.#uiCardContainer = uiCardContainer;
    this.#initialFilters = initialFilters;
    this.#panoViewerType = panoViewerType;
    this.#viewerAccessToken = viewerAccessToken;
    this.#currUsername = currUsername;

    this.#listLabelIds = initialFilters.labelIds ?? [];
    this.#listMode = this.#listLabelIds.length > 0;

    // The sidebar is built first and owns the filter state, so the initial selection comes from it, not the page.
    this.#currentLabelTypes = sg.cardFilter.getStatus().currentLabelTypes;
  }

  /**
   * Creates a CardContainer, fetches the first batch of labels, and builds the ExpandedView.
   * @param {*} uiCardContainer - UI element tied with this CardContainer.
   * @param {Record<string, any>} initialFilters - Object containing initial set of filters in sidebar.
   * @param {typeof PanoViewer} panoViewerType - The type of pano viewer to initialize.
   * @param {string} viewerAccessToken - An access token that authorizes image requests for the pano viewer.
   * @param {?string} currUsername - The viewer's username when signed in to a real account, else null.
   * @returns {Promise<CardContainer>}
   */
  static async create(uiCardContainer, initialFilters, panoViewerType, viewerAccessToken, currUsername) {
    const cardContainer
      = new CardContainer(uiCardContainer, initialFilters, panoViewerType, viewerAccessToken, currUsername);
    // ExpandedView reaches back through sg.cardContainer, and #init can get as far as opening a deep link before
    // create() returns, so the global is published here rather than waiting for Main to assign what create()
    // hands back. Main's own assignment then just re-sets the same object.
    sg.cardContainer = cardContainer;
    await cardContainer.#init();
    return cardContainer;
  }

  async #init() {
    const uiCardContainer = this.#uiCardContainer;
    const initialFilters = this.#initialFilters;

    // Bind click actions to the forward/backward paging buttons.
    if (uiCardContainer) {
      uiCardContainer.nextPage.bind({
        click: this.#handleNextPageClick,
      });
      uiCardContainer.prevPage.bind({
        click: this.#handlePrevPageClick,
      });
    }

    this.#pageNumberDisplay = document.createElement('h2');
    this.#pageNumberDisplay.innerText = '1';
    uiCardContainer.pageNumber.append(this.#pageNumberDisplay);
    sg.ui.pageControl.hide();
    sg.cardFilter.disable();
    sg.ui.cardContainer.prevPage.prop('disabled', true);

    // Grab first batch of labels to show.
    if (this.#listMode) {
      // The server already applied the only selection there is (the id list) and returned it in order, so the cards
      // go straight into the bucket — #collectCurrentCards would re-apply the sidebar's filters and regroup by type,
      // which is exactly the ordering the list exists to avoid.
      this.fetchLabels([], this.#listLabelIds.length, [], [], undefined, undefined, undefined, undefined,
        this.#listLabelIds, (newCards, unavailableLabelIds) => {
          // A failed request is not an empty list: rendering zero cards would show the filtered gallery's "No
          // matches, start exploring" copy and a "Showing 0 labels" count, telling a reviewer their queue is empty
          // when the server never answered. Say so instead, and leave the server-rendered count standing.
          if (newCards === null) {
            CardContainer.#showListError();
            sg.pageLoading.hide();
            // render() is never reached on this path, so the handover happens here instead: it releases the
            // filters and hands the view an empty page, where a ?labelId= still opens the label by id.
            this.#pageHasCards = false;
            this.#notifyExpandedViewRendered();
            return;
          }
          this.#currentCards = new CardBucket(newCards);
          this.#lastPage = this.#currentCards.getSize() <= this.#currentPage * this.getCardsPerPage();
          CardContainer.#renderListCount(this.#currentCards.getSize());
          CardContainer.#renderListTruncated();
          CardContainer.#renderUnavailableIds(unavailableLabelIds);
          this.render();
        });
    } else {
      const filters = this.#currentFilters();
      this.fetchLabels(
        filters.types,
        CardContainer.#initialLoad,
        filters.valOptions,
        Array.from(this.#loadedLabelIds),
        initialFilters.regionIds,
        filters.severities,
        filters.tagsByType,
        initialFilters.aiValidationOptions,
        undefined,
        () => {
          this.#currentCards = this.#collectCurrentCards(filters);
          this.#lastPage = this.#currentCards.getCards().length <= this.#currentPage * this.getCardsPerPage();
          this.render();
        },
      );
    }
    // Creates the ExpandedView object in the DOM element currently present.
    sg.panoStore = new PanoStore();
    this.#expandedView = await ExpandedView.create(
      sg.ui.expandedView.container, this.#panoViewerType, this.#viewerAccessToken, this.#currUsername,
    );
    // The opening query is fired above, before this await, so the request is in flight while the viewer builds —
    // and can finish first. A page rendered in that window has nobody to hand itself to, so this is where it goes.
    if (this.#expandedViewHooksDeferred) this.#notifyExpandedViewRendered();
    // Add the click event for opening the ExpandedView when a card is clicked.
    const cardClickSelector = '.static-gallery-image, .additional-count, .ai-icon-marker-card';
    sg.ui.cardContainer.holder.on('click', cardClickSelector, (event) => {
      sg.ui.expandedView.container.css('visibility', 'visible');
      // If the user clicks on the image body in the card, just use the provided id.
      // If they click the AI icon, use the image id from the same card.
      // Otherwise, the user will have clicked on an existing "+n" icon on the card, meaning we need to acquire
      // the cardId from the card-tags DOM element (as well as perform an additional prepend to put the ID in
      // the correct form).
      const clickedImage = event.target.classList.contains('static-gallery-image');
      let cardId;
      if (event.target.classList.contains('ai-icon-marker-card')) {
        const imageHolder = event.target.closest('.image-holder');
        const parentImage = imageHolder ? imageHolder.querySelector('.static-gallery-image') : null;
        cardId = parentImage ? parentImage.id : null;
      } else if (clickedImage) {
        cardId = event.target.id;
      } else {
        cardId = `label_id_${event.target.closest('.card-tags').id}`;
      }
      if (!cardId) return;
      // Sets/Updates the label being displayed in the expanded view.
      this.#expandedView.updateCardIndex(this.#findCardIndex(cardId));
    });

    // Tag pills are fitted in measured pixels at render time (TagDisplay), so a card-column width change
    // (rotation, the narrow-layout re-stack, a desktop resize) leaves stale fits; re-fit the visible cards.
    // TagDisplay rebuilds from scratch, so re-running is idempotent; the width guard plus trailing debounce
    // keep it quiet during continuous resizes and height-only changes (which ResizeObserver also reports).
    let lastTagFitWidth = null;
    let tagRefitTimer = null;
    new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      if (width === lastTagFitWidth) return;
      lastTagFitWidth = width;
      clearTimeout(tagRefitTimer);
      tagRefitTimer = setTimeout(() => this.getCurrentPageCards().forEach((card) => card.refitTags()), 150);
    }).observe(uiCardContainer.holder[0]);
  }

  /**
   * Returns the index of a card in the current CardBucket in use.
   *
   * @param {string} id - The id of the image Id to find.
   * @returns {number} The index of the matching card in the current CardBucket.
   */
  #findCardIndex(id) {
    return this.#currentCards.findCardIndexByImageId(id);
  }

  /**
   * Gets a card from the current CardBucket given an index.
   *
   * @param {number} index - The index of the card to find.
   * @returns {Card} The Card that has the matching index in the current CardBucket.
   */
  getCardByIndex(index) {
    return this.#currentCards.getCardByIndex(index);
  }

  #handleNextPageClick = (e) => {
    // This variable will be true if this is a "real" click. Otherwise, it will be false for .click() js code.
    const fromUser = typeof (e.clientX) !== 'undefined';

    // Main assigns sg.tracker after CardContainer.create() resolves, so a click that beats that is untracked
    // rather than fatal.
    sg.tracker?.push('NextPage', null, {
      from: this.#currentPage,
      to: this.#currentPage + 1,
    });

    if (fromUser) {
      sg.tracker?.push('NextPageClick', null, null);
    }

    this.#setPage(this.#currentPage + 1);
    sg.ui.cardContainer.prevPage.prop('disabled', false);
    this.updateCardsNewPage();
  };

  #handlePrevPageClick = (e) => {
    if (this.#currentPage > 1) {
      // This variable will be true if this is a "real" click. Otherwise, it will be false for .click() js code.
      const fromUser = typeof (e.clientX) !== 'undefined';

      sg.tracker?.push('PrevPage', null, {
        from: this.#currentPage,
        to: this.#currentPage - 1,
      });

      if (fromUser) {
        sg.tracker?.push('PrevPageClick', null, null);
      }

      $('#next-page').prop('disabled', false);
      this.#setPage(this.#currentPage - 1);
      this.updateCardsNewPage();
    }
  };

  #setPage(pageNumber) {
    if (pageNumber <= 1) {
      sg.ui.cardContainer.prevPage.prop('disabled', true);
    }
    this.#currentPage = pageNumber;
    this.#pageNumberDisplay.innerText = pageNumber;
  }

  /**
   * Grab n labels of the specified label types, severities, and tags.
   *
   * @param {string[]} labelTypes - Label type names specifying which types of labels to grab.
   * @param {*} n - Number of labels to grab.
   * @param {string[]} validationOptions - Validation options for labels: correct, incorrect, and/or unvalidated.
   * @param {*} loadedLabels - Label Ids of labels already grabbed.
   * @param {*} regionIds - Region IDs the labels to be grabbed can be from (Set to undefined if N/A).
   * @param {*} severities - Severities the labels to be grabbed can have (Set to undefined if N/A).
   * @param {object} tagsByLabelType - Tags each label type is narrowed to, keyed by type name.
   * @param {string[]|undefined} aiValidationOptions - AI validation options: correct, incorrect, and/or unvalidated.
   * @param {number[]|undefined} labelIds - A review list (#5444). When non-empty the server ignores every filter
   *      above and returns exactly these labels in this order.
   * @param {(cards: (Card[]|null), unavailableLabelIds: (number[]|undefined)) => void} [callback] - Called when
   *      labels arrive, given the new cards in the order the server returned them and, for a review list, the
   *      requested ids the server could not serve. Called with `null` when the request failed.
   */
  fetchLabels(
    labelTypes, n, validationOptions, loadedLabels, regionIds, severities, tagsByLabelType, aiValidationOptions,
    labelIds, callback,
  ) {
    const url = '/label/labels';
    const data = {
      label_types: labelTypes,
      n,
      validation_options: validationOptions,
      ...(regionIds !== undefined && { region_ids: regionIds }),
      ...(severities !== undefined && { severities }),
      ...(tagsByLabelType !== undefined && { tags_by_label_type: tagsByLabelType }),
      ...(aiValidationOptions !== undefined && { ai_validation_options: aiValidationOptions }),
      ...(labelIds !== undefined && labelIds.length > 0 && { label_ids: labelIds }),
      loaded_labels: loadedLabels,
    };
    $.ajax({
      async: true,
      contentType: 'application/json; charset=utf-8',
      url,
      method: 'POST',
      data: JSON.stringify(data),
      dataType: 'json',
      success: (response) => {
        if ('labelsOfType' in response) {
          const labels = response.labelsOfType;
          const newCards = [];
          for (let i = 0; i < labels.length; i++) {
            const labelProp = labels[i];
            const card = new Card(labelProp.label, labelProp.cropUrl, labelProp.gsvImageUrl, labelProp.cropMarker);
            this.push(card);
            newCards.push(card);
            this.#loadedLabelIds.add(card.getLabelId());
          }
          if (callback) callback(newCards, response.unavailableLabelIds);
        }
      },
      // Still run the callback on failure: it is what releases the sidebar's loading state, so skipping it leaves
      // the filters greyed and unusable for the rest of the page's life. `null` rather than an empty array, so a
      // caller that must not read a failure as "there were none" can tell the two apart.
      error: () => {
        if (callback) callback(null, undefined);
      },
    });
  }

  /**
   * Returns cards of current type.
   */
  getCards() {
    return this.#cardsByType;
  }

  /**
   * Returns cards of current type that are being rendered.
   */
  getCurrentCards() {
    return this.#currentCards;
  }

  /**
   * Push a card into the CardBucket of its label type.
   * @param {Card} card - Card to add.
   */
  push(card) {
    this.#cardsByType[card.getLabelType()].push(card);
  }

  /**
   * The filters the sidebar is currently reporting, in the shape the label query takes.
   * @returns {{types: string[], valOptions: string[], severities: (string[]|undefined),
   *      tagsByType: Record<string, string[]>}} The current filter state.
   */
  #currentFilters() {
    const types = sg.cardFilter.getStatus().currentLabelTypes;
    // Severity is left out entirely when nothing selected can carry one — otherwise the "N/A" toggle, which those
    // labels all fall under, would silently decide whether they show at all.
    const anyHasSeverity = types.some((type) => util.misc.labelTypeHasSeverity(type));
    return {
      types,
      valOptions: sg.cardFilter.getAppliedValidationOptions(),
      severities: anyHasSeverity ? sg.cardFilter.getAppliedSeverities() : undefined,
      tagsByType: sg.cardFilter.getAppliedTagsByType(),
    };
  }

  /**
   * Gathers the loaded cards that pass the current filters, from every selected label type.
   *
   * Cards accumulate across filter changes, so this re-applies the filters the server already applied when they were
   * fetched. Tags are per type — a curb ramp's "narrow" says nothing about an obstacle — so each type is filtered
   * against its own.
   *
   * @param {{types: string[], valOptions: string[], severities: (string[]|undefined),
   *      tagsByType: Record<string, string[]>}} filters - The filters from #currentFilters().
   * @returns {CardBucket} The cards to page through.
   */
  #collectCurrentCards({ types, valOptions, severities, tagsByType }) {
    const bucket = new CardBucket();
    for (const type of types) {
      const cards = this.#cardsByType[type].copy();
      cards.filterOnTags(type === 'Occlusion' ? undefined : tagsByType[type]); // Occlusion labels carry no tags.
      cards.filterOnSeverities(severities);
      cards.filterOnValidationOptions(valOptions);
      cards.getCards().forEach((card) => bucket.push(card));
    }
    return bucket;
  }

  /**
   * Updates Cards being shown when user moves to next/previous page.
   */
  updateCardsNewPage() {
    this.#refreshUI();

    // The list is fully loaded, so paging within it is pure arithmetic — never another query.
    if (this.#listMode) {
      this.#lastPage = this.#currentCards.getSize() <= this.#currentPage * this.getCardsPerPage();
      this.render();
      return;
    }

    const filters = this.#currentFilters();

    // With no label type selected there is nothing to ask the server for, and nothing to show.
    if (filters.types.length === 0) {
      this.#currentCards = new CardBucket();
      this.#lastPage = true;
      this.render();
      return;
    }

    this.#currentCards = this.#collectCurrentCards(filters);

    if (this.#currentCards.getSize() < this.getCardsPerPage() * this.#currentPage + 1) {
      // When we don't have enough cards of specific query to show on one page, see if more can be grabbed.
      this.fetchLabels(
        filters.types,
        this.getCardsPerPage() * 2,
        filters.valOptions,
        Array.from(this.#loadedLabelIds),
        this.#initialFilters.regionIds,
        filters.severities,
        filters.tagsByType,
        this.#initialFilters.aiValidationOptions,
        undefined,
        () => {
          this.#currentCards = this.#collectCurrentCards(filters);
          this.#lastPage = this.#currentCards.getCards().length <= this.#currentPage * this.getCardsPerPage();
          this.render();
        },
      );
    } else {
      this.#lastPage = false;
      this.render();
    }
  }

  /**
   * When a filter is updated; update which Cards are shown.
   */
  updateCardsByFilter() {
    // List mode renders no filter controls, so nothing should reach this; guard anyway, since applying the sidebar's
    // empty state would silently throw the list away.
    if (this.#listMode) return;

    const newLabelTypes = sg.cardFilter.getStatus().currentLabelTypes;
    // Only need to refresh UI if the label types changed, since the tags are swapped out.
    if (newLabelTypes.join() !== this.#currentLabelTypes.join()) {
      this.#currentLabelTypes = newLabelTypes;
      this.#refreshUI();
    }

    this.#setPage(1);
    this.updateCardsNewPage();
  }

  /**
   * Renders current cards.
   */
  render() {
    const uiCardContainer = this.#uiCardContainer;
    // TODO: should we try to just empty in render method? Or assume it's was emptied in a method utilizing render?
    this.#clearCardContainer(uiCardContainer.holder);

    const imagesToLoad = this.getCurrentPageCards();
    const imagePromises = imagesToLoad.map((img) => img.loadImage());
    this.#pageHasCards = imagesToLoad.length > 0;

    if (imagesToLoad.length > 0) {
      if (this.#lastPage) {
        sg.ui.cardContainer.nextPage.prop('disabled', true);
      } else {
        sg.ui.cardContainer.nextPage.prop('disabled', false);
      }

      // We wait for all the promises from grabbing pano images to resolve before showing cards.
      Promise.all(imagePromises).then(() => {
        imagesToLoad.forEach((card) => {
          card.render(uiCardContainer.holder);
        });
        sg.pageLoading.hide();
        this.#notifyExpandedViewRendered();
      });
    } else if (this.#listMode) {
      // "No matches. Start exploring to contribute more data!" answers a filtered search that found nothing; it
      // answers nothing about a list whose ids this city doesn't have, and with no sidebar to sit beside it, it is
      // absolutely positioned straight over the strip that does explain it.
      sg.pageLoading.hide();
      this.#notifyExpandedViewRendered();
    } else {
      // TODO: figure out how to better do the toggling of this element.
      sg.labelsNotFound.show();
      sg.pageLoading.hide();
      this.#notifyExpandedViewRendered();
    }
  }

  /**
   * Hands a freshly rendered page over: the controls that act on it, then the expanded view's pending cross-page
   * navigation and any `?labelId=` deep link.
   *
   * This is the one place a page becomes live, and it runs exactly once per render, whichever of the opening query
   * and the viewer build finishes second. Both halves need the view to exist. The paging handlers close the
   * expanded view and push a tracker event, and in the query-wins ordering neither the view nor `sg.tracker` is up
   * yet, so the controls stay hidden and the filters disabled until the handover can happen. And `restoreFromUrl()`
   * consumes the pending deep-link id on entry, so a render that skips it leaves the id set for a later render to
   * spring open — which is why every branch of `render()` calls this, empty pages included.
   */
  #notifyExpandedViewRendered() {
    if (!this.#expandedView) {
      this.#expandedViewHooksDeferred = true;
      return;
    }
    this.#expandedViewHooksDeferred = false;
    if (this.#pageHasCards) sg.ui.pageControl.show();
    sg.cardFilter.enable();
    this.#expandedView.onPageCardsRendered();
    this.#expandedView.restoreFromUrl();
  }

  /**
   * Refreshes the UI after each query made by user.
   */
  #refreshUI() {
    // Close expanded views (if open) and empty cards from current page. The view is absent until the opening query
    // and the viewer build have both finished (see #notifyExpandedViewRendered).
    this.#expandedView?.closeExpandedView();
    this.#clearCardContainer(this.#uiCardContainer.holder);

    // Place user back at top of page.
    window.scrollTo(0, 0);

    // Indicate query is sent, loading appropriate cards.
    sg.pageLoading.show();

    // Disable interactable UI elements while query loads.
    sg.cardFilter.disable();
    sg.labelsNotFound.hide();
    sg.ui.pageControl.hide();
  }

  /**
   * Flush all Cards currently being rendered.
   */
  clearCurrentCards() {
    this.#currentCards = new CardBucket();
  }

  /**
   * Clear Cards from UI.
   * @param {*} cardContainer - UI element to clear Cards from.
   */
  #clearCardContainer(cardContainer) {
    cardContainer.children().each((i, el) => {
      $(el).detach();
    });
  }

  getCurrentPage() {
    return this.#currentPage;
  }

  /**
   * Get the cards that form the current page.
   * @returns {Card[]} Array of cards from the current page.
   */
  getCurrentPageCards() {
    let idx = (this.#currentPage - 1) * this.getCardsPerPage();
    const cardBucket = this.#currentCards.getCards();

    const currentPageCards = [];
    while (idx < this.#currentPage * this.getCardsPerPage() && idx < cardBucket.length) {
      currentPageCards.push(cardBucket[idx]);
      idx++;
    }

    return currentPageCards;
  }

  /**
   * Returns whether the current page is the last page of queried cards.
   * @returns {boolean} True if current page is last page of cards that satisfies applied query, false otherwise.
   */
  isLastPage() {
    return this.#lastPage;
  }

  getExpandedView() {
    return this.#expandedView;
  }

  /**
   * How many cards a page holds, which depends on the mode and so has to be asked for rather than assumed.
   *
   * The single source for every consumer — this container's page math, and ExpandedView's paging and position
   * indicator. Two copies of this number disagreeing is a review queue that skips or repeats a label at each page
   * boundary, which looks like nothing at all until someone audits the results.
   *
   * @returns {number} Cards per page in the mode this container is in.
   */
  getCardsPerPage() {
    return this.#listMode ? CardContainer.#listCardsPerPage : CardContainer.#filteredCardsPerPage;
  }

  /** @returns {boolean} Whether the page is showing an explicit `?labelIds=` review list (#5444). */
  isListMode() {
    return this.#listMode;
  }

  /** @returns {number} How many labels the review list actually holds; 0 when not in list mode. */
  getListSize() {
    return this.#listMode ? this.#currentCards.getSize() : 0;
  }

  /**
   * Opens a review list's card for a label by its position in the list, paging to it first if it's on another page.
   *
   * This is what a `?labelId=` deep link uses in list mode: opening the label by id instead would leave the expanded
   * view with no reference card, so prev/next would restart from the top of the list and the position indicator
   * would have nothing to count from.
   *
   * @param {number} labelId - The label to open.
   * @returns {boolean} True if the list holds that label and it is being opened.
   */
  jumpToLabel(labelId) {
    if (!this.#listMode) return false;
    const index = this.#currentCards.getCards().findIndex((card) => card.getLabelId() === labelId);
    if (index < 0) return false;

    this.#expandedView.pendingCardIndex = index;
    const page = Math.floor(index / this.getCardsPerPage()) + 1;
    if (page === this.#currentPage) {
      // This page's cards are already rendered (render() is what calls restoreFromUrl), so open it right away.
      this.#expandedView.onPageCardsRendered();
    } else {
      this.#setPage(page);
      this.updateCardsNewPage();
    }
    return true;
  }

  /**
   * Writes the review list's size into the strip, replacing the count the page was rendered with.
   *
   * The server-rendered number is how many ids were *asked for*; this is how many came back. A list that came back
   * whole just says how many labels there are; a short one says both numbers, so the gap is on screen rather than
   * only inside the unavailable disclosure.
   *
   * @param {number} shown - How many labels the list is showing.
   */
  static #renderListCount(shown) {
    const countEl = document.getElementById('gallery-list-count');
    if (!countEl) return;
    const requested = Number(countEl.dataset.requested);
    countEl.textContent = shown < requested
      ? i18next.t('gallery:list-count-partial', { shown, count: requested })
      : i18next.t('gallery:list-count', { count: shown });
  }

  /**
   * Restates the truncation notice the page was rendered with, in the language the rest of the panel is now in.
   *
   * Both numbers come off the element the server wrote them onto — how many ids were dropped, and the cap that
   * dropped them — so the limit is never a frontend literal. A list that fits the cap renders no such element.
   * (The strip's other lines are static text and localize themselves through `data-i18n`.)
   */
  static #renderListTruncated() {
    const truncatedEl = document.getElementById('gallery-list-truncated');
    if (!truncatedEl) return;
    const dropped = Number(truncatedEl.dataset.dropped);
    const max = Number(truncatedEl.dataset.max);
    if (dropped > 0) truncatedEl.textContent = i18next.t('gallery:list-truncated', { count: dropped, max });
  }

  /** Tells the reviewer the list could not be loaded, rather than letting a failed request read as an empty queue. */
  static #showListError() {
    const errorEl = document.getElementById('gallery-list-error');
    if (errorEl) errorEl.hidden = false;
  }

  /**
   * Fills the strip's unavailable disclosure, so a short list reads as explained rather than broken.
   *
   * Behind a disclosure rather than inline: the usual case is that every id came back, and a reviewer who needs to
   * chase the ones that didn't is the only one who wants a few hundred numbers on screen.
   *
   * @param {number[]|undefined} labelIds - The unavailable ids, in the order they were requested.
   */
  static #renderUnavailableIds(labelIds) {
    const disclosure = document.getElementById('gallery-list-unavailable');
    if (!disclosure) return;
    const list = disclosure.querySelector('.gallery-list-bar__ids');
    const summary = disclosure.querySelector('summary');
    if (!list || !summary || !labelIds || labelIds.length === 0) {
      disclosure.hidden = true;
      return;
    }
    summary.textContent = i18next.t('gallery:list-unavailable', { count: labelIds.length });
    list.replaceChildren(...labelIds.map((labelId) => {
      const item = document.createElement('li');
      item.textContent = `#${labelId}`;
      return item;
    }));
    disclosure.hidden = false;
  }
}
