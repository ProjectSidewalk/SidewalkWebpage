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
/** Exactly one list-mode page (12), so the boundary between "one page" and "two" is pinned from both sides. */
const FULL_PAGE = [201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212];
/** One card past a page, so paging and the page-boundary handoff are exercised. */
const LONG_LIST = [...FULL_PAGE, 213, 214, 215];

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
         * Builds a GalleryFilter the way list mode does: with no sidebar and no reset in the page at all. It is
         * still constructed, because it owns the address bar and the filter state CardContainer reads.
         *
         * @param {number[]} labelIds The review list the page was opened with.
         * @returns {GalleryFilter} The filter under test.
         */
        function build(labelIds) {
            document.body.innerHTML = '<div class="gallery-list-bar"></div>';
            window.sg = { tracker: { push: jest.fn() }, cardContainer: { updateCardsByFilter: jest.fn() } };
            return new window.GalleryFilter(null, null, { regionIds: [], aiValidationOptions: [], labelIds });
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

        it('answers the empty default for every filter it has no controls for', () => {
            const filter = build(LIST_IDS);

            // CardContainer asks for all of these on the paths list mode shares with the filtered grid, so each
            // has to have an answer rather than throwing on the missing sidebar.
            expect(filter.getStatus().currentLabelTypes).toEqual([]);
            expect(filter.getAppliedSeverities()).toEqual([]);
            expect(filter.getAppliedValidationOptions()).toEqual([]);
            expect(filter.getAppliedTagsByType()).toEqual({});
            expect(filter.getAppliedTagNames()).toEqual([]);
            expect(() => {
                filter.disable();
                filter.enable();
                filter.clearFilters();
            }).not.toThrow();
        });

        it('leaves an over-cap labelIds exactly as it arrived', () => {
            // The page carries what the server *kept* (capped at MaxLabelIds), so writing the URL from that would
            // shorten a 600-id link to 500 — under a strip that is at that moment reporting 100 as dropped.
            window.history.replaceState({}, '', '/gallery?labelIds=1,2,3,4');
            build([1, 2, 3]);

            expect(window.location.pathname + window.location.search).toBe('/gallery?labelIds=1,2,3,4');
        });

        it('writes the list from the page when the URL carries none', () => {
            window.history.replaceState({}, '', '/gallery');
            build(LIST_IDS);

            expect(window.location.pathname + window.location.search).toBe('/gallery?labelIds=42,7,19');
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
        /** @type {(body: *) => void} Answers the held request with a 200 carrying exactly this body. */
        let respondWith;
        /** @type {() => void} Answers the in-flight request the way a failed POST does. */
        let failRequest;

        /** Lets the render pipeline's promise chain settle; render() opens the expanded view inside a `.then`. */
        const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

        /**
         * Drains microtasks only, so a render completes while a macrotask-deferred viewer build is still pending —
         * the window in which a page exists and the view backing its controls does not.
         */
        const flushRenderOnly = async () => {
            for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
        };

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

        /** @returns {boolean} Whether the container has shown the filtered grid's "no matches" notice. */
        const labelsNotFoundShown = () => sg.labelsNotFound.style.display === 'block';

        /**
         * Gives the next container its own paging controls. Every container wires click listeners onto the buttons
         * it is handed, so two containers sharing a set would both answer a click — and one's listener could pass
         * a test about the other's.
         */
        function freshControls() {
            sg.ui.pageControl = document.createElement('div');
            sg.ui.cardContainer = {
                holder: document.createElement('div'),
                prevPage: document.createElement('button'),
                nextPage: document.createElement('button'),
                pageNumber: document.createElement('div'),
            };
        }

        beforeEach(() => {
            // A bare URL: the real ExpandedView reads ?labelId= on construction, and the suite above leaves one set.
            window.history.replaceState({}, '', '/gallery');
            document.body.innerHTML = `
              <p id="gallery-list-count" data-requested="3">3 labels in this list</p>
              <p id="gallery-list-truncated" data-dropped="100" data-max="500">100 ids were past the limit.</p>
              <p id="gallery-list-error" hidden>The list couldn't be loaded.</p>
              <div aria-live="polite">
                <details id="gallery-list-unavailable" hidden>
                  <summary id="gallery-list-unavailable-heading"></summary>
                  <ul class="gallery-list-bar__ids" tabindex="0"></ul>
                </details>
              </div>
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
            window.fetch = (url, { body }) => new Promise((resolve) => {
                requests.push(JSON.parse(body));
                // Held rather than resolved inline, so a test can assert on the request before the cards land.
                respondWith = (responseBody) => resolve({ ok: true, json: async () => responseBody });
                respond = (cards, unavailableLabelIds) => respondWith({
                    labelsOfType: cards.map((card) => ({ label: { label_id: card.getLabelId() } })),
                    ...(unavailableLabelIds !== undefined && { unavailableLabelIds }),
                });
                failRequest = () => resolve({ ok: false, status: 500 });
            });
            window.Card = class {
                constructor(label) { return stubCard(label.label_id); }
            };
            window.PanoStore = class {};
            // The real ExpandedView, so the "k of N" indicator and the cross-page handoff are actually exercised;
            // only the shared LabelDetail behind it is stubbed.
            window.PopupPanoManager = { DEEP_LINK_BUILD_WAIT_MS: 0 };
            window.LabelDetail = {
                // The created instance is kept so a test can assert on the by-id fallback showLabel() call.
                create: async () => {
                    window.LabelDetail.create.lastDetail = {
                        panoManager: { warmUp: jest.fn() },
                        showLabel: jest.fn(() => Promise.resolve()),
                    };
                    return window.LabelDetail.create.lastDetail;
                },
                urlLabelId: () => parseInt(new URLSearchParams(window.location.search).get('labelId'), 10) || null,
                syncUrlLabelId: jest.fn(),
            };
            window.ExpandedView = window.ExpandedViewClass;
            Element.prototype.scrollIntoView = jest.fn(); // jsdom has none; the expanded view scrolls its card in.
            window.ResizeObserver = class {
                observe() {}
            };
            window.sg = {
                // The whole of the interface GalleryFilter offers the container, since the filtered path reads more
                // of it than list mode does.
                cardFilter: {
                    getStatus: () => ({ currentLabelTypes: [] }),
                    getAppliedValidationOptions: () => [],
                    getAppliedSeverities: () => [],
                    getAppliedTagsByType: () => ({}),
                    disable: jest.fn(),
                    enable: jest.fn(),
                },
                ui: { expandedView: { container: document.querySelector('.gallery-expanded-view') } },
                pageLoading: document.createElement('div'),
                labelsNotFound: document.createElement('div'),
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
            freshControls();
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
            expect(unavailable.querySelector('summary').textContent)
                .toBe('gallery:list-unavailable:{"count":1}');
            expect([...unavailable.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['#7']);
        });

        it('says both numbers once the list came back short, and only one when it did not', async () => {
            await listContainer([42, 19], [7]);
            expect(document.getElementById('gallery-list-count').textContent)
                .toBe('gallery:list-count-partial:{"shown":2,"count":3}');

            await listContainer(LIST_IDS, []);
            expect(document.getElementById('gallery-list-count').textContent)
                .toBe('gallery:list-count:{"count":3}');
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

        it('lets the strip explain an empty grid, rather than the filtered gallery\'s copy', async () => {
            // Every id belongs to another city, so nothing comes back. "No matches. Start exploring to contribute
            // more data!" answers a filtered search, not this, and with no sidebar it lands on top of the strip.
            await listContainer([], LIST_IDS);

            expect(labelsNotFoundShown()).toBe(false);
            expect(document.getElementById('gallery-list-count').textContent)
                .toBe('gallery:list-count-partial:{"shown":0,"count":3}');
            const unavailable = document.getElementById('gallery-list-unavailable');
            expect(unavailable.hidden).toBe(false);
            expect([...unavailable.querySelectorAll('li')].map((li) => li.textContent))
                .toEqual(['#42', '#7', '#19']);
            // The disclosure sits inside the live region, so its appearance is announced (see gallery.css, which
            // gives the wrapper `display: contents` so it holds no layout box of its own).
            expect(unavailable.parentElement.getAttribute('aria-live')).toBe('polite');
        });

        it('hands the view an empty page too, so a deep link into it still opens', async () => {
            // Nothing came back, so there is no card to open by index — but ?labelId= still names a real label,
            // and a render that skips the handover leaves the id pending for whatever renders next.
            window.history.replaceState({}, '', `/gallery?labelIds=x&labelId=${LIST_IDS[0]}`);
            const empty = await listContainer([], LIST_IDS);
            await flush();

            const view = empty.getExpandedView();
            expect(view.initialUrlLabelId).toBeNull(); // Consumed, not left pending.
            expect(window.LabelDetail.create.lastDetail.showLabel).toHaveBeenCalledWith(LIST_IDS[0], 'GalleryExpanded');
        });

        it('says the list could not be loaded, rather than showing an empty queue', async () => {
            freshControls();
            const created = window.CardContainer.create(
                sg.ui.cardContainer, { regionIds: [], aiValidationOptions: [], labelIds: LIST_IDS }, null, null, null,
            );
            requests.length = 0;
            failRequest();
            await created;

            expect(document.getElementById('gallery-list-error').hidden).toBe(false);
            // "No matches, start exploring" is the filtered grid's copy; a failed request is not an empty list.
            expect(labelsNotFoundShown()).toBe(false);
            // The count the server rendered still stands, rather than being rewritten to "0 labels in this list".
            expect(document.getElementById('gallery-list-count').textContent).toBe('3 labels in this list');
        });

        it('treats an answer with no labels in it as a failed request', async () => {
            // The filters and the loading overlay are released on this path too; a 200 with an unexpected body used
            // to leave them greyed out for the rest of the page's life.
            freshControls();
            const created = window.CardContainer.create(
                sg.ui.cardContainer, { regionIds: [], aiValidationOptions: [], labelIds: LIST_IDS }, null, null, null,
            );
            respondWith({});
            await created;

            expect(document.getElementById('gallery-list-error').hidden).toBe(false);
            expect(sg.cardFilter.enable).toHaveBeenCalled();
        });

        it('leaves the filtered grid on nine, which is the other half of the same contract', async () => {
            // Asserting only the list's twelve would pass just as well if getCardsPerPage() returned twelve
            // unconditionally, which would quietly repage the ordinary Gallery. The same container also still
            // shows the grid's "no matches" copy, so the list-mode suppression above is scoped to list mode.
            const filtered = await listContainer(LIST_IDS, [], []);

            expect(filtered.isListMode()).toBe(false);
            expect(filtered.getCardsPerPage()).toBe(9);
            expect(labelsNotFoundShown()).toBe(true);
        });

        describe('paging a list longer than one page', () => {
            /** @type {CardContainer} */
            let container;

            beforeEach(async () => {
                container = await listContainer(LONG_LIST, [], LONG_LIST);
            });

            // A list page holds twelve, not the filtered grid's nine (#5444), and the container is the one place
            // that knows which — ExpandedView reads it back rather than keeping a copy that could disagree.
            it('holds twelve cards to a page, and says so once', () => {
                expect(container.getCardsPerPage()).toBe(12);
            });

            it('fits exactly one page when the list is exactly a page long', async () => {
                const full = await listContainer(FULL_PAGE, [], FULL_PAGE);

                expect(full.getCurrentPage()).toBe(1);
                expect(full.isLastPage()).toBe(true);
                expect(full.getCurrentPageCards()).toHaveLength(12);
            });

            it('knows where the last page ends', () => {
                expect(container.getListSize()).toBe(15);
                expect(container.getCurrentPage()).toBe(1);
                expect(container.isLastPage()).toBe(false); // 15 cards, 12 per page.

                sg.ui.cardContainer.nextPage.click();
                expect(container.getCurrentPage()).toBe(2);
                expect(container.isLastPage()).toBe(true); // Cards 13-15.
                expect(container.getCurrentPageCards()).toHaveLength(3);
                expect(requests).toHaveLength(1); // Still no second query.

                sg.ui.cardContainer.prevPage.click();
                expect(container.getCurrentPage()).toBe(1);
                expect(container.isLastPage()).toBe(false);
            });

            it('hands a card on the next page to the expanded view across the page turn', async () => {
                const view = container.getExpandedView();
                view.updateCardIndex(11); // Last card of page 1.
                expect(positionText()).toBe('gallery:list-position:{"k":12,"n":15}');

                view.nextLabel(false);
                await flush();

                // The arrow ran out of page, so it set a pending index and clicked through; the new page's render is
                // what opens it. Landing on the wrong card here is how a review queue silently skips a label.
                expect(container.getCurrentPage()).toBe(2);
                expect(view.getReferenceCard().getLabelId()).toBe(LONG_LIST[12]);
                expect(positionText()).toBe('gallery:list-position:{"k":13,"n":15}');

                view.previousLabel(false);
                await flush();
                expect(container.getCurrentPage()).toBe(1);
                expect(view.getReferenceCard().getLabelId()).toBe(LONG_LIST[11]);
                expect(positionText()).toBe('gallery:list-position:{"k":12,"n":15}');
            });

            it('jumps a deep link to its card on a later page', async () => {
                expect(container.jumpToLabel(LONG_LIST[13])).toBe(true);
                await flush();

                expect(container.getCurrentPage()).toBe(2);
                expect(container.getExpandedView().getReferenceCard().getLabelId()).toBe(LONG_LIST[13]);
                expect(positionText()).toBe('gallery:list-position:{"k":14,"n":15}');
                expect(requests).toHaveLength(1);
            });

            it('jumps a deep link to a card already on this page without paging', () => {
                expect(container.jumpToLabel(LONG_LIST[2])).toBe(true);

                expect(container.getCurrentPage()).toBe(1);
                expect(positionText()).toBe('gallery:list-position:{"k":3,"n":15}');
            });

            it('reports a label the list does not hold, so the caller can fall back', () => {
                expect(container.jumpToLabel(999999)).toBe(false);
            });

            /** Makes the viewer build lose the race to the opening query, which is the ordering that broke. */
            function slowExpandedView() {
                const build = window.ExpandedViewClass.create.bind(window.ExpandedViewClass);
                window.ExpandedView = {
                    create: async (...args) => {
                        await new Promise((resolve) => { setTimeout(resolve, 0); });
                        return build(...args);
                    },
                };
            }

            it('opens a deep link whose query came back before the viewer existed', async () => {
                // In that ordering render() has no expanded view to hand the page to, so the handover has to wait
                // for the view rather than being dropped: a dropped one leaves the id pending for a later render.
                slowExpandedView();
                window.history.replaceState({}, '', `/gallery?labelIds=x&labelId=${LONG_LIST[13]}`);
                const raced = await listContainer(LONG_LIST, [], LONG_LIST);
                await flush();

                const view = raced.getExpandedView();
                expect(view.cardIndex).toBe(13);
                expect(view.getReferenceCard().getLabelId()).toBe(LONG_LIST[13]);
                expect(raced.getCurrentPage()).toBe(2);
            });

            it('keeps the controls dead until the view that backs them exists', async () => {
                // Both paging handlers close the expanded view and push a tracker event, and in this ordering
                // neither the view nor sg.tracker is up — so showing the control and re-enabling the filters
                // before the handover hands the user a Next button that throws.
                slowExpandedView();
                sg.tracker = undefined; // As on the real page: Main assigns it after CardContainer.create resolves.
                // This block's beforeEach already built one container; only the one below is under test here.
                freshControls();
                sg.cardFilter.enable.mockClear();
                const created = window.CardContainer.create(
                    sg.ui.cardContainer,
                    { regionIds: [], aiValidationOptions: [], labelIds: LONG_LIST },
                    null, null, null,
                );
                respond(LONG_LIST.map(stubCard), []);
                await flushRenderOnly();

                expect(sg.ui.pageControl.style.display).toBe('none');
                expect(sg.cardFilter.enable).not.toHaveBeenCalled();
                // And a click that slips through anyway must not take the page down with it.
                expect(() => sg.ui.cardContainer.nextPage.click()).not.toThrow();

                const raced = await created;
                expect(sg.ui.pageControl.style.display).toBe('');
                expect(sg.cardFilter.enable).toHaveBeenCalled();
                expect(raced.getExpandedView()).toBeDefined();
            });

            it('does not let that deep link ambush the next page turn', async () => {
                // A target on page 1 was the worst of it: the late restore ran #setPage(1) and undid the turn the
                // user had just made, which reads as the Gallery refusing to page.
                slowExpandedView();
                window.history.replaceState({}, '', `/gallery?labelIds=x&labelId=${LONG_LIST[0]}`);
                const raced = await listContainer(LONG_LIST, [], LONG_LIST);
                await flush();
                expect(raced.getExpandedView().cardIndex).toBe(0);

                sg.ui.cardContainer.nextPage.click();
                await flush();

                expect(raced.getCurrentPage()).toBe(2);
            });

            it('pages back from a deep link that landed on the second page', async () => {
                // The deep link turns the page without pressing Next, which is what used to enable Prev. A page
                // turn the expanded view asks for has to work regardless of what the button thinks.
                const view = container.getExpandedView();
                view.initialUrlLabelId = LONG_LIST[12];
                view.restoreFromUrl();
                await flush();
                expect(container.getCurrentPage()).toBe(2);
                expect(view.cardIndex).toBe(12);
                expect(sg.ui.cardContainer.prevPage.disabled).toBe(false);

                view.previousLabel(false);
                await flush();

                expect(container.getCurrentPage()).toBe(1);
                expect(view.cardIndex).toBe(11);
                expect(view.getReferenceCard().getLabelId()).toBe(LONG_LIST[11]);
                expect(sg.ui.cardContainer.prevPage.disabled).toBe(true);
            });

            it('reopens a ?labelId= deep link by its place in the list, not just by id', async () => {
                const view = container.getExpandedView();
                view.initialUrlLabelId = LONG_LIST[13]; // What #init reads off the URL on a real load.

                view.restoreFromUrl();
                await flush();

                // Opened by index, so it has a reference card and paging carries on through the list; the old
                // by-id path left cardIndex at -1 and restarted from the first card.
                expect(view.cardIndex).toBe(13);
                expect(view.getReferenceCard().getLabelId()).toBe(LONG_LIST[13]);
                expect(positionText()).toBe('gallery:list-position:{"k":14,"n":15}');
            });
        });
    });
});
