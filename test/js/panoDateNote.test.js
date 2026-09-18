/**
 * The Explore bottom-left imagery-era note (#5413): which of the three states a pano falls into, what each one
 * writes into the corner, and that the log records a street's states without firing on every step.
 *
 * The month-boundary cases are the point of the suite. Explore's street-level re-audit flag comes from a median over
 * the street's panos, so on a partly-refreshed street the two ends disagree — the note has to get that right from the
 * pano's own capture date, and has to refuse to claim a re-audit it cannot prove from month-granular dates.
 *
 * PanoDateNote is a top-level `class` written for the Grunt-concatenation world, so the source is eval'd into the
 * jsdom global scope. `util.monthYear` is loaded for real, not stubbed: the printed month is half of what is being
 * asserted here.
 */

const fs = require('fs');
const path = require('path');

const { loadGlobalScript } = require('./loadGlobalScript');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/explore/src/panorama/PanoDateNote.js'), 'utf8');

window.eval(`${SRC}; window.PanoDateNote = PanoDateNote;`);
const { PanoDateNote } = window;

/** A stand-in for Task exposing the reads the note makes. */
const makeTask = (streetEdgeId, props = {}) => ({
    getStreetEdgeId: () => streetEdgeId,
    getProperty: (key) => (key in props ? props[key] : null),
});

// Teaneck street 1755, the street that motivated #5413: audited 2024-07-07, imagery now spanning 2021-10 to 2024-10.
const MAPPED_BY_ME = { mappedByThisUser: true, lastMappedAt: '2024-07-07T12:00:00-07:00' };
const MAPPED_BY_OTHERS = { mappedByThisUser: false, lastMappedAt: '2024-07-07T12:00:00-07:00' };

describe('PanoDateNote', () => {
    let tracker;
    let note;

    /** The two pills' rendered text, with the note's hidden state. */
    const corner = () => ({
        date: document.getElementById('svl-panorama-date').textContent,
        note: document.getElementById('svl-pano-date-note').textContent,
        noteHidden: document.getElementById('svl-pano-date-note').hidden,
    });

    beforeEach(() => {
        tracker = { push: jest.fn() };
        window.i18next = {
            language: 'en',
            t: (key, opts) => (opts && opts.date ? `${key}|${opts.date}` : key),
        };
        loadGlobalScript('public/js/common/utilities.js');
        // Mirrors explore.scala.html, including the pill starting hidden. PanoInfoPopover's button would be a second
        // child of the pill on the real page; nothing here reads it.
        document.body.innerHTML =
            '<div id="svl-panorama-date-holder">'
            + '<span id="svl-panorama-date-pill" class="svl-pano-pill" hidden><span id="svl-panorama-date"></span></span>'
            + '</div>';
        note = new PanoDateNote(
            tracker,
            document.getElementById('svl-panorama-date-holder'),
            document.getElementById('svl-panorama-date-pill'),
            document.getElementById('svl-panorama-date')
        );
    });

    describe('stateFor', () => {
        test('a street with no completed audit has nothing to compare against', () => {
            expect(PanoDateNote.stateFor('2024-10-01', null)).toBe('unaudited');
        });

        test('a pano with no usable capture date is left alone rather than guessed at', () => {
            expect(PanoDateNote.stateFor(null, '2024-07-07T12:00:00-07:00')).toBe('unaudited');
            expect(PanoDateNote.stateFor('Invalid date', '2024-07-07T12:00:00-07:00')).toBe('unaudited');
        });

        test('imagery captured after the last audit is a re-audit', () => {
            expect(PanoDateNote.stateFor('2024-10-01', '2024-07-07T12:00:00-07:00')).toBe('reaudit');
        });

        test('imagery captured before the last audit is what was already mapped', () => {
            expect(PanoDateNote.stateFor('2022-03-01', '2024-07-07T12:00:00-07:00')).toBe('already-mapped');
        });

        test('the same month counts as already mapped, since a capture date carries no day', () => {
            expect(PanoDateNote.stateFor('2024-07-01', '2024-07-07T12:00:00-07:00')).toBe('already-mapped');
            // One month either side, to pin that the boundary is the only equal case.
            expect(PanoDateNote.stateFor('2024-08-01', '2024-07-07T12:00:00-07:00')).toBe('reaudit');
            expect(PanoDateNote.stateFor('2024-06-01', '2024-07-07T12:00:00-07:00')).toBe('already-mapped');
        });

        test('a timestamp is read in the offset it carries, not shifted into the local zone', () => {
            // 2024-07-01T00:30+02:00 is still June 30 in UTC. Reading the calendar fields keeps it in July, so a July
            // capture does not flip to a re-audit on the strength of the reader's time zone.
            expect(PanoDateNote.stateFor('2024-07-01', '2024-07-01T00:30:00+02:00')).toBe('already-mapped');
        });
    });

    describe('update', () => {
        test('the date pill stays hidden until a pano reports a capture date', () => {
            const pill = document.getElementById('svl-panorama-date-pill');
            expect(pill.hidden).toBe(true);

            note.update({ captureDateIso: null, task: makeTask(31, MAPPED_BY_ME) });
            expect(pill.hidden).toBe(true);
            expect(corner().noteHidden).toBe(true);

            note.update({ captureDateIso: '2024-10-01' });
            expect(pill.hidden).toBe(false);
        });

        test('shows the bare capture date on a street nobody has audited', () => {
            note.update({ captureDateIso: '2024-10-01', task: makeTask(31, {}) });
            expect(corner()).toEqual({ date: 'Oct 2024', note: '', noteHidden: true });
            expect(tracker.push).not.toHaveBeenCalled();
        });

        test('names the imagery and the last audit when this pano is newer', () => {
            note.update({ captureDateIso: '2024-10-01', task: makeTask(1755, MAPPED_BY_ME) });
            expect(corner()).toEqual({
                date: 'right-ui.pano-date-note.image-date|Oct 2024',
                note: 'right-ui.pano-date-note.last-audited|Jul 2024',
                noteHidden: false,
            });
        });

        test('says the labeler already mapped this view when the pano predates their audit', () => {
            note.update({ captureDateIso: '2022-03-01', task: makeTask(31, MAPPED_BY_ME) });
            expect(corner()).toEqual({
                date: 'right-ui.pano-date-note.image-date|Mar 2022',
                // The date rides along even though en's wording does not use it, so a language that needs "you
                // mapped this in July 2024" to read naturally has it available.
                note: 'right-ui.pano-date-note.mapped-this-view-you|Jul 2024',
                noteHidden: false,
            });
        });

        test('credits the earlier pass to someone else when it was not this labeler', () => {
            note.update({ captureDateIso: '2022-03-01', task: makeTask(31, MAPPED_BY_OTHERS) });
            expect(corner().note).toBe('right-ui.pano-date-note.mapped-this-view-others|Jul 2024');
        });

        test('a street switch re-reads lastMappedAt without a new pano', () => {
            note.update({ captureDateIso: '2022-03-01', task: makeTask(1755, MAPPED_BY_ME) });
            expect(corner().note).toBe('right-ui.pano-date-note.mapped-this-view-you|Jul 2024');

            // Same pano date, different street, never audited: the note has to clear, not linger.
            note.update({ task: makeTask(99, {}) });
            expect(corner()).toEqual({ date: 'Mar 2022', note: expect.any(String), noteHidden: true });
        });

        test('one partly-refreshed street reports both of its states', () => {
            // Walking street 1755 from its 2021 end to its 2024 end: the same street is both, which is the case
            // audit_task.outdated_imagery cannot express.
            note.update({ captureDateIso: '2021-10-01', task: makeTask(1755, MAPPED_BY_ME) });
            note.update({ captureDateIso: '2024-10-01', task: makeTask(1755, MAPPED_BY_ME) });

            expect(tracker.push).toHaveBeenCalledTimes(2);
            expect(tracker.push.mock.calls.map((c) => c[1].state)).toEqual(['already-mapped', 'reaudit']);
            expect(tracker.push.mock.calls[1][1]).toEqual({
                streetEdgeId: 1755,
                state: 'reaudit',
                captureDate: '2024-10-01',
                lastMappedAt: '2024-07-07T12:00:00-07:00',
                mappedByThisUser: true,
            });
        });

        test('walking a street logs its state once, not once per pano', () => {
            for (const captureDateIso of ['2024-10-01', '2024-10-01', '2024-11-01', '2024-10-01']) {
                note.update({ captureDateIso, task: makeTask(1755, MAPPED_BY_ME) });
            }
            expect(tracker.push).toHaveBeenCalledTimes(1);
            expect(tracker.push).toHaveBeenCalledWith('PanoDateNote_Shown', expect.objectContaining({
                streetEdgeId: 1755, state: 'reaudit',
            }));
        });

        test('each street is logged on its own', () => {
            note.update({ captureDateIso: '2024-10-01', task: makeTask(1755, MAPPED_BY_ME) });
            note.update({ captureDateIso: '2024-10-01', task: makeTask(1756, MAPPED_BY_ME) });
            expect(tracker.push.mock.calls.map((c) => c[1].streetEdgeId)).toEqual([1755, 1756]);
        });
    });
});
