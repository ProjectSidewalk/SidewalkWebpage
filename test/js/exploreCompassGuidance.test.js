/**
 * The compass message that steers the labeler along the route (frontend/js/explore/navigation/Compass.js, #5840):
 * which turn it shows for how far the view is from the route's way, when it warns of being off route, what a click on
 * it does (a step forward, a turn, or a jump when the label-before-jump prompt is up), and the prompt's own wording
 * and blinking. The cursor under the prompt is compassJumpPromptCursor.test.js's.
 */

import { loadModules, mockModule } from './loader.js';
import { flush } from './support/routeFetch.js';
import { fakePanoManager, fakeTaskContainer, fakeTracker } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

describe('Compass', () => {
  let compass;
  let holder;
  let message;
  let config;
  let regionModel;
  let task;
  let viewer;
  let panoManager;
  let nav;
  let navigationService;
  let streetProgress;
  let stuckAlert;
  let tracker;
  let listeners;

  beforeEach(async () => {
    document.body.innerHTML = '<div id="compass-message-holder"><div id="compass-message"></div></div>';
    holder = document.getElementById('compass-message-holder');
    message = document.getElementById('compass-message');
    const { Compass } = await loadModules('frontend/js/explore/navigation/Compass.js');
    config = { isOnboarding: false, isExploreAddressMode: false };
    regionModel = { isRouteComplete: false, isRegionComplete: false, isRouteOrRegionComplete: () => false };
    // The route runs north from here; the labeler is on it unless a test says otherwise.
    task = { headingAlongRoute: vi.fn(() => 0), isNearRoute: vi.fn(() => true) };
    viewer = {
      heading: 0,
      getPanoId: () => 'pano-a',
      getPosition: () => ({ lat: 47.6, lng: -122.3 }),
      getPov() { return { heading: this.heading, pitch: 0, zoom: 1 }; },
    };
    listeners = {};
    panoManager = fakePanoManager(viewer, {
      onPovChanged: (listener) => { listeners.povChanged = listener; },
      turnTo: vi.fn(),
    });
    nav = { moving: false, canWalk: true };
    navigationService = {
      onMoveStarted: (listener) => { listeners.moveStarted = listener; },
      onMoveFinished: (listener) => { listeners.moveFinished = listener; },
      onHeadingSettled: (listener) => { listeners.headingSettled = listener; },
      isMoving: () => nav.moving,
      canWalk: () => nav.canWalk,
      moveForward: vi.fn(() => Promise.resolve('pano-b')),
    };
    streetProgress = {
      armed: false,
      onLabelBeforeJumpChanged: (listener) => { listeners.jumpPrompt = listener; },
      isLabelBeforeJumpArmed: () => streetProgress.armed,
      jumpToANewTask: vi.fn(() => Promise.resolve()),
    };
    stuckAlert = { compassOrStuckClicked: vi.fn() };
    tracker = fakeTracker();
    compass = new Compass(config, regionModel, fakeTaskContainer(() => task, {
      onCurrentTaskChanged: (listener) => { listeners.taskChanged = listener; },
    }), panoManager, navigationService, streetProgress, stuckAlert, tracker);
  });

  afterEach(() => compass.stopBlinking());

  const tracked = (eventName) => tracker.push.mock.calls.filter(([name]) => name === eventName);

  describe('the turn message', () => {
    // How far clockwise the view is from the route's way, and the turn that brings it back.
    test.each([
      [0, 'straight', 'ArrowStraight'],
      [19, 'straight', 'ArrowStraight'],
      [341, 'straight', 'ArrowStraight'],
      [20, 'slight-left', 'ArrowSlightLeft'],
      [44, 'slight-left', 'ArrowSlightLeft'],
      [340, 'slight-right', 'ArrowSlightRight'],
      [316, 'slight-right', 'ArrowSlightRight'],
      [45, 'left', 'ArrowLeftTurn'],
      [149, 'left', 'ArrowLeftTurn'],
      [315, 'right', 'ArrowRightTurn'],
      [211, 'right', 'ArrowRightTurn'],
      [150, 'u-turn', 'ArrowUTurn'],
      [210, 'u-turn', 'ArrowUTurn'],
    ])('%i° off the route says %s', (angle, direction, icon) => {
      viewer.heading = angle;
      compass.setTurnMessage();
      expect(message.querySelector('.compass-message-large').textContent).toBe(`center-ui.compass.${direction}`);
      expect(message.querySelector('img').getAttribute('src')).toBe(`/assets/images/explore/icons/${icon}.png`);
      expect(message.querySelector('.compass-message-small').textContent).toBe('center-ui.compass.unlabeled-problems');
    });

    test('measures from the route\'s own heading, with the view\'s heading brought into one turn', () => {
      task.headingAlongRoute.mockReturnValue(90);
      viewer.heading = -180; // 180: a left turn brings the view round to 90.
      compass.setTurnMessage();
      expect(message.textContent).toContain('center-ui.compass.left');
      expect(task.headingAlongRoute).toHaveBeenCalledWith({ lat: 47.6, lng: -122.3 });

      viewer.heading = 450; // 90: facing the route.
      compass.setTurnMessage();
      expect(message.textContent).toContain('center-ui.compass.straight');
    });

    test('follows the view and the street, and re-aims once a move\'s heading settles', () => {
      listeners.povChanged();
      expect(message.textContent).toContain('center-ui.compass.straight');

      task.headingAlongRoute.mockReturnValue(180);
      compass.hideMessage();
      listeners.taskChanged();
      expect(holder.hidden).toBe(false);
      expect(message.textContent).toContain('center-ui.compass.u-turn');

      task.headingAlongRoute.mockReturnValue(270);
      listeners.headingSettled();
      expect(message.textContent).toContain('center-ui.compass.left');
    });

    test('mid-move the message holds, since the street\'s progress lags the new position (#5918)', () => {
      listeners.povChanged();
      nav.moving = true;
      task.headingAlongRoute.mockReturnValue(180);
      listeners.povChanged();
      expect(message.textContent).toContain('center-ui.compass.straight');

      nav.moving = false;
      listeners.headingSettled();
      expect(message.textContent).toContain('center-ui.compass.u-turn');
    });
  });

  describe('off the route', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      task.isNearRoute.mockReturnValue(false);
    });

    test('the message says to come back and blinks until the labeler is back on it', () => {
      compass.update();
      expect(message.innerHTML).toBe('center-ui.compass.far-away');
      expect(compass.isEnRoute()).toBe(false);

      vi.advanceTimersByTime(500);
      expect(holder.classList.contains('highlight-100')).toBe(true);
      vi.advanceTimersByTime(500);
      expect(holder.classList.contains('highlight-100')).toBe(false);

      task.isNearRoute.mockReturnValue(true);
      compass.update();
      vi.advanceTimersByTime(1000);
      expect(holder.classList.contains('highlight-100')).toBe(false);
      expect(message.textContent).toContain('center-ui.compass.straight');
    });

    test('mid-move the warning waits, since the position is not final yet', () => {
      nav.moving = true;
      compass.update();
      expect(message.innerHTML).toBe('');
      vi.advanceTimersByTime(1000);
      expect(holder.classList.contains('highlight-100')).toBe(false);
    });

    test('with no street yet the labeler counts as on route', () => {
      task = null;
      expect(compass.isEnRoute()).toBe(true);
    });
  });

  describe('when there is nothing to steer toward', () => {
    test('free exploration shows no guidance', () => {
      config.isExploreAddressMode = true;
      compass.update();
      expect(message.innerHTML).toBe('');
    });

    test('the tutorial and the jump prompt keep their own message', () => {
      config.isOnboarding = true;
      compass.update();
      expect(message.innerHTML).toBe('');

      config.isOnboarding = false;
      streetProgress.armed = true;
      compass.update();
      expect(message.innerHTML).toBe('');
    });
  });

  describe('a click on the message', () => {
    const click = async () => {
      holder.click();
      await flush();
    };

    test('facing the route steps forward, and logs whether the step landed', async () => {
      await click();

      expect(stuckAlert.compassOrStuckClicked).toHaveBeenCalledTimes(1);
      expect(navigationService.moveForward).toHaveBeenCalledTimes(1);
      expect(tracked('Click_Compass_Direction=straight')).toHaveLength(1);
      expect(tracked('CompassMove_Success')).toHaveLength(1);

      navigationService.moveForward.mockRejectedValueOnce(new Error('no pano there'));
      await click();
      expect(tracked('CompassMove_PanoNotAvailable')).toHaveLength(1);
    });

    test('a refused step is not logged as one that happened', async () => {
      nav.canWalk = false;
      await click();
      expect(navigationService.moveForward).not.toHaveBeenCalled();
      expect(tracked('CompassMove_Success')).toEqual([]);
    });

    test('facing away turns the view toward the route over a short transition', async () => {
      viewer.heading = 90;
      await click();
      expect(navigationService.moveForward).not.toHaveBeenCalled();
      expect(tracked('Click_Compass_Direction=left')).toHaveLength(1);
      expect(panoManager.turnTo.mock.calls).toEqual([[0, 250]]);
    });

    test('off the route steps forward and then faces the route at once', async () => {
      task.isNearRoute.mockReturnValue(false);
      await click();
      expect(tracked('Click_Compass_FarFromRoute')).toHaveLength(1);
      expect(stuckAlert.compassOrStuckClicked).not.toHaveBeenCalled();
      expect(navigationService.moveForward).toHaveBeenCalledTimes(1);
      expect(panoManager.turnTo.mock.calls).toEqual([[0, undefined]]);
    });

    test('does nothing while a move is in flight', async () => {
      listeners.moveStarted();
      await click();
      expect(navigationService.moveForward).not.toHaveBeenCalled();

      listeners.moveFinished();
      await click();
      expect(navigationService.moveForward).toHaveBeenCalledTimes(1);
    });
  });

  describe('the label-before-jump prompt', () => {
    beforeEach(() => vi.useFakeTimers());

    test('names what the jump finishes: the street, the route, or the region', () => {
      listeners.jumpPrompt(true);
      expect(message.innerHTML).toBe('<div>center-ui.compass.end-street</div>');

      regionModel.isRegionComplete = true;
      listeners.jumpPrompt(true);
      expect(message.innerHTML).toBe('<div>center-ui.compass.end-region</div>');

      regionModel.isRouteComplete = true;
      listeners.jumpPrompt(true);
      expect(message.innerHTML).toBe('<div>center-ui.compass.end-route</div>');
    });

    test('a click jumps to the next street, and no longer does once the prompt is gone', async () => {
      listeners.jumpPrompt(true);
      holder.click();
      await Promise.resolve();
      expect(tracked('LabelBeforeJump_Jump')).toHaveLength(1);
      expect(streetProgress.jumpToANewTask).toHaveBeenCalledTimes(1);
      expect(navigationService.moveForward).not.toHaveBeenCalled();

      listeners.jumpPrompt(false);
      holder.click();
      await Promise.resolve();
      expect(streetProgress.jumpToANewTask).toHaveBeenCalledTimes(1);
      expect(navigationService.moveForward).toHaveBeenCalledTimes(1);
    });

    test('at the end of the route or region a click finishes instead of jumping', () => {
      regionModel.isRouteOrRegionComplete = () => true;
      const finish = vi.fn();
      compass.onFinishClick(finish);
      listeners.jumpPrompt(true);

      holder.click();
      expect(finish).toHaveBeenCalledTimes(1);
      expect(streetProgress.jumpToANewTask).not.toHaveBeenCalled();
    });

    test('blinks after fifteen seconds of waiting, and not if the prompt went away first', () => {
      listeners.jumpPrompt(true);
      vi.advanceTimersByTime(15000);
      expect(tracked('LabelBeforeJump_Blink')).toHaveLength(1);
      vi.advanceTimersByTime(500);
      expect(holder.classList.contains('highlight-100')).toBe(true);

      listeners.jumpPrompt(false);
      expect(holder.classList.contains('highlight-100')).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(holder.classList.contains('highlight-100')).toBe(false);

      listeners.jumpPrompt(true);
      listeners.jumpPrompt(false);
      vi.advanceTimersByTime(16000);
      expect(tracked('LabelBeforeJump_Blink')).toHaveLength(1);
    });
  });

  test('the icon for a direction is public, for the tutorial\'s own message', () => {
    expect(compass.directionToImagePath('straight')).toBe('/assets/images/explore/icons/ArrowStraight.png');
    expect(compass.getTargetAngle()).toBe(0);
    expect(compass.getCompassMessageHolder()).toEqual({ messageHolder: holder, message });
  });
});
