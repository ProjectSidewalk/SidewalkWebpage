/**
 * Tests for a Validate mission's progress, across frontend/js/validate/mission/MissionContainer.js,
 * frontend/js/validate/mission/Mission.js and frontend/js/validate/status/StatusField.js: a mission arriving from the
 * server, each verdict and undo moving its bar and tally, and the last verdict ending it. The three are driven
 * together because each verdict passes through all of them, and only together do they show what the validator sees
 * (the title, the bar, the badge toast, the mission-complete screen) (#5840).
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker } from './fakes.js';

mockModule('i18next', () => ({ default: {
  // Echo the key plus any interpolation, so assertions can name what a slot was filled with.
  t: (key, opts) => (opts ? `${key}|${JSON.stringify(opts)}` : key),
} }));

const { MissionContainer, StatusField, BadgeAchievements } = await loadModules(
  'frontend/js/validate/mission/MissionContainer.js',
  'frontend/js/validate/status/StatusField.js',
  'frontend/js/common/BadgeAchievements.js',
);

/** The desktop title bar and menu header (validate.scala.html), cut down to what the status field writes. */
const DESKTOP = `
  <div id="mission-status">
    <img id="mission-title-icon" alt="">
    <div id="mission-title"></div>
    <div class="ps-progress-bar"><div id="mission-progress-bar-complete"></div></div>
    <span id="mission-progress-bar-text"></span>
  </div>
  <div id="svv-panorama-holder"></div>
  <div id="main-validate-header"></div>`;

/** The phone's (mobileValidate.scala.html): a bar with no text, a title with no icon, and no menu column. */
const MOBILE = `
  <div class="ps-progress-bar"><div id="mission-progress-bar-complete"></div></div>
  <div id="mission-title"></div>
  <div id="svv-panorama-holder"></div>`;

/**
 * @param {object} [overrides] - Fields to change.
 * @returns {Record<string, any>} A mission as /validationTask/mission sends it: three Obstacle labels, none done.
 */
const missionJson = (overrides = {}) => ({
  mission_id: 7, mission_type: 'validation', label_type: 'Obstacle', labels_progress: 0, labels_validated: 3,
  completed: false, ...overrides,
});

const NO_VOTES = { agree_count: 0, disagree_count: 0, unsure_count: 0 };

const byId = (id) => document.getElementById(id);

describe('a validation mission’s progress', () => {
  let tracker;
  let marker;
  let modalMission;
  let modalMissionComplete;
  let statusField;
  let missions;

  /**
   * Builds the status field and container over the given markup, the way Main.js builds them.
   * @param {string} markup - The layout's status markup.
   * @param {number} [completedValidations] - The validator's all-time count when the page loaded.
   */
  function build(markup, completedValidations = 0) {
    document.body.innerHTML = markup;
    // The UI bag Main.js collects; only the status and the menu header are read here.
    const ui = /** @type {any} */ ({
      status: { upperMenuTitle: byId('mission-title'), upperMenuIcon: byId('mission-title-icon') },
      validationMenu: { header: byId('main-validate-header') },
    });
    statusField = new StatusField(completedValidations, ui);
    missions = new MissionContainer(statusField, modalMission, modalMissionComplete, marker, tracker);
  }

  /**
   * Casts a verdict the way LabelContainer does: tally it on the mission, then count it toward the mission.
   * @param {string} result - 'Agree', 'Disagree' or 'Unsure'.
   */
  function vote(result) {
    missions.getCurrentMission().updateValidationResult(result, false);
    missions.updateAMission();
  }

  /** @returns {{width: string, text: string}} What the mission bar shows. */
  const bar = () => ({
    width: byId('mission-progress-bar-complete').style.width,
    text: byId('mission-progress-bar-text')?.textContent,
  });

  beforeEach(() => {
    tracker = fakeTracker();
    marker = { markLive: vi.fn() };
    modalMission = { setMissionMessage: vi.fn() };
    modalMissionComplete = { show: vi.fn() };
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('the container is what the tracker files each action under', () => {
    build(DESKTOP);

    expect(tracker.trackMissions).toHaveBeenCalledWith(missions);
  });

  test('a new mission marks the tab live, is briefed, and titles the page with its type and length', () => {
    build(DESKTOP);

    missions.createAMission(missionJson(), NO_VOTES);

    const mission = missions.getCurrentMission();
    expect(marker.markLive).toHaveBeenCalledWith(7);
    expect(modalMission.setMissionMessage).toHaveBeenCalledWith(mission);
    expect(mission.getProperty('labelType')).toBe('Obstacle');
    expect(mission.isComplete()).toBe(false);
    expect(byId('mission-title').innerHTML).toContain('mission-start-tutorial.mst-instruction-2');
    expect(byId('mission-title').innerHTML).toContain('"nLabels":3');
    expect(byId('mission-title-icon').getAttribute('src')).toContain('label_type_icons/Obstacle_small.svg');
    expect(byId('main-validate-header').innerHTML).toBe('top-ui.title.obstacle');
    expect(bar()).toEqual({ width: '0%', text: '0/3' });
  });

  test('a resumed mission picks its bar up where it was left', () => {
    build(DESKTOP);

    missions.createAMission(missionJson({ labels_progress: 2, labels_validated: 5 }), NO_VOTES);

    expect(bar()).toEqual({ width: '40%', text: '2/5' });
  });

  test('each verdict moves the bar and the validator’s all-time count forward', () => {
    build(DESKTOP, 10);
    missions.createAMission(missionJson(), NO_VOTES);

    vote('Agree');

    expect(bar()).toEqual({ width: '33%', text: '1/3' });
    expect(statusField.getCompletedValidations()).toBe(11);
    expect(modalMissionComplete.show).not.toHaveBeenCalled();
  });

  test('the last verdict ends the mission: its screen goes up with the tally, then the listeners hear', () => {
    build(DESKTOP);
    missions.createAMission(missionJson(), NO_VOTES);
    const listener = vi.fn();
    missions.onMissionComplete(listener);

    vote('Agree');
    vote('Disagree');
    vote('Unsure');

    const mission = missions.getCurrentMission();
    expect(mission.isComplete()).toBe(true);
    expect(modalMissionComplete.show).toHaveBeenCalledWith(mission, 1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.invocationCallOrder[0]).toBeGreaterThan(modalMissionComplete.show.mock.invocationCallOrder[0]);
    expect(['agreeCount', 'disagreeCount', 'unsureCount'].map((key) => mission.getProperty(key))).toEqual([1, 1, 1]);
    expect(bar()).toEqual({ width: '100%', text: '3/3' });
  });

  test('the screen is told how many missions this page has finished, so every third can offer Explore', () => {
    build(DESKTOP);
    for (const missionId of [7, 8]) {
      missions.createAMission(missionJson({ mission_id: missionId, labels_validated: 1 }), NO_VOTES);
      vote('Agree');
    }

    expect(modalMissionComplete.show.mock.calls.map((call) => call[1])).toEqual([1, 2]);
  });

  test.each(['Agree', 'Disagree', 'Unsure'])('an undo of %s takes that vote back and steps the bar back', (result) => {
    build(DESKTOP, 10);
    missions.createAMission(missionJson(), { agree_count: 2, disagree_count: 2, unsure_count: 2 });
    vote(result);

    missions.updateAMissionUndoValidation(result);

    const mission = missions.getCurrentMission();
    expect(['agreeCount', 'disagreeCount', 'unsureCount'].map((key) => mission.getProperty(key))).toEqual([2, 2, 2]);
    expect(bar()).toEqual({ width: '0%', text: '0/3' });
    expect(statusField.getCompletedValidations()).toBe(10);
  });

  // labels_progress is the server's; a mission already full is never counted past its end, nor completed twice.
  test('a mission the server sends already full counts no further verdict', () => {
    build(DESKTOP, 10);
    missions.createAMission(missionJson({ labels_progress: 3 }), NO_VOTES);

    missions.updateAMission();

    expect(bar()).toEqual({ width: '100%', text: '3/3' });
    expect(statusField.getCompletedValidations()).toBe(10);
    expect(modalMissionComplete.show).not.toHaveBeenCalled();
  });

  test('the verdict that crosses into a new validation badge shows the unlock toast over the pano', () => {
    const toast = vi.spyOn(BadgeAchievements, 'showUnlockToast').mockImplementation(() => null);
    build(DESKTOP, 98); // The first validation badge is at 100.
    missions.createAMission(missionJson(), NO_VOTES);

    vote('Agree');
    expect(toast).not.toHaveBeenCalled();

    vote('Agree');
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ roman: 'I' });
    expect(toast.mock.calls[0][1]).toBe(byId('svv-panorama-holder'));
  });

  test('on the phone, which has no title icon, menu header or bar text, the title and bar still follow', () => {
    build(MOBILE);

    missions.createAMission(missionJson(), NO_VOTES);
    vote('Agree');

    expect(byId('mission-title').innerHTML).toContain('"nLabels":3');
    expect(bar()).toEqual({ width: '33%', text: undefined });
  });
});
