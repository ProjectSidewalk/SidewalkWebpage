/**
 * The explanation a labeler gets when Explore gives up on a street *at page load* and reloads onto another one
 * (#4918).
 *
 * This path is the one that cost production ~3,370 streets, and it is the harder one to say anything on: the reload
 * that carries the labeler to a new street also tears down the page that would have told them about it. So the
 * failing load leaves a note in sessionStorage, and the load that follows reads it and speaks. Without that the
 * labeler is silently somewhere else, which is precisely how a session could walk 44 streets in 33 seconds without
 * anyone in the seat realizing anything had happened.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const readSrc = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

const NO_IMAGERY_ERROR_SRC = readSrc('public/js/common/pano-viewer/src/NoImageryError.js');
const FLAG_GUARD_SRC = readSrc('public/js/explore/src/panorama/NoImageryFlagGuard.js');
const PANO_MANAGER_SRC = readSrc('public/js/explore/src/panorama/PanoManager.js');

describe('a street given up on at page load', () => {
    let reportNoImagery;
    let showAlert;

    /** A viewer type whose creation fails the given way, standing in for a street with no imagery or a dead SDK. */
    const viewerTypeFailingWith = (error) => ({ create: jest.fn(() => Promise.reject(error)) });

    const task = { getStreetEdgeId: () => 101 };

    /** Runs one page load that fails to seed its viewer. */
    const loadAndFail = (error) => window.PanoManager.create(
        viewerTypeFailingWith(error), 'access-token', { startPanoId: 'pano-a' }, { task, missionId: 3 },
    );

    beforeEach(() => {
        window.sessionStorage.clear();
        document.body.innerHTML = '<div id="pano"></div>';
        // The failure path logs the error deliberately — it is the only trace of a transient failure, since nothing
        // is written to the db. Kept out of the test output rather than out of the code.
        jest.spyOn(console, 'error').mockImplementation(() => {});
        reportNoImagery = jest.fn(() => Promise.resolve());
        showAlert = jest.fn();

        // jsdom refuses real navigation, and the give-up path ends in one.
        Object.defineProperty(window, 'location', { value: { replace: jest.fn() }, writable: true });

        window.svl = { tracker: { push: jest.fn() }, alertController: { showAlert } };
        window.util = { misc: { reportNoImagery } };
        window.i18next = { t: (key) => key };

        window.eval(`${NO_IMAGERY_ERROR_SRC}; window.NoImageryError = NoImageryError;`);
        window.eval(`${FLAG_GUARD_SRC}; window.NoImageryFlagGuard = NoImageryFlagGuard;`);
        window.eval(`${PANO_MANAGER_SRC}; window.PanoManager = PanoManager;`);
    });

    it('leaves a note for the load that follows, so the move can be explained', async () => {
        await loadAndFail(new window.NoImageryError('nothing usable here'));

        expect(reportNoImagery).toHaveBeenCalledWith(task, 3);
        expect(window.location.replace).toHaveBeenCalledWith('/explore');
        expect(window.PanoManager.consumeStreetSkippedNotice()).toBe(true);
    });

    it('explains the move once, not on every load thereafter', async () => {
        await loadAndFail(new window.NoImageryError('nothing usable here'));

        expect(window.PanoManager.consumeStreetSkippedNotice()).toBe(true);
        expect(window.PanoManager.consumeStreetSkippedNotice()).toBe(false);
    });

    it('says nothing on an ordinary load', () => {
        expect(window.PanoManager.consumeStreetSkippedNotice()).toBe(false);
    });

    it('leaves no note when the provider never answered, since nobody was moved', async () => {
        await loadAndFail(new Error('the maps library never loaded'));

        expect(reportNoImagery).not.toHaveBeenCalled();
        expect(window.location.replace).not.toHaveBeenCalled();
        expect(window.PanoManager.consumeStreetSkippedNotice()).toBe(false);
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
        expect(window.location.replace).not.toHaveBeenCalled();
        expect(showAlert).toHaveBeenCalledWith('popup.imagery-skip-limit', 'imagerySkipLimit', false);
    });
});
