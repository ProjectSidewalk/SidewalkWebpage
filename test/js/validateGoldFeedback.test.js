/**
 * The training example's explanation in Validate (#1445): ModalGoldFeedback fills the dialog with the label's crop and
 * the pinned reason and holds the keyboard until it is dismissed, and LabelContainer shows it before a wrong vote on an
 * example moves the mission on, while a right vote or an ordinary label moves on at once.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeGate, fakeTracker } from './fakes.js';

// Only the driveway reason has explanation text of its own; the rest fall back to the reason menu's tooltip.
mockModule('i18next', () => ({
  default: {
    t: (key) => key,
    // A typed key, `driveway-curb-ramp`, doesn't exist, so the lookup falls through to the reason's own. The locale
    // files know nothing at all of `newer-reason`, as for an id from a vocabulary newer than this page's.
    exists: (key) => !key.includes('.newer-reason') &&
      (!key.startsWith('validate:gold-feedback.explanation.') || key.endsWith('.driveway')),
    language: 'en',
  },
}));
useUtil({ assetPath: (p) => `/assets/${p}`, isMobile: () => false, escapeHTML: (s) => s });

/** The dialog's elements, as Main collects them; jsdom has no showModal, so the open flag stands in for it. */
function panelUi() {
  document.body.innerHTML = `
    <dialog id="panel"><img id="image" alt=""><h2 id="heading"></h2><p id="text"></p><p id="advice"></p>
    <button type="button" id="ok"></button></dialog>`;
  const byId = (id) => document.getElementById(id);
  const panel = /** @type {HTMLDialogElement} */ (byId('panel'));
  panel.showModal = () => { panel.open = true; };
  panel.close = () => { panel.open = false; };
  return {
    panel, image: byId('image'), heading: byId('heading'), text: byId('text'), advice: byId('advice'),
    okButton: byId('ok'),
  };
}

/** Lets the vote's promise chain run to its end. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A label as the mission payload carries one; `gold_reason` makes it an example. */
function labelParams(goldReason = null, goldCropUrl = null) {
  return {
    label_id: 42, label_type: 'CurbRamp', pano_id: 'pano', heading: 10, pitch: 0, zoom: 1, canvas_x: 100,
    canvas_y: 100, canvas_width: 720, canvas_height: 480, tags: [], severity: null, gold_reason: goldReason,
    gold_crop_url: goldCropUrl,
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

  test('explains the pinned reason over the label\'s crop, and holds the keyboard until dismissed', async () => {
    const ui = panelUi();
    const gate = fakeGate();
    const tracker = fakeTracker();
    const modal = new ModalGoldFeedback(ui, gate, tracker);
    const label = new Label(labelParams('driveway', '/cropImage/CurbRamp/42?sig=x'), {});

    let resolved = false;
    const shown = modal.show(label, 'Agree').then(() => { resolved = true; });
    await Promise.resolve();

    expect(ui.panel.open).toBe(true);
    expect(gate.hold).toHaveBeenCalledWith('gold-feedback');
    expect(ui.heading.innerHTML).toBe('common:validation-reason.driveway.text');
    expect(ui.text.innerHTML).toBe('validate:gold-feedback.explanation.driveway');
    expect(ui.advice.innerHTML).toBe('validate:gold-feedback.advice');
    expect(ui.image.getAttribute('src')).toBe('/cropImage/CurbRamp/42?sig=x');
    expect(ui.image.hidden).toBe(false);
    expect(document.activeElement).toBe(ui.okButton);
    expect(tracker.push)
      .toHaveBeenCalledWith('ModalGoldFeedback_Shown', { labelId: 42, reasonId: 'driveway', vote: 'Agree' });
    expect(resolved).toBe(false);

    ui.okButton.click();
    await shown;

    expect(resolved).toBe(true);
    expect(gate.release).toHaveBeenCalledWith('gold-feedback');
    expect(ui.panel.open).toBe(false);
    expect(tracker.push).toHaveBeenCalledWith('ModalGoldFeedback_ClickOK');
  });

  test('a label with no crop on disk gets the text alone, with the reason menu\'s tooltip', () => {
    const ui = panelUi();
    const modal = new ModalGoldFeedback(ui, fakeGate(), fakeTracker());

    modal.show(new Label(labelParams('wrong-type'), {}), 'Agree');

    expect(ui.text.innerHTML).toBe('common:validation-reason.wrong-type.tooltip-curb-ramp');
    expect(ui.image.hidden).toBe(true);
    expect(ui.image.hasAttribute('src')).toBe(false);
  });

  test('a reason the locale files don\'t know yet is still named, by its id, with no explanation under it', () => {
    const ui = panelUi();
    const modal = new ModalGoldFeedback(ui, fakeGate(), fakeTracker());

    modal.show(new Label(labelParams('newer-reason'), {}), 'Agree');

    expect(ui.heading.innerHTML).toBe('newer-reason');
    expect(ui.text.innerHTML).toBe('');
  });

  test('a held Enter, the vote\'s own key still down, does not press the button; a fresh press does', async () => {
    const ui = panelUi();
    const modal = new ModalGoldFeedback(ui, fakeGate(), fakeTracker());
    let resolved = false;
    const shown = modal.show(new Label(labelParams('driveway'), {}), 'Unsure').then(() => { resolved = true; });

    const held = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, cancelable: true, bubbles: true });
    ui.okButton.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
    const fresh = new KeyboardEvent('keydown', { key: 'Enter', repeat: false, cancelable: true, bubbles: true });
    ui.okButton.dispatchEvent(fresh);
    expect(fresh.defaultPrevented).toBe(false);

    // jsdom doesn't turn Enter into a click, so the press is the click the browser would send.
    ui.okButton.click();
    await shown;
    expect(resolved).toBe(true);
    expect(ui.okButton.onkeydown).toBeNull();
  });
});

describe('LabelContainer.validateCurrentLabel on a training example', () => {
  let LabelContainer;
  let feedback;
  let resolveFeedback;
  let mission;
  let missionContainer;
  let tracker;

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
      missionContainer, tracker, feedback);
    vi.spyOn(container, 'moveToNextLabel').mockResolvedValue(undefined);
    return container;
  }

  beforeEach(async () => {
    ({ LabelContainer } = await loadModules('frontend/js/validate/label/LabelContainer.js'));
    feedback = { show: vi.fn(() => new Promise((resolve) => { resolveFeedback = resolve; })) };
    tracker = fakeTracker();
    mission = { updateValidationResult: vi.fn(), getProperty: () => 7, isComplete: () => false };
    missionContainer = { getCurrentMission: () => mission, updateAMission: vi.fn() };
  });

  test('a vote that is not Disagree is explained first, and the mission moves on once that is read', async () => {
    const container = containerWith(labelParams('driveway'));

    container.validateCurrentLabel('Agree', new Date(), '');
    await Promise.resolve();

    expect(feedback.show).toHaveBeenCalledTimes(1);
    expect(feedback.show.mock.calls[0][1]).toBe('Agree');
    // Filed and sent before the explanation, so a closed tab still counts, and at once, so an undo can't drop it.
    expect(container.getLabelsToSubmit()).toHaveLength(1);
    expect(tracker.flushSoon).toHaveBeenCalledWith(0);
    expect(mission.updateValidationResult).toHaveBeenCalledWith('Agree', false);
    expect(missionContainer.updateAMission).not.toHaveBeenCalled();
    expect(container.moveToNextLabel).not.toHaveBeenCalled();
    // The tool is busy meanwhile, so a second tap is dropped rather than voted.
    expect(container.dropInputWhileLoading('test')).toBe(true);

    resolveFeedback();
    await settle();

    expect(missionContainer.updateAMission).toHaveBeenCalledTimes(1);
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

  test('an explanation that fails to open still records the vote and frees the tool', async () => {
    feedback.show = vi.fn(() => { throw new Error('no modal'); });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = containerWith(labelParams('driveway'));

    container.validateCurrentLabel('Unsure', new Date(), '');
    await settle();

    expect(container.getLabelsToSubmit()).toHaveLength(1);
    expect(container.moveToNextLabel).toHaveBeenCalledTimes(1);
    expect(container.dropInputWhileLoading('test')).toBe(false);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
