/**
 * Tests for the community listing pages' client layer (#4688): CommunityListPage (search / sort / live count /
 * localized dates) plus the page-specific StoryListPage (type-chip tinting, read-more clamp toggle, view-label
 * popup routing) and RouteListPage (copy-share-link fallbacks).
 *
 * All three are top-level `class` declarations written for the Grunt-concatenation world, so (like ShareWidget's
 * test) we eval the sources into the jsdom global scope.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const COMMUNITY_SRC = ['CommunityListPage.js', 'StoryListPage.js', 'RouteListPage.js']
    .map((f) => fs.readFileSync(path.resolve(REPO_ROOT, 'public/js/community', f), 'utf8'))
    .join('\n');

/** Loads fresh copies of the three page classes into the jsdom global scope. */
function loadClasses() {
    window.eval(`${COMMUNITY_SRC}
        window.CommunityListPage = CommunityListPage;
        window.StoryListPage = StoryListPage;
        window.RouteListPage = RouteListPage;`);
}

/** Renders the toolbar + card list skeleton that CommunityListPage.init() expects. */
function setupDom(cardsHtml, { sortOptions = ['newest', 'neighborhood', 'longest', 'explored', 'labeltype'] } = {}) {
    document.body.innerHTML = `
        <input type="search" id="community-search">
        <select id="community-sort">
            ${sortOptions.map((o, i) => `<option value="${o}"${i === 0 ? ' selected' : ''}>${o}</option>`).join('')}
        </select>
        <span id="community-count" data-count-template="{0} shown"></span>
        <ul id="community-cards" data-read-more="Read more" data-read-less="Read less"></ul>
        <p id="community-no-results" hidden>Nothing matches</p>
    `;
    document.getElementById('community-cards').innerHTML = cardsHtml;
}

/** A generic route-shaped card; like the real cards, the region name is part of the visible (searchable) text. */
function routeCard({ id, created, region, distance = 0, explored = 0, slug = '', text }) {
    return `
        <li class="community-card route-card" data-route-id="${id}" data-slug="${slug}" data-created="${created}"
            data-region="${region}" data-distance="${distance}" data-explored="${explored}">
            <div class="route-card__body"><h2>${text}</h2><p>${region}</p></div>
        </li>`;
}

function cardIds() {
    return Array.from(document.querySelectorAll('.community-card')).map((c) => c.dataset.routeId);
}

function search(query) {
    const el = document.getElementById('community-search');
    el.value = query;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function sortBy(value) {
    const el = document.getElementById('community-sort');
    el.value = value;
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

function newCommunityPage() {
    const page = new window.CommunityListPage('SpecPage', {
        newest: { key: 'created', numeric: true, desc: true },
        neighborhood: { key: 'region' },
        longest: { key: 'distance', numeric: true, desc: true },
    });
    page.init();
    return page;
}

beforeEach(() => {
    loadClasses();
    window.logWebpageActivity = jest.fn();
    window.moment = jest.fn(() => ({ format: () => 'LOCALIZED-DATE' }));
    // The string sort passes the page language to localeCompare; the Twirl layout always renders <html lang="...">,
    // but jsdom's default is the empty string, which localeCompare rejects.
    document.documentElement.lang = 'en';
});

describe('CommunityListPage', () => {
    const THREE_CARDS =
        routeCard({ id: '1', created: 300, region: 'Alpha Park', distance: 10, text: 'Morning walk' }) +
        routeCard({ id: '2', created: 200, region: 'Beta Square', distance: 30, text: 'Long trek' }) +
        routeCard({ id: '3', created: 100, region: 'Alpha Park', distance: 20, text: 'Short stroll' });

    test('init reports the visible count via the server-provided template', () => {
        setupDom(THREE_CARDS);
        newCommunityPage();
        expect(document.getElementById('community-count').textContent).toBe('3 shown');
    });

    test('init is a no-op on an empty page (no toolbar rendered)', () => {
        document.body.innerHTML = '<div id="something-else"></div>';
        expect(() => newCommunityPage()).not.toThrow();
    });

    test('search hides non-matching cards, updates the count, and toggles the no-results notice', () => {
        setupDom(THREE_CARDS);
        newCommunityPage();

        search('long trek');
        const hiddenById = Object.fromEntries(
            Array.from(document.querySelectorAll('.community-card')).map((c) => [c.dataset.routeId, c.hidden]));
        expect(hiddenById).toEqual({ 1: true, 2: false, 3: true });
        expect(document.getElementById('community-count').textContent).toBe('1 shown');
        expect(document.getElementById('community-no-results').hidden).toBe(true);

        search('no such story anywhere');
        expect(document.getElementById('community-no-results').hidden).toBe(false);
        expect(document.getElementById('community-count').textContent).toBe('0 shown');

        search('');
        expect(Array.from(document.querySelectorAll('.community-card')).every((c) => !c.hidden)).toBe(true);
        expect(document.getElementById('community-no-results').hidden).toBe(true);
    });

    test('search is case-insensitive and matches any card text (e.g. the neighborhood name)', () => {
        setupDom(THREE_CARDS);
        newCommunityPage();
        search('bEtA sQuArE');
        expect(document.querySelector('[data-route-id="2"]').hidden).toBe(false);
        expect(document.querySelector('[data-route-id="1"]').hidden).toBe(true);
    });

    test('search use is logged once per page view, and never the typed query', () => {
        setupDom(THREE_CARDS);
        newCommunityPage();
        search('a');
        search('ab');
        const searchLogs = window.logWebpageActivity.mock.calls.filter(([a]) => a.includes('Search'));
        expect(searchLogs).toEqual([['Click_module=SpecPage_Search']]);
    });

    test('numeric desc sort reorders the DOM and falls back to newest-first on ties', () => {
        setupDom(
            THREE_CARDS +
            routeCard({ id: '4', created: 400, region: 'Gamma', distance: 20, text: 'Tie breaker' }));
        newCommunityPage();
        sortBy('longest');
        // 30, then the 20-tie (newer id 4 first), then 10.
        expect(cardIds()).toEqual(['2', '4', '3', '1']);
        expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=SpecPage_Sort=longest');
    });

    test('string sort orders alphabetically; newest restores recency order', () => {
        setupDom(THREE_CARDS);
        newCommunityPage();
        sortBy('neighborhood');
        // Alpha Park twice (newer card 1 first on the tie), then Beta Square.
        expect(cardIds()).toEqual(['1', '3', '2']);
        sortBy('newest');
        expect(cardIds()).toEqual(['1', '2', '3']);
    });

    test('sorting keeps operating on all cards while a search filter is active', () => {
        setupDom(THREE_CARDS);
        newCommunityPage();
        search('alpha park');
        sortBy('longest');
        expect(cardIds()).toEqual(['2', '3', '1']);
        expect(document.querySelector('[data-route-id="2"]').hidden).toBe(true); // Still filtered out.
    });

    test('server-rendered UTC dates are rewritten through moment in the reader\'s locale', () => {
        setupDom(routeCard({ id: '1', created: 1, region: 'A', text: 'x' })
            .replace('<h2>x</h2>', '<h2>x</h2><time class="community-date" datetime="2026-07-24T01:00:00Z">raw</time>'));
        newCommunityPage();
        expect(document.querySelector('.community-date').textContent).toBe('LOCALIZED-DATE');
    });
});

describe('StoryListPage', () => {
    /** A story card with the pieces StoryListPage touches; heights are stubbed per-test for the clamp check. */
    function storyCard({ id, storyId, text = 'story text', typeColor = '#78B0EA' }) {
        return `
            <li class="community-card story-card" ${storyId ? `data-story-id="${storyId}"` : ''}
                data-created="${id}" data-region="R" data-labeltype="Obstacle">
                <div class="story-card__body">
                    <p class="story-card__text">${text}</p>
                    <a class="story-card__location" href="/labelMap?labelId=${id}" data-label-id="${id}">loc</a>
                    <div class="story-card__foot">
                        <span class="community-chip community-chip--type" data-type-color="${typeColor}">t</span>
                        <a class="story-card__label-link" data-label-id="${id}" href="/labelMap?labelId=${id}">View</a>
                    </div>
                </div>
            </li>`;
    }

    /** Fakes the rendered geometry of a clamped text block (jsdom has no layout engine). */
    function stubHeights(el, { scrollHeight, clientHeight }) {
        Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
        Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
    }

    test('tints each type chip from its backend-sourced canonical color', () => {
        setupDom(storyCard({ id: '1' }));
        new window.StoryListPage().init();
        const chip = document.querySelector('.community-chip--type');
        // jsdom normalizes the #RRGGBB + 20%-alpha suffix into rgba(); the exact channels come from #78B0EA.
        expect(chip.style.backgroundColor).toBe('rgba(120, 176, 234, 0.2)');
    });

    test('adds a read-more toggle only to stories that overflow the clamp, and it expands/collapses', () => {
        setupDom(storyCard({ id: '1', text: 'long story' }) + storyCard({ id: '2', text: 'short story' }));
        const [long, short] = Array.from(document.querySelectorAll('.story-card__text'));
        stubHeights(long, { scrollHeight: 300, clientHeight: 110 });
        stubHeights(short, { scrollHeight: 44, clientHeight: 44 });
        new window.StoryListPage().init();

        expect(short.parentElement.querySelector('.story-card__read-more')).toBeNull();
        const toggle = long.parentElement.querySelector('.story-card__read-more');
        expect(toggle).not.toBeNull();
        expect(toggle.textContent).toBe('Read more');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');

        toggle.click();
        expect(long.classList.contains('is-expanded')).toBe(true);
        expect(toggle.textContent).toBe('Read less');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');

        toggle.click();
        expect(long.classList.contains('is-expanded')).toBe(false);
        expect(toggle.textContent).toBe('Read more');
    });

    test('view-label opens the popup (and suppresses navigation) once a LabelPopup is attached', () => {
        setupDom(storyCard({ id: '7' }));
        const page = new window.StoryListPage();
        page.init();
        const popup = { showLabel: jest.fn() };
        page.setLabelPopup(popup);

        const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
        document.querySelector('.story-card__label-link').dispatchEvent(event);
        expect(popup.showLabel).toHaveBeenCalledWith(7, 'StoryListPage');
        expect(event.defaultPrevented).toBe(true);
        expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=StoryListPage_ViewLabel_LabelId=7');
    });

    test('view-label falls back to plain navigation (default not prevented) when the popup never initialized', () => {
        setupDom(storyCard({ id: '7' }));
        new window.StoryListPage().init();
        const link = document.querySelector('.story-card__label-link');
        const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
        // jsdom can't navigate; swallow the default at the end of the dispatch without affecting the page's handler.
        link.addEventListener('click', (e) => e.preventDefault());
        link.dispatchEvent(event);
        expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=StoryListPage_ViewLabel_LabelId=7');
    });

    test('following the location line to the LabelMap is logged', () => {
        setupDom(storyCard({ id: '9' }));
        new window.StoryListPage().init();
        const link = document.querySelector('.story-card__location');
        link.addEventListener('click', (e) => e.preventDefault());
        link.click();
        expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=StoryListPage_Location_LabelId=9');
    });

    describe('card-wide click target', () => {
        /** Builds a page with a story card and a stub popup attached, and hands back the pieces a test needs. */
        function pageWithPopup(cardHtml) {
            setupDom(cardHtml);
            const page = new window.StoryListPage();
            page.init();
            const popup = { showLabel: jest.fn() };
            page.setLabelPopup(popup);
            return { page, popup };
        }

        function clickOn(selector) {
            document.querySelector(selector)
                .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
        }

        afterEach(() => window.getSelection().removeAllRanges());

        test('clicking the card body opens the label, the same as "View label" does', () => {
            const { popup } = pageWithPopup(storyCard({ id: '7' }));
            clickOn('.story-card__text');
            expect(popup.showLabel).toHaveBeenCalledWith(7, 'StoryListPage');
            expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=StoryListPage_Card_LabelId=7');
        });

        test('the card is only marked clickable once its handler is wired', () => {
            setupDom(storyCard({ id: '7' }));
            expect(document.querySelector('.story-card').classList.contains('story-card--clickable')).toBe(false);
            new window.StoryListPage().init();
            expect(document.querySelector('.story-card').classList.contains('story-card--clickable')).toBe(true);
        });

        test('"View label" still opens the label exactly once — the card handler stands down for it', () => {
            const { popup } = pageWithPopup(storyCard({ id: '7' }));
            clickOn('.story-card__label-link');
            expect(popup.showLabel).toHaveBeenCalledTimes(1);
            expect(window.logWebpageActivity)
                .not.toHaveBeenCalledWith(expect.stringContaining('StoryListPage_Card_'));
        });

        test('the location line keeps its own behavior instead of opening the popup over it', () => {
            const { popup } = pageWithPopup(storyCard({ id: '7' }));
            const link = document.querySelector('.story-card__location');
            link.addEventListener('click', (e) => e.preventDefault()); // jsdom can't navigate.
            link.click();
            expect(popup.showLabel).not.toHaveBeenCalled();
        });

        test('"read more" expands the story rather than opening the label', () => {
            setupDom(storyCard({ id: '7', text: 'long story' }));
            const text = document.querySelector('.story-card__text');
            stubHeights(text, { scrollHeight: 300, clientHeight: 110 });
            const page = new window.StoryListPage();
            page.init();
            const popup = { showLabel: jest.fn() };
            page.setLabelPopup(popup);

            document.querySelector('.story-card__read-more').click();
            expect(text.classList.contains('is-expanded')).toBe(true);
            expect(popup.showLabel).not.toHaveBeenCalled();
        });

        test('a click that ends a text selection leaves the reader on the page', () => {
            const { popup } = pageWithPopup(storyCard({ id: '7', text: 'Snow piles up here all winter.' }));
            const range = document.createRange();
            range.selectNodeContents(document.querySelector('.story-card__text'));
            window.getSelection().addRange(range);

            clickOn('.story-card__text');
            expect(popup.showLabel).not.toHaveBeenCalled();
        });

        test('without a LabelPopup the card click falls back to the label on the LabelMap', () => {
            setupDom(storyCard({ id: '7' }));
            new window.StoryListPage().init();
            clickOn('.story-card__text'); // The href navigation itself is a jsdom no-op.
            expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=StoryListPage_Card_LabelId=7');
        });
    });

    describe('share chips (#4722)', () => {
        const SHARE_SRC = fs.readFileSync(
            path.resolve(REPO_ROOT, 'public/js/common/share/ShareWidget.js'), 'utf8');

        /** Loads the real ShareWidget (the page builds one per card) plus the collaborators it reaches for. */
        function loadShareWidget() {
            window.eval(`${SHARE_SRC}\nwindow.ShareWidget = ShareWidget;`);
            // The share text key resolves with the excerpt interpolated; everything else echoes its key.
            window.i18next = { t: (key, opts) => (opts && opts.excerpt !== undefined ? `shared:${opts.excerpt}` : key) };
            window.matchMedia = jest.fn().mockReturnValue({ matches: false }); // jsdom has none; act as desktop.
        }

        afterEach(() => {
            delete window.ShareWidget;
            delete window.i18next;
        });

        test('each story card grows a footer share chip pointed at its story-anchored permalink', () => {
            setupDom(storyCard({ id: '7', storyId: '42', text: 'Snow piles up here all winter.' }));
            loadShareWidget();
            const setTarget = jest.spyOn(window.ShareWidget.prototype, 'setTarget');
            new window.StoryListPage().init();

            expect(document.querySelector(
                '.story-card__foot .story-card__share .label-detail__share-trigger')).not.toBeNull();
            expect(setTarget).toHaveBeenCalledTimes(1);
            const target = setTarget.mock.calls[0][0];
            expect(target.url).toBe('http://localhost/label/7?storyId=42');
            // The share text leads with the storyteller's words (share.story-text), not label boilerplate; the
            // title carries the same descriptive text (it feeds the native sheet and the email subject).
            expect(target.text).toBe('shared:Snow piles up here all winter.');
            expect(target.title).toBe(target.text);
        });

        test('long story text is excerpted at a word boundary with an ellipsis', () => {
            setupDom(storyCard({ id: '7', storyId: '42', text: 'word '.repeat(40).trim() }));
            loadShareWidget();
            const setTarget = jest.spyOn(window.ShareWidget.prototype, 'setTarget');
            new window.StoryListPage().init();

            const excerpt = setTarget.mock.calls[0][0].text.replace('shared:', '');
            expect(excerpt).toBe(`${'word '.repeat(18).trim()}…`); // Cut at the last space inside the 90-char cap.
        });

        test('opening the chip logs surface + story attribution', () => {
            setupDom(storyCard({ id: '7', storyId: '42' }));
            loadShareWidget();
            new window.StoryListPage().init();
            document.querySelector('.story-card__share .label-detail__share-trigger').click();
            expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=StoryCardShare_storyId=42');
        });

        test('a click that dismisses an open share menu does not also open the label', () => {
            setupDom(storyCard({ id: '7', storyId: '42' }));
            loadShareWidget();
            const page = new window.StoryListPage();
            page.init();
            const popup = { showLabel: jest.fn() };
            page.setLabelPopup(popup);

            document.querySelector('.story-card__share .label-detail__share-trigger').click();
            // ShareWidget closes on a capture-phase document listener, so by the time the card's own handler runs
            // the menu already looks closed; the card has to have noticed at pointerdown.
            document.querySelector('.story-card__text')
                .dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
            document.querySelector('.story-card__text')
                .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
            expect(popup.showLabel).not.toHaveBeenCalled();
        });

        test('a card without a story id gets no chip, and a missing ShareWidget leaves the page working', () => {
            setupDom(storyCard({ id: '7' })); // No data-story-id.
            loadShareWidget();
            new window.StoryListPage().init();
            expect(document.querySelector('.story-card__share')).toBeNull();

            delete window.ShareWidget; // The share script failed to load; cards must still initialize.
            setupDom(storyCard({ id: '8', storyId: '9' }));
            expect(() => new window.StoryListPage().init()).not.toThrow();
            expect(document.querySelector('.story-card__share')).toBeNull();
        });
    });
});

describe('RouteListPage', () => {
    beforeEach(() => {
        Object.defineProperty(window.navigator, 'clipboard', {
            configurable: true,
            value: { writeText: jest.fn() },
        });
        window.Toast = { show: jest.fn() };
        window.i18next = { t: (key) => key };
    });

    function routeCardWithActions({ id, slug = '' }) {
        return `
            <li class="community-card route-card" data-route-id="${id}" data-slug="${slug}" data-created="${id}"
                data-region="R" data-distance="1" data-explored="0">
                <div class="route-card__body">
                    <a class="route-card__explore" data-route-id="${id}" href="/explore?routeId=${id}">Explore</a>
                    <a class="route-card__labelmap" data-route-id="${id}" href="/labelMap?routes=${id}">Map</a>
                    <button type="button" class="route-card__copy" data-route-id="${id}">Copy</button>
                </div>
            </li>`;
    }

    test('copy prefers the /r/<slug> short link and confirms with a toast', () => {
        setupDom(routeCardWithActions({ id: '5', slug: 'abc123' }));
        new window.RouteListPage().init();
        const btn = document.querySelector('.route-card__copy');
        btn.click();
        expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost/r/abc123');
        expect(window.Toast.show).toHaveBeenCalledWith(expect.objectContaining({ reference: btn }));
        expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=RouteListPage_Copy_RouteId=5');
    });

    test('copy falls back to the routeId explore link for a card without a slug', () => {
        setupDom(routeCardWithActions({ id: '6' }));
        new window.RouteListPage().init();
        document.querySelector('.route-card__copy').click();
        expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost/explore?routeId=6');
    });

    test('explore and label-map clicks are logged with their route id', () => {
        setupDom(routeCardWithActions({ id: '8' }));
        new window.RouteListPage().init();
        for (const selector of ['.route-card__explore', '.route-card__labelmap']) {
            const link = document.querySelector(selector);
            link.addEventListener('click', (e) => e.preventDefault());
            link.click();
        }
        expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=RouteListPage_Explore_RouteId=8');
        expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=RouteListPage_LabelMap_RouteId=8');
    });
});
