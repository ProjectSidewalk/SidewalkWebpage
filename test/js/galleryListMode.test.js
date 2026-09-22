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

const LIST_IDS = [42, 7, 19];

describe('the Gallery in review-list mode', () => {
    beforeAll(() => {
        window.i18next = { t: (key, opts) => `${key}:${JSON.stringify(opts ?? {})}` };
        window.eval(URL_QUERY_SRC); // Defines util.url, which the URL writer depends on.
        window.eval(`${FILTER_SIDEBAR_SRC}\nwindow.FilterSidebar = FilterSidebar;`);
        window.eval(`${GALLERY_FILTER_SRC}\nwindow.GalleryFilter = GalleryFilter;`);
        window.eval(`${CARD_BUCKET_SRC}\nwindow.CardBucket = CardBucket;`);
        window.eval(`${CARD_CONTAINER_SRC}\nwindow.CardContainer = CardContainer;`);
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
    });

    describe('the card container', () => {
        /** @type {object[]} The bodies the container POSTed to /label/labels. */
        let requests;
        /** @type {(cards: object[], unavailable: (number[]|undefined)) => void} */
        let respond;

        /** A Card stand-in: the container only needs an id, a type to bucket it under, and a render pass. */
        function stubCard(labelId) {
            return {
                getLabelId: () => labelId,
                getLabelType: () => 'CurbRamp',
                getImageId: () => `label_id_${labelId}`,
                loadImage: () => Promise.resolve(),
                render: jest.fn(),
                refitTags: jest.fn(),
            };
        }

        /** A jQuery-ish element stub: enough of the API for the container's DOM pokes. */
        function el() {
            const stub = {
                bind: jest.fn(), append: jest.fn(), prop: jest.fn(), on: jest.fn(), css: jest.fn(),
                show: jest.fn(), hide: jest.fn(), children: () => ({ each: jest.fn() }),
            };
            stub[0] = document.createElement('div');
            return stub;
        }

        beforeEach(() => {
            document.body.innerHTML = `
              <p id="gallery-list-count">Showing 3 labels, in the order given.</p>
              <div id="gallery-list-unavailable" hidden><ul class="gallery-list-panel__ids"></ul></div>`;

            requests = [];
            respond = () => {};
            window.scrollTo = jest.fn(); // jsdom has no implementation; the container scrolls to the top on paging.
            window.$ = jest.fn(() => ({ prop: jest.fn() }));
            window.$.ajax = ({ data, success }) => {
                requests.push(JSON.parse(data));
                // Held rather than resolved inline, so a test can assert on the request before the cards land.
                respond = (cards, unavailableLabelIds) => success({
                    labelsOfType: cards.map((card) => ({ label: { label_id: card.getLabelId() } })),
                    ...(unavailableLabelIds !== undefined && { unavailableLabelIds }),
                });
            };
            window.Card = class {
                constructor(label) { return stubCard(label.label_id); }
            };
            window.PanoStore = class {};
            window.ExpandedView = {
                create: async () => ({
                    closeExpandedView: jest.fn(), onPageCardsRendered: jest.fn(), restoreFromUrl: jest.fn(),
                }),
            };
            window.ResizeObserver = class {
                observe() {}
            };
            window.sg = {
                cardFilter: {
                    getStatus: () => ({ currentLabelTypes: [] }), disable: jest.fn(), enable: jest.fn(),
                },
                ui: {
                    pageControl: el(),
                    cardContainer: { holder: el(), prevPage: el(), nextPage: el(), pageNumber: el() },
                    expandedView: { container: el() },
                },
                pageLoading: el(),
                labelsNotFound: el(),
            };
        });

        /**
         * Builds a CardContainer in list mode and answers its opening query with cards for `served`.
         * @param {number[]} served Label ids the server returns, in the order it returns them.
         * @param {number[]} [unavailable] Requested ids the server could not serve.
         * @returns {Promise<CardContainer>} The container under test.
         */
        async function listContainer(served, unavailable) {
            const created = window.CardContainer.create(
                sg.ui.cardContainer, { regionIds: [], aiValidationOptions: [], labelIds: LIST_IDS }, null, null, null,
            );
            respond(served.map(stubCard), unavailable);
            return created;
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

        it('leaves the unavailable list hidden when every id came back', async () => {
            await listContainer(LIST_IDS, []);

            expect(document.getElementById('gallery-list-unavailable').hidden).toBe(true);
        });
    });
});
