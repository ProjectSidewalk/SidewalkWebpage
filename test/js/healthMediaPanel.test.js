/**
 * Tests for the Health dashboard's Media storage panel (public/js/admin-dashboard/HealthPage.js, issue #4926).
 *
 * The panel is the human-readable half of the tripwire #4925 went without: a story photo was destroyed by a deploy
 * and answered 404 for six days with nothing anywhere saying so. Its failure mode is quiet in both directions —
 * showing zeros for a city it could not actually scan reads as "all present", and painting a dev checkout red for
 * the relative defaults it is supposed to use teaches everyone to ignore the panel entirely.
 *
 * So every judgment call here belongs to the server (MediaIntegrity computes each row's label and severity, and
 * HealthMediaPayloadSpec pins the field names below). What is tested here is that the page renders what it was told
 * and invents nothing: an unscanned city must not read as a clean one, and the KPI must never call an unknown
 * healthy.
 *
 * The class is a plain top-level declaration (no window assignment), so the source is eval'd with an explicit
 * window epilogue, the way the other class suites do it.
 */

const fs = require('fs');
const path = require('path');

const PAGE_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard/HealthPage.js'), 'utf8'
);

/** The panel's containers, plus the KPI tile it fills. Absent ids are no-ops, so only what's asserted is needed. */
const MARKUP = `
    <div id="health-pulse"></div>
    <span id="kpi-media"></span>
    <div id="health-media-dirs"></div>
    <div id="health-media-story"></div>
    <p id="health-media-note"></p>
`;

/** Every threshold the untested panels read, so a render can't throw before reaching the media panel. */
const THRESHOLDS = {
    idle_txn_warn_seconds: 60, idle_txn_bad_seconds: 300, lock_wait_warn_seconds: 5, lock_wait_bad_seconds: 30,
    active_query_warn_seconds: 30, active_query_bad_seconds: 120, bloat_warn_ratio: 0.2, bloat_bad_ratio: 0.4,
    bloat_min_dead_tuples: 1000, vacuum_age_warn_seconds: 86400, conn_pool_max: 25, conn_warn_active: 15,
    conn_bad_active: 20
};

const OK_DIR = {
    key: 'story.media.directory', env_var: 'SIDEWALK_STORY_MEDIA_DIR', irreplaceable: true,
    path: '/srv/sidewalk/story-media', status: 'ok', label: 'ok', severity: 'good'
};

const UNSAFE_DIR = {
    key: 'pano.images.directory', env_var: 'SIDEWALK_PANO_DIR', irreplaceable: true,
    path: '/app/target/universal/stage/.pano-images', status: 'unsafe', label: 'a deploy will delete this',
    severity: 'bad', detail: 'pano.images.directory resolves inside the build output tree that a deploy deletes.'
};

/** One city whose rows and files all line up. */
const cleanCity = (overrides = {}) => ({
    city_id: 'chicago-il', schema: 'sidewalk_chicago', rows: 3, missing: 0, orphans: 0,
    missing_ids: [], orphan_ids: [], scanned: true, ...overrides
});

/** A payload with the media panel populated and every other panel empty. */
const payloadWith = (mediaStorage) => ({
    generated_at: '2026-08-20T00:00:00Z', current_database: 'sidewalk', current_role: 'sidewalk',
    can_see_all_queries: true, blocking_sessions: [], idle_in_transaction: [], active_queries: [],
    stuck_evolutions: [], table_bloat: [], connections: [], pano_backups: null,
    media_storage: mediaStorage, thresholds: THRESHOLDS
});

describe('HealthPage media storage panel', () => {
    let HealthPage;

    beforeEach(() => {
        // init() installs poll intervals; fake timers keep them from firing into a torn-down DOM.
        jest.useFakeTimers();
        document.body.innerHTML = MARKUP;
        window.eval(`${PAGE_SRC}\nwindow.HealthPage = HealthPage;`);
        HealthPage = window.HealthPage;
    });

    afterEach(() => {
        jest.useRealTimers();
        delete global.fetch;
    });

    /** Renders one payload through the real load path and hands back the panel's containers. */
    async function render(mediaStorage) {
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => payloadWith(mediaStorage) });
        await new HealthPage({ healthUrl: '/adminapi/dbHealth' }).init();
        // A render that threw is caught and reported in the pulse line, which would otherwise leave the media
        // assertions failing against empty containers with no hint of why.
        expect(document.getElementById('health-pulse').innerHTML).not.toContain('Could not load');
        return {
            dirs: document.getElementById('health-media-dirs').innerHTML,
            story: document.getElementById('health-media-story').innerHTML,
            note: document.getElementById('health-media-note').innerHTML,
            kpi: document.getElementById('kpi-media')
        };
    }

    describe('the directory table', () => {
        it('names each directory, the variable that fixes it, and where it resolved', async () => {
            const { dirs } = await render({ directories: [OK_DIR], enforced: true, story_media: null });

            expect(dirs).toContain('story.media.directory');
            // A path with no variable name beside it doesn't tell an operator what to change.
            expect(dirs).toContain('SIDEWALK_STORY_MEDIA_DIR');
            expect(dirs).toContain('/srv/sidewalk/story-media');
        });

        it('states recoverability as flat text, since it is a consequence and not a live alarm', async () => {
            // An amber badge here sat beside the Status badge on a perfectly healthy row and read as a second alarm,
            // which is what made the column unreadable.
            const { dirs } = await render({ directories: [OK_DIR], enforced: true, story_media: null });

            expect(dirs).toContain('No — nothing to rebuild it from');
            expect(dirs).not.toContain('ac-badge--warn');
        });

        it('says of a rebuildable directory that losing it costs a rebuild, not content', async () => {
            const shareImages = { ...OK_DIR, key: 'share.image.directory', irreplaceable: false };
            const { dirs } = await render({ directories: [shareImages], enforced: true, story_media: null });

            expect(dirs).toContain('Yes — rebuilt on demand');
        });

        it('leads a dev checkout\'s status with the verdict, not with the location', async () => {
            // "inside the build tree" alone left the reader to work out whether that was a problem.
            const devUnsafe = { ...UNSAFE_DIR, label: 'ok for dev (inside the build tree)', severity: 'ok' };
            const { dirs } = await render({ directories: [devUnsafe], enforced: false, story_media: null });

            expect(dirs).toContain('ok for dev');
        });

        it('shows the server\'s own label and severity rather than deciding either here', async () => {
            const { dirs } = await render({ directories: [UNSAFE_DIR], enforced: true, story_media: null });

            expect(dirs).toContain('ac-badge--bad');
            expect(dirs).toContain('a deploy will delete this');
        });

        it('says how to fix an unsafe directory once, below the table', async () => {
            // The wipe-zone reason repeats the same sentence about deploys on every row, and four copies of it in the
            // narrowest column is what made these rows tower over every other table on the page.
            const { dirs, note } = await render({
                directories: [UNSAFE_DIR, { ...OK_DIR, status: 'unsafe', severity: 'bad', detail: UNSAFE_DIR.detail }],
                enforced: true, story_media: null
            });

            expect(dirs).not.toContain('resolves inside the build output tree');
            expect(note).toContain('deleted by the next release');
        });

        it('keeps a non-wipe-zone explanation, which the table is the only place to read', async () => {
            const notReadable = {
                ...OK_DIR, status: 'not_readable', label: 'not readable', severity: 'bad',
                detail: 'SIDEWALK_STORY_MEDIA_DIR points at a path this process cannot read.'
            };
            const { dirs } = await render({ directories: [notReadable], enforced: true, story_media: null });

            expect(dirs).toContain('cannot read');
        });

        it('explains that a dev checkout is meant to look like this', async () => {
            // Without this the dev dashboard is permanently red for doing exactly what it is configured to do, and a
            // panel that is always red is a panel nobody reads on the day it matters.
            const { note } = await render({ directories: [UNSAFE_DIR], enforced: false, story_media: null });

            expect(note).toContain('Not production mode');
        });

        it('says why there is nothing to show when the scan could not even stat the directories', async () => {
            const { dirs, story } = await render({
                directories: [], enforced: true, story_media: null,
                unavailable: 'A previous media scan has not returned; storage may be offline.'
            });

            expect(dirs).toContain('storage may be offline');
            // An empty table here would read as "no media directories are configured", which is a different problem.
            expect(dirs).not.toContain('<table');
            expect(story).toBe('');
        });
    });

    describe('the per-city table', () => {
        const scanOf = (cities, missing, orphans) => ({
            directories: [OK_DIR], enforced: true,
            story_media: { base_dir: '/srv/sidewalk/story-media', cities, missing, orphans }
        });

        it('badges a city that has lost files, and lists ids to start looking from', async () => {
            const lost = cleanCity({ missing: 1, missing_ids: [331] });
            const { story } = await render(scanOf([lost], 1, 0));

            expect(story).toContain('chicago-il');
            expect(story).toContain('ac-badge--bad');
            expect(story).toContain('missing 331');
        });

        it('badges orphaned files at the lesser tone, since they are a half-finished retraction', async () => {
            const orphaned = cleanCity({ orphans: 2, orphan_ids: [7, 8] });
            const { story } = await render(scanOf([orphaned], 0, 2));

            expect(story).toContain('ac-badge--warn');
            expect(story).toContain('orphaned 7, 8');
        });

        it('leaves a clean city unbadged, so a healthy fleet reads as quiet', async () => {
            const { story } = await render(scanOf([cleanCity()], 0, 0));

            expect(story).toContain('chicago-il');
            expect(story).not.toContain('ac-badge--bad');
            expect(story).not.toContain('ac-badge--warn');
        });

        it('shows an unscanned city as unknown rather than as zero losses', async () => {
            // Rendering a 0 here is the panel's worst possible lie: it says "every photo is present" about a city it
            // never managed to look at.
            const unscanned = cleanCity({
                city_id: null, scanned: false, unscanned_reason: 'no city on this stage is configured to use schema X'
            });
            const { story } = await render(scanOf([unscanned], 0, 0));

            expect(story).toContain('sidewalk_chicago');
            expect(story).toContain('no city on this stage is configured');
            expect(story).not.toContain('ac-badge--bad');
            expect(story).toContain('—');
        });

        it('says plainly when no city has any story media, rather than showing an empty table', async () => {
            const { story } = await render(scanOf([], 0, 0));

            expect(story).toContain('No city has any story media yet.');
        });

        it('names the directory the per-city subdirectories live under', async () => {
            const { note } = await render(scanOf([cleanCity()], 0, 0));

            expect(note).toContain('/srv/sidewalk/story-media');
        });

        it('escapes a server-supplied reason instead of writing it into the page as markup', async () => {
            const hostile = cleanCity({ scanned: false, unscanned_reason: '<img src=x onerror=alert(1)>' });
            const { story } = await render(scanOf([hostile], 0, 0));

            expect(story).not.toContain('<img');
            expect(story).toContain('&lt;img');
        });
    });

    describe('the "Missing media files" KPI', () => {
        const kpiFor = async (mediaStorage) => {
            const { kpi } = await render(mediaStorage);
            return { text: kpi.textContent, tone: kpi.className };
        };

        it('shows the missing count and reds the tile when anything is gone', async () => {
            const { text, tone } = await kpiFor({
                directories: [OK_DIR], enforced: true,
                story_media: { base_dir: '/srv/media', cities: [cleanCity({ missing: 2 })], missing: 2, orphans: 0 }
            });

            expect(text).toBe('2');
            expect(tone).toContain('health-kpi--bad');
        });

        it('reds the tile for a directory a deploy will delete, before anything has been lost from it', async () => {
            const { text, tone } = await kpiFor({
                directories: [UNSAFE_DIR], enforced: true,
                story_media: { base_dir: '/srv/media', cities: [cleanCity()], missing: 0, orphans: 0 }
            });

            // The tile is labelled "Missing media files", so it can only ever show a count of those; the directory
            // table below is what names the doomed directory.
            expect(text).toBe('0');
            expect(tone).toContain('health-kpi--bad');
        });

        it('warns, without reddening, when the only fault is files nobody has a row for', async () => {
            const { text, tone } = await kpiFor({
                directories: [OK_DIR], enforced: true,
                story_media: { base_dir: '/srv/media', cities: [cleanCity({ orphans: 1 })], missing: 0, orphans: 1 }
            });

            expect(text).toBe('0');
            expect(tone).toContain('health-kpi--warn');
        });

        it('goes green only when the scan ran and found nothing wrong', async () => {
            const { tone } = await kpiFor({
                directories: [OK_DIR], enforced: true,
                story_media: { base_dir: '/srv/media', cities: [cleanCity()], missing: 0, orphans: 0 }
            });

            expect(tone).toContain('health-kpi--good');
        });

        it('shows unknown, never a zero, when the scan could not run', async () => {
            // A count of unsafe directories under a tile labelled "Missing media files" would misreport, and a 0
            // would claim a clean result the scan never produced.
            const { text, tone } = await kpiFor({ directories: [OK_DIR], enforced: true, story_media: null });

            expect(text).toBe('—');
            expect(tone).toContain('health-kpi--ok');
        });

        it('tones unknown neutral rather than green when the whole payload is missing', async () => {
            const { text, tone } = await kpiFor(null);

            expect(text).toBe('—');
            expect(tone).toContain('health-kpi--ok');
        });
    });
});
