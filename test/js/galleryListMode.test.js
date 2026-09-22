/**
 * Tests for the Gallery's review-list mode (`/gallery?labelIds=…`, issue #5444).
 *
 * List mode is a different contract from the filtered grid: the server picked the cards and their order, so the
 * client must show them as they arrived, never re-fetch while paging through them, and never let the (unrendered)
 * filter sidebar speak for the page. Each of those failing looks like an ordinary Gallery rather than a broken one —
 * a re-fetch silently reshuffles a rater's queue — so they are pinned here.
 *
 * Both classes are Grunt-concatenated `class` declarations that reach for page globals, so the sources are eval'd
 * into jsdom with those stubbed.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js');
const URL_QUERY_SRC = fs.readFileSync(path.join(SRC_DIR, 'common/urlQuery.js'), 'utf8');
const FILTER_SIDEBAR_SRC = fs.readFileSync(path.join(SRC_DIR, 'common/filter-sidebar/FilterSidebar.js'), 'utf8');
const GALLERY_FILTER_SRC = fs.readFileSync(path.join(SRC_DIR, 'gallery/src/filter/GalleryFilter.js'), 'utf8');
const CARD_BUCKET_SRC = fs.readFileSync(path.join(SRC_DIR, 'gallery/src/cards/CardBucket.js'), 'utf8');
const CARD_CONTAINER_SRC = fs.readFileSync(path.join(SRC_DIR, 'gallery/src/cards/CardContainer.js'), 'utf8');
const EXPANDED_VIEW_SRC = fs.readFileSync(path.join(SRC_DIR, 'gallery/src/expandedview/ExpandedView.js'), 'utf8');

const LIST_IDS = [42, 7, 19];
/** A list longer than one 9-card page, so paging and the page-boundary handoff are exercised. */
const LONG_LIST = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112];

describe('the Gallery in review-list mode', () => {
    beforeAll(() => {
        window.i18next = { t: (key, opts) => `${key}:${JSON.stringify(opts ?? {})}` };
        window.eval(URL_QUERY_SRC); // Defines util.url, which the URL writer depends on.
        window.eval(`${FILTER_SIDEBAR_SRC}\nwindow.FilterSidebar = FilterSidebar;`);
        window.eval(`${GALLERY_FILTER_SRC}\nwindow.GalleryFilter = GalleryFilter;`);
        window.eval(`${CARD_BUCKET_SRC}\nwindow.CardBucket = CardBucket;`);
        window.eval(`${CARD_CONTAINER_SRC}\nwindow.CardContainer = CardContainer;`);
        window.eval(`${EXPANDED_VIEW_SRC}\nwindow.ExpandedViewClass = ExpandedView;`);
    });

    describe('the sidebar and the address bar', () => {
        /**
         * Builds a GalleryFilter over the list-mode sidebar, which renders no filter sections at all.
         * @param {number[]} labelIds The review list the page was opened with.
         * @returns {GalleryFilter} The filter under test.
         */
        function build(labelIds) {
            document.body.innerHTML = `
              <div class="gallery-filter-header gallery-filter-header--list">
                <h4 id="filter-header">Label List</h4>
                <button type="button" id="clear-filters" hidden><span>Clear Filters</span></button>
              </div>
              <div id="card-filter"><div class="gallery-list-panel"></div></div>`;
            window.sg = { tracker: { push: jest.fn() }, cardContainer: { updateCardsByFilter: jest.fn() } };
            return new window.GalleryFilter(
                document.getElementById('card-filter'),
                document.getElementById('clear-filters'),
                { regionIds: [], aiValidationOptions: [], labelIds },
            );
        }

        beforeEach(() => {
            window.history.replaceState({}, '', '/gallery?labelIds=42,7,19');
            // GalleryFilter reads the open label off LabelDetail to carry it through its rewrite (#5446).
            window.LabelDetail = {
                urlLabelId: () => parseInt(new URLSearchParams(window.location.search).get('labelId'), 10) || null,
            };
        });

        it('keeps the list in the URL, and claims no filters it is not applying', () => {
            build(LIST_IDS);

            // Without the list-mode branch the constructor's first pass would rewrite this to
            // `/gallery?severities=&validationOptions=`, scrubbing the list and naming two filters that don't exist.
            expect(window.location.pathname + window.location.search).toBe('/gallery?labelIds=42,7,19');
        });

        it('leaves the reset hidden, since there is nothing to reset', () => {
            build(LIST_IDS);

            expect(document.getElementById('clear-filters').hidden).toBe(true);
        });

        it('keeps a ?labelId= deep link alongside the list', () => {
            // GalleryFilter is constructed before ExpandedView reads the param, so scrubbing it here is what made
            // every deep link into a list open the plain first card instead (#5446).
            window.history.replaceState({}, '', '/gallery?labelIds=42,7,19&labelId=7');
            build(LIST_IDS);

            expect(window.location.pathname + window.location.search).toBe('/gallery?labelIds=42,7,19&labelId=7');
        });
    });

    describe('the card container', () => {
        /** @type {object[]} The bodies the container POSTed to /label/labels. */
        let requests;
        /** @type {(cards: object[], unavailable: (number[]|undefined)) => void} */
        let respond;
        /** @type {() => void} Answers the in-flight request the way a failed POST does. */
        let failRequest;

        /** Lets the render pipeline's promise chain settle; render() opens the expanded view inside a `.then`. */
        const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

        /** A Card stand-in: the container only needs an id, a type to bucket it under, and a render pass. */
        function stubCard(labelId) {
            return {
                getLabelId: () => labelId,
                getLabelType: () => 'CurbRamp',
                getImageId: () => `label_id_${labelId}`,
                getCropUrl: () => null,
                getCropMarker: () => null,
                getBackupImageData: () => null,
                getProperties: () => ({
                    label_id: labelId,
                    label_type: 'CurbRamp',
                    image_capture_date: { toISOString: () => '2020-01-01' },
                    label_timestamp: { toISOString: () => '2020-01-01' },
                    val_counts: { Agree: 0, Disagree: 0, Unsure: 0 },
                    tags: [],
                }),
                loadImage: () => Promise.resolve(),
                render: jest.fn(),
                refitTags: jest.fn(),
            };
        }

        /**
         * A jQuery-ish element stub: enough of the API for the container's DOM pokes, and it remembers the handlers
         * bound to it so a test can press the paging buttons the way the page does.
         */
        function el() {
            const stub = {
                handlers: {},
                bind(map) { Object.assign(this.handlers, map); },
                append: jest.fn(),
                prop: jest.fn(),
                on: jest.fn(),
                css: jest.fn(),
                show: jest.fn(),
                hide: jest.fn(),
                children: () => ({ each: jest.fn() }),
            };
            stub.click = () => stub.handlers.click?.({});
            stub[0] = document.createElement('div');
            return stub;
        }

        beforeEach(() => {
            // A bare URL: the real ExpandedView reads ?labelId= on construction, and the suite above leaves one set.
            window.history.replaceState({}, '', '/gallery');
            document.body.innerHTML = `
              <p id="gallery-list-count">Showing 3 labels, in the order given.</p>
              <p id="gallery-list-truncated" data-dropped="100" data-max="500">100 ids were past the limit.</p>
              <p id="gallery-list-error" hidden>The list couldn't be loaded.</p>
              <div id="gallery-list-unavailable" hidden><ul class="gallery-list-panel__ids"></ul></div>
              <div class="gallery-expanded-view">
                <button class="label-detail__paging label-detail__paging--prev"></button>
                <span class="label-detail__position" hidden></span>
                <button class="label-detail__paging label-detail__paging--next"></button>
                <div class="label-detail__pano"></div>
                <button data-action="close-label-detail"></button>
              </div>
              <div id="cards"></div>`;

            requests = [];
            respond = () => {};
            window.scrollTo = jest.fn(); // jsdom has no implementation; the container scrolls to the top on paging.
            window.$ = jest.fn(() => ({ prop: jest.fn() }));
            window.$.ajax = ({ data, success, error }) => {
                requests.push(JSON.parse(data));
                // Held rather than resolved inline, so a test can assert on the request before the cards land.
                respond = (cards, unavailableLabelIds) => success({
                    labelsOfType: cards.map((card) => ({ label: { label_id: card.getLabelId() } })),
                    ...(unavailableLabelIds !== undefined && { unavailableLabelIds }),
                });
                failRequest = () => error();
            };
            window.Card = class {
                constructor(label) { return stubCard(label.label_id); }
            };
            window.PanoStore = class {};
            // The real ExpandedView, so the "k of N" indicator and the cross-page handoff are actually exercised;
            // only the shared LabelDetail behind it is stubbed.
            window.PopupPanoManager = { DEEP_LINK_BUILD_WAIT_MS: 0 };
            window.LabelDetail = {
                create: async () => ({
                    panoManager: { warmUp: jest.fn() },
                    showLabel: jest.fn(() => Promise.resolve()),
                }),
                urlLabelId: () => parseInt(new URLSearchParams(window.location.search).get('labelId'), 10) || null,
                syncUrlLabelId: jest.fn(),
            };
            window.ExpandedView = window.ExpandedViewClass;
            Element.prototype.scrollIntoView = jest.fn(); // jsdom has none; the expanded view scrolls its card in.
            window.ResizeObserver = class {
                observe() {}
            };
            const expandedHost = el();
            expandedHost[0] = document.querySelector('.gallery-expanded-view');
            window.sg = {
                cardFilter: {
                    getStatus: () => ({ currentLabelTypes: [] }), disable: jest.fn(), enable: jest.fn(),
                },
                ui: {
                    pageControl: el(),
                    cardContainer: { holder: el(), prevPage: el(), nextPage: el(), pageNumber: el() },
                    expandedView: { container: expandedHost },
                },
                pageLoading: el(),
                labelsNotFound: el(),
                tracker: { push: jest.fn() },
            };
        });

        /** @returns {string} The rendered "k of N" text, or '' while the indicator is hidden. */
        const positionText = () => {
            const positionEl = document.querySelector('.label-detail__position');
            return positionEl.hidden ? '' : positionEl.textContent;
        };

        /**
         * Builds a CardContainer in list mode and answers its opening query with cards for `served`.
         * @param {number[]} served Label ids the server returns, in the order it returns them.
         * @param {number[]} [unavailable] Requested ids the server could not serve.
         * @returns {Promise<CardContainer>} The container under test.
         */
        async function listContainer(served, unavailable, requested = LIST_IDS) {
            document.getElementById('cards').innerHTML
                = served.map((labelId) => `<div id="gallery_card_${labelId}"></div>`).join('');
            const created = window.CardContainer.create(
                sg.ui.cardContainer, { regionIds: [], aiValidationOptions: [], labelIds: requested }, null, null, null,
            );
            respond(served.map(stubCard), unavailable);
            // ExpandedView reaches back through sg.cardContainer for the card at an index, as Main wires it up.
            sg.cardContainer = await created;
            return sg.cardContainer;
        }

        it('asks for the list by id and for nothing else', async () => {
            await listContainer(LIST_IDS);

            expect(requests).toHaveLength(1);
            expect(requests[0].label_ids).toEqual(LIST_IDS);
            expect(requests[0].label_types).toEqual([]);
            expect(requests[0].region_ids).toBeUndefined();
            expect(requests[0].severities).toBeUndefined();
        });

        it('keeps the order the server returned, rather than regrouping by label type', async () => {
            const container = await listContainer(LIST_IDS);

            expect(container.getCurrentCards().getCards().map((card) => card.getLabelId())).toEqual(LIST_IDS);
            expect(container.isListMode()).toBe(true);
            expect(container.getListSize()).toBe(LIST_IDS.length);
        });

        it('never re-queries while paging through the list', async () => {
            const container = await listContainer(LIST_IDS);

            container.updateCardsNewPage();
            container.updateCardsByFilter();

            expect(requests).toHaveLength(1);
            expect(container.getCurrentCards().getCards().map((card) => card.getLabelId())).toEqual(LIST_IDS);
        });

        it('names the ids it could not serve, so a short list reads as explained', async () => {
            await listContainer([42, 19], [7]);

            const unavailable = document.getElementById('gallery-list-unavailable');
            expect(unavailable.hidden).toBe(false);
            expect([...unavailable.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['#7']);
        });

        it('restates the truncation notice with the numbers the server wrote onto it', async () => {
            await listContainer(LIST_IDS, []);

            // The cap is the server's, read back off the element — never a frontend literal.
            expect(document.getElementById('gallery-list-truncated').textContent)
                .toBe('gallery:list-truncated:{"count":100,"max":500}');
        });

        it('leaves the unavailable list hidden when every id came back', async () => {
            await listContainer(LIST_IDS, []);

            expect(document.getElementById('gallery-list-unavailable').hidden).toBe(true);
        });

        it('says the list could not be loaded, rather than showing an empty queue', async () => {
            const created = window.CardContainer.create(
                sg.ui.cardContainer, { regionIds: [], aiValidationOptions: [], labelIds: LIST_IDS }, null, null, null,
            );
            requests.length = 0;
            failRequest();
            await created;

            expect(document.getElementById('gallery-list-error').hidden).toBe(false);
            // "No matches, start exploring" is the filtered grid's copy; a failed request is not an empty list.
            expect(sg.labelsNotFound.show).not.toHaveBeenCalled();
            // The count the server rendered still stands, rather than being rewritten to "Showing 0 labels".
            expect(document.getElementById('gallery-list-count').textContent)
                .toBe('Showing 3 labels, in the order given.');
        });

        describe('paging a list longer than one page', () => {
            /** @type {CardContainer} */
            let container;

            beforeEach(async () => {
                container = await listContainer(LONG_LIST, [], LONG_LIST);
            });

            it('knows where the last page ends', () => {
                expect(container.getListSize()).toBe(12);
                expect(container.getCurrentPage()).toBe(1);
                expect(container.isLastPage()).toBe(false); // 12 cards, 9 per page.

                sg.ui.cardContainer.nextPage.handlers.click({});
                expect(container.getCurrentPage()).toBe(2);
                expect(container.isLastPage()).toBe(true); // Cards 10-12.
                expect(requests).toHaveLength(1); // Still no second query.

                sg.ui.cardContainer.prevPage.handlers.click({});
                expect(container.getCurrentPage()).toBe(1);
                expect(container.isLastPage()).toBe(false);
            });

            it('hands a card on the next page to the expanded view across the page turn', async () => {
                const view = container.getExpandedView();
                view.updateCardIndex(8); // Last card of page 1.
                expect(positionText()).toBe('gallery:list-position:{"k":9,"n":12}');

                view.nextLabel(false);
                await flush();

                // The arrow ran out of page, so it set a pending index and clicked through; the new page's render is
                // what opens it. Landing on the wrong card here is how a review queue silently skips a label.
                expect(container.getCurrentPage()).toBe(2);
                expect(view.getReferenceCard().getLabelId()).toBe(LONG_LIST[9]);
                expect(positionText()).toBe('gallery:list-position:{"k":10,"n":12}');

                view.previousLabel(false);
                await flush();
                expect(container.getCurrentPage()).toBe(1);
                expect(view.getReferenceCard().getLabelId()).toBe(LONG_LIST[8]);
                expect(positionText()).toBe('gallery:list-position:{"k":9,"n":12}');
            });

            it('jumps a deep link to its card on a later page', async () => {
                expect(container.jumpToLabel(LONG_LIST[10])).toBe(true);
                await flush();

                expect(container.getCurrentPage()).toBe(2);
                expect(container.getExpandedView().getReferenceCard().getLabelId()).toBe(LONG_LIST[10]);
                expect(positionText()).toBe('gallery:list-position:{"k":11,"n":12}');
                expect(requests).toHaveLength(1);
            });

            it('jumps a deep link to a card already on this page without paging', () => {
                expect(container.jumpToLabel(LONG_LIST[2])).toBe(true);

                expect(container.getCurrentPage()).toBe(1);
                expect(positionText()).toBe('gallery:list-position:{"k":3,"n":12}');
            });

            it('reports a label the list does not hold, so the caller can fall back', () => {
                expect(container.jumpToLabel(999999)).toBe(false);
            });

            it('reopens a ?labelId= deep link by its place in the list, not just by id', async () => {
                const view = container.getExpandedView();
                view.initialUrlLabelId = LONG_LIST[10]; // What #init reads off the URL on a real load.

                view.restoreFromUrl();
                await flush();

                // Opened by index, so it has a reference card and paging carries on through the list; the old
                // by-id path left cardIndex at -1 and restarted from the first card.
                expect(view.cardIndex).toBe(10);
                expect(view.getReferenceCard().getLabelId()).toBe(LONG_LIST[10]);
                expect(positionText()).toBe('gallery:list-position:{"k":11,"n":12}');
            });
        });
    });
});
