/**
 * Tests for the map's street re-audit hover card (public/js/ps-map/StreetReauditCard.js, #5258).
 *
 * Four contracts matter. The card must not fetch what it already has, or a pointer sweeping a city's streets fires a
 * request per street it crosses. It must not open for a street the pointer has already left, since its data arrives
 * asynchronously. It must survive the pointer moving *into* it, which is the only way its Explore link can be
 * clicked (WCAG 1.4.13), and Escape must close it. And the label breakdown has to render through the shared
 * icon/type-name helpers rather than reinventing either.
 *
 * StreetReauditCard is a page-global `class` that reaches for globals, so the source is eval'd into jsdom with
 * mapboxgl, i18next, util, and moment stubbed.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CARD_SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/ps-map/StreetReauditCard.js'), 'utf8');

const STREET_ID = 776;

/** A summary shaped exactly as /contribution/street/:id/reauditSummary returns one. */
const SUMMARY = {
    street_edge_id: STREET_ID,
    last_audited_at: '2024-04-19T14:33:13.842Z',
    new_imagery_date: '2024-08-01',
    label_counts: [
        { label_type: 'NoSidewalk', count: 42 },
        { label_type: 'CurbRamp', count: 5 },
    ],
};

describe('the street re-audit hover card', () => {
    /** @returns {HTMLElement|null} The card's content element, if it is open. */
    const card = () => document.querySelector('.street-reaudit');
    /** Lets pending timers and promises settle. */
    const settle = async (ms = 0) => {
        jest.advanceTimersByTime(ms);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    };

    let map;
    let popupElement;

    beforeAll(() => {
        window.moment = (date) => ({
            format: (fmt) => `${fmt}:${date.toISOString().slice(0, 10)}`,
        });
        window.i18next = { language: 'en', t: (key) => key };
        window.util = {
            camelToKebab: (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(),
            misc: { getIconImagePaths: (type) => ({ iconImagePath: `/assets/icons/${type}_small.svg` }) },
        };
        // A Popup stub that renders into the document the way Mapbox does, so :hover and listeners are testable.
        window.mapboxgl = {
            Popup: class {
                setDOMContent(content) {
                    popupElement = document.createElement('div');
                    popupElement.className = 'mapboxgl-popup';
                    popupElement.appendChild(content);
                    return this;
                }

                setLngLat() { return this; }

                addTo() { document.body.appendChild(popupElement); return this; }

                getElement() { return popupElement; }

                remove() { popupElement.remove(); }
            },
        };
        window.eval(`${CARD_SRC}\nwindow.StreetReauditCard = StreetReauditCard;`);
    });

    beforeEach(() => {
        jest.useFakeTimers();
        document.body.innerHTML = '';
        popupElement = null;
        map = {};
        window.logWebpageActivity = jest.fn();
        global.fetch = jest.fn(async () => ({ ok: true, json: async () => SUMMARY }));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /**
     * Builds a card and hovers a street on it.
     * @param {object} [opts] - Card options passed through to the constructor.
     * @returns {object} The card.
     */
    const hoverStreet = (opts = {}) => {
        const instance = new window.StreetReauditCard(map, { mapName: 'labelmap-choropleth', ...opts });
        instance.scheduleFor(STREET_ID, { lng: 1, lat: 2 });
        return instance;
    };

    describe('opening', () => {
        it('waits out the hover delay before asking the server for anything', async () => {
            hoverStreet();

            await settle(200);
            expect(global.fetch).not.toHaveBeenCalled();

            await settle(100);
            expect(global.fetch).toHaveBeenCalledWith(`/contribution/street/${STREET_ID}/reauditSummary`);
            expect(card()).not.toBeNull();
        });

        it('drops a card whose street the pointer already left while the request was in flight', async () => {
            let respond;
            global.fetch = jest.fn(() => new Promise((resolve) => { respond = resolve; }));

            const instance = hoverStreet();
            await settle(250); // The delay elapses and the request goes out, but hangs.
            instance.cancelScheduled();
            respond({ ok: true, json: async () => SUMMARY });
            await settle(0);

            expect(card()).toBeNull();
        });

        it('says nothing at all for a street the server no longer considers stale', async () => {
            global.fetch = jest.fn(async () => ({ ok: false, status: 404 }));

            hoverStreet();
            await settle(250);

            expect(card()).toBeNull();
        });

        it('stays silent when the request fails outright rather than showing an empty card', async () => {
            global.fetch = jest.fn(async () => { throw new Error('offline'); });

            hoverStreet();
            await settle(250);

            expect(card()).toBeNull();
        });
    });

    describe('caching', () => {
        it('fetches a street once however often it is hovered', async () => {
            const instance = hoverStreet();
            await settle(250);
            instance.hide();
            instance.scheduleFor(STREET_ID, { lng: 1, lat: 2 });
            await settle(250);

            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(card()).not.toBeNull();
        });

        it('does not re-arm for the street already shown, so sliding along one street is one request', async () => {
            const instance = hoverStreet();
            await settle(250);
            instance.scheduleFor(STREET_ID, { lng: 1, lat: 2 });
            instance.scheduleFor(STREET_ID, { lng: 1, lat: 2 });
            await settle(250);

            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        it('remembers a 404 rather than re-asking about the same street', async () => {
            global.fetch = jest.fn(async () => ({ ok: false, status: 404 }));

            const instance = hoverStreet();
            await settle(250);
            instance.scheduleFor(STREET_ID, { lng: 1, lat: 2 });
            await settle(250);

            expect(global.fetch).toHaveBeenCalledTimes(1);
        });
    });

    describe('dismissal', () => {
        it('survives the pointer moving into it, so its Explore link is reachable', async () => {
            const instance = hoverStreet();
            await settle(250);
            // jsdom has no real hover, so stand in for the pointer being inside the card.
            popupElement.matches = (selector) => selector === ':hover';

            instance.scheduleHide();
            await settle(200);

            expect(card()).not.toBeNull();
        });

        it('closes once the pointer is in neither the street nor the card', async () => {
            const instance = hoverStreet();
            await settle(250);
            popupElement.matches = () => false;

            instance.scheduleHide();
            await settle(200);

            expect(card()).toBeNull();
        });

        it('closes on Escape (WCAG 1.4.13)', async () => {
            hoverStreet();
            await settle(250);
            expect(card()).not.toBeNull();

            document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));

            expect(card()).toBeNull();
        });
    });

    describe('content', () => {
        it('renders each label type through the shared icon and type-name helpers, most frequent first', async () => {
            hoverStreet();
            await settle(250);

            const types = [...document.querySelectorAll('.street-reaudit__type')].map((el) => el.textContent.trim());
            const icons = [...document.querySelectorAll('.street-reaudit__type img')];
            expect(types).toEqual(['common:no-sidewalk', 'common:curb-ramp']);
            expect(icons.map((i) => i.getAttribute('src')))
                .toEqual(['/assets/icons/NoSidewalk_small.svg', '/assets/icons/CurbRamp_small.svg']);
            // The type name beside it is the accessible text, so the icon must not repeat it.
            expect(icons.every((i) => i.getAttribute('alt') === '')).toBe(true);
            expect([...document.querySelectorAll('.street-reaudit__count')].map((el) => el.textContent))
                .toEqual(['42', '5']);
        });

        it('offers a street with no labels left an explanation rather than an empty table', async () => {
            global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ...SUMMARY, label_counts: [] }) }));

            hoverStreet();
            await settle(250);

            expect(document.querySelector('.street-reaudit__labels')).toBeNull();
            expect(document.querySelector('.street-reaudit__empty').textContent.trim())
                .toBe('labelmap:reaudit-card-none');
        });

        it('omits the imagery row when the latest poll cleared the capture date', async () => {
            global.fetch = jest.fn(async () => (
                { ok: true, json: async () => ({ ...SUMMARY, new_imagery_date: null }) }));

            hoverStreet();
            await settle(250);

            expect(document.querySelector('.street-reaudit__facts').textContent)
                .not.toContain('labelmap:reaudit-card-new-imagery');
            expect(card()).not.toBeNull();
        });

        it('links to Explore for the street it describes, and logs the click', async () => {
            hoverStreet();
            await settle(250);

            const link = document.querySelector('.street-reaudit__explore');
            expect(link.getAttribute('href')).toBe(`/explore?streetEdgeId=${STREET_ID}`);

            link.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
            expect(window.logWebpageActivity).toHaveBeenCalledWith(
                `Click_module=labelmap-choropleth_action=StreetReauditCardExplore_streetId=${STREET_ID}`
            );
        });

        it('stays quiet on maps that opted out of click logging', async () => {
            hoverStreet({ logClicks: false });
            await settle(250);

            document.querySelector('.street-reaudit__explore')
                .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

            expect(window.logWebpageActivity).not.toHaveBeenCalled();
        });
    });
});
