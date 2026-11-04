/**
 * Explore's armed label type (frontend/js/explore/menu/LabelModes.js, #5840): which switches go through, what the
 * `switching` gate lets past while held (the tutorial's one-type-at-a-time exceptions), and who is told of a change.
 */

import { loadModules } from './loader.js';
import { fakeTracker } from './fakes.js';

describe('LabelModes', () => {
  let modes;
  let tracker;

  beforeEach(async () => {
    const { LabelModes } = await loadModules('frontend/js/explore/menu/LabelModes.js');
    tracker = fakeTracker();
    modes = new LabelModes(tracker);
  });

  test('starts in Walk mode with no label type armed', () => {
    expect(modes.getMode()).toBe('Walk');
    expect(modes.getSelectedLabelType()).toBeUndefined();
  });

  test('arming a type tells each listener, and backToWalk disarms it', () => {
    const heard = [];
    modes.onModeChanged((mode) => heard.push(mode));

    modes.switchTo('CurbRamp');
    expect(modes.getSelectedLabelType()).toBe('CurbRamp');
    modes.backToWalk();

    expect(heard).toEqual(['CurbRamp', 'Walk']);
    expect(tracker.push).toHaveBeenCalledWith('ModeSwitch_CurbRamp');
    expect(tracker.push).toHaveBeenCalledWith('ModeSwitch_Walk');
  });

  test('an unsubscribed listener hears no further switches', () => {
    const listener = vi.fn();
    const unsubscribe = modes.onModeChanged(listener);
    modes.switchTo('Obstacle');
    unsubscribe();

    modes.switchTo('Walk');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('a refused switch is still logged, since the attempt says what the labeler wanted', () => {
    const listener = vi.fn();
    modes.onModeChanged(listener);
    modes.switching.hold('popup');

    modes.switchTo('CurbRamp');

    expect(modes.getMode()).toBe('Walk');
    expect(listener).not.toHaveBeenCalled();
    expect(tracker.push).toHaveBeenCalledWith('ModeSwitch_CurbRamp');
  });

  describe('while switching is held', () => {
    let availabilityChanged;

    beforeEach(() => {
      availabilityChanged = vi.fn();
      modes.onAvailabilityChanged(availabilityChanged);
      modes.switching.hold('tutorial');
    });

    test('only an enabled type gets through', () => {
      modes.enableMode('NoCurbRamp');

      expect(modes.isUsable('NoCurbRamp')).toBe(true);
      expect(modes.isUsable('CurbRamp')).toBe(false);
      modes.switchTo('NoCurbRamp');
      expect(modes.getMode()).toBe('NoCurbRamp');
    });

    test('enabling Other opens the ribbon button, and its menu entry only when named', () => {
      modes.enableMode('Other');
      expect(modes.isUsable('OuterOther')).toBe(true);
      expect(modes.isUsable('Other')).toBe(false);

      modes.enableMode('Other', 'Occlusion');
      expect(modes.isUsable('Occlusion')).toBe(true);
    });

    test('disabling takes the type and its menu entry back out', () => {
      modes.enableMode('Other', 'Occlusion');
      modes.disableMode('Other', 'Occlusion');

      expect(modes.isUsable('OuterOther')).toBe(false);
      expect(modes.isUsable('Occlusion')).toBe(false);
    });

    test('disabling without a menu entry leaves one that was enabled alone', () => {
      modes.enableMode('Other', 'Occlusion');
      modes.disableMode('Other');

      expect(modes.isUsable('Occlusion')).toBe(true);
    });

    test('every change to what is usable is announced, the hold and release included', () => {
      // The hold in beforeEach is the first announcement.
      modes.enableMode('CurbRamp');
      modes.disableMode('CurbRamp');
      modes.switching.release('tutorial');

      expect(availabilityChanged).toHaveBeenCalledTimes(4);
    });

    test('releasing the hold forgets the exceptions, so a later hold starts with none', () => {
      modes.enableMode('CurbRamp');
      modes.switching.release('tutorial');
      expect(modes.isUsable('Obstacle')).toBe(true);

      modes.switching.hold('popup');

      expect(modes.isUsable('CurbRamp')).toBe(false);
    });
  });
});
