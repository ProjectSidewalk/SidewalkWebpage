/**
 * The Explore re-audit notice (#4895): which tasks earn the "this street has newer imagery" toast, which of the four
 * wordings it picks, that it shows once per street, and what it logs.
 *
 * Everything the notice needs now rides on the task payload, so there is no request to stub and no in-flight race to
 * cover. ReauditNotice is a top-level `class` written for the Grunt-concatenation world, so the source is eval'd into
 * the jsdom global scope with the globals it reads (`Toast`, `i18next`, `util`) stubbed or loaded around it.
 *
 * `util.monthYear` is loaded for real rather than stubbed: the month wording is half of what these assertions check,
 * and a stub would let the shared formatter drift from what the toast actually prints (#5413).
 */

const fs = require('fs');
const path = require('path');

const { loadGlobalScript } = require('./loadGlobalScript');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/explore/src/alert/ReauditNotice.js'), 'utf8');

window.eval(`${SRC}; window.ReauditNotice = ReauditNotice;`);
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
        window.Toast = { show: jest.fn() };
        window.i18next = {
            language: 'en',
            t: (key, opts) => (opts ? `${key}|${opts.lastMapped}|${opts.newImagery}` : key),
        };
        loadGlobalScript('public/js/common/utilities.js');
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
});
