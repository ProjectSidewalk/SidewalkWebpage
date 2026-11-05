/**
 * The hands-on tutorial off its usual path (frontend/js/explore/onboarding/Onboarding.js, #5840): a page missing
 * parts it draws on, a script naming a step that doesn't exist, and step shapes the real script never has (a camera
 * step with annotations, a placement step without any, a message with no step behind it). Those run on small scripts
 * of their own, since the real script is fixed and is covered by onboardingWalkthrough.test.js.
 */

import {
  currentStep, deleteLabel, flush, placeLabel, playUntil, pressOk, rate, selectMode, setupOnboarding, turnTo,
  world, zoom,
} from './support/onboardingHarness.js';

const messageHolder = () => document.getElementById('onboarding-message-holder');

/** An arrow and a box a step can point at the pano with; neither blinks, so nothing is left animating. */
const ARROW = { type: 'arrow', x: 7000, y: -500, length: 50, angle: 0, fill: 'white' };
const BOX = { type: 'box', x: 7000, y: -500, width: 40, height: 40 };

/**
 * @param {string} next - The step after the opening one.
 * @param {object} [extra] - More for the opening step, such as annotations.
 * @returns {object} The opening step every script needs: it sets the camera and moves on.
 */
const opening = (next, extra = {}) => ({
  id: 'initialize',
  properties: { action: 'Introduction', heading: 230, pitch: -6, zoom: 1 },
  transition: next,
  ...extra,
});

const END = { id: 'end', 'end-onboarding': true };

/** An instruction step looks up the outro by name to know whether it is the last screen, so a script needs one. */
const OUTRO = { id: 'outro', properties: { action: 'Instruction' }, message: { message: 'bye' } };

/** @param {string} text - What the box says. @returns {object} A step's message. */
const says = (text) => ({ message: text });

describe('a page missing what the tutorial draws on', () => {
  it('runs without the onboarding canvas, the retake button, or a sidebar to size the minimap against', async () => {
    const { onboarding, c } = setupOnboarding({ start: false, reducedMotion: true });
    document.getElementById('navbar-retake-tutorial-btn').remove();
    document.getElementById('explore-sidebar').remove();
    c.ui.onboarding.canvas = null;

    onboarding.start();
    await playUntil(c, 'speed-things-up');
    turnTo(100);
    onboarding.resize();

    expect(world.draws).toEqual([]);
    expect(world.icons).toEqual([]);
    expect(world.markers).toHaveLength(4);
    expect(c.ui.minimap.holder.style.transform).toBe('');
  });

  it('skips the minimap refit in a browser without ResizeObserver', () => {
    const { onboarding } = setupOnboarding({ start: false });
    vi.stubGlobal('ResizeObserver', undefined);

    onboarding.start();

    expect(world.resizeObservers).toEqual([]);
  });

  it('shows the last screen plain when its template has no clip', async () => {
    const { c } = setupOnboarding();
    document.getElementById('onboarding-outro').content.querySelector('video').remove();

    await playUntil(c, 'outro');

    expect(messageHolder().querySelector('.motion-toggle')).not.toBeNull();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('keeps a callout where it was once its label can no longer be placed', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'label-attribute-1');
    turnTo(231);
    placeLabel(c, { accurate: false });
    expect(currentStep(c)).toBe('delete-attribute-1');
    const options = world.floating.options;

    world.label.deleted = true;
    world.floating.update();
    await Promise.resolve();

    expect(world.floating.options).not.toBe(options);
    expect(world.floating.options.placement).toBe('top');
    expect(messageHolder().style.left).toBe('12px');
  });
});

describe('a script that names a step it does not have', () => {
  it('fails at once rather than when a labeler gets there', () => {
    const { onboarding } = setupOnboarding({ start: false, states: [opening('nowhere')] });
    expect(() => onboarding.start()).toThrow('Onboarding has no state with id "nowhere".');
  });
});

describe('steps shaped unlike the real script\'s', () => {
  it('takes down the pano listener a camera or control step added with annotations once it is done', async () => {
    const { c } = setupOnboarding({ states: [
      opening('walk', { annotations: [ARROW] }),
      { id: 'walk', properties: { action: 'WalkTowards' }, message: says('walk'), annotations: [ARROW],
        transition: 'rate' },
      { id: 'rate', properties: { action: 'RateSeverity', labelNumber: 1 }, message: says('rate'),
        annotations: [ARROW], transition: 'zoom' },
      { id: 'zoom', properties: { action: 'Zoom', type: 'in' }, message: says('zoom'), annotations: [BOX],
        transition: 'end' },
      END,
    ] });
    expect(currentStep(c)).toBe('walk');
    expect(world.povListeners.size).toBe(1);

    document.getElementById('nav-arrows').click();
    await flush();
    expect(currentStep(c)).toBe('rate');
    expect(world.povListeners.size).toBe(1);

    rate(2);
    expect(currentStep(c)).toBe('zoom');
    zoom(c, 'in');
    expect(currentStep(c)).toBe('end');
    expect(world.povListeners.size).toBe(0);
  });

  it('adds no pano listener for a labeling step that has nothing to draw', async () => {
    const { c } = setupOnboarding({ states: [
      opening('pick'),
      { id: 'pick', properties: { action: 'SelectLabelType', labelType: 'CurbRamp' }, message: says('pick'),
        transition: 'place' },
      { id: 'place', message: says('place'), transition: [() => 'remove'],
        properties: [{ action: 'LabelAccessibilityAttribute', labelType: 'CurbRamp', imageX: 7000, imageY: -500,
          tolerance: 300, labelNumber: 1 }] },
      { id: 'remove', properties: { action: 'DeleteAccessibilityAttribute', labelType: 'CurbRamp' },
        message: says('remove'), transition: 'end' },
      END,
    ] });

    selectMode(c, 'CurbRamp');
    expect(currentStep(c)).toBe('place');
    expect(messageHolder().classList).not.toContain('onboarding-message-pano-anchored');
    placeLabel(c);
    expect(currentStep(c)).toBe('remove');
    deleteLabel(c);
    expect(currentStep(c)).toBe('end');
    expect(world.povListeners.size).toBe(0);
  });

  it('leaves a placement step\'s message in the corner when its annotations hold no arrow', () => {
    setupOnboarding({ states: [
      opening('place'),
      { id: 'place', message: says('place'), annotations: [BOX], transition: [() => 'end'],
        properties: [{ action: 'LabelAccessibilityAttribute', labelType: 'CurbRamp', imageX: 7000, imageY: -500,
          tolerance: 300, labelNumber: 1 }] },
      END,
    ] });

    expect(messageHolder().classList).not.toContain('onboarding-message-pano-anchored');
    expect(messageHolder().style.left).toBe('');
  });

  it('just shows the message of a step with no action, known or otherwise, after fixing the camera', () => {
    const { c } = setupOnboarding({ states: [
      opening('words'),
      { id: 'words', message: says('just words'), transition: 'odd' },
      { id: 'odd', properties: { action: 'Dance', minHeading: 1, maxHeading: 2 }, message: says('odd') },
      { id: 'oddArray', properties: [{ action: 'Dance', minHeading: 3, maxHeading: 4 }], message: says('odder') },
    ] });

    expect(currentStep(c)).toBe('words');
    expect(messageHolder().textContent).toBe('just words');
    expect(c.panoManager.setHeadingRange).toHaveBeenCalledTimes(1);

    setupOnboarding({ states: [opening('odd'),
      { id: 'odd', properties: { action: 'Dance', minHeading: 1, maxHeading: 2 }, message: says('odd') }] });
    expect(messageHolder().textContent).toBe('odd');
    setupOnboarding({ states: [opening('oddArray'),
      { id: 'oddArray', properties: [{ action: 'Dance', minHeading: 3, maxHeading: 4 }], message: says('odder') }] });
    expect(messageHolder().textContent).toBe('odder');
    expect(world.povListeners.size).toBe(0);
  });

  it('dims the page behind a takeover message that is not a full page', () => {
    const { c } = setupOnboarding({ states: [
      opening('dim'),
      { id: 'dim', properties: { action: 'Instruction' }, message: { message: 'dim', background: true },
        transition: 'end' },
      OUTRO, END,
    ] });

    expect(document.getElementById('onboarding-background').style.visibility).toBe('visible');
    expect(messageHolder().classList).toContain('onboarding-message-takeover');
    expect(messageHolder().classList).not.toContain('onboarding-message-fullpage');
    pressOk();
    expect(currentStep(c)).toBe('end');
  });

  it('puts a callout with no placement of its own to the right of its anchor', () => {
    setupOnboarding({ states: [
      opening('look'),
      {
        id: 'look',
        properties: { action: 'Instruction' },
        message: { message: 'look', anchor: '#explore-control-stuck' },
        transition: 'end',
      },
      OUTRO, END,
    ] });

    expect(messageHolder().classList).toContain('callout-floating');
    expect(world.floating.options.placement).toBe('right');
  });
});
