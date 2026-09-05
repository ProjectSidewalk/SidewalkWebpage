/**
 * The explanation a labeler gets when Explore gives up on a street *at page load* and reloads (#4918).
 *
 * This path is the one that cost production ~3,370 streets, and it is the harder one to say anything on: the reload
 * tears down the page that would have told the labeler what happened. So the failing load leaves a note in
 * sessionStorage — the given-up street's id — and the load that follows reads it and speaks. The id matters because
 * the reported street stays in the pool and assignment picks at random among the highest-priority ones (#4922), so
 * the follow-up load can land back on it: the "you were moved" explanation must only fire when the fresh assignment
 * really is somewhere else. Without any of this the labeler is silently elsewhere, which is precisely how a session
 * could walk 44 streets in 33 seconds without anyone in the seat realizing anything had happened.
 */

const fs = require('fs');
const path = require('path');

const { windowWithStubbedLocation, runScriptWithWindow, newLocationStub } =
    require('./support/windowWithStubbedLocation');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const readSrc = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

const NO_IMAGERY_ERROR_SRC = readSrc('public/js/common/pano-viewer/src/NoImageryError.js');
const FLAG_GUARD_SRC = readSrc('public/js/explore/src/panorama/NoImageryFlagGuard.js');
const PANO_MANAGER_SRC = readSrc('public/js/explore/src/panorama/PanoManager.js');

describe('a street given up on at page load', () => {
    let reportNoImagery;
    let showAlert;
    let locationStub;

    /** A viewer type whose creation fails the given way, standing in for a street with no imagery or a dead SDK. */
    const viewerTypeFailingWith = (error) => ({ create: jest.fn(() => Promise.reject(error)) });

    const task = { getStreetEdgeId: () => 101 };

    /** Runs one page load that fails to seed its viewer. */
    const loadAndFail = (error) => window.PanoManager.create(
        viewerTypeFailingWith(error), 'access-token', { startPanoId: 'pano-a' }, { task, missionId: 3 },
    );

    /** Whether an element is readable, i.e. not sitting under an inherited `visibility: hidden`. */
    const isVisible = (id) => window.getComputedStyle(document.getElementById(id)).visibility === 'visible';

    beforeEach(() => {
        window.sessionStorage.clear();
        // Mirrors explore.scala.html: the alert banner lives inside `.tool-ui`, which the page ships hidden and
        // Main.init() reveals — and init bails long before that whenever there is no viewer. The loading animation
        // it also hides is what the labeler stares at meanwhile.
        document.body.innerHTML = `
            <div id="page-loading"></div>
            <div class="container tool-ui ps-invisible">
              <div id="pano"></div>
              <div id="interaction-area-holder">
                <div id="alert-holder"></div>
              </div>
            </div>`;
        const style = document.createElement('style');
        style.textContent = '.ps-invisible { visibility: hidden !important; }';
        document.head.appendChild(style);
        // The failure path logs the error deliberately — it is the only trace of a transient failure, since nothing
        // is written to the db. Kept out of the test output rather than out of the code.
        jest.spyOn(console, 'error').mockImplementation(() => {});
        reportNoImagery = jest.fn(() => Promise.resolve());
        showAlert = jest.fn();

        // jsdom refuses real navigation, and the give-up path ends in one.
        locationStub = newLocationStub();
        const win = windowWithStubbedLocation(locationStub);

        window.svl = { tracker: { push: jest.fn() }, alertController: { showAlert } };
        window.util = { misc: { reportNoImagery } };
        window.i18next = { t: (key) => key };

        runScriptWithWindow(`${NO_IMAGERY_ERROR_SRC}; window.NoImageryError = NoImageryError;`, win);
        runScriptWithWindow(`${FLAG_GUARD_SRC}; window.NoImageryFlagGuard = NoImageryFlagGuard;`, win);
        runScriptWithWindow(`${PANO_MANAGER_SRC}; window.PanoManager = PanoManager;`, win);
    });

    it('leaves a note for the load that follows, so the move can be explained', async () => {
        await loadAndFail(new window.NoImageryError('nothing usable here'));

        expect(reportNoImagery).toHaveBeenCalledWith(task, 3);
        expect(locationStub.replace).toHaveBeenCalledWith('/explore');
        // The note names the street, so the arrival can tell a retry of this street from a move to another.
        expect(window.PanoManager.consumeStreetSkippedNotice()).toBe(101);
    });

    it('explains the move once, not on every load thereafter', async () => {
        await loadAndFail(new window.NoImageryError('nothing usable here'));

        expect(window.PanoManager.consumeStreetSkippedNotice()).toBe(101);
        expect(window.PanoManager.consumeStreetSkippedNotice()).toBeNull();
    });

    it('says nothing on an ordinary load', () => {
        expect(window.PanoManager.consumeStreetSkippedNotice()).toBeNull();
    });

    it('leaves no note when the provider never answered, since nobody was moved', async () => {
        await loadAndFail(new Error('the maps library never loaded'));

        expect(reportNoImagery).not.toHaveBeenCalled();
        expect(locationStub.replace).not.toHaveBeenCalled();
        expect(window.PanoManager.consumeStreetSkippedNotice()).toBeNull();
        expect(showAlert).toHaveBeenCalledWith('popup.imagery-load-failed', 'imageryLoadFailed', false);
    });

    it('tells a labeler whose session has spent its budget that the run stopped', async () => {
        window.NoImageryFlagGuard.recordStreetGivenUp();
        window.NoImageryFlagGuard.recordStreetGivenUp();
        window.NoImageryFlagGuard.recordStreetGivenUp();

        await loadAndFail(new window.NoImageryError('nothing usable here'));

        // Past the flag budget nothing is recorded and nobody is moved, so the transient-failure wording ("try
        // again in a few minutes") would be doubly wrong: nothing failed, and waiting changes nothing.
        expect(reportNoImagery).not.toHaveBeenCalled();
        expect(locationStub.replace).not.toHaveBeenCalled();
        expect(showAlert).toHaveBeenCalledWith('popup.imagery-skip-limit', 'imagerySkipLimit', false);
    });

    it('hands the budget back when it stops, so the reload it suggests actually starts over', async () => {
        for (let i = 0; i < window.NoImageryFlagGuard.MAX_CONSECUTIVE_FLAGS; i++) {
            window.NoImageryFlagGuard.recordStreetGivenUp();
        }

        await loadAndFail(new window.NoImageryError('nothing usable here'));

        // The message tells the labeler to reload to start again. A budget that survived the reload would make that
        // advice false and leave the tab unable to show them a street ever again.
        expect(window.NoImageryFlagGuard.count()).toBe(0);
    });

    describe('when the load stops instead of reloading', () => {
        // A message nobody can read is the same as no message, and this is the exact spot where that happens: the
        // banner is inside `.tool-ui`, which only Main.init() reveals, and init returns as soon as it sees there is
        // no viewer. Asserting that showAlert was called is not enough to know the labeler was told (#4918).
        it('makes the banner readable rather than leaving it inside the hidden tool', async () => {
            expect(isVisible('alert-holder')).toBe(false);

            await loadAndFail(new Error('the maps library never loaded'));

            expect(isVisible('alert-holder')).toBe(true);
        });

        it('stops the loading animation, which would otherwise say the page is still working', async () => {
            await loadAndFail(new Error('the maps library never loaded'));

            expect(isVisible('page-loading')).toBe(false);
        });

        it('leaves the rest of the tool hidden, since its controls have no viewer to drive', async () => {
            await loadAndFail(new Error('the maps library never loaded'));

            expect(isVisible('pano')).toBe(false);
        });

        it('does the same when the run ended on the flag budget rather than on an error', async () => {
            for (let i = 0; i < window.NoImageryFlagGuard.MAX_CONSECUTIVE_FLAGS; i++) {
                window.NoImageryFlagGuard.recordStreetGivenUp();
            }

            await loadAndFail(new window.NoImageryError('nothing usable here'));

            expect(isVisible('alert-holder')).toBe(true);
            expect(isVisible('page-loading')).toBe(false);
        });
    });
});
