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

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeTracker, navigationAttempts } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

describe('a street given up on at page load', () => {
  let PanoManager;
  let NoImageryFlagGuard;
  let NoImageryError;
  let reportNoImagery;
  let showAlert;
  /** How the tests see the move to /explore the give-up path ends in. */
  const navigations = navigationAttempts();

  /** A viewer type whose creation fails the given way, standing in for a street with no imagery or a dead SDK. */
  const viewerTypeFailingWith = (error) => ({ create: vi.fn(() => Promise.reject(error)) });

  const task = { getStreetEdgeId: () => 101 };

  /** Runs one page load that fails to seed its viewer. */
  const loadAndFail = (error) => {
    const config = { viewerType: viewerTypeFailingWith(error), viewerAccessToken: 'access-token' };
    const panoManager = new PanoManager({ pano: document.getElementById('pano') }, config, {},
      fakeTracker(), { showAlert }, { startPanoId: 'pano-a' }, { task, missionId: 3 });
    return panoManager.ready;
  };

  /** Whether an element is readable, i.e. not sitting under an inherited `visibility: hidden`. */
  const isVisible = (id) => window.getComputedStyle(document.getElementById(id)).visibility === 'visible';

  beforeEach(async () => {
    window.sessionStorage.clear();
    // Mirrors explore.scala.html: the tool ships hidden and Main.init() reveals it — and init bails long before that
    // whenever there is no viewer. The loading animation is what the labeler stares at meanwhile.
    document.body.innerHTML = `
            <div id="page-loading"></div>
            <div class="container tool-ui ps-invisible">
              <div id="pano"></div>
            </div>`;
    const style = document.createElement('style');
    style.textContent = '.ps-invisible { visibility: hidden !important; }';
    document.head.appendChild(style);
    // The failure path logs the error deliberately — it is the only trace of a transient failure, since nothing
    // is written to the db. Kept out of the test output rather than out of the code.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reportNoImagery = vi.fn(() => Promise.resolve());
    showAlert = vi.fn();

    useUtil({ misc: { reportNoImagery } });

    ({ PanoManager, NoImageryFlagGuard, NoImageryError } = await loadModules(
      'frontend/js/explore/panorama/PanoManager.js', 'frontend/js/explore/panorama/NoImageryFlagGuard.js',
      'frontend/js/common/pano-viewer/NoImageryError.js',
    ));
  });

  it('leaves a note for the load that follows, so the move can be explained', async () => {
    await loadAndFail(new NoImageryError('nothing usable here'));

    expect(reportNoImagery).toHaveBeenCalledWith(task, 3);
    expect(navigations).toHaveBeenCalledTimes(1);
    // The note names the street, so the arrival can tell a retry of this street from a move to another.
    expect(PanoManager.consumeStreetSkippedNotice()).toBe(101);
  });

  it('explains the move once, not on every load thereafter', async () => {
    await loadAndFail(new NoImageryError('nothing usable here'));

    expect(PanoManager.consumeStreetSkippedNotice()).toBe(101);
    expect(PanoManager.consumeStreetSkippedNotice()).toBeNull();
  });

  it('says nothing on an ordinary load', () => {
    expect(PanoManager.consumeStreetSkippedNotice()).toBeNull();
  });

  it('leaves no note when the provider never answered, since nobody was moved', async () => {
    await loadAndFail(new Error('the maps library never loaded'));

    expect(reportNoImagery).not.toHaveBeenCalled();
    expect(navigations).not.toHaveBeenCalled();
    expect(PanoManager.consumeStreetSkippedNotice()).toBeNull();
    expect(showAlert).toHaveBeenCalledWith('popup.imagery-load-failed', 'imageryLoadFailed', false);
  });

  it('tells a labeler whose session has spent its budget that the run stopped', async () => {
    NoImageryFlagGuard.recordStreetGivenUp();
    NoImageryFlagGuard.recordStreetGivenUp();
    NoImageryFlagGuard.recordStreetGivenUp();

    await loadAndFail(new NoImageryError('nothing usable here'));

    // Past the flag budget nothing is recorded and nobody is moved, so the transient-failure wording ("try
    // again in a few minutes") would be doubly wrong: nothing failed, and waiting changes nothing.
    expect(reportNoImagery).not.toHaveBeenCalled();
    expect(navigations).not.toHaveBeenCalled();
    expect(showAlert).toHaveBeenCalledWith('popup.imagery-skip-limit', 'imagerySkipLimit', false);
  });

  it('hands the budget back when it stops, so the reload it suggests actually starts over', async () => {
    for (let i = 0; i < NoImageryFlagGuard.MAX_CONSECUTIVE_FLAGS; i++) {
      NoImageryFlagGuard.recordStreetGivenUp();
    }

    await loadAndFail(new NoImageryError('nothing usable here'));

    // The message tells the labeler to reload to start again. A budget that survived the reload would make that
    // advice false and leave the tab unable to show them a street ever again.
    expect(NoImageryFlagGuard.count()).toBe(0);
  });

  describe('when the load stops instead of reloading', () => {
    // The message itself is a toast on <body>, outside the hidden tool (alertController.test.js holds that).
    it('stops the loading animation, which would otherwise say the page is still working', async () => {
      await loadAndFail(new Error('the maps library never loaded'));

      expect(isVisible('page-loading')).toBe(false);
    });

    it('leaves the rest of the tool hidden, since its controls have no viewer to drive', async () => {
      await loadAndFail(new Error('the maps library never loaded'));

      expect(isVisible('pano')).toBe(false);
    });

    it('does the same when the run ended on the flag budget rather than on an error', async () => {
      for (let i = 0; i < NoImageryFlagGuard.MAX_CONSECUTIVE_FLAGS; i++) {
        NoImageryFlagGuard.recordStreetGivenUp();
      }

      await loadAndFail(new NoImageryError('nothing usable here'));

      expect(isVisible('page-loading')).toBe(false);
    });
  });
});
