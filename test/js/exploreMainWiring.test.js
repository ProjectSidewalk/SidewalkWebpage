/**
 * Tests that Explore's start-up (frontend/js/explore/Main.js) builds its modules in dependency order, hands each one
 * what it subscribes to, and wires the one policy that spans them: what a pop-up stops (#5648). No module's own suite
 * would notice one built before what it is handed exists. Every module is a recording stand-in from
 * support/exploreMainHarness.js; the gates are real, so the pop-up policy is checked by holding the lock.
 */

import { FIXTURE, SESSION, exploreMain, startExploreMain } from './support/exploreMainHarness.js';

beforeEach(async () => {
  document.body.innerHTML = FIXTURE;
  await startExploreMain();
});

/** The keyboard lock and the pop-up lock, which Main builds as plain gates and hands to what holds them. */
const keyboardLock = () => exploreMain.built.keyboard.ctorArgs[0];
const interactionLock = () => exploreMain.built.popUpMessage.ctorArgs[1];

describe('Explore Main builds in dependency order', () => {
  it('starts the viewer and the minimap side by side, and builds what needs neither meanwhile', () => {
    const { built, buildOrder } = exploreMain;
    const before = (a, b) => expect(buildOrder.indexOf(a)).toBeLessThan(buildOrder.indexOf(b));
    before('panoManager', 'minimap');
    // The peg is the first thing that needs the pano on screen.
    for (const viewerFree of ['stuckAlert', 'overallStats', 'missionPanel', 'audioEffect', 'labelModes']) {
      before('panoManager', viewerFree);
      before(viewerFree, 'peg');
    }
    // Centered on the seed while loading, then on the pano that actually landed.
    expect(built.minimap.ctorArgs[1]).toEqual({ lat: 47.6, lng: -122.3 });
    expect(built.minimap.setMinimapLocation).toHaveBeenCalledWith({ lat: 47.6, lng: -122.3 });
  });

  it('creates the first mission only once all three containers can hear about it', () => {
    const { built, buildOrder } = exploreMain;
    const containers = ['taskContainer', 'missionContainer', 'labelContainer'].map((name) => buildOrder.indexOf(name));
    expect(containers.every((index) => index >= 0)).toBe(true);
    expect(built.missionModel.createAMission).toHaveBeenCalledWith(SESSION.mission);
    expect(buildOrder.indexOf('form')).toBeGreaterThan(Math.max(...containers));
  });

  it('hands the Tracker its flush once the Form exists', () => {
    const { built, buildOrder } = exploreMain;
    expect(built.tracker.onFlush).toHaveBeenCalledWith(expect.any(Function));
    expect(buildOrder.indexOf('form')).toBeLessThan(built.tracker.onFlush.mock.invocationCallOrder[0]);

    // A full log buffer is posted by the Form along with any unsaved labels.
    built.tracker.onFlush.mock.calls[0][0]();
    expect(built.form.submitData).toHaveBeenCalled();
  });

  it('builds the arrows before the service that answers them, and the keyboard after everything it drives', () => {
    const { built, buildOrder } = exploreMain;
    expect(buildOrder.indexOf('navArrows')).toBeLessThan(buildOrder.indexOf('navigationService'));
    // The compass shows street progress's jump prompt, so it needs street progress built first.
    expect(buildOrder.indexOf('streetProgress')).toBeLessThan(buildOrder.indexOf('compass'));
    const keyboard = buildOrder.indexOf('keyboard');
    for (const driven of ['canvas', 'contextMenu', 'navigationService', 'ribbon', 'zoomControl', 'compass']) {
      expect(buildOrder.indexOf(driven)).toBeLessThan(keyboard);
    }
    expect(built.navArrows.onLinkClick).toHaveBeenCalledWith(expect.any(Function));
    expect(built.navArrows.onRouteForwardClick).toHaveBeenCalledWith(expect.any(Function));
  });

  it('hands each module what it subscribes to', () => {
    const m = exploreMain.built;
    expect(m.streetSweep.ctorArgs).toEqual(expect.arrayContaining([m.taskContainer, m.panoManager, m.form]));
    expect(m.navigationService.ctorArgs).toEqual(expect.arrayContaining(
      [m.streetSweep, m.labelContainer, m.labelModes, m.navArrows, keyboardLock()]));
    expect(m.streetProgress.ctorArgs).toEqual(expect.arrayContaining(
      [m.taskContainer, m.missionContainer, m.navigationService, m.streetSweep]));
    expect(m.canvas.ctorArgs).toEqual(expect.arrayContaining(
      [m.labelModes, m.contextMenu, m.labelContainer, m.panoManager, m.navigationService]));
    expect(m.compass.ctorArgs).toEqual(expect.arrayContaining(
      [m.taskContainer, m.panoManager, m.navigationService, m.streetProgress]));
    expect(m.contextMenu.ctorArgs).toEqual(expect.arrayContaining([m.labelModes, m.navigationService]));
    expect(m.forwardCrumbs.ctorArgs).toEqual(expect.arrayContaining([m.navigationService, m.navArrows]));
    expect(m.missionController.ctorArgs).toEqual(expect.arrayContaining(
      [m.compass, m.navigationService, m.streetProgress, m.panoManager]));
    expect(m.modalMissionComplete.ctorArgs).toEqual(expect.arrayContaining([interactionLock()]));
    expect(m.ribbon.ctorArgs).toEqual(expect.arrayContaining([m.labelModes]));
    expect(m.stuckAlert.ctorArgs).toEqual(expect.arrayContaining([m.panoManager]));
    expect(m.reauditNotice.ctorArgs).toEqual(expect.arrayContaining([m.taskContainer]));
    expect(m.panoDateNote.ctorArgs).toEqual(expect.arrayContaining([m.panoManager, m.taskContainer]));
    expect(m.peg.ctorArgs).toEqual(expect.arrayContaining([m.minimap, m.panoManager]));
  });
});

describe('Explore Main wires what a pop-up stops', () => {
  it('a pop-up holds walking, panning, labeling, mode switching and the shortcuts, and lets all of them go', () => {
    const { navigationService, panoManager, canvas, labelModes, missionStartTutorial } = exploreMain.built;
    const gates = [navigationService.walking, panoManager.panning, canvas.labeling, labelModes.switching,
      keyboardLock()];

    interactionLock().hold('popup');
    expect(gates.every((gate) => gate.isHeld())).toBe(true);
    interactionLock().release('popup');
    // The mission-start screen still holds the shortcuts; once it's dismissed, nothing should.
    missionStartTutorial.ctorArgs[3].keyboard.enableKeyboard();
    expect(gates.some((gate) => gate.isHeld())).toBe(false);
  });

  it('the sign-in dialog is one of those pop-ups', async () => {
    // Registered on the element at start-up, so the dialog has to exist before Main runs.
    document.body.insertAdjacentHTML('beforeend', '<div id="sign-in-modal-container"></div>');
    await startExploreMain();
    const modal = document.getElementById('sign-in-modal-container');
    const toolUi = document.querySelector('.tool-ui');
    modal.dispatchEvent(new Event('ps:modal:show'));
    expect(exploreMain.built.navigationService.walking.isHeld()).toBe(true);
    expect(toolUi.style.opacity).toBe('0.5');
    modal.dispatchEvent(new Event('ps:modal:hidden'));
    expect(exploreMain.built.navigationService.walking.isHeld()).toBe(false);
    expect(toolUi.style.opacity).toBe('1');
  });

  it('pauses the shortcuts under the mission-start screen until it is dismissed', () => {
    const { missionStartTutorial } = exploreMain.built;
    expect(keyboardLock().isHeld()).toBe(true);
    missionStartTutorial.ctorArgs[3].keyboard.enableKeyboard();
    expect(keyboardLock().isHeld()).toBe(false);
  });
});
