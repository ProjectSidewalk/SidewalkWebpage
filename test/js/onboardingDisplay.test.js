/**
 * What the hands-on tutorial draws and where it puts its messages (frontend/js/explore/onboarding/Onboarding.js,
 * #5840): the arrows and example labels on its canvas, the message box's placement modes, and the celebration clip
 * on the last screen. The walk through the steps themselves is in onboardingWalkthrough.test.js.
 */

import {
  currentStep, deleteLabel, doStep, placeLabel, pressOk, selectMode, setupOnboarding, turnTo, world,
} from './support/onboardingHarness.js';

/** Plays correct steps until the tutorial reaches `stopAt`. */
async function playUntil(c, stopAt) {
  for (let guard = 0; guard < 200 && currentStep(c) !== stopAt; guard++) await doStep(c);
  if (currentStep(c) !== stopAt) throw new Error(`never reached ${stopAt}`);
}

/** Gives an element a fixed on-screen box. */
function placeAt(el, { left = 0, top = 0, width = 0, height = 0 }) {
  el.getBoundingClientRect = () => new DOMRect(left, top, width, height);
}

const messageHolder = () => document.getElementById('onboarding-message-holder');

describe('the arrows on the tutorial canvas', () => {
  it('blinks a colored arrow between its color and white, a frame at a time', () => {
    setupOnboarding();
    // introduce-curb-ramp points a yellow arrow at the first curb ramp.
    const fills = () => world.draws.filter(([op, key]) => op === '=' && key === 'fillStyle').map(([, , v]) => v);
    expect(fills()).toEqual(['yellow']);

    // Half a second (30 frames) in each color.
    for (let i = 0; i < 40; i++) world.frame();
    expect(fills().at(-1)).toBe('white');
    for (let i = 0; i < 20; i++) world.frame();
    expect(fills().at(-1)).toBe('yellow');
  });

  it('stops blinking when the step is done, and redraws when the camera turns', () => {
    const { c } = setupOnboarding();
    turnTo(231);
    expect(world.frames.size).toBe(1);

    pressOk();
    expect(currentStep(c)).toBe('select-label-type-1');
    // The next step's arrow is white, so nothing is left animating.
    expect(world.frames.size).toBe(0);

    const before = world.draws.length;
    turnTo(232);
    expect(world.draws.slice(before).some(([op]) => op === 'stroke')).toBe(true);
  });

  it('skips an arrow or box whose target is behind the camera', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'label-attribute-5');
    const strokes = () => world.draws.filter(([op]) => op === 'stroke' || op === 'strokeRect').length;

    turnTo(103);
    const facing = strokes();
    expect(world.draws.some(([op]) => op === 'strokeRect')).toBe(true);
    turnTo(283);
    expect(strokes()).toBe(facing);
  });
});

describe('the example labels', () => {
  it('pops them in one after another, each with its minimap marker, then stops animating', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'speed-things-up');
    turnTo(100);
    expect(world.markers).toHaveLength(0);

    world.frame();
    expect(world.markers.map((m) => m.labelType)).toEqual(['CurbRamp']);
    for (let i = 0; i < 100; i++) world.frame();

    expect(world.markers.map((m) => m.labelType)).toEqual(['CurbRamp', 'CurbRamp', 'Crosswalk', 'Signal']);
    expect(world.markers[0].latLng).toEqual({ lat: 38.94039365744705, lng: -77.06749504111177 });
    expect(world.frames.size).toBe(0);
    // An icon fades in rather than appearing at full strength.
    const alphas = world.draws.filter(([op, key]) => op === '=' && key === 'globalAlpha').map(([, , v]) => v);
    expect(alphas.some((a) => a > 0 && a < 1)).toBe(true);
    expect(alphas.at(-1)).toBe(1);
  });

  it('shows them at rest at once for a visitor who asked for reduced motion', async () => {
    const { c } = setupOnboarding({ reducedMotion: true });
    await playUntil(c, 'speed-things-up');

    expect(world.markers).toHaveLength(4);
    expect(world.frames.size).toBe(0);
  });

  it('keeps them on the canvas through the next steps without adding markers again, and drops them later', async () => {
    const { c } = setupOnboarding({ reducedMotion: true });
    await playUntil(c, 'speed-things-up');
    turnTo(100);
    const icons = world.icons.length;

    pressOk();
    selectMode(c, 'NoSidewalk');
    expect(currentStep(c)).toBe('label-attribute-7');
    turnTo(101);
    expect(world.icons.length).toBeGreaterThan(icons);
    expect(world.markers).toHaveLength(4);

    await playUntil(c, 'select-label-type-8');
    const atDrop = world.icons.length;
    turnTo(c.panoManager.getPov().heading);
    expect(world.icons.length).toBe(atDrop);
  });
});

describe('redrawing after a resize', () => {
  it('re-sizes the canvas and redraws the current step\'s annotations', () => {
    const { onboarding } = setupOnboarding();
    const before = world.draws.length;

    onboarding.resize();

    const redraw = world.draws.slice(before).map(([op]) => op);
    expect(redraw).toContain('setTransform');
    expect(redraw).toContain('stroke');
  });

  it('draws nothing on a step that has no annotations', async () => {
    const { onboarding, c } = setupOnboarding();
    await playUntil(c, 'rate-severity-1');
    const before = world.draws.length;

    onboarding.resize();

    expect(world.draws.slice(before).map(([op]) => op)).toEqual(['setTransform', '=']);
  });

  it('leaves the canvas blank once the tutorial has ended', async () => {
    const { onboarding, c } = setupOnboarding();
    await playUntil(c, 'outro');
    pressOk();
    const before = world.draws.length;

    onboarding.resize();

    expect(world.draws.slice(before).some(([op]) => op === 'stroke' || op === 'clearRect')).toBe(false);
  });

  it('does nothing before the tutorial has started', () => {
    const { onboarding } = setupOnboarding({ start: false });
    onboarding.resize();
    expect(world.draws).toEqual([]);
  });
});

describe('the tutorial minimap', () => {
  it('fills the column\'s width and fits its height to the sidebar, refitting when the sidebar resizes', () => {
    document.documentElement.style.setProperty('--ui-scale', '1');
    const { onboarding, c } = setupOnboarding({ start: false });
    const holder = c.ui.minimap.holder;
    holder.style.setProperty('--minimap-base-size', '200px');
    placeAt(holder.parentElement, { width: 300 });
    placeAt(holder, { top: 100, width: 200, height: 200 });
    placeAt(document.getElementById('explore-sidebar'), { top: 0, height: 302 });

    onboarding.start();
    expect(holder.classList).toContain('minimap-tutorial');
    expect(holder.style.backgroundImage).toContain('TutorialMiniMap.jpg');
    expect(holder.style.transform).toBe('scale(1.5, 1)');

    placeAt(document.getElementById('explore-sidebar'), { top: 0, height: 202 });
    world.resizeObservers[0].cb();
    expect(world.resizeObservers[0].target).toBe(holder.parentElement);
    expect(holder.style.transform).toBe('scale(1.5, 0.5)');
  });

  it('leaves the scale alone while the sidebar has no room to measure', () => {
    const { c } = setupOnboarding();
    expect(c.ui.minimap.holder.style.transform).toBe('');
  });
});

describe('the message box', () => {
  it('flashes once when a new message appears', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setupOnboarding();
    expect(messageHolder().classList).toContain('onboarding-message-flash');
    vi.advanceTimersByTime(100);
    expect(messageHolder().classList).not.toContain('onboarding-message-flash');
  });

  it('sets a step\'s width in on-screen pixels', async () => {
    const { c } = setupOnboarding();
    const layer = document.createElement('div');
    layer.id = 'label-drawing-layer';
    placeAt(layer, { width: 1440 });
    document.body.appendChild(layer);

    await playUntil(c, 'adjust-heading-angle-3');
    expect(messageHolder().style.width).toBe('380px');
    await doStep(c);
    expect(messageHolder().style.width).toBe('');
  });

  it('pins a placement step\'s message above the arrow it narrates', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'select-label-type-1');
    turnTo(231);
    selectMode(c, 'CurbRamp');

    expect(currentStep(c)).toBe('label-attribute-1');
    expect(messageHolder().classList).toContain('onboarding-message-pano-anchored');
    expect(messageHolder().style.left).toMatch(/px$/);
    expect(messageHolder().style.top).toMatch(/px$/);
  });

  it('keeps the default corner when the arrow it would sit above is off-screen', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'select-label-type-1');
    turnTo(50);
    selectMode(c, 'CurbRamp');

    expect(messageHolder().classList).not.toContain('onboarding-message-pano-anchored');
  });

  it('dims the page behind the last screen and fills the page with it', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'outro');

    expect(document.getElementById('onboarding-background').style.visibility).toBe('visible');
    expect(messageHolder().classList).toContain('onboarding-message-takeover');
    expect(messageHolder().classList).toContain('onboarding-message-fullpage');
    expect(messageHolder().querySelectorAll('#onboarding-ok-button')).toHaveLength(1);
  });

  it('labels the Ok button with a step\'s own text', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'walk-5');
    expect(document.getElementById('onboarding-ok-button').textContent).toBe('tutorial.walk-5-2');
  });
});

describe('the callout pointing at a control', () => {
  it('points at a ribbon button from below, kept inside the page', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'select-label-type-1');

    expect(messageHolder().classList).toContain('callout-floating');
    expect(world.floating.options.placement).toBe('bottom');
    const flip = world.floating.options.middleware.find((m) => m.name === 'flip');
    expect(flip.options.boundary).toBeUndefined();
    await Promise.resolve();
    expect(messageHolder().style.left).toBe('12px');
    expect(messageHolder().style.top).toBe('34px');
    expect(messageHolder().querySelector('.fui-arrow').style.top).toMatch(/px$/);
  });

  it('keeps a callout on a menu inside the pane within the pane, and shrinks it to the room it has', async () => {
    const { c } = setupOnboarding();
    world.contextMenuOpen = true;
    await playUntil(c, 'rate-severity-1');

    expect(world.floating.options.placement).toBe('left');
    const size = world.floating.options.middleware.find((m) => m.name === 'size');
    expect(size.options.boundary).toBe(document.getElementById('street-view-holder'));
    size.options.apply({ availableWidth: 250, elements: { floating: messageHolder() } });
    expect(messageHolder().style.maxWidth).toBe('250px');
    size.options.apply({ availableWidth: -5, elements: { floating: messageHolder() } });
    expect(messageHolder().style.maxWidth).toBe('0px');
  });

  it('points the arrow along the side the callout ended up on', async () => {
    const { c } = setupOnboarding();
    world.contextMenuOpen = true;
    world.floatingPlacement = 'top-start';
    placeAt(document.getElementById('severity-menu'), { left: 100, top: 200, width: 80, height: 40 });
    placeAt(messageHolder(), { left: 50, top: 100, width: 300, height: 80 });
    await playUntil(c, 'rate-severity-1');
    await Promise.resolve();

    const arrow = messageHolder().querySelector('.fui-arrow');
    expect(arrow.style.left).toMatch(/px$/);
    expect(arrow.style.bottom).toMatch(/px$/);
    expect(arrow.style.top).toBe('');
  });

  it('follows the label while the menu it points into is closed', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'rate-severity-1');
    expect(world.floating.options.placement).toBe('top');

    // Once the menu is open, the callout points at the menu itself.
    world.contextMenuOpen = true;
    world.floating.update();
    const rect = world.floating.reference.getBoundingClientRect();
    expect(rect).toEqual(document.getElementById('severity-menu').getBoundingClientRect());
  });

  it('tears down the previous callout\'s tracking when the next message shows', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'select-label-type-1');
    const { cleanup } = world.floating;
    selectMode(c, 'CurbRamp');
    expect(cleanup).toHaveBeenCalled();
  });
});

describe('the callout pointing at a misplaced label', () => {
  /** Plays to the first delete step with the label placed off target. */
  async function toDeleteStep() {
    const { c } = setupOnboarding();
    await playUntil(c, 'label-attribute-1');
    turnTo(231);
    const pane = document.getElementById('street-view-holder');
    placeAt(pane, { left: 0, top: 0, width: 720, height: 480 });
    placeLabel(c, { accurate: false });
    expect(currentStep(c)).toBe('delete-attribute-1');
    return c;
  }

  it('lets the hover and click through to the label underneath', async () => {
    await toDeleteStep();
    expect(messageHolder().classList).toContain('onboarding-message-pass-through');
    expect(world.floating.options.placement).toBe('top');
  });

  it('covers the label\'s hover card too while it shows', async () => {
    await toDeleteStep();
    const iconOnly = world.floating.reference.getBoundingClientRect();

    world.label.hoverInfo = 'visible';
    const card = document.getElementById('hover-card');
    card.style.visibility = 'visible';
    placeAt(card, { left: iconOnly.left - 50, top: iconOnly.bottom, width: 200, height: 120 });
    const withCard = world.floating.reference.getBoundingClientRect();

    expect(withCard.left).toBe(iconOnly.left - 50);
    expect(withCard.top).toBe(iconOnly.top);
    expect(withCard.bottom).toBe(iconOnly.bottom + 120);
  });

  it('keeps its last spot once the label is gone', async () => {
    await toDeleteStep();
    const before = world.floating.reference.getBoundingClientRect();
    world.label.deleted = true;
    expect(world.floating.reference.getBoundingClientRect()).toEqual(before);
  });

  it('waits for the labeler to delete the label before going on', async () => {
    const c = await toDeleteStep();
    deleteLabel(c);
    expect(currentStep(c)).toBe('redo-select-label-type-1');
  });
});

describe('picking a label type', () => {
  it('turns the label mode off again if the labeler starts placing and backs out', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'select-label-type-1');
    selectMode(c, 'CurbRamp');
    expect(c.labelModes.enableMode).toHaveBeenCalledWith('Walk');

    c.ui.canvas.drawingLayer.dispatchEvent(new MouseEvent('mousedown'));
    expect(c.labelModes.disableMode).toHaveBeenCalledWith('CurbRamp');
  });
});

describe('the celebration clip on the last screen', () => {
  const hero = () => messageHolder().querySelector('.tutorial-complete__hero');
  const toggle = () => messageHolder().querySelector('.motion-toggle');

  it('plays muted, with no still over it', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'outro');

    expect(hero().muted).toBe(true);
    expect(hero().play).toHaveBeenCalled();
    expect(hero().hasAttribute('poster')).toBe(false);
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('pauses on its still and plays again from the toggle, logging each', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'outro');

    toggle().click();
    expect(hero().pause).toHaveBeenCalled();
    expect(hero().getAttribute('poster')).toBe('still.jpg');
    expect(toggle().classList).toContain('is-paused');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(c.tracker.push).toHaveBeenCalledWith('Onboarding_PauseAnimation');

    toggle().click();
    expect(hero().hasAttribute('poster')).toBe(false);
    expect(c.tracker.push).toHaveBeenCalledWith('Onboarding_PlayAnimation');
  });

  it('starts paused on its still for a visitor who asked for reduced motion', async () => {
    const { c } = setupOnboarding({ reducedMotion: true });
    await playUntil(c, 'outro');

    expect(hero().play).not.toHaveBeenCalled();
    expect(hero().getAttribute('poster')).toBe('still.jpg');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the still when the browser refuses to play it', async () => {
    const { c } = setupOnboarding();
    world.play = Promise.reject(new Error('NotAllowedError'));
    await playUntil(c, 'outro');
    await Promise.resolve();

    expect(hero().getAttribute('poster')).toBe('still.jpg');
  });
});
