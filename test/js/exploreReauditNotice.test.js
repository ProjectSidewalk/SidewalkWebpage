/**
 * The Explore re-audit notice (#4895): which tasks earn the "this street has newer imagery" toast, which of the four
 * wordings it picks, that it shows once per street, and what it logs.
 *
 * Everything the notice needs now rides on the task payload, so there is no request to stub and no in-flight race to
 * cover. The second block loads the real `Toast` with fake timers, because the fix for #5472 lives in how the notice
 * drives Toast's per-anchor queue: a notice raised for a street the labeler is moved off before its turn is retired
 * unseen, and only a toast that reached the screen counts as the street's one announcement.
 *
 * `util.monthYear` is loaded for real rather than stubbed: the month wording is half of what these assertions check,
 * and a stub would let the shared formatter drift from what the toast actually prints (#5413).
 */


const { loadModules, realUtil } = require('./loadGlobalScript');


Object.assign(window, loadModules('frontend/js/explore/alert/ReauditNotice.js'));
const { ReauditNotice } = window;

/** A stand-in for Task exposing the reads the notice makes. */
const makeTask = (streetEdgeId, props = {}) => ({
    getStreetEdgeId: () => streetEdgeId,
    getProperty: (key) => (key in props ? props[key] : null),
});

const REAUDIT_BY_ME = {
    needsReaudit: true,
    mappedByThisUser: true,
    lastMappedAt: '2019-06-14T18:20:00Z',
    newImageryDate: '2025-03-01',
};
const REAUDIT_BY_OTHERS = { ...REAUDIT_BY_ME, mappedByThisUser: false };

describe('ReauditNotice.showForTask', () => {
    let tracker;

    beforeEach(() => {
        tracker = { push: jest.fn() };
        // Stands in for a toast that mounts at once: `onShow` fires inside show(), as the real Toast does when its
        // anchor is free, and the handle the notice keeps is a spy.
        window.Toast = {
            show: jest.fn((opts) => {
                opts.onShow?.();
                return { dismiss: jest.fn() };
            }),
        };
        window.i18next = {
            language: 'en',
            t: (key, opts) => (opts ? `${key}|${opts.lastMapped}|${opts.newImagery}` : key),
        };
        window.util = realUtil();
        document.body.innerHTML = '<div id="pano"></div>';
    });

    test('does nothing for a street that is not a re-audit', () => {
        const notice = new ReauditNotice(tracker);
        expect(notice.showForTask(makeTask(7, { needsReaudit: false }))).toBe(false);
        expect(window.Toast.show).not.toHaveBeenCalled();
        expect(tracker.push).not.toHaveBeenCalled();
    });

    test('says "you mapped this" when the earlier pass was the labeler\'s own, and logs it', () => {
        const notice = new ReauditNotice(tracker);
        expect(notice.showForTask(makeTask(7, REAUDIT_BY_ME))).toBe(true);

        expect(window.Toast.show).toHaveBeenCalledTimes(1);
        const opts = window.Toast.show.mock.calls[0][0];
        expect(opts.title).toBe('right-ui.reaudit.title');
        // Month precision, and a first-of-month capture date must not slip a month to the local timezone.
        expect(opts.message).toBe('right-ui.reaudit.message-you|June 2019|March 2025');
        expect(opts.dark).toBe(true);
        expect(opts.reference).toBe(document.getElementById('pano'));

        expect(tracker.push).toHaveBeenCalledWith('ReauditToast_Shown', {
            streetEdgeId: 7,
            mappedByThisUser: true,
            lastMappedAt: '2019-06-14T18:20:00Z',
            newImageryDate: '2025-03-01',
        });
    });

    test('names the month the labeler did the work in, not the UTC month the server wrote', () => {
        // jest.config.js pins Los Angeles, where 2024-11-01T03:00Z is the evening of October 31.
        const notice = new ReauditNotice(tracker);
        notice.showForTask(makeTask(7, { ...REAUDIT_BY_ME, lastMappedAt: '2024-11-01T03:00:00Z' }));
        expect(window.Toast.show.mock.calls[0][0].message).toBe('right-ui.reaudit.message-you|October 2024|March 2025');
    });

    test('says "someone mapped this" when the earlier pass was not the labeler\'s', () => {
        const notice = new ReauditNotice(tracker);
        expect(notice.showForTask(makeTask(7, REAUDIT_BY_OTHERS))).toBe(true);

        expect(window.Toast.show.mock.calls[0][0].message)
            .toBe('right-ui.reaudit.message-others|June 2019|March 2025');
        expect(tracker.push.mock.calls[0][1].mappedByThisUser).toBe(false);
    });

    test.each([
        ['neither date', {}, 'right-ui.reaudit.message-you-no-dates'],
        ['no imagery date', { lastMappedAt: '2019-06-14T18:20:00Z' }, 'right-ui.reaudit.message-you-no-dates'],
        ['no audit date', { newImageryDate: '2025-03-01' }, 'right-ui.reaudit.message-you-no-dates'],
        ['an unparseable date', { lastMappedAt: 'not-a-date', newImageryDate: '2025-03-01' },
            'right-ui.reaudit.message-you-no-dates'],
    ])('falls back to the dateless wording with %s', (_label, dates, expected) => {
        const notice = new ReauditNotice(tracker);
        const task = makeTask(7, { needsReaudit: true, mappedByThisUser: true, ...dates });
        expect(notice.showForTask(task)).toBe(true);
        // Half a comparison reads worse than none, and a raw ISO string must never reach the sentence.
        expect(window.Toast.show.mock.calls[0][0].message).toBe(expected);
    });

    test('the dateless wording also splits on who mapped it', () => {
        const notice = new ReauditNotice(tracker);
        expect(notice.showForTask(makeTask(7, { needsReaudit: true, mappedByThisUser: false }))).toBe(true);
        expect(window.Toast.show.mock.calls[0][0].message).toBe('right-ui.reaudit.message-others-no-dates');
    });

    test('the close button logs a dismissal distinct from a fade', () => {
        const notice = new ReauditNotice(tracker);
        notice.showForTask(makeTask(7, REAUDIT_BY_ME));
        window.Toast.show.mock.calls[0][0].onClose();
        expect(tracker.push).toHaveBeenCalledWith('Click_ReauditToast_Close', { streetEdgeId: 7 });
    });

    test('announces each street once, but every re-audit street', () => {
        const notice = new ReauditNotice(tracker);
        expect(notice.showForTask(makeTask(7, REAUDIT_BY_ME))).toBe(true);
        expect(notice.showForTask(makeTask(7, REAUDIT_BY_ME))).toBe(false);
        expect(notice.showForTask(makeTask(8, REAUDIT_BY_ME))).toBe(true);
        expect(window.Toast.show).toHaveBeenCalledTimes(2);
    });

    test('a street switch retires the previous notice, and a repeat hand-over of the same street does not', () => {
        const notice = new ReauditNotice(tracker);
        notice.showForTask(makeTask(7, REAUDIT_BY_ME));
        const handle = window.Toast.show.mock.results[0].value;

        // Same street again (a re-render, a jump resolving to the current street): the toast stands.
        expect(notice.showForTask(makeTask(7, REAUDIT_BY_ME))).toBe(false);
        expect(handle.dismiss).not.toHaveBeenCalled();

        // Any other street, re-audit or not, retires it.
        expect(notice.showForTask(makeTask(8, { needsReaudit: false }))).toBe(false);
        expect(handle.dismiss).toHaveBeenCalledTimes(1);
    });
});

describe('ReauditNotice with Toast\'s queue (#5472)', () => {
    let Toast;
    let notice;
    let tracker;
    let pano;

    /** A re-audit street whose toast is recognisable on screen: its "last mapped" year is 2000 + the street id. */
    const reauditTask = (streetEdgeId) =>
        makeTask(streetEdgeId, { ...REAUDIT_BY_ME, lastMappedAt: `${2000 + streetEdgeId}-06-14T18:20:00Z` });

    /** The message text of each toast on screen, in DOM order. */
    const onScreen = () => [...document.querySelectorAll('.ps-toast')]
        .map((el) => el.querySelector('.ps-toast__message').textContent);

    /** Street ids logged as shown, in order. */
    const shownIds = () => tracker.push.mock.calls
        .filter(([event]) => event === 'ReauditToast_Shown').map(([, notes]) => notes.streetEdgeId);

    /** What Main.js raises after the mission-start screen before the first re-audit notice: 10 s on the pano. */
    const showResumeToast = () => Toast.show({ message: 'resume', reference: pano, dark: true, duration: 10000 });

    beforeEach(() => {
        jest.useFakeTimers();
        // The block above fakes Toast on window; the transform prefers that fake, so it must be gone before the
        // real one loads alongside the notice (one registry, so both see the same queue).
        delete window.Toast;
        tracker = { push: jest.fn() };
        window.i18next = {
            language: 'en',
            t: (key, opts) => (opts ? `${key}|${opts.lastMapped}|${opts.newImagery}` : key),
        };
        window.util = realUtil();
        document.body.innerHTML = '<div id="pano"></div>';
        pano = document.getElementById('pano');
        const mods = loadModules('frontend/js/common/Toast.js', 'frontend/js/explore/alert/ReauditNotice.js');
        Toast = mods.Toast;
        notice = new mods.ReauditNotice(tracker);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('a notice queued for a street the labeler is moved off before its turn is dropped, not marked shown', () => {
        showResumeToast();
        expect(notice.showForTask(reauditTask(7))).toBe(true);
        expect(onScreen()).toEqual(['resume']);

        // Moved on before the resume toast is done (a street with no imagery, say).
        notice.showForTask(makeTask(8, { needsReaudit: false }));
        jest.advanceTimersByTime(10000 + Toast.FADE_MS);

        expect(onScreen()).toEqual([]);
        expect(shownIds()).toEqual([]);
        // Back on 7 later: still un-announced, so it gets its notice.
        expect(notice.showForTask(reauditTask(7))).toBe(true);
        expect(onScreen()).toEqual(['right-ui.reaudit.message-you|June 2007|March 2025']);
        expect(shownIds()).toEqual([7]);
    });

    test('the notice for the street the labeler ends up on is the one that shows', () => {
        showResumeToast();
        notice.showForTask(reauditTask(7));
        notice.showForTask(reauditTask(8));
        jest.advanceTimersByTime(10000 + Toast.FADE_MS);

        expect(onScreen()).toEqual(['right-ui.reaudit.message-you|June 2008|March 2025']);
        expect(shownIds()).toEqual([8]);
    });

    test('a street whose toast reached the screen is not announced again', () => {
        notice.showForTask(reauditTask(7));
        expect(shownIds()).toEqual([7]);
        notice.showForTask(makeTask(8, { needsReaudit: false }));
        jest.advanceTimersByTime(Toast.FADE_MS);

        expect(notice.showForTask(reauditTask(7))).toBe(false);
        expect(onScreen()).toEqual([]);
        expect(shownIds()).toEqual([7]);
    });

    test('a run of skipped re-audit streets behind a live toast yields one toast, for the street reached', () => {
        showResumeToast();
        for (const id of [1, 2, 3, 4]) notice.showForTask(reauditTask(id));
        notice.showForTask(reauditTask(5));
        jest.advanceTimersByTime(10000 + Toast.FADE_MS);

        expect(onScreen()).toEqual(['right-ui.reaudit.message-you|June 2005|March 2025']);
        expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
        expect(shownIds()).toEqual([5]);
        // Nothing else is waiting: the run's toasts are gone, not queued.
        jest.advanceTimersByTime(ReauditNotice.DURATION_MS + Toast.FADE_MS);
        expect(onScreen()).toEqual([]);
    });

    test('a run of skipped re-audit streets with no toast live ends with only the reached street\'s toast', () => {
        // Mid-session with the anchor free, the first skipped street's toast mounts at once and is then retired.
        notice.showForTask(reauditTask(1));
        expect(onScreen()).toEqual(['right-ui.reaudit.message-you|June 2001|March 2025']);
        for (const id of [2, 3, 4]) notice.showForTask(reauditTask(id));
        notice.showForTask(reauditTask(5));
        // Street 1's toast is fading; 5's is waiting for the anchor; 2-4 are gone.
        jest.advanceTimersByTime(Toast.FADE_MS);

        expect(onScreen()).toEqual(['right-ui.reaudit.message-you|June 2005|March 2025']);
        expect(shownIds()).toEqual([1, 5]);
        jest.advanceTimersByTime(ReauditNotice.DURATION_MS + Toast.FADE_MS);
        expect(onScreen()).toEqual([]);
    });

    test('a single re-audit street still shows after the resume toast, and logs then, for 12 s', () => {
        // The ordinary page-load path: one re-audit street queued behind the resume toast.
        showResumeToast();
        expect(notice.showForTask(reauditTask(7))).toBe(true);
        expect(shownIds()).toEqual([]); // Raised, not yet shown.

        jest.advanceTimersByTime(10000);
        expect(onScreen()).toEqual(['resume']); // The fade is still running.
        jest.advanceTimersByTime(Toast.FADE_MS);
        expect(onScreen()).toEqual(['right-ui.reaudit.message-you|June 2007|March 2025']);
        expect(shownIds()).toEqual([7]);
        expect(tracker.push).toHaveBeenCalledWith('ReauditToast_Shown', expect.objectContaining({
            streetEdgeId: 7, mappedByThisUser: true, lastMappedAt: '2007-06-14T18:20:00Z', newImageryDate: '2025-03-01',
        }));

        jest.advanceTimersByTime(ReauditNotice.DURATION_MS - 1);
        expect(onScreen()).toHaveLength(1);
        jest.advanceTimersByTime(1 + Toast.FADE_MS);
        expect(onScreen()).toEqual([]);
        // Standing on the same street for the rest of the session: silent.
        expect(notice.showForTask(reauditTask(7))).toBe(false);
    });

    test('closing a shown toast with the X still logs the dismissal, and the street stays announced', () => {
        notice.showForTask(reauditTask(7));
        document.querySelector('.ps-toast__close').click();
        expect(tracker.push).toHaveBeenCalledWith('Click_ReauditToast_Close', { streetEdgeId: 7 });
        jest.advanceTimersByTime(Toast.FADE_MS);
        expect(notice.showForTask(reauditTask(7))).toBe(false);
    });
});
