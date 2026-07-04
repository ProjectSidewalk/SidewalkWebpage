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
    Assorted: null,
  };

  #uiCardContainer;
  #initialFilters;
  #panoViewerType;
  #viewerAccessToken;

  #currentLabelType;
  #currentPage = 1;
  #lastPage = false;
  #pageNumberDisplay = null;
  #expandedView;

  // Map Cards to a CardBucket containing Cards of their label type.
  #cardsByType = {
    Assorted: new CardBucket(),
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
     */
  constructor(uiCardContainer, initialFilters, panoViewerType, viewerAccessToken) {
    this.#uiCardContainer = uiCardContainer;
    this.#initialFilters = initialFilters;
    this.#panoViewerType = panoViewerType;
    this.#viewerAccessToken = viewerAccessToken;

    this.#currentLabelType = initialFilters.labelType;
    sg.neighborhoodIds = initialFilters.neighborhoods; // TODO remove when we add a UI for filtering neighborhoods.
    sg.aiValidationOptions = initialFilters.aiValidationOptions; // TODO remove when we add UI for filtering on AI vals.
  }

  /**
     * Creates a CardContainer, fetches the first batch of labels, and builds the ExpandedView.
     * @param {*} uiCardContainer UI element tied with this CardContainer.
     * @param {object} initialFilters Object containing initial set of filters in sidebar.
     * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize.
     * @param {string} viewerAccessToken An access token that authorizes image requests for the pano viewer.
     * @returns {Promise<CardContainer>}
     */
  static async create(uiCardContainer, initialFilters, panoViewerType, viewerAccessToken) {
    const cardContainer = new CardContainer(uiCardContainer, initialFilters, panoViewerType, viewerAccessToken);
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
    this.#cardsByType[this.#currentLabelType] = new CardBucket();

    // Grab first batch of labels to show.
    this.fetchLabels(CardContainer.#labelTypeIds[this.#currentLabelType], CardContainer.#initialLoad, initialFilters.validationOptions, Array.from(this.#loadedLabelIds), initialFilters.neighborhoods, initialFilters.severities, initialFilters.tags, initialFilters.aiValidationOptions, () => {
      this.#currentCards = this.#cardsByType[this.#currentLabelType].copy();
      this.#lastPage = this.#currentCards.getCards().length <= this.#currentPage * CardContainer.#cardsPerPage;
      this.render();
    });
    // Creates the ExpandedView object in the DOM element currently present.
    sg.panoStore = new PanoStore();
    this.#expandedView = await ExpandedView.create(sg.ui.expandedView.container, this.#panoViewerType, this.#viewerAccessToken);
    // Add the click event for opening the ExpandedView when a card is clicked.
    sg.ui.cardContainer.holder.on('click', '.static-gallery-image, .additional-count, .ai-icon-marker-card', (event) => {
      sg.ui.expandedView.container.css('position', 'relative');
      sg.ui.expandedView.container.css('visibility', 'visible');
      $('.grid-container').css('grid-template-columns', '1fr 5fr');
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
     * Grab n assorted labels of specified label type, severities, and tags.
     *
     * @param {*} labelTypeId Label type id specifying labels of what label type to grab.
     * @param {*} n Number of labels to grab.
     * @param validationOptions List of validation options for fetched labels: correct, incorrect, and/or unvalidated.
     * @param {*} loadedLabels Label Ids of labels already grabbed.
     * @param {*} neighborhoods Region IDs the labels to be grabbed can be from (Set to undefined if N/A).
     * @param {*} severities Severities the labels to be grabbed can have (Set to undefined if N/A).
     * @param {*} tags Tags the labels to be grabbed can have (Set to undefined if N/A).
     * @param aiValidationOptions List of AI validation options for labels: correct, incorrect, and/or unvalidated.
     * @param {*} callback Function to be called when labels arrive.
     */
  fetchLabels(labelTypeId, n, validationOptions, loadedLabels, neighborhoods, severities, tags, aiValidationOptions, callback) {
    const url = '/label/labels';
    const data = {
      label_type_id: labelTypeId,
      n,
      validation_options: validationOptions,
      ...(neighborhoods !== undefined && { neighborhoods }),
      ...(severities !== undefined && { severities }),
      ...(tags !== undefined && { tags }),
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
     * Push a card into corresponding CardBucket in cardsOfType as well as the "Assorted" bucket.
     * @param card Card to add.
     */
  push(card) {
    this.#cardsByType.Assorted.push(card);
    this.#cardsByType[card.getLabelType()].push(card);
  }

  /**
     * Updates Cards being shown when user moves to next/previous page.
     */
  updateCardsNewPage() {
    this.#refreshUI();

    let appliedTags = sg.cardFilter.getAppliedTagNames();
    let appliedSeverities = sg.cardFilter.getAppliedSeverities();
    const appliedValOptions = sg.cardFilter.getAppliedValidationOptions();

    // NoSidewalk, Occlusion, and Signal don't have severity, Occlusion does not have tags.
    if (!util.misc.labelTypeHasSeverity(this.#currentLabelType)) appliedSeverities = undefined;
    if ('Occlusion' === this.#currentLabelType) appliedTags = undefined;

    this.#currentCards = this.#cardsByType[this.#currentLabelType].copy();
    this.#currentCards.filterOnTags(appliedTags);
    this.#currentCards.filterOnSeverities(appliedSeverities);
    this.#currentCards.filterOnValidationOptions(appliedValOptions);

    if (this.#currentCards.getSize() < CardContainer.#cardsPerPage * this.#currentPage + 1) {
      // When we don't have enough cards of specific query to show on one page, see if more can be grabbed.
      this.fetchLabels(CardContainer.#labelTypeIds[this.#currentLabelType], CardContainer.#cardsPerPage * 2, appliedValOptions, Array.from(this.#loadedLabelIds), this.#initialFilters.neighborhoods, appliedSeverities, appliedTags, this.#initialFilters.aiValidationOptions, () => {
        this.#currentCards = this.#cardsByType[this.#currentLabelType].copy();
        this.#currentCards.filterOnTags(appliedTags);
        this.#currentCards.filterOnSeverities(appliedSeverities);
        this.#currentCards.filterOnValidationOptions(appliedValOptions);
        this.#lastPage = this.#currentCards.getCards().length <= this.#currentPage * CardContainer.#cardsPerPage;
        this.render();
      });
    } else {
      this.#lastPage = false;
      this.render();
    }
  }

  /**
     * When a filter is updated; update which Cards are shown.
     */
  updateCardsByFilter() {
    // Only need to refresh UI if label type changed, since the tags are swapped out.
    const newLabelType = sg.cardFilter.getStatus().currentLabelType;
    if (this.#currentLabelType !== newLabelType) {
      this.#currentLabelType = newLabelType;
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
        sg.ui.cardFilter.wrapper.css('position', 'fixed');
        sg.ui.cardFilter.wrapper.css('top', '');
        uiCardContainer.holder.css('margin-left', sg.ui.cardFilter.wrapper.css('width'));
        sg.scrollStatus.stickySidebar = true;
        sg.cardFilter.enable();
        this.#expandedView && this.#expandedView.onPageCardsRendered();
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
    // TODO: To help the loading icon show, we make the sidebar positioned relatively while we are loading on the page.
    // Otherwise, keep it fixed. This is hacky and needs a better fix.

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

    // Since we have returned to top of page,
    sg.ui.cardFilter.wrapper.css('position', 'relative');
  }

  /**
     * Flush all Cards currently being rendered.
     */
  clearCurrentCards() {
    this.#currentCards = new CardBucket();
  }

  /**
     * Flush all Cards from cardsOfType.
     */
  clearCards() {
    for (const labelType of this.#cardsByType) {
      this.#cardsByType[labelType] = null;
    }
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
