/**
 * The Explore re-audit notice (#4895): which tasks earn the "this street has newer imagery" toast, that it shows once
 * per street, what it logs, and how it degrades when the dates can't be fetched.
 *
 * ReauditNotice is a top-level `class` written for the Grunt-concatenation world, so the source is eval'd into the
 * jsdom global scope with the globals it reads (`svl`, `Toast`, `i18next`, `fetch`) stubbed around it.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/explore/src/alert/ReauditNotice.js'), 'utf8');

window.eval(`${SRC}; window.ReauditNotice = ReauditNotice;`);
const { ReauditNotice } = window;

/** A stand-in for Task exposing the two reads the notice makes. */
const makeTask = (streetEdgeId, needsReaudit) => ({
    getStreetEdgeId: () => streetEdgeId,
    getProperty: (key) => (key === 'needsReaudit' ? needsReaudit : null),
});

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ReauditNotice.showForTask', () => {
    let tracker;
    let currentStreetId;

    beforeEach(() => {
        tracker = { push: jest.fn() };
        currentStreetId = 7;
        window.svl = { taskContainer: { getCurrentTaskStreetEdgeId: () => currentStreetId } };
        window.Toast = { show: jest.fn() };
        window.i18next = {
            language: 'en',
            t: (key, opts) => (opts ? `${key}|${opts.lastMapped}|${opts.newImagery}` : key),
        };
        document.body.innerHTML = '<div id="pano"></div>';
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ last_audited_at: '2019-06-14T18:20:00Z', new_imagery_date: '2025-03-01' }),
        }));
    });

    test('does nothing for a street that is not a re-audit, and never fetches', async () => {
        const notice = new ReauditNotice(tracker);
        await expect(notice.showForTask(makeTask(7, false))).resolves.toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
        expect(window.Toast.show).not.toHaveBeenCalled();
        expect(tracker.push).not.toHaveBeenCalled();
    });

    test('shows a dated toast for a re-audit street and logs it', async () => {
        const notice = new ReauditNotice(tracker);
        await expect(notice.showForTask(makeTask(7, true))).resolves.toBe(true);

        expect(global.fetch).toHaveBeenCalledWith('/contribution/street/7/reauditSummary');
        expect(window.Toast.show).toHaveBeenCalledTimes(1);
        const opts = window.Toast.show.mock.calls[0][0];
        expect(opts.title).toBe('right-ui.reaudit.title');
        // A first-of-month capture date must read as that month, not the evening before in the local zone.
        expect(opts.message).toBe('right-ui.reaudit.message|June 2019|March 2025');
        expect(opts.dark).toBe(true);
        expect(opts.reference).toBe(document.getElementById('pano'));
        expect(tracker.push).toHaveBeenCalledWith('ReauditToast_Shown', {
            streetEdgeId: 7, lastAuditedAt: '2019-06-14T18:20:00Z', newImageryDate: '2025-03-01',
        });
    });

    test('logs an explicit close through the toast\'s onClose hook', async () => {
        const notice = new ReauditNotice(tracker);
        await notice.showForTask(makeTask(7, true));
        window.Toast.show.mock.calls[0][0].onClose();
        expect(tracker.push).toHaveBeenLastCalledWith('Click_ReauditToast_Close', { streetEdgeId: 7 });
    });

    test('shows once per street, however often the street becomes current', async () => {
        const notice = new ReauditNotice(tracker);
        await notice.showForTask(makeTask(7, true));
        await expect(notice.showForTask(makeTask(7, true))).resolves.toBe(false);
        expect(window.Toast.show).toHaveBeenCalledTimes(1);

        currentStreetId = 8;
        await expect(notice.showForTask(makeTask(8, true))).resolves.toBe(true);
        expect(window.Toast.show).toHaveBeenCalledTimes(2);
    });

    test('falls back to the dateless wording when the summary is unavailable', async () => {
        global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }));
        const notice = new ReauditNotice(tracker);
        await expect(notice.showForTask(makeTask(7, true))).resolves.toBe(true);
        expect(window.Toast.show.mock.calls[0][0].message).toBe('right-ui.reaudit.message-no-dates');
        expect(tracker.push).toHaveBeenCalledWith('ReauditToast_Shown', {
            streetEdgeId: 7, lastAuditedAt: null, newImageryDate: null,
        });
    });

    test('stays quiet when the labeler has moved on before the summary arrived', async () => {
        let resolveFetch;
        global.fetch = jest.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
        const notice = new ReauditNotice(tracker);
        const shown = notice.showForTask(makeTask(7, true));
        await flushPromises();
        currentStreetId = 9;
        resolveFetch({ ok: true, json: () => Promise.resolve({ last_audited_at: '2019-06-14T18:20:00Z' }) });
        await expect(shown).resolves.toBe(false);
        expect(window.Toast.show).not.toHaveBeenCalled();
    });
});
