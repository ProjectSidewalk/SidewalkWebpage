/**
 * The AccessScore Spotlight module's state logic (public/js/AccessScoreSpotlight.js, issue #5215).
 *
 * Almost every Project Sidewalk city is short of the data needed to rank five neighborhoods, so which of the module's
 * states a visitor sees is decided by the feed far more often than by the happy path. These pin that decision table —
 * which unit it opens on, when the second column becomes the "help the next one across the line" ask, when the whole
 * section hides — plus the two things the rows are for: a deep link into the right city's AccessScore tool, and the
 * map feature a hovered row lights up.
 *
 * The module is a bare top-level `class` that reaches for page globals, so the source is eval'd into jsdom with its
 * collaborators stubbed out.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'public/js/AccessScoreSpotlight.js'), 'utf8');

/** Every feature-state call the module made, in order, as `source:id -> hover`. */
let featureStates = [];
/** Every logged activity string, in order. */
let logged = [];

/** A region row of the shape /v3/api/accessScoreSpotlight returns. */
function regionRow(id, name, score, completion = 0.9, extra = {}) {
    return {
        region_id: id, name, score, completion_rate: completion, audited_distance_m: 1000, total_distance_m: 2500,
        cluster_count: 1234, ...extra,
    };
}

/** A street row of the same shape. */
function streetRow(wayId, name, score, extra = {}) {
    return {
        osm_way_id: wayId, street_edge_id: wayId * 10, region_id: 7, region_name: 'Ballard', name, score,
        length_m: 1200, cluster_count: 4, validation_count: 3, ...extra,
    };
}

/** A whole feed, with the envelope fields the module reads. */
function feed(unit, { qualifying = 0, total = 0, top = [], bottom = [], nearest = [], computedAt = null } = {}) {
    return {
        unit,
        min_completion: 0.8,
        min_street_length_m: 100,
        highest_min_score: 0.5,
        lowest_max_score: 0.5,
        qualifying,
        total,
        computed_at: computedAt,
        top,
        bottom,
        nearest,
    };
}

/** Five ranked region rows, i.e. enough for a top-and-bottom city. */
const FIVE_REGIONS = [1, 2, 3, 4, 5].map((i) => regionRow(i, `Region ${i}`, 0.9 - i * 0.1));

describe('the AccessScore Spotlight', () => {
    /**
     * Mounts the module with the given feeds already answered.
     *
     * @param {object} feeds - `{ regions, streets }`; a null feed stands for a request that failed.
     * @param {object} [options] - Passed through to the constructor.
     * @returns {Promise<HTMLElement>} The section element.
     */
    async function mount(feeds, options = {}) {
        featureStates = [];
        logged = [];
        document.body.innerHTML = `
            <section id="spotlight-section" hidden>
              <div class="section-title-and-subtitle">
                <h2 class="section-title">Where scores are highest and lowest</h2>
                <div class="section-subtitle spotlight-subtitle"></div>
              </div>
              <div class="spotlight"></div>
            </section>`;
        window.fetch = jest.fn((url) => Promise.resolve({
            ok: true,
            json: () => Promise.resolve(url.includes('unit=streets') ? feeds.streets : feeds.regions),
        }));
        // A null feed is a failed request, which the module reports as a fetch that did not answer with JSON.
        if (feeds.regions === null || feeds.streets === null) {
            window.fetch = jest.fn((url) => {
                const wanted = url.includes('unit=streets') ? feeds.streets : feeds.regions;
                return wanted === null
                    ? Promise.resolve({ ok: false, status: 500 })
                    : Promise.resolve({ ok: true, json: () => Promise.resolve(wanted) });
            });
        }

        let start;
        window.util.onFirstInteractionOrIdle = (fn) => { start = fn; };
        const section = document.getElementById('spotlight-section');
        const module = new window.AccessScoreSpotlight(section, options);
        expect(module).toBeInstanceOf(window.AccessScoreSpotlight);
        await start();
        return section;
    }

    /** The heading text of each rendered column. */
    const columnHeadings = () => [...document.querySelectorAll('.spotlight-col-heading')].map((h) => h.textContent);

    /** The name link text of each rendered row, in document order. */
    const rowNames = () => [...document.querySelectorAll('.spotlight-name-link')].map((n) => n.textContent);

    /**
     * The few strings rendered for real, so a test can see what a reader would: the subtitle's link, and values
     * that i18next's default escaping would mangle in a text node.
     */
    const STRINGS = {
        'common:access-score-spotlight.subtitle-regions': 'Scored by our <a href="{{href}}">AccessScore</a> algorithm.',
        'common:access-score-spotlight.street-sub': '{{region}} · {{length}}',
        'common:access-score-spotlight.updated-last': 'Last updated {{date}}.',
        'common:access-score-spotlight.explore-region': 'Explore {{name}}',
    };

    /** i18next's default interpolation escaping, character for character. */
    const escapeLikeI18next = (value) => String(value).replace(/[&<>"'/]/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;', '/': '&#x2F;',
    })[c]);

    beforeAll(() => {
        // Keys pass through, with interpolation values appended so a test can tell two renderings of one key apart,
        // except the STRINGS above, which interpolate the way the app configures i18next: values verbatim, escaped
        // only where the call asks for it.
        window.i18next = {
            language: 'en',
            t: (key, vars) => {
                if (STRINGS[key]) {
                    const escape = vars?.interpolation?.escapeValue === true;
                    return STRINGS[key].replace(/\{\{(\w+)\}\}/g, (_, name) => (
                        escape ? escapeLikeI18next(vars[name]) : String(vars[name])
                    ));
                }
                return vars ? `${key}|${JSON.stringify(vars)}` : key;
            },
        };
        window.util = {
            onFirstInteractionOrIdle: () => {},
            distanceToString: (m) => `${m} m`,
            longDistanceToString: (km, precision) => `${km.toFixed(precision)} km`,
        };
        window.ScoreRamp = {
            colors: () => ['#a', '#b', '#c', '#d', '#e'],
            at: (score) => `score:${score}`,
        };
        window.logWebpageActivity = (activity) => logged.push(activity);
        // Stands in for a loaded Mapbox map; the module only ever reads a source and sets a feature state on it.
        const fakeMap = (sources) => ({
            getSource: (name) => (sources.includes(name) ? {} : undefined),
            setFeatureState: ({ source, id }, state) => featureStates.push(`${source}:${id} -> ${state.hover}`),
        });
        window.choropleth = fakeMap(['region-polygons']);
        window.citiesMap = fakeMap(['cities']);
        window.eval(`${SRC}\nwindow.AccessScoreSpotlight = AccessScoreSpotlight;`);
    });

    describe('which unit it opens on', () => {
        it('opens on neighborhoods once five of them are ranked', async () => {
            await mount({
                regions: feed('regions', { qualifying: 5, total: 12, top: FIVE_REGIONS, bottom: FIVE_REGIONS }),
                streets: feed('streets', { qualifying: 400, total: 900, top: [streetRow(1, 'NW Market St', 0.9)] }),
            });

            expect(document.querySelector('.spotlight-unit[aria-pressed="true"]').textContent)
                .toBe('common:access-score-spotlight.unit-regions');
        });

        it('opens on streets in a young city, where they qualify long before a neighborhood does', async () => {
            await mount({
                regions: feed('regions', { qualifying: 2, total: 9, top: FIVE_REGIONS.slice(0, 2) }),
                streets: feed('streets', { qualifying: 40, total: 900, top: [streetRow(1, 'Main St', 0.7)] }),
            });

            expect(document.querySelector('.spotlight-unit[aria-pressed="true"]').textContent)
                .toBe('common:access-score-spotlight.unit-streets');
        });

        it('opens on neighborhoods when no street qualifies, whatever the neighborhood count', async () => {
            await mount({
                regions: feed('regions', { qualifying: 1, total: 9, top: [regionRow(1, 'Downtown', 0.71)] }),
                streets: feed('streets', { qualifying: 0, total: 900 }),
            });

            expect(document.querySelector('.spotlight-unit[aria-pressed="true"]').textContent)
                .toBe('common:access-score-spotlight.unit-regions');
        });

        it('opens on streets in a city mapped as a single neighborhood', async () => {
            // One region is never two lists, so the interesting view for such a city is its streets.
            await mount({
                regions: feed('regions', { qualifying: 1, total: 1, top: [regionRow(1, 'Oradell', 0.62)] }),
                streets: feed('streets', { qualifying: 30, total: 200, top: [streetRow(1, 'Kinderkamack Rd', 0.5)] }),
            });

            expect(document.querySelector('.spotlight-unit[aria-pressed="true"]').textContent)
                .toBe('common:access-score-spotlight.unit-streets');
        });
    });

    describe('what it shows', () => {
        it('shows a highest and a lowest list once enough units are ranked', async () => {
            await mount({
                regions: feed('regions', {
                    qualifying: 66,
                    total: 79,
                    top: FIVE_REGIONS,
                    bottom: [regionRow(9, 'South Park', 0.31)],
                }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            });

            // The two headings carry their bar (the "and their bars" suite pins the number).
            expect(columnHeadings().map((h) => h.split('|')[0])).toEqual([
                'common:access-score-spotlight.highest', 'common:access-score-spotlight.lowest',
            ]);
            expect(rowNames()).toContain('South Park');
        });

        it('turns the second column into the call to action while the city is short of ranked places', async () => {
            await mount({
                regions: feed('regions', {
                    qualifying: 2,
                    total: 9,
                    top: [regionRow(1, 'Downtown', 0.71), regionRow(2, 'Hillside', 0.58)],
                    nearest: [regionRow(3, 'Riverside', null, 0.67), regionRow(4, 'Soldier Hill', null, 0.41)],
                }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            });

            expect(columnHeadings()).toEqual([
                'common:access-score-spotlight.ranked-so-far', 'common:access-score-spotlight.closest',
            ]);
            // The ask is a mission in that neighborhood, the same link a choropleth click follows.
            const explore = document.querySelectorAll('.spotlight-explore');
            expect(explore).toHaveLength(2);
            expect(explore[0].getAttribute('href')).toBe('/explore?regionId=3');
            // A pending row has no score, so its bar is the completion meter instead.
            expect(document.querySelector('.spotlight-row--pending .spotlight-bar').style.width).toBe('67%');
        });

        it('shows one list and no comparison for a city mapped as a single neighborhood', async () => {
            await mount({
                regions: feed('regions', { qualifying: 1, total: 1, top: [regionRow(1, 'Oradell', 0.62)] }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            });

            expect(columnHeadings()).toEqual(['common:access-score-spotlight.ranked-so-far']);
            expect(document.querySelectorAll('.spotlight-explore')).toHaveLength(0);
        });

        it('hides itself when neither unit has anything ranked', async () => {
            const section = await mount({
                regions: feed('regions', { qualifying: 0, total: 9 }),
                streets: feed('streets', { qualifying: 0, total: 900 }),
            });

            expect(section.hidden).toBe(true);
        });

        it('hides itself when the feed cannot be loaded at all', async () => {
            const section = await mount({ regions: null, streets: null });

            expect(section.hidden).toBe(true);
        });

        it('holds its space with skeleton rows before the feed arrives', () => {
            document.body.innerHTML = '<section id="s" hidden><div class="spotlight"></div></section>';
            window.util.onFirstInteractionOrIdle = () => {}; // Never fires: this is the pre-fetch state.
            const section = document.getElementById('s');
            new window.AccessScoreSpotlight(section);

            expect(section.hidden).toBe(false);
            expect(document.querySelectorAll('.spotlight-row--skeleton').length).toBeGreaterThan(0);
        });

        it('redraws on the unit switch without refetching', async () => {
            await mount({
                regions: feed('regions', { qualifying: 6, total: 9, top: [regionRow(1, 'Downtown', 0.71)] }),
                streets: feed('streets', { qualifying: 9, total: 90, top: [streetRow(1, 'Main St', 0.8)] }),
            });
            const callsAfterLoad = window.fetch.mock.calls.length;

            document.querySelectorAll('.spotlight-unit')[1].click();

            expect(rowNames()).toContain('Main St');
            expect(window.fetch.mock.calls.length).toBe(callsAfterLoad);
            expect(logged).toContain('Click_module=AccessScoreSpotlightUnit_unit=streets');
        });
    });

    describe('where a row goes', () => {
        it('links a neighborhood into this city\'s AccessScore tool, at that neighborhood', async () => {
            await mount({
                regions: feed('regions', { qualifying: 6, total: 9, top: [regionRow(42, 'Capitol Hill', 0.84)] }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            });

            expect(document.querySelector('.spotlight-name-link').getAttribute('href'))
                .toBe('/accessScore?unit=regions&sel=42');
        });

        it('links a street by its representative edge, which is what the tool selects on', async () => {
            await mount({
                regions: feed('regions', { qualifying: 0, total: 0 }),
                streets: feed('streets', { qualifying: 9, total: 90, top: [streetRow(77, 'Broadway E', 0.98)] }),
            });

            expect(document.querySelector('.spotlight-name-link').getAttribute('href'))
                .toBe('/accessScore?unit=streets&sel=770');
            // Length says how much sidewalk the score speaks for, which matters for a street and not a neighborhood.
            expect(document.querySelector('.spotlight-sub').textContent).toContain('1.2 km');
        });

        it('sends a cross-city row to that city\'s own tool, and offers the city itself as a second link', async () => {
            const city = { city_id: 'seattle-wa', city_name: 'Seattle', city_url: 'https://sidewalk-sea.example' };
            await mount({
                regions: feed('regions', {
                    qualifying: 6, total: 9, top: [regionRow(42, 'Capitol Hill', 0.84, 0.97, city)],
                }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            }, { crossCity: true });

            expect(document.querySelector('.spotlight-name-link').getAttribute('href'))
                .toBe('https://sidewalk-sea.example/accessScore?unit=regions&sel=42');
            expect(document.querySelector('.spotlight-sub-link').getAttribute('href'))
                .toBe('https://sidewalk-sea.example');
            // There is no single tool to send a cross-city visitor to, so the section-level CTA is dropped.
            expect(document.querySelector('.spotlight-cta')).toBeNull();
        });

        it('logs the click with the unit and the id, and the city when there is one', async () => {
            const city = { city_id: 'seattle-wa', city_name: 'Seattle', city_url: 'https://sidewalk-sea.example' };
            await mount({
                regions: feed('regions', {
                    qualifying: 6, total: 9, top: [regionRow(42, 'Capitol Hill', 0.84, 0.97, city)],
                }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            }, { crossCity: true });

            document.querySelector('.spotlight-name-link').click();

            expect(logged).toContain('Click_module=AccessScoreSpotlight_unit=regions_id=42_city=seattle-wa');
        });

        it('follows the name link from a click anywhere on the row, keeping the modifier keys', async () => {
            const city = { city_id: 'seattle-wa', city_name: 'Seattle', city_url: 'https://sidewalk-sea.example' };
            await mount({
                regions: feed('regions', {
                    qualifying: 6, total: 9, top: [regionRow(42, 'Capitol Hill', 0.84, 0.97, city)],
                }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            }, { crossCity: true });
            const row = document.querySelector('.spotlight-row');
            const link = row.querySelector('.spotlight-name-link');
            const seen = [];
            link.addEventListener('click', (e) => seen.push(e.metaKey ? 'meta' : 'plain'));

            // The score cell is nowhere near the link; the click still lands on it, and the log sees one click.
            row.querySelector('.spotlight-score').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
            row.querySelector('.spotlight-track').dispatchEvent(
                new window.MouseEvent('click', { bubbles: true, metaKey: true }),
            );
            expect(seen).toEqual(['plain', 'meta']);
            expect(logged.filter((entry) => entry.startsWith('Click_module=AccessScoreSpotlight_unit'))).toHaveLength(2);

            // The city link is its own destination, so a click on it is not redirected to the tool.
            row.querySelector('.spotlight-sub-link').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
            expect(seen).toHaveLength(2);
            expect(row.classList.contains('spotlight-row--linked')).toBe(true);
        });

        it('sends a click anywhere on a pending row to its Explore button', async () => {
            await mount({
                regions: feed('regions', {
                    qualifying: 1, total: 9, top: [regionRow(1, 'Ranked', 0.5)],
                    nearest: [regionRow(3, 'Nearly', null, 0.67)],
                }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            });

            const pending = document.querySelector('.spotlight-row--pending');
            pending.querySelector('.spotlight-name-link').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

            expect(logged).toContain('Click_module=AccessScoreSpotlightExplore_regionId=3');
        });
    });

    describe('the map highlight', () => {
        it('lights the hovered neighborhood on the choropleth and clears it on the way out', async () => {
            await mount({
                regions: feed('regions', { qualifying: 6, total: 9, top: [regionRow(42, 'Capitol Hill', 0.84)] }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            });
            const row = document.querySelector('.spotlight-row');

            row.dispatchEvent(new window.Event('mouseenter'));
            expect(row.classList.contains('highlighted')).toBe(true);
            expect(featureStates).toContain('region-polygons:42 -> true');

            row.dispatchEvent(new window.Event('mouseleave'));
            expect(row.classList.contains('highlighted')).toBe(false);
            expect(featureStates).toContain('region-polygons:42 -> false');
        });

        it('lights a street row\'s neighborhood, since the choropleth draws no streets', async () => {
            await mount({
                regions: feed('regions', { qualifying: 0, total: 0 }),
                streets: feed('streets', { qualifying: 9, total: 90, top: [streetRow(77, 'Broadway E', 0.98)] }),
            });

            document.querySelector('.spotlight-row').dispatchEvent(new window.Event('mouseenter'));

            expect(featureStates).toContain('region-polygons:7 -> true');
        });

        it('lights the city circle on /cities instead of a neighborhood polygon', async () => {
            const city = { city_id: 'seattle-wa', city_name: 'Seattle', city_url: 'https://sidewalk-sea.example' };
            await mount({
                regions: feed('regions', {
                    qualifying: 6, total: 9, top: [regionRow(42, 'Capitol Hill', 0.84, 0.97, city)],
                }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            }, { crossCity: true });

            document.querySelector('.spotlight-row').dispatchEvent(new window.Event('mouseenter'));

            expect(featureStates).toContain('cities:seattle-wa -> true');
        });

        it('follows keyboard focus, so the highlight is not mouse-only', async () => {
            await mount({
                regions: feed('regions', { qualifying: 6, total: 9, top: [regionRow(42, 'Capitol Hill', 0.84)] }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            });
            const row = document.querySelector('.spotlight-row');

            row.dispatchEvent(new window.Event('focusin', { bubbles: true }));

            expect(row.classList.contains('highlighted')).toBe(true);
            expect(featureStates).toContain('region-polygons:42 -> true');
        });

        it('logs a row hover once per page view, so running down a list is not a flood', async () => {
            await mount({
                regions: feed('regions', { qualifying: 6, total: 9, top: [regionRow(42, 'Capitol Hill', 0.84)] }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            });
            const row = document.querySelector('.spotlight-row');

            for (let i = 0; i < 4; i++) {
                row.dispatchEvent(new window.Event('mouseenter'));
                row.dispatchEvent(new window.Event('mouseleave'));
            }

            const hovers = logged.filter((entry) => entry.startsWith('Hover_module=AccessScoreSpotlight'));
            expect(hovers).toEqual(['Hover_module=AccessScoreSpotlight_unit=regions_id=42']);
        });

        it('names the city in a cross-city hover, since two cities can share a region id', async () => {
            const a = { city_id: 'a-city', city_name: 'A', city_url: 'https://a.example' };
            const b = { city_id: 'b-city', city_name: 'B', city_url: 'https://b.example' };
            await mount({
                regions: feed('regions', {
                    qualifying: 6, total: 9, top: [regionRow(1, 'A one', 0.9, 0.9, a), regionRow(1, 'B one', 0.8, 0.9, b)],
                }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            }, { crossCity: true });

            document.querySelectorAll('.spotlight-row').forEach((row) => row.dispatchEvent(new window.Event('mouseenter')));

            expect(logged.filter((entry) => entry.startsWith('Hover_module=AccessScoreSpotlight'))).toEqual([
                'Hover_module=AccessScoreSpotlight_unit=regions_id=1_city=a-city',
                'Hover_module=AccessScoreSpotlight_unit=regions_id=1_city=b-city',
            ]);
        });

        it('says nothing when the map stack has not finished loading', async () => {
            const realChoropleth = window.choropleth;
            window.choropleth = undefined; // Both load on the same first-interaction gate; either can win.
            try {
                await mount({
                    regions: feed('regions', { qualifying: 6, total: 9, top: [regionRow(42, 'Capitol Hill', 0.84)] }),
                    streets: feed('streets', { qualifying: 0, total: 0 }),
                });
                const row = document.querySelector('.spotlight-row');

                expect(() => row.dispatchEvent(new window.Event('mouseenter'))).not.toThrow();
                expect(row.classList.contains('highlighted')).toBe(true);
                expect(featureStates).toEqual([]);
            } finally {
                window.choropleth = realChoropleth;
            }
        });
    });

    it('logs the view once, with the unit shown and how many rows it drew', async () => {
        await mount({
            regions: feed('regions', {
                qualifying: 66, total: 79, top: FIVE_REGIONS, bottom: FIVE_REGIONS.slice(0, 3),
            }),
            streets: feed('streets', { qualifying: 0, total: 0 }),
        });

        const views = logged.filter((entry) => entry.startsWith('View_module=AccessScoreSpotlight'));
        expect(views).toEqual(['View_module=AccessScoreSpotlight_unit=regions_count=8']);

        // A unit switch is a separate event; the view is the section being seen, and it is seen once.
        document.querySelectorAll('.spotlight-unit')[1].click();
        expect(logged.filter((entry) => entry.startsWith('View_module=AccessScoreSpotlight'))).toEqual(views);
    });

    it('takes both floors from the feed rather than restating the backend\'s rules', async () => {
        await mount({
            regions: feed('regions', { qualifying: 2, total: 9, top: FIVE_REGIONS.slice(0, 2) }),
            streets: feed('streets', { qualifying: 3, total: 90, top: [streetRow(1, 'NW Market St', 0.9)] }),
        });

        // The footnote quotes the completion floor the feed published, as a percent, and the street length floor
        // in the reader's units.
        // (Two ranked neighborhoods is short of a list, so the module opens on streets.)
        const note = () => document.querySelector('.spotlight-note').textContent;
        expect(note()).toContain('common:access-score-spotlight.count-streets');
        expect(note()).toContain('"minLength":"100 m"');
        document.querySelectorAll('.spotlight-unit')[0].click();
        expect(note()).toContain('common:access-score-spotlight.count-regions');
        expect(note()).toContain('"percent":80');
    });

    describe('what a row says under its name', () => {
        it('gives a neighborhood its size and the evidence behind the score, so every row is two lines', async () => {
            await mount({
                regions: feed('regions', {
                    qualifying: 6, total: 9, top: [regionRow(42, 'Capitol Hill', 0.84, 0.97, {
                        total_distance_m: 14600, cluster_count: 6120,
                    })],
                }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            });

            const sub = document.querySelector('.spotlight-row .spotlight-sub').textContent;
            expect(sub).toContain('common:access-score-spotlight.region-sub');
            expect(sub).toContain('"length":"14.6 km"');
            expect(sub).toContain('"clusters":"6,120"');
        });

        it('tells a neighborhood still short of the floor how big it is and how far along', async () => {
            await mount({
                regions: feed('regions', {
                    qualifying: 1, total: 9, top: [regionRow(1, 'Ranked', 0.5)],
                    nearest: [regionRow(3, 'Nearly', null, 0.67, { total_distance_m: 3000 })],
                }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            });

            const sub = document.querySelector('.spotlight-row--pending .spotlight-sub').textContent;
            expect(sub).toContain('common:access-score-spotlight.region-sub-pending');
            expect(sub).toContain('"length":"3.0 km"');
            expect(sub).toContain('"percent":67');
        });
    });

    describe('the two lists and their bars', () => {
        it('quotes each list\'s bar in its heading, from the feed', async () => {
            await mount({
                regions: feed('regions', { qualifying: 6, total: 9, top: FIVE_REGIONS, bottom: [regionRow(9, 'Low', 0.2)] }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            });

            const headings = columnHeadings();
            expect(headings[0]).toContain('common:access-score-spotlight.highest');
            expect(headings[0]).toContain('"score":50');
            expect(headings[1]).toContain('common:access-score-spotlight.lowest');
            expect(headings[1]).toContain('"score":50');
        });

        it('says so when nothing clears a list\'s bar, instead of filling it from the other side', async () => {
            await mount({
                regions: feed('regions', { qualifying: 6, total: 9, top: [], bottom: FIVE_REGIONS }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            });

            const empty = document.querySelector('.spotlight-row--empty');
            expect(empty.textContent).toContain('common:access-score-spotlight.empty-highest-regions');
            expect(empty.textContent).toContain('"score":50');
            // The empty line is not a row: it has no link, no bar, and lights nothing.
            expect(empty.querySelector('.spotlight-name-link')).toBeNull();
            expect(document.querySelectorAll('.spotlight-row--empty')).toHaveLength(1);
        });

        it('does not offer a unit whose feed failed, so switching can never blank the section', async () => {
            const section = await mount({
                regions: null,
                streets: feed('streets', { qualifying: 9, total: 90, top: [streetRow(1, 'NW Market St', 0.9)] }),
            });

            expect(section.hidden).toBe(false);
            expect([...document.querySelectorAll('.spotlight-unit')].map((b) => b.textContent))
                .toEqual(['common:access-score-spotlight.unit-streets']);
        });
    });

    describe('the "Updated nightly" tip', () => {
        const mountWithTip = () => mount({
            regions: feed('regions', {
                qualifying: 6, total: 9, top: [regionRow(42, 'Capitol Hill', 0.84)], computedAt: '2026-09-16T20:57:30Z',
            }),
            streets: feed('streets', { qualifying: 0, total: 0 }),
        });
        const tip = () => document.querySelector('.spotlight-tip');
        const info = () => document.querySelector('.spotlight-info');

        it('stays open after a tap: focus then click is one gesture, not a show and a hide', async () => {
            await mountWithTip();
            info().dispatchEvent(new window.Event('focus'));
            expect(tip().hidden).toBe(false);
            info().click();
            expect(tip().hidden).toBe(false);
            expect(info().getAttribute('aria-expanded')).toBe('true');
            // A second click closes it.
            info().click();
            expect(tip().hidden).toBe(true);
            expect(info().getAttribute('aria-expanded')).toBe('false');
        });

        it('survives the pointer leaving the button while pinned, and closes on Escape from anywhere', async () => {
            await mountWithTip();
            info().dispatchEvent(new window.Event('mouseenter'));
            info().click();
            document.querySelector('.spotlight-updated').dispatchEvent(new window.Event('mouseleave'));
            expect(tip().hidden).toBe(false);

            // Focus is nowhere near the tip; Escape still dismisses it (WCAG 1.4.13).
            document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(tip().hidden).toBe(true);
        });

        it('hides on leaving the wrapper when only hovered, so an unpinned tip never lingers', async () => {
            await mountWithTip();
            info().dispatchEvent(new window.Event('mouseenter'));
            expect(tip().hidden).toBe(false);
            document.querySelector('.spotlight-updated').dispatchEvent(new window.Event('mouseleave'));
            expect(tip().hidden).toBe(true);
        });
    });

    describe('text that i18next would otherwise escape', () => {
        it('prints an apostrophe in a neighborhood name as an apostrophe, in text and in an accessible name', async () => {
            await mount({
                regions: feed('regions', {
                    qualifying: 1, total: 9, top: [regionRow(1, 'Ranked', 0.5)],
                    nearest: [regionRow(3, "Al 'Ummah Community Center", null, 0.67)],
                }),
                streets: feed('streets', {
                    qualifying: 9, total: 90,
                    top: [streetRow(77, 'Queen Anne Road', 0.98, { region_name: "Al 'Ummah Community Center" })],
                }),
            });

            // Opens on streets: one ranked neighborhood is short of a list.
            expect(document.querySelector('.spotlight-sub').textContent).toBe("Al 'Ummah Community Center · 1.2 km");
            document.querySelectorAll('.spotlight-unit')[0].click();
            expect(document.querySelector('.spotlight-explore').getAttribute('aria-label'))
                .toBe("Explore Al 'Ummah Community Center");
        });

        it('prints the last-updated date with its slashes, to the minute', async () => {
            await mount({
                regions: feed('regions', {
                    qualifying: 6, total: 9, top: [regionRow(42, 'Capitol Hill', 0.84)],
                    computedAt: '2026-09-16T20:57:30Z',
                }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            });

            const tip = document.querySelector('.spotlight-tip').textContent;
            expect(tip).not.toContain('&#x2F;');
            // The day depends on the worker's zone; newer ICU puts a narrow no-break space before AM/PM.
            expect(tip).toMatch(/Last updated Sep 1[67], 2026, \d{1,2}:\d{2}[\s\u202f][AP]M\.$/);
        });

        it('links "AccessScore" in the subtitle to how the score is computed', async () => {
            await mount({
                regions: feed('regions', { qualifying: 6, total: 9, top: [regionRow(42, 'Capitol Hill', 0.84)] }),
                streets: feed('streets', { qualifying: 0, total: 0 }),
            });

            const link = document.querySelector('.spotlight-subtitle a');
            expect(link.textContent).toBe('AccessScore');
            expect(link.getAttribute('href')).toBe('/v3/api-docs/accessScoreStreets#scoring-model');
        });
    });
});
