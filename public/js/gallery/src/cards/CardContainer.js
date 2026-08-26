/**
 * Card Container module. This is responsible for managing the Card objects that are to be rendered.
 *
 * Construct instances via the `static async create()` factory, which fetches the first batch of labels and builds
 * the ExpandedView before resolving.
 */
class CardContainer {
  // The number of labels to grab from database on initial page load.
  static #initialLoad = 30;

  static #cardsPerPage = 9;

  // Map label type to id.
  static #labelTypeIds = {
    CurbRamp: 1,
    NoCurbRamp: 2,
    Obstacle: 3,
    SurfaceProblem: 4,
    Other: 5,
    Occlusion: 6,
    NoSidewalk: 7,
    Crosswalk: 9,
    Signal: 10,
  };

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

  /**
   * @param {*} uiCardContainer UI element tied with this CardContainer.
   * @param {object} initialFilters Object containing initial set of filters in sidebar.
   * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize.
   * @param {string} viewerAccessToken An access token that authorizes image requests for the pano viewer.
   * @param {?string} currUsername The viewer's username when signed in to a real account, else null.
   */
  constructor(uiCardContainer, initialFilters, panoViewerType, viewerAccessToken, currUsername) {
    this.#uiCardContainer = uiCardContainer;
    this.#initialFilters = initialFilters;
    this.#panoViewerType = panoViewerType;
    this.#viewerAccessToken = viewerAccessToken;
    this.#currUsername = currUsername;

    // The sidebar is built first and owns the filter state, so the initial selection comes from it, not the page.
    this.#currentLabelTypes = sg.cardFilter.getStatus().currentLabelTypes;
  }

  /**
   * Creates a CardContainer, fetches the first batch of labels, and builds the ExpandedView.
   * @param {*} uiCardContainer UI element tied with this CardContainer.
   * @param {object} initialFilters Object containing initial set of filters in sidebar.
   * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize.
   * @param {string} viewerAccessToken An access token that authorizes image requests for the pano viewer.
   * @param {?string} currUsername The viewer's username when signed in to a real account, else null.
   * @returns {Promise<CardContainer>}
   */
  static async create(uiCardContainer, initialFilters, panoViewerType, viewerAccessToken, currUsername) {
    const cardContainer
      = new CardContainer(uiCardContainer, initialFilters, panoViewerType, viewerAccessToken, currUsername);
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
    const filters = this.#currentFilters();
    this.fetchLabels(
      filters.typeIds,
      CardContainer.#initialLoad,
      filters.valOptions,
      Array.from(this.#loadedLabelIds),
      initialFilters.neighborhoods,
      filters.severities,
      filters.tagsByType,
      initialFilters.aiValidationOptions,
      () => {
        this.#currentCards = this.#collectCurrentCards(filters);
        this.#lastPage = this.#currentCards.getCards().length <= this.#currentPage * CardContainer.#cardsPerPage;
        this.render();
      },
    );
    // Creates the ExpandedView object in the DOM element currently present.
    sg.panoStore = new PanoStore();
    this.#expandedView = await ExpandedView.create(
      sg.ui.expandedView.container, this.#panoViewerType, this.#viewerAccessToken, this.#currUsername,
    );
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
   * @param {string} id The id of the image Id to find.
   * @returns {number} The index of the matching card in the current CardBucket.
   */
  #findCardIndex(id) {
    return this.#currentCards.findCardIndexByImageId(id);
  }

  /**
   * Gets a card from the current CardBucket given an index.
   *
   * @param {number} index The index of the card to find.
   * @returns {Card} The Card that has the matching index in the current CardBucket.
   */
  getCardByIndex(index) {
    return this.#currentCards.getCardByIndex(index);
  }

  #handleNextPageClick = (e) => {
    // This variable will be true if this is a "real" click. Otherwise, it will be false for .click() js code.
    const fromUser = typeof (e.clientX) !== 'undefined';

    sg.tracker.push('NextPage', null, {
      from: this.#currentPage,
      to: this.#currentPage + 1,
    });

    if (fromUser) {
      sg.tracker.push('NextPageClick', null, null);
    }

    this.#setPage(this.#currentPage + 1);
    sg.ui.cardContainer.prevPage.prop('disabled', false);
    this.updateCardsNewPage();
  };

  #handlePrevPageClick = (e) => {
    if (this.#currentPage > 1) {
      // This variable will be true if this is a "real" click. Otherwise, it will be false for .click() js code.
      const fromUser = typeof (e.clientX) !== 'undefined';

      sg.tracker.push('PrevPage', null, {
        from: this.#currentPage,
        to: this.#currentPage - 1,
      });

      if (fromUser) {
        sg.tracker.push('PrevPageClick', null, null);
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
   * @param {number[]} labelTypeIds Label type ids specifying which types of labels to grab.
   * @param {*} n Number of labels to grab.
   * @param validationOptions List of validation options for fetched labels: correct, incorrect, and/or unvalidated.
   * @param {*} loadedLabels Label Ids of labels already grabbed.
   * @param {*} neighborhoods Region IDs the labels to be grabbed can be from (Set to undefined if N/A).
   * @param {*} severities Severities the labels to be grabbed can have (Set to undefined if N/A).
   * @param {object} tagsByLabelType Tags each label type is narrowed to, keyed by type name.
   * @param aiValidationOptions List of AI validation options for labels: correct, incorrect, and/or unvalidated.
   * @param {*} callback Function to be called when labels arrive.
   */
  fetchLabels(
    labelTypeIds, n, validationOptions, loadedLabels, neighborhoods, severities, tagsByLabelType, aiValidationOptions,
    callback,
  ) {
    const url = '/label/labels';
    const data = {
      label_type_ids: labelTypeIds,
      n,
      validation_options: validationOptions,
      ...(neighborhoods !== undefined && { neighborhoods }),
      ...(severities !== undefined && { severities }),
      ...(tagsByLabelType !== undefined && { tags_by_label_type: tagsByLabelType }),
      ...(aiValidationOptions !== undefined && { ai_validation_options: aiValidationOptions }),
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
          for (let i = 0; i < labels.length; i++) {
            const labelProp = labels[i];
            const card = new Card(labelProp.label, labelProp.cropUrl, labelProp.gsvImageUrl);
            this.push(card);
            this.#loadedLabelIds.add(card.getLabelId());
          }
          if (callback) callback();
        }
      },
      // Still run the callback on failure: it is what releases the sidebar's loading state, so skipping it leaves
      // the filters greyed and unusable for the rest of the page's life.
      error: () => {
        if (callback) callback();
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
   * @param card Card to add.
   */
  push(card) {
    this.#cardsByType[card.getLabelType()].push(card);
  }

  /**
   * The filters the sidebar is currently reporting, in the shape the label query takes.
   * @returns {{types: string[], typeIds: number[], valOptions: string[], severities: (string[]|undefined),
   *      tagsByType: object}} The current filter state.
   */
  #currentFilters() {
    const types = sg.cardFilter.getStatus().currentLabelTypes;
    // Severity is left out entirely when nothing selected can carry one — otherwise the "N/A" toggle, which those
    // labels all fall under, would silently decide whether they show at all.
    const anyHasSeverity = types.some((type) => util.misc.labelTypeHasSeverity(type));
    return {
      types,
      typeIds: types.map((type) => CardContainer.#labelTypeIds[type]),
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
   * @param {object} filters The filters from #currentFilters().
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

    const filters = this.#currentFilters();

    // With no label type selected there is nothing to ask the server for, and nothing to show.
    if (filters.types.length === 0) {
      this.#currentCards = new CardBucket();
      this.#lastPage = true;
      this.render();
      return;
    }

    this.#currentCards = this.#collectCurrentCards(filters);

    if (this.#currentCards.getSize() < CardContainer.#cardsPerPage * this.#currentPage + 1) {
      // When we don't have enough cards of specific query to show on one page, see if more can be grabbed.
      this.fetchLabels(
        filters.typeIds,
        CardContainer.#cardsPerPage * 2,
        filters.valOptions,
        Array.from(this.#loadedLabelIds),
        this.#initialFilters.neighborhoods,
        filters.severities,
        filters.tagsByType,
        this.#initialFilters.aiValidationOptions,
        () => {
          this.#currentCards = this.#collectCurrentCards(filters);
          this.#lastPage = this.#currentCards.getCards().length <= this.#currentPage * CardContainer.#cardsPerPage;
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
        sg.ui.pageControl.show();
        sg.pageLoading.hide();
        sg.cardFilter.enable();
        if (this.#expandedView) {
          this.#expandedView.onPageCardsRendered();
          this.#expandedView.restoreFromUrl();
        }
      });
    } else {
      // TODO: figure out how to better do the toggling of this element.
      sg.labelsNotFound.show();
      sg.pageLoading.hide();
      sg.cardFilter.enable();
    }
  }

  /**
   * Refreshes the UI after each query made by user.
   */
  #refreshUI() {
    // Close expanded views (if open) and empty cards from current page.
    this.#expandedView.closeExpandedView();
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
   * @param {*} cardContainer UI element to clear Cards from.
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
   * @returns Array of cards from the current page.
   */
  getCurrentPageCards() {
    let idx = (this.#currentPage - 1) * CardContainer.#cardsPerPage;
    const cardBucket = this.#currentCards.getCards();

    const currentPageCards = [];
    while (idx < this.#currentPage * CardContainer.#cardsPerPage && idx < cardBucket.length) {
      currentPageCards.push(cardBucket[idx]);
      idx++;
    }

    return currentPageCards;
  }

  /**
   * Returns whether the current page is the last page of queried cards.
   * @returns True if current page is last page of cards that satisfies applied query, false otherwise.
   */
  isLastPage() {
    return this.#lastPage;
  }

  getExpandedView() {
    return this.#expandedView;
  }
}
