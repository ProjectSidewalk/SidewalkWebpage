/**
 * Gallery ExpandedView — inline wrapper around the shared LabelDetail controller.
 *
 * Hosts LabelDetail inside a `.label-detail.label-detail--inline` container. Manages open/close visibility, prev/next
 * paging, thumbnail highlighting, card transparency, and syncing validation results back onto the small cards.
 *
 * Construct instances via the `static async create()` factory, which initializes LabelDetail before resolving.
 */
class ExpandedView {
    static #cardsPerPage = 9;
    static #unselectedCardClassName = 'expanded-view-background-card';

    #uiModal;
    #root;
    #panoViewerType;
    #viewerAccessToken;

    /**
     * @param {jQuery} uiModal The `.gallery-expanded-view` container element.
     * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize.
     * @param {string} viewerAccessToken An access token that authorizes image requests for the pano viewer.
     */
    constructor(uiModal, panoViewerType, viewerAccessToken) {
        this.#uiModal = uiModal;
        this.#root = uiModal[0]; // Unwrap jQuery to get the DOM element for LabelDetail.
        this.#panoViewerType = panoViewerType;
        this.#viewerAccessToken = viewerAccessToken;
    }

    /**
     * Creates an ExpandedView and initializes its LabelDetail controller.
     * @param {jQuery} uiModal The `.gallery-expanded-view` container element.
     * @param {typeof PanoViewer} panoViewerType The type of pano viewer to initialize.
     * @param {string} viewerAccessToken An access token that authorizes image requests for the pano viewer.
     * @returns {Promise<ExpandedView>}
     */
    static async create(uiModal, panoViewerType, viewerAccessToken) {
        const expandedView = new ExpandedView(uiModal, panoViewerType, viewerAccessToken);
        await expandedView.#init();
        return expandedView;
    }

    /**
     * Initialization: instantiate LabelDetail inside the host root, then wire up close and paging buttons.
     */
    async #init() {
        const root = this.#root;
        this.open = false;
        this.cardIndex = -1;
        this.refCard = null;
        this.pendingCardIndex = undefined; // Set by nextLabel/previousLabel for cross-page navigation.

        // Initialize the shared LabelDetail controller inside our inline host.
        this.labelDetail = await LabelDetail.create(root, {
            admin: false,
            viewerType: this.#panoViewerType,
            viewerAccessToken: this.#viewerAccessToken,
            currUsername: null,
            onVote: this.#handleVote,
            panoOverlaySource: 'GalleryExpandedImage',
            voteColumnSource: 'GalleryExpandedThumbs'
        });

        // Expose panoManager for Keyboard.js zoom shortcuts.
        this.panoManager = this.labelDetail.panoManager;

        // Wire paging buttons.
        this.leftArrow = root.querySelector('.label-detail__paging--prev');
        this.rightArrow = root.querySelector('.label-detail__paging--next');
        this.leftArrowDisabled = false;
        this.rightArrowDisabled = false;
        if (this.leftArrow) this.leftArrow.addEventListener('click', () => this.previousLabel(false));
        if (this.rightArrow) this.rightArrow.addEventListener('click', () => this.nextLabel(false));

        // Wire close button.
        const closeBtn = root.querySelector('[data-action="close-label-detail"]');
        if (closeBtn) closeBtn.addEventListener('click', () => this.closeExpandedViewAndRemoveCardTransparency());

        this.#attachCursorHandlers();
    }

    /**
     * Converts a Gallery Card's properties into the meta object shape that LabelDetail.showLabel() expects.
     * @param {Card} card
     * @returns {object} A meta object compatible with LabelDetail._handleData().
     */
    #cardToMeta(card) {
        const p = card.getProperties();
        return {
            label_id: p.label_id,
            label_type: p.label_type,
            pano_id: p.pano_id,
            camera_lat: p.camera_lat,
            camera_lng: p.camera_lng,
            // Moment objects → raw date strings so LabelDetail can reparse them uniformly.
            image_capture_date: p.image_capture_date.toISOString(),
            timestamp: p.label_timestamp.toISOString(),
            heading: p.heading,
            pitch: p.pitch,
            zoom: p.zoom,
            canvas_x: p.original_canvas_x,
            canvas_y: p.original_canvas_y,
            severity: p.severity,
            description: p.description,
            street_edge_id: p.street_edge_id,
            region_id: p.region_id,
            num_agree: p.val_counts.Agree,
            num_disagree: p.val_counts.Disagree,
            num_unsure: p.val_counts.Unsure,
            user_validation: p.user_validation,
            ai_validation: p.ai_validation,
            tags: p.tags,
            ai_generated: p.ai_generated,
            crop_url: card.getCropUrl(),
            backup_image: card.getBackupImageData(),
            from_current_user: p.from_current_user,
            expired: p.expired,
            comments: p.comments
        };
    }

    /**
     * Called by LabelDetail after a successful validation POST. Syncs the new vote back onto the small card.
     * @param {'Agree'|'Disagree'|'Unsure'} action
     */
    #handleVote = (action) => {
        if (this.refCard) {
            this.refCard.updateUserValidation(action);
        }
    };

    /**
     * Opens the expanded view for the current refCard by passing the card data to LabelDetail.
     */
    #openExpandedView() {
        // Clear the close-guard so the in-flight pano load is allowed to show once this card's load completes.
        const panoEl = this.#root.querySelector('.label-detail__pano');
        if (panoEl) delete panoEl.dataset.closedDuringLoad;

        const meta = this.#cardToMeta(this.refCard);
        this.labelDetail.showLabel(meta, 'Gallery');

        // Highlight selected card thumbnail.
        this.#highlightThumbnail(document.getElementById('gallery_card_' + this.refCard.getLabelId()));
        this.open = true;
    }

    /**
     * Performs the actions to close the expanded view.
     * NOTE: does not remove card transparency. For that, use closeExpandedViewAndRemoveCardTransparency().
     */
    closeExpandedView() {
        $('.grid-container').css('grid-template-columns', 'none');
        this.#uiModal.css('position', 'absolute');
        this.#uiModal.css('visibility', 'hidden');
        // Clear the inline visibility set by PopupPanoManager.setPano() so the parent's visibility:hidden cascades.
        // Also set a data flag so that if a pano load is still in-flight, it won't reveal itself when it finishes.
        const panoEl = this.#root.querySelector('.label-detail__pano');
        if (panoEl) {
            panoEl.style.visibility = '';
            panoEl.dataset.closedDuringLoad = 'true';
        }
        this.open = false;
    }

    /**
     * Removes transparency from the current page of cards.
     */
    #removeCardTransparency() {
        const currentPageCards = sg.cardContainer.getCurrentPageCards();
        for (const card of currentPageCards) {
            const cardDomEl = document.getElementById('gallery_card_' + card.getLabelId());
            if (cardDomEl && cardDomEl.classList.contains(ExpandedView.#unselectedCardClassName)) {
                cardDomEl.classList.remove(ExpandedView.#unselectedCardClassName);
            }
        }
    }

    /**
     * Closes expanded view, removes transparency from cards, and scrolls the reference card to the top of the viewport.
     */
    closeExpandedViewAndRemoveCardTransparency() {
        const cardToScrollTo = this.refCard;
        this.closeExpandedView();
        this.#removeCardTransparency();
        if (cardToScrollTo) {
            requestAnimationFrame(() => {
                const cardEl = document.getElementById('gallery_card_' + cardToScrollTo.getLabelId());
                if (cardEl) {
                    const navbar = document.getElementById('header');
                    const navbarHeight = navbar ? navbar.offsetHeight : 0;
                    const cardMarginTop = parseFloat(window.getComputedStyle(cardEl).marginTop) || 0;
                    const targetScrollY = cardEl.getBoundingClientRect().top + window.scrollY - navbarHeight - cardMarginTop;
                    window.scrollTo({ top: targetScrollY, behavior: 'smooth' });
                }
            });
        }
    }

    /**
     * Tries to update the current card to the given input index.
     * @param {number} index The index of the card to update to.
     */
    #updateExpandedViewCardByIndex(index) {
        if (this.leftArrow) { this.leftArrow.disabled = false; this.leftArrowDisabled = false; }
        if (this.rightArrow) { this.rightArrow.disabled = false; this.rightArrowDisabled = false; }
        this.cardIndex = index;
        this.refCard = sg.cardContainer.getCardByIndex(this.cardIndex);

        this.#openExpandedView();

        if (this.cardIndex === 0) {
            if (this.leftArrow) this.leftArrow.disabled = true;
            this.leftArrowDisabled = true;
        }

        if (sg.cardContainer.isLastPage()) {
            const page = sg.cardContainer.getCurrentPage();
            const lastCardIndex = (page - 1) * ExpandedView.#cardsPerPage + sg.cardContainer.getCurrentPageCards().length - 1;
            if (this.cardIndex === lastCardIndex) {
                if (this.rightArrow) this.rightArrow.disabled = true;
                this.rightArrowDisabled = true;
            }
        }
    }

    /**
     * Updates the index of the current label being displayed in the expanded view.
     * @param {number} newIndex The new index of the card being displayed.
     */
    updateCardIndex(newIndex) {
        this.#updateExpandedViewCardByIndex(newIndex);
    }

    /**
     * Moves to the next label.
     * @param {boolean} keyboardShortcut Whether the action came from a keyboard shortcut.
     */
    nextLabel(keyboardShortcut) {
        sg.tracker.push(`NextLabel${keyboardShortcut ? 'KeyboardShortcut' : 'Click'}`);
        const page = sg.cardContainer.getCurrentPage();
        if (this.cardIndex < page * ExpandedView.#cardsPerPage - 1) {
            this.#updateExpandedViewCardByIndex(this.cardIndex + 1);
        } else {
            this.cardIndex += 1;
            this.pendingCardIndex = this.cardIndex;
            sg.ui.cardContainer.nextPage.click();
        }
    }

    /**
     * Moves to the previous label.
     * @param {boolean} keyboardShortcut Whether the action came from a keyboard shortcut.
     */
    previousLabel(keyboardShortcut) {
        sg.tracker.push(`PrevLabel${keyboardShortcut ? 'KeyboardShortcut' : 'Click'}`);
        const page = sg.cardContainer.getCurrentPage();
        if (this.cardIndex > (page - 1) * ExpandedView.#cardsPerPage) {
            this.#updateExpandedViewCardByIndex(this.cardIndex - 1);
        } else {
            this.cardIndex -= 1;
            this.pendingCardIndex = this.cardIndex;
            sg.ui.cardContainer.prevPage.click();
        }
    }

    /**
     * Highlights the selected thumbnail and dims the rest of the cards on the page.
     * @param {HTMLElement} galleryCard
     */
    #highlightThumbnail(galleryCard) {
        // Reset the sidebar as sticky.
        sg.ui.cardFilter.wrapper.css('position', 'fixed');
        sg.ui.cardFilter.wrapper.css('top', '');
        sg.ui.cardContainer.holder.css('margin-left', sg.ui.cardFilter.wrapper.css('width'));
        sg.scrollStatus.stickySidebar = true;

        // Scroll the selected card into view.
        const index = this.cardIndex;
        const page = sg.cardContainer.getCurrentPage();
        const totalCards = sg.cardContainer.getCurrentCards().getSize();
        galleryCard.scrollIntoView({
            block: (index < page * ExpandedView.#cardsPerPage - 1 && index < totalCards - 1) ? 'center' : 'end',
            behavior: 'smooth'
        });

        // Remove transparent effect from selected card.
        galleryCard.classList.remove(ExpandedView.#unselectedCardClassName);

        // The rest of the cards should be semitransparent.
        const currentPageCards = sg.cardContainer.getCurrentPageCards();
        for (const card of currentPageCards) {
            const cardLabelId = card.getLabelId();
            if (cardLabelId !== this.refCard.getLabelId()) {
                const cardDomEl = document.getElementById('gallery_card_' + cardLabelId);
                if (cardDomEl && !cardDomEl.classList.contains(ExpandedView.#unselectedCardClassName)) {
                    cardDomEl.classList.add(ExpandedView.#unselectedCardClassName);
                }
            }
        }
    }

    /**
     * Returns the reference card currently being displayed.
     * @returns {Card}
     */
    getReferenceCard() {
        return this.refCard;
    }

    /**
     * Called by CardContainer after new cards have been rendered to the DOM. If a cross-page navigation
     * was pending (i.e., the user clicked next/prev from the last/first card on a page), reopens the
     * expanded view for the target card on the new page.
     */
    onPageCardsRendered() {
        if (this.pendingCardIndex === undefined) return;
        const idx = this.pendingCardIndex;
        this.pendingCardIndex = undefined;
        this.#uiModal.css('top', `calc(${$(window).scrollTop()}px + 1vh)`);
        this.#uiModal.css('visibility', 'visible');
        this.#uiModal.css('position', 'relative');
        $('.grid-container').css('grid-template-columns', '1fr 5fr');
        this.#updateExpandedViewCardByIndex(idx);
    }

    /**
     * Sets up cursor handlers for the GSV widget-scene-canvas inside the pano.
     */
    #attachCursorHandlers() {
        const panoEl = this.#root.querySelector('.label-detail__pano');
        if (!panoEl) return;

        const cursorObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE &&
                            node.className &&
                            typeof node.className === 'string' &&
                            node.className.indexOf('widget-scene-canvas') > -1) {
                            node.addEventListener('mousedown', () => {
                                $(node).css('cursor', 'url(/assets/images/icons/closedhand.cur) 4 4, move');
                            });
                            node.addEventListener('mouseup', () => {
                                $(node).css('cursor', '');
                            });
                            cursorObserver.disconnect();
                        }
                    });
                }
            });
        });

        cursorObserver.observe(panoEl, { childList: true, subtree: true });
    }

    /**
     * Programmatically triggers a validation from the expanded view (used by Keyboard.js shortcuts).
     * Clicks the corresponding pano overlay button in the LabelDetail markup, which goes through
     * LabelDetail's normal vote flow (including the onVote callback that syncs back to the card).
     * @param {'Agree'|'Disagree'|'Unsure'} action
     */
    validate(action) {
        if (!this.open) return;
        const btn = this.#root.querySelector(`.label-detail__pano-overlay-button--${action.toLowerCase()}`);
        if (btn && !btn.disabled) btn.click();
    }
}
