/**
 * Explore's tips (frontend/js/explore/alert/KeyboardShortcutAlert.js, RatingReminderAlert.js, ZoomShortcutAlert.js
 * and StuckAlert.js, #5840): how many repeats of a click earn each nudge, what resets the count, that the tutorial
 * stays quiet, and that the "going in circles" hint fires on a third visit to one pano. The AlertController is the
 * real one, over a Toast double, so each tip is checked as the toast it becomes.
 */

import { loadModules, mockModule } from './loader.js';

mockModule('i18next', () => ({ default: {
  // A tip that names a key reads `key|C`; the street-name notice reads `key|Palisade Ave`.
  t: (key, opts) => {
    const value = opts?.key ?? opts?.streetName;
    return value === undefined ? key : `${key}|${value}`;
  },
} }));

const toast = { show: vi.fn(() => ({ dismiss: vi.fn() })) };
mockModule('frontend/js/common/Toast.js', () => ({ Toast: toast }));

let alerts;
let KeyboardShortcutAlert;
let RatingReminderAlert;
let ZoomShortcutAlert;
let StuckAlert;

/** @returns {string[]} The message of each toast shown so far. */
const shown = () => toast.show.mock.calls.map(([opts]) => opts.messageHtml);

/** @returns {string|undefined} The label of the last toast's button, if it offered one. */
const lastButton = () => toast.show.mock.calls.at(-1)[0].button?.label;

/** @param {() => void} action - What the labeler does. @param {number} times - How often. */
const repeat = (action, times) => { for (let i = 0; i < times; i++) action(); };

beforeEach(async () => {
  document.body.innerHTML = '<div id="pano"></div>';
  const stored = {};
  const { AlertController, ...rest } = await loadModules('frontend/js/explore/alert/AlertController.js',
    'frontend/js/explore/alert/KeyboardShortcutAlert.js', 'frontend/js/explore/alert/RatingReminderAlert.js',
    'frontend/js/explore/alert/ZoomShortcutAlert.js', 'frontend/js/explore/alert/StuckAlert.js');
  ({ KeyboardShortcutAlert, RatingReminderAlert, ZoomShortcutAlert, StuckAlert } = rest);
  alerts = new AlertController({ get: (key) => stored[key], set: (key, value) => { stored[key] = value; } });
});

describe('the keyboard-shortcut nudge', () => {
  const config = (isOnboarding = false) => ({ isOnboarding });

  it('names a mode button\'s key on the tenth click, then starts counting again', () => {
    const nudge = new KeyboardShortcutAlert(config(), alerts);

    repeat(() => nudge.modeSwitchButtonClicked('CurbRamp'), 9);
    expect(shown()).toEqual([]);
    nudge.modeSwitchButtonClicked('CurbRamp');
    expect(shown()).toEqual(['popup.label-shortcuts-curb-ramp|C']);
    expect(lastButton()).toBe('common:dont-show-again');

    repeat(() => nudge.modeSwitchButtonClicked('CurbRamp'), 9);
    expect(shown()).toHaveLength(1);
    nudge.modeSwitchButtonClicked('CurbRamp');
    expect(shown()).toHaveLength(2);
  });

  it('counts each label type on its own, and never the walk button', () => {
    const nudge = new KeyboardShortcutAlert(config(), alerts);

    repeat(() => nudge.modeSwitchButtonClicked('CurbRamp'), 9);
    repeat(() => nudge.modeSwitchButtonClicked('Obstacle'), 9);
    repeat(() => nudge.modeSwitchButtonClicked('Walk'), 20);

    expect(shown()).toEqual([]);
    nudge.modeSwitchButtonClicked('Obstacle');
    expect(shown()).toEqual(['popup.label-shortcuts-obstacle|O']);
  });

  it('has nothing to say about a type with no shortcut key', () => {
    const nudge = new KeyboardShortcutAlert(config(), alerts);
    repeat(() => nudge.modeSwitchButtonClicked('Other'), 12);
    expect(shown()).toEqual([]);
  });

  it('suggests the spacebar on the fifth Stuck click', () => {
    const nudge = new KeyboardShortcutAlert(config(), alerts);

    repeat(() => nudge.stuckButtonClicked(), 4);
    expect(shown()).toEqual([]);
    nudge.stuckButtonClicked();
    expect(shown()).toEqual(['popup.move-forward-shortcut']);
    repeat(() => nudge.stuckButtonClicked(), 4);
    expect(shown()).toHaveLength(1);
  });

  it('stays quiet during the tutorial', () => {
    const nudge = new KeyboardShortcutAlert(config(true), alerts);

    repeat(() => nudge.modeSwitchButtonClicked('CurbRamp'), 10);
    repeat(() => nudge.stuckButtonClicked(), 5);

    expect(shown()).toEqual([]);
  });
});

describe('the severity reminder', () => {
  it('fires on the fourth unrated label in a row, and a rating in between starts the count over', () => {
    const reminder = new RatingReminderAlert({ isOnboarding: false }, alerts);

    repeat(() => reminder.ratingClicked(null), 3);
    reminder.ratingClicked(2);
    repeat(() => reminder.ratingClicked(undefined), 3);
    expect(shown()).toEqual([]);

    reminder.ratingClicked(null);
    expect(shown()).toEqual(['popup.severity-shortcuts']);
    repeat(() => reminder.ratingClicked(null), 3);
    expect(shown()).toHaveLength(1);
  });

  it('stays quiet during the tutorial', () => {
    const reminder = new RatingReminderAlert({ isOnboarding: true }, alerts);
    repeat(() => reminder.ratingClicked(null), 8);
    expect(shown()).toEqual([]);
  });
});

describe('the zoom-shortcut nudge', () => {
  it('fires on the fifth click of the zoom button, then starts counting again', () => {
    const nudge = new ZoomShortcutAlert({ isOnboarding: false }, alerts);

    repeat(() => nudge.zoomClicked(), 4);
    expect(shown()).toEqual([]);
    nudge.zoomClicked();
    expect(shown()).toEqual(['popup.zoom-shortcuts']);
    repeat(() => nudge.zoomClicked(), 4);
    expect(shown()).toHaveLength(1);
  });

  it('stays quiet during the tutorial', () => {
    const nudge = new ZoomShortcutAlert({ isOnboarding: true }, alerts);
    repeat(() => nudge.zoomClicked(), 10);
    expect(shown()).toEqual([]);
  });
});

describe('the Stuck alerts', () => {
  let panoChanged;

  /** @returns {StuckAlert} An alert listening to a pano manager whose pano changes the test fires. */
  const stuckAlert = () => new StuckAlert(alerts, { onPanoChanged: (fn) => { panoChanged = fn; } });

  it('asks "still stuck?" when the button is clicked', () => {
    stuckAlert().stuckClicked();
    expect(shown()).toEqual(['popup.still-stuck']);
    expect(lastButton()).toBe('common:dont-show-again');
  });

  it('hints at the Stuck button the third time the labeler lands on the same pano', () => {
    stuckAlert();

    panoChanged({ getPanoId: () => 'a' });
    panoChanged({ getPanoId: () => 'b' });
    panoChanged({ getPanoId: () => 'a' });
    expect(shown()).toEqual([]);
    panoChanged({ getPanoId: () => 'a' });
    expect(shown()).toEqual(['popup.stuck-suggestion']);
  });

  it('forgets the recent panos after the compass or Stuck button moves the labeler on purpose', () => {
    const alert = stuckAlert();
    alert.panoVisited('a');
    alert.panoVisited('a');

    alert.compassOrStuckClicked();
    alert.panoVisited('a');
    alert.panoVisited('a');
    expect(shown()).toEqual([]);
    alert.panoVisited('a');
    expect(shown()).toEqual(['popup.stuck-suggestion']);
  });

  it('only remembers the last 25 panos', () => {
    const alert = stuckAlert();
    alert.panoVisited('a');
    for (let i = 0; i < 25; i++) alert.panoVisited(`other-${i}`);

    alert.panoVisited('a');
    alert.panoVisited('a');
    expect(shown()).toEqual([]);
  });
});
