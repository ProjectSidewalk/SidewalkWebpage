/**
 * Plays the hands-on tutorial end to end (frontend/js/explore/onboarding/Onboarding.js and its script,
 * OnboardingStates.js, #5840): a labeler who gets every step right, one who gets steps wrong and is sent back, and
 * what the tutorial locks and unlocks along the way. The script is the real one, so a renamed state, a changed right
 * answer, or a step whose listener never fires shows up here as a walk that stalls.
 */

import {
  currentState, currentStep, deleteLabel, doStep, flush, navigations, placeLabel, pressOk, rate, selectMode, SEVERITY,
  setupOnboarding, tag, TAGS, turnTo, world,
} from './support/onboardingHarness.js';

/** Plays correct steps until the tutorial reaches `stopAt`, or ends. Returns the ids visited along the way. */
async function playUntil(c, stopAt = null) {
  const visited = [];
  for (let guard = 0; guard < 200; guard++) {
    const step = currentStep(c);
    if (step === stopAt || step === 'end-onboarding') return visited;
    visited.push(await doStep(c));
  }
  throw new Error(`the tutorial stalled at ${currentStep(c)}`);
}

describe('the tutorial, played through', () => {
  it('locks the tool down and opens on the first step', () => {
    const { c } = setupOnboarding();

    expect(c.tracker.push).toHaveBeenCalledWith('Onboarding_Start');
    for (const gate of [c.navArrows.showing, c.labelContainer.deleting, c.navigationService.walking,
      c.zoomControl.zoomInGate, c.zoomControl.zoomOutGate, c.labelModes.switching, c.compass.click]) {
      expect(gate.hold).toHaveBeenCalledWith('tutorial');
    }
    expect(c.panoOverlayControls.disableButtons).toHaveBeenCalled();
    expect(c.contextMenu.disableRatingSeverity).toHaveBeenCalled();
    expect(c.contextMenu.disableTagging).toHaveBeenCalled();
    expect(document.getElementById('navbar-retake-tutorial-btn').style.display).toBe('none');
    expect(c.minimap.setBasemapVisible).toHaveBeenCalledWith(false);

    // The opening POV is set without crediting it as looking around, then the first instruction shows.
    expect(c.panoManager.setPov).toHaveBeenCalledWith({ heading: 230, pitch: -6, zoom: 1 });
    expect(c.observedArea.resetCurrentPano).toHaveBeenCalled();
    expect(currentStep(c)).toBe('introduce-curb-ramp');
    expect(document.getElementById('onboarding-message-holder').textContent).toContain('tutorial.introduce-curb-ramp');
  });

  it('reaches the end for a labeler who gets every step right, then submits and reloads into Explore', async () => {
    const { c } = setupOnboarding();

    const visited = await playUntil(c);

    // Every step that counts toward progress was visited, and none of the do-over steps.
    const progressSteps = c.states.get().filter((s) => s.progression).map((s) => s.id);
    expect(['initialize', ...visited]).toEqual(progressSteps);
    expect(currentStep(c)).toBe('end-onboarding');
    expect(c.mission.setProperty).toHaveBeenCalledWith('isComplete', true);
    expect(c.mission.setProperty).not.toHaveBeenCalledWith('skipped', true);
    expect(c.tracker.push).toHaveBeenCalledWith('Onboarding_End');

    await flush();
    expect(c.form.submitData).toHaveBeenCalled();
    expect(navigations).toHaveBeenCalledTimes(1);
  });

  it('moves the progress bar forward once per counted step, logging each step number', async () => {
    const { c } = setupOnboarding();
    await playUntil(c);

    const rates = c.missionProgressBar.update.mock.calls.map(([rate]) => rate);
    expect(rates).toEqual([...rates].sort((a, b) => a - b));
    expect(new Set(rates).size).toBe(rates.length);
    const steps = c.tracker.push.mock.calls.filter(([name, data]) => name === 'Onboarding_Transition' && 'step' in data)
      .map(([, data]) => data.step);
    expect(steps).toEqual(steps.map((_, i) => i));
  });

  it('confines panning to each step\'s heading range', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'select-label-type-1');
    expect(c.panoManager.setHeadingRange).toHaveBeenLastCalledWith({ min: 230, max: 233 });

    await playUntil(c, 'label-attribute-1');
    selectMode(c, 'CurbRamp');
    expect(c.panoManager.setHeadingRange).toHaveBeenLastCalledWith({ min: 230, max: 233 });
  });

  it('removes every pano listener a step added once the tutorial is over', async () => {
    const { c } = setupOnboarding();
    await playUntil(c);
    expect(world.povListeners.size).toBe(0);
  });
});

describe('the tutorial, with steps done wrong', () => {
  it('sends a misplaced label to a delete step, then back to pick the type and place it again', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'label-attribute-1');

    placeLabel(c, { accurate: false });
    expect(currentStep(c)).toBe('delete-attribute-1');
    // The labeler may delete now, the callout points at the label, and the label isn't numbered as a tutorial one.
    expect(c.labelContainer.deleting.release).toHaveBeenCalledWith('tutorial');
    expect(document.getElementById('onboarding-message-holder').classList).toContain('onboarding-message-pass-through');
    expect(world.label.getProperty('tutorialLabelNumber')).toBeUndefined();

    deleteLabel(c);
    expect(currentStep(c)).toBe('redo-select-label-type-1');
    selectMode(c, 'CurbRamp');
    expect(currentStep(c)).toBe('label-attribute-1');

    placeLabel(c);
    expect(currentStep(c)).toBe('rate-severity-1');
    expect(world.label.getProperty('tutorialLabelNumber')).toBe(1);
  });

  it('keeps a wrong rating on the redo step until the right one is picked', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'rate-severity-1');

    rate(3);
    expect(currentStep(c)).toBe('redo-rate-attribute-1');
    rate(1);
    expect(currentStep(c)).toBe('redo-rate-attribute-1');
    rate(2);
    expect(currentStep(c)).toBe('tag-attribute-1');
    expect(c.contextMenu.disableRatingSeverity).toHaveBeenCalled();
    expect(document.getElementById('severity-menu').classList).not.toContain('onboarding-attention');
  });

  it('keeps wrong tags on the redo step, and closes the menu once they are right', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'tag-attribute-1');

    tag([2, 5]);
    expect(currentStep(c)).toBe('redo-tag-attribute-1');
    tag([5]);
    expect(currentStep(c)).toBe('redo-tag-attribute-1');
    expect(c.contextMenu.hide).not.toHaveBeenCalled();
    tag([2]);
    expect(currentStep(c)).toBe('select-label-type-2');
    expect(c.contextMenu.hide).toHaveBeenCalled();
  });

  it('waits on the two-tag step for the second tag, and sends a wrong one to its redo step', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'tag-attribute-7');

    tag([20]);
    expect(currentStep(c)).toBe('tag-attribute-7');
    tag([20, 4]);
    expect(currentStep(c)).toBe('redo-tag-attribute-7');
    tag([21]);
    expect(currentStep(c)).toBe('redo-tag-attribute-7');
    tag([3]);
    expect(currentStep(c)).toBe('redo-tag-attribute-7');
    tag([20, 21]);
    expect(currentStep(c)).toBe('adjust-heading-angle-4');
  });

  it('ignores a label type other than the one the step asks for', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'select-label-type-1');

    selectMode(c, 'Obstacle');
    expect(currentStep(c)).toBe('select-label-type-1');
    expect(c.ribbon.stopBlinking).not.toHaveBeenCalled();
    selectMode(c, 'CurbRamp');
    expect(currentStep(c)).toBe('label-attribute-1');
    expect(c.ribbon.stopBlinking).toHaveBeenCalled();
  });

  it('sends every placement, rating and tagging step to its do-over for a wrong answer, twice over', async () => {
    const { c } = setupOnboarding();
    const wrongSeverity = (n) => (SEVERITY[n] === 1 ? 3 : 1);
    // Where each wrong answer led, by the step it was given on.
    const sentTo = {};
    for (let guard = 0; guard < 300 && currentStep(c) !== 'end-onboarding'; guard++) {
      const from = currentStep(c);
      const props = [currentState(c).properties].flat()[0];
      if (from in sentTo) {
        await doStep(c);
        continue;
      }
      if (props.action === 'LabelAccessibilityAttribute') placeLabel(c, { accurate: false });
      else if (props.action.endsWith('RateSeverity')) rate(wrongSeverity(props.labelNumber));
      else if (props.action.endsWith('AddTag')) tag([999]);
      else {
        await doStep(c);
        continue;
      }
      sentTo[from] = currentStep(c);
    }

    expect(currentStep(c)).toBe('end-onboarding');
    const expected = {};
    for (let n = 1; n <= 9; n++) expected[`label-attribute-${n}`] = `delete-attribute-${n}`;
    for (const n of Object.keys(SEVERITY)) {
      expected[`rate-severity-${n}`] = `redo-rate-attribute-${n}`;
      expected[`redo-rate-attribute-${n}`] = `redo-rate-attribute-${n}`;
    }
    for (const n of Object.keys(TAGS)) {
      expected[`tag-attribute-${n}`] = `redo-tag-attribute-${n}`;
      expected[`redo-tag-attribute-${n}`] = `redo-tag-attribute-${n}`;
    }
    expect(sentTo).toEqual(expected);
  });
});

describe('the steps that move the camera', () => {
  it('waits until the labeler has turned at least to the asked heading', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'adjust-heading-angle-1');
    const hand = document.getElementById('hand-gesture-holder');
    expect(hand.classList).not.toContain('ps-hidden');

    // The step wants 210 within 20 to the left of it; turning short or the wrong way doesn't count.
    turnTo(240);
    expect(currentStep(c)).toBe('adjust-heading-angle-1');
    turnTo(185);
    expect(currentStep(c)).toBe('adjust-heading-angle-1');
    turnTo(205);
    expect(currentStep(c)).toBe('zoom-in');
    expect(hand.classList).toContain('ps-hidden');
  });

  it('unlocks only the zoom direction the step asks for, and locks it again after', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'zoom-in');
    expect(c.zoomControl.blinkZoomIn).toHaveBeenCalled();
    expect(c.zoomControl.zoomInGate.release).toHaveBeenCalledWith('tutorial');

    c.on.zoomed.forEach((fn) => fn('out'));
    expect(currentStep(c)).toBe('zoom-in');
    c.on.zoomed.forEach((fn) => fn('in'));
    expect(currentStep(c)).toBe('select-label-type-3');
    expect(c.zoomControl.zoomInGate.hold).toHaveBeenCalledTimes(2);

    await playUntil(c, 'zoom-out');
    expect(c.zoomControl.blinkZoomOut).toHaveBeenCalled();
    expect(c.zoomControl.zoomOutGate.release).toHaveBeenCalledWith('tutorial');
    c.on.zoomed.forEach((fn) => fn('out'));
    expect(c.zoomControl.zoomOutGate.hold).toHaveBeenCalledTimes(2);
  });

  it('sets up the compass message, then walks to the second pano from it or from the arrows', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'walk-1');
    pressOk();
    expect(currentStep(c)).toBe('walk-2');
    expect(document.getElementById('compass-message').innerHTML).toContain('/img/straight.svg');
    expect(c.compass.showMessage).toHaveBeenCalled();

    pressOk();
    expect(currentStep(c)).toBe('walk-3');
    expect(c.navArrows.showing.release).toHaveBeenCalledWith('tutorial');
    expect(c.navigationService.walking.release).toHaveBeenCalledWith('tutorial');
    expect(c.compass.blink).toHaveBeenCalled();
    expect(c.navArrows.blink).toHaveBeenCalled();

    document.getElementById('nav-arrows').click();
    expect(c.navigationService.moveToPano).toHaveBeenCalledWith('afterWalkTutorial', true);
    await flush();

    expect(currentStep(c)).toBe('walk-4');
    expect(c.navigationService.walking.hold).toHaveBeenCalledTimes(2);
    expect(c.compass.detachMessageClickHandler).toHaveBeenCalled();
    expect(c.panoManager.setPov).toHaveBeenLastCalledWith({ heading: 329, pitch: 0, zoom: 1 });
    expect(c.ui.minimap.holder.style.backgroundImage).toContain('afterWalkTutorialMiniMap.jpg');

    // After the walk, clicking the arrows goes nowhere.
    document.getElementById('nav-arrows').click();
    expect(c.navigationService.moveToPano).toHaveBeenCalledTimes(1);
  });

  it('stops the blinking the walk started, and blinks the minimap and stuck button for their steps', async () => {
    const { c } = setupOnboarding();
    await playUntil(c, 'walk-4');
    expect(c.minimap.stopBlinkingMinimap).toHaveBeenCalled();
    expect(c.compass.stopBlinking).toHaveBeenCalled();

    await playUntil(c, 'instruction-2');
    expect(c.minimap.blinkMinimap).toHaveBeenCalled();
    expect(c.panoOverlayControls.blinkStuckButton).toHaveBeenCalled();
    pressOk();
    expect(c.panoOverlayControls.stopBlinkingStuckButton).toHaveBeenCalled();
  });
});
