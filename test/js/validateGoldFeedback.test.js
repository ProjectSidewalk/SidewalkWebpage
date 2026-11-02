/**
 * The known-answer example's explanation in Validate (#1445): ModalGoldFeedback paints the mission modal with the
 * pinned reason and holds the keyboard until it is dismissed, and LabelContainer shows it before a wrong vote on an
 * example moves the mission on, while a right vote, or a vote on an ordinary label, moves on at once.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeGate, fakeTracker } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key) => key, exists: () => true, language: 'en' } }));
useUtil({ assetPath: (p) => `/assets/${p}`, isMobile: () => false });

/** The mission modal's elements, as Main collects them. */
function modalMissionUi() {
  document.body.innerHTML = `
    <div id="holder"><div id="bg"></div><div id="fg"><h1 id="title"></h1><div id="instruction"></div>
    <button type="button" id="close"></button></div></div>`;
  const byId = (id) => document.getElementById(id);
  return {
    holder: byId('holder'), background: byId('bg'), foreground: byId('fg'), eyebrow: null,
    missionTitle: byId('title'), instruction: byId('instruction'), closeButton: byId('close'),
  };
}

/** A label as the mission payload carries one; `gold_reason` makes it an example. */
function labelParams(goldReason = null) {
  return {
    label_id: 42, label_type: 'CurbRamp', pano_id: 'pano', heading: 10, pitch: 0, zoom: 1, canvas_x: 100,
    canvas_y: 100, canvas_width: 720, canvas_height: 480, tags: [], severity: null, gold_reason: goldReason,
  };
}

describe('ModalGoldFeedback', () => {
  let ModalGoldFeedback;
  let Label;

  beforeEach(async () => {
    ({ ModalGoldFeedback, Label } = await loadModules(
      'frontend/js/validate/modal/ModalGoldFeedback.js', 'frontend/js/validate/label/Label.js',
    ));
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('explains the pinned reason with the menu\'s example image, and holds the keyboard until dismissed', async () => {
    const ui = modalMissionUi();
    const gate = fakeGate();
    const tracker = fakeTracker();
    const reasons = { 'curb-ramp': { 'no-button-2': { reasonId: 'driveway', tooltipImage: '/assets/driveway.png' } } };
    const modal = new ModalGoldFeedback(ui, reasons, gate, tracker);
    const label = new Label(labelParams('driveway'), {});

    let resolved = false;
    const shown = modal.show(label, 'Agree').then(() => { resolved = true; });
    await Promise.resolve();

    expect(modal.isShowing()).toBe(true);
    expect(gate.hold).toHaveBeenCalledWith('gold-feedback');
    expect(ui.missionTitle.textContent).toBe('gold-feedback.title');
    expect(ui.instruction.innerHTML).toContain('common:validation-reason.driveway.text');
    expect(ui.instruction.innerHTML).toContain('common:validation-reason.driveway.tooltip-curb-ramp');
    expect(ui.instruction.querySelector('img').getAttribute('src')).toBe('/assets/driveway.png');
    expect(ui.closeButton.textContent).toBe('gold-feedback.ok');
    expect(tracker.push).toHaveBeenCalledWith('ModalGoldFeedback_Shown', { labelId: 42, reasonId: 'driveway', vote: 'Agree' });
    expect(resolved).toBe(false);

    ui.closeButton.click();
    await shown;

    expect(resolved).toBe(true);
    expect(modal.isShowing()).toBe(false);
    expect(gate.release).toHaveBeenCalledWith('gold-feedback');
    expect(ui.holder.style.visibility).toBe('hidden');
    expect(tracker.push).toHaveBeenCalledWith('ModalGoldFeedback_ClickOK');
  });
});

describe('LabelContainer.validateCurrentLabel on a known-answer example', () => {
  let LabelContainer;
  let feedback;
  let resolveFeedback;
  let mission;
  let missionContainer;

  /** A container holding one label, with the collaborators a vote touches and nothing more. */
  function containerWith(params) {
    const ui = { busyRegion: [], holder: { style: {} }, viewer: { controlLayer: { style: {} } } };
    const config = { canvasWidth: () => 720, canvasHeight: () => 480, labelRadius: 10 };
    const panoManager = {
      panoViewer: { getViewerType: () => 'GSV', getPov: () => ({ heading: 10, pitch: 0, zoom: 1 }) },
      getActiveViewerName: () => 'GSV',
    };
    const modal = { isShowing: () => false };
    const container = new LabelContainer([params], 'CurbRamp', ui, config, panoManager, {}, modal, modal,
      missionContainer, fakeTracker(), feedback);
    vi.spyOn(container, 'moveToNextLabel').mockResolvedValue(undefined);
    return container;
  }

  beforeEach(async () => {
    ({ LabelContainer } = await loadModules('frontend/js/validate/label/LabelContainer.js'));
    feedback = { show: vi.fn(() => new Promise((resolve) => { resolveFeedback = resolve; })) };
    mission = { updateValidationResult: vi.fn(), getProperty: () => 7, isComplete: () => false };
    missionContainer = { getCurrentMission: () => mission, updateAMission: vi.fn() };
  });

  test('a vote that is not Disagree is explained first, and the mission moves on once that is read', async () => {
    const container = containerWith(labelParams('driveway'));

    container.validateCurrentLabel('Agree', new Date(), '');

    expect(feedback.show).toHaveBeenCalledTimes(1);
    expect(feedback.show.mock.calls[0][1]).toBe('Agree');
    expect(container.getLabelsToSubmit()).toHaveLength(0);
    expect(container.moveToNextLabel).not.toHaveBeenCalled();
    // The tool is busy meanwhile, so a second tap is dropped rather than voted.
    expect(container.dropInputWhileLoading('test')).toBe(true);

    resolveFeedback();
    await Promise.resolve();
    await Promise.resolve();

    expect(container.getLabelsToSubmit()).toHaveLength(1);
    expect(mission.updateValidationResult).toHaveBeenCalledWith('Agree', false);
    expect(container.moveToNextLabel).toHaveBeenCalledTimes(1);
    expect(container.dropInputWhileLoading('test')).toBe(false);
  });

  test('a Disagree on an example is the right answer and gets no explanation', () => {
    const container = containerWith(labelParams('driveway'));

    container.validateCurrentLabel('Disagree', new Date(), '');

    expect(feedback.show).not.toHaveBeenCalled();
    expect(container.getLabelsToSubmit()).toHaveLength(1);
    expect(container.moveToNextLabel).toHaveBeenCalledTimes(1);
  });

  test('an ordinary label is never explained', () => {
    const container = containerWith(labelParams());

    container.validateCurrentLabel('Agree', new Date(), '');

    expect(feedback.show).not.toHaveBeenCalled();
    expect(container.moveToNextLabel).toHaveBeenCalledTimes(1);
  });
});
