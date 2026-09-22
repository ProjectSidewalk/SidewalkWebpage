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
// In the shape the task payload carries it: the server writes every OffsetDateTime in UTC.
const MAPPED_BY_ME = { mappedByThisUser: true, lastMappedAt: '2024-07-07T19:00:00Z' };
const MAPPED_BY_OTHERS = { mappedByThisUser: false, lastMappedAt: '2024-07-07T19:00:00Z' };

describe('PanoDateNote', () => {
    let tracker;
    let note;

    /** The corner's rendered text, with the note's hidden state. */
    const corner = () => ({
        date: document.getElementById('svl-panorama-date').textContent,
        note: document.getElementById('svl-pano-date-note').textContent,
        noteHidden: document.getElementById('svl-pano-date-note').hidden,
    });
    const datePilled = () =>
        document.getElementById('svl-panorama-date-pill').classList.contains('svl-pano-pill');
    const tip = () => document.getElementById('svl-pano-date-note').getAttribute('data-ps-tooltip');
    const noteIsAction = () =>
        document.getElementById('svl-pano-date-note').classList.contains('svl-pano-pill--action');

    beforeEach(() => {
        tracker = { push: jest.fn() };
        window.i18next = {
            language: 'en',
            t: (key, opts) => {
                if (opts && opts.date) return `${key}|${opts.date}`;
                if (opts && opts.assessedDate) return `${key}|${opts.assessedDate}|${opts.captureDate}`;
                return key;
            },
        };
        loadGlobalScript('public/js/common/utilities.js');
        // Mirrors explore.scala.html, including the pill starting hidden. PanoInfoPopover's button would be a second
        // child of the pill on the real page; nothing here reads it.
        document.body.innerHTML =
            '<div id="svl-panorama-date-holder">'
            + '<span id="svl-panorama-date-pill"><span id="svl-panorama-date"></span>'
            + '<i id="pano-info-button"></i></span>'
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
            expect(PanoDateNote.stateFor(null, '2024-07-07T19:00:00Z')).toBe('unaudited');
            expect(PanoDateNote.stateFor('Invalid date', '2024-07-07T19:00:00Z')).toBe('unaudited');
        });

        test('imagery captured after the last audit is a re-audit', () => {
            expect(PanoDateNote.stateFor('2024-10-01', '2024-07-07T19:00:00Z')).toBe('reaudit');
        });

        test('imagery captured before the last audit is what was already mapped', () => {
            expect(PanoDateNote.stateFor('2022-03-01', '2024-07-07T19:00:00Z')).toBe('already-mapped');
        });

        test('the same month counts as already mapped, since a capture date carries no day', () => {
            expect(PanoDateNote.stateFor('2024-07-01', '2024-07-07T19:00:00Z')).toBe('already-mapped');
            // One month either side, to pin that the boundary is the only equal case.
            expect(PanoDateNote.stateFor('2024-08-01', '2024-07-07T19:00:00Z')).toBe('reaudit');
            expect(PanoDateNote.stateFor('2024-06-01', '2024-07-07T19:00:00Z')).toBe('already-mapped');
        });

        test('the chip and its tooltip never disagree about which month an assessment landed in', () => {
            // Where `stateFor` and `util.monthYear` used to part company, one reading the month off the string and
            // the other converting it. jest.config.js pins the TZ to Los Angeles, where this is October 31, 8 pm.
            const octoberEvening = { ...MAPPED_BY_ME, lastMappedAt: '2024-11-01T03:00:00Z' };
            note.update('2024-10-01', makeTask(31, octoberEvening));
            expect(corner().note).toBe('right-ui.pano-date-note.already-assessed');
            expect(tip()).toBe('right-ui.pano-date-note.already-assessed-tip|October 2024|October 2024');
        });

        test('a UTC assessment timestamp is read in the labeler\'s zone, not off the string', () => {
            // The payload's `Z` is the server's zone, not the labeler's: this assessment was done on October 31 in
            // Los Angeles, so November imagery postdates it. Reading `11` off the string would call that imagery
            // already assessed and print "November 2024" at someone who did the work in October.
            const octoberEvening = { ...MAPPED_BY_ME, lastMappedAt: '2024-11-01T03:00:00Z' };
            expect(PanoDateNote.stateFor('2024-11-01', octoberEvening.lastMappedAt)).toBe('reaudit');
            note.update('2024-11-01', makeTask(31, octoberEvening));
            expect(corner().note).toBe('right-ui.pano-date-note.needs-reassessment');
            expect(tip()).toBe('right-ui.pano-date-note.needs-reassessment-tip-you|October 2024|November 2024');
        });

        test('a capture date is read off the string, never shifted by the zone', () => {
            // `new Date('2024-07-01')` is UTC midnight, which in Los Angeles is June 30.
            expect(PanoDateNote.monthKey('2024-07-01')).toBe(202407);
            expect(PanoDateNote.monthKey('2024-07')).toBe(202407);
        });
    });

    describe('update', () => {
        test('an unreadable capture date empties the corner but keeps the info button', () => {
            // The pill element is PanoInfoPopover's container, so hiding it would take pano id, position and the
            // report links away on exactly the panos whose metadata someone needs to report.
            const pill = document.getElementById('svl-panorama-date-pill');
            const infoButton = () => document.getElementById('pano-info-button');

            for (const captureDateIso of [null, 'Invalid date', '2024-13-01']) {
                note.update(captureDateIso, makeTask(31, MAPPED_BY_ME));
                expect(corner()).toEqual({ date: '', note: expect.any(String), noteHidden: true });
                expect(datePilled()).toBe(false);
                expect(pill.hidden).toBe(false);
                expect(infoButton()).not.toBeNull();
            }

            note.update('2024-10-01', makeTask(31, MAPPED_BY_ME));
            expect(corner().date).toBe('right-ui.pano-date-note.image-date|Oct 2024');
            expect(infoButton()).not.toBeNull();
        });

        test('shows the bare capture date on a street nobody has assessed', () => {
            note.update('2024-10-01', makeTask(31, {}));
            expect(corner()).toEqual({ date: 'Oct 2024', note: '', noteHidden: true });
            expect(datePilled()).toBe(false);
            expect(tracker.push).not.toHaveBeenCalled();
        });

        test('names the imagery and the last assessment when this pano is newer', () => {
            note.update('2024-10-01', makeTask(1755, MAPPED_BY_ME));
            expect(corner()).toEqual({
                date: 'right-ui.pano-date-note.image-date|Oct 2024',
                note: 'right-ui.pano-date-note.needs-reassessment',
                noteHidden: false,
            });
            expect(datePilled()).toBe(true);
            expect(noteIsAction()).toBe(true);
            // Spelled-out months, and both dates: the chip names only the state, so it has room for neither.
            expect(tip()).toBe('right-ui.pano-date-note.needs-reassessment-tip-you|July 2024|October 2024');
        });

        test('the same street assessed by someone else still gets the re-assessment note', () => {
            // The chip names no one; only the tooltip, with room for a sentence, says whose earlier pass it was.
            note.update('2024-10-01', makeTask(1755, MAPPED_BY_OTHERS));
            expect(corner().note).toBe('right-ui.pano-date-note.needs-reassessment');
            expect(tip()).toBe('right-ui.pano-date-note.needs-reassessment-tip-others|July 2024|October 2024');
        });

        test('says the labeler assessed this view when the pano predates their own assessment', () => {
            note.update('2022-03-01', makeTask(31, MAPPED_BY_ME));
            expect(corner()).toEqual({
                date: 'right-ui.pano-date-note.image-date|Mar 2022',
                note: 'right-ui.pano-date-note.already-assessed',
                noteHidden: false,
            });
            expect(datePilled()).toBe(true);
            // Neutral: this state asks the labeler for nothing.
            expect(noteIsAction()).toBe(false);
            expect(tip()).toBe('right-ui.pano-date-note.already-assessed-tip|July 2024|March 2022');
        });

        test('withholds that someone else assessed this view, to keep the assessment independent', () => {
            note.update('2022-03-01', makeTask(31, MAPPED_BY_OTHERS));
            expect(corner()).toEqual({ date: 'Mar 2022', note: '', noteHidden: true });
            expect(datePilled()).toBe(false);
            expect(tracker.push).not.toHaveBeenCalled();
        });

        test('each render names one pano and the street that pano is on, never a mix of two', () => {
            // A street transition swaps the task while the labeler still stands on the previous street's last pano,
            // so anything retained across calls pairs one street's assessment with the other's imagery.
            note.update('2022-03-01', makeTask(1755, MAPPED_BY_ME));
            expect(corner().note).toBe('right-ui.pano-date-note.already-assessed');

            note.update('2024-10-01', makeTask(99, {}));
            expect(corner()).toEqual({ date: 'Oct 2024', note: expect.any(String), noteHidden: true });
            expect(datePilled()).toBe(false);
            expect(tracker.push.mock.calls.map((c) => [c[1].streetEdgeId, c[1].captureDate]))
                .toEqual([[1755, '2022-03-01']]);
        });

        test('one partly-refreshed street reports both of its states', () => {
            // Walking street 1755 from its 2021 end to its 2024 end: the same street is both, which is the case
            // audit_task.outdated_imagery cannot express.
            note.update('2021-10-01', makeTask(1755, MAPPED_BY_ME));
            note.update('2024-10-01', makeTask(1755, MAPPED_BY_ME));

            expect(tracker.push).toHaveBeenCalledTimes(2);
            expect(tracker.push.mock.calls.map((c) => c[1].state)).toEqual(['already-mapped', 'reaudit']);
            expect(tracker.push.mock.calls[1][1]).toEqual({
                streetEdgeId: 1755,
                state: 'reaudit',
                captureDate: '2024-10-01',
                lastMappedAt: '2024-07-07T19:00:00Z',
                mappedByThisUser: true,
            });
        });

        test('walking a street logs its state once, not once per pano', () => {
            for (const captureDateIso of ['2024-10-01', '2024-10-01', '2024-11-01', '2024-10-01']) {
                note.update(captureDateIso, makeTask(1755, MAPPED_BY_ME));
            }
            expect(tracker.push).toHaveBeenCalledTimes(1);
            expect(tracker.push).toHaveBeenCalledWith('PanoDateNote_Shown', expect.objectContaining({
                streetEdgeId: 1755, state: 'reaudit',
            }));
        });

        test('each street is logged on its own', () => {
            note.update('2024-10-01', makeTask(1755, MAPPED_BY_ME));
            note.update('2024-10-01', makeTask(1756, MAPPED_BY_ME));
            expect(tracker.push.mock.calls.map((c) => c[1].streetEdgeId)).toEqual([1755, 1756]);
        });
    });
});
