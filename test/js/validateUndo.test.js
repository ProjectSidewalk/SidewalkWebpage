/**
 * Tests for Validate's undo (the Back button), across frontend/js/validate/menu/UndoValidation.js,
 * frontend/js/validate/label/LabelContainer.js (`retractLastValidation`, `undoLabel`, `hasPreviousLabel`) and
 * frontend/js/validate/mission/MissionContainer.js (`updateAMissionUndoValidation`, `onMissionComplete`).
 *
 * An undo puts back the label on screen, the mission's counts and the verdict in the submit buffer, each owned by a
 * different module, so these suites drive the real button, container and mission together.
 */

const { assetPathStub, installUtilitiesMisc, loadModules } = require('./loadGlobalScript');

const TAGS_BY_TYPE = {
  Obstacle: [{ tag_name: 'pole' }],
  SurfaceProblem: [{ tag_name: 'pole' }, { tag_name: 'cracks' }],
};

/** The page facts the label and the container read. */
const config = {
  tagsByLabelType: TAGS_BY_TYPE, adminVersion: true, source: 'ExpertValidate', validateParams: {},
  canvasWidth: () => 720, canvasHeight: () => 480, labelRadius: 10,
};

let LabelContainer;
let UndoValidation;
let MissionContainer;

beforeAll(() => {
  window.util = {
    assetPath: assetPathStub,
    isMobile: () => false,
    uiScale: () => 1,
    camelToKebab: (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
  };
  installUtilitiesMisc();
  window.i18next = { t: (key) => key };
  ({ LabelContainer, UndoValidation, MissionContainer } = loadModules(
    'frontend/js/validate/label/Label.js',
    'frontend/js/validate/label/LabelContainer.js',
    'frontend/js/validate/menu/UndoValidation.js',
    'frontend/js/validate/mission/MissionContainer.js',
  ));
  // Where the validator was looking is not under test; the projection only has to answer.
  window.util.pano = {
    canvasCoordToCenteredPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
    centeredPovToCanvasCoord: () => ({ x: 360, y: 240 }),
    renderedHFov: () => 90,
  };
});

/** @returns {Array} Three Obstacle labels, one per pano, as the backend would hand them over. */
function threeLabels() {
  return [1, 2, 3].map((n) => ({
    label_id: n, label_type: 'Obstacle', severity: 2, tags: ['pole'], pano_id: `pano${n}`,
    heading: 0, pitch: 0, zoom: 1, canvas_x: 0, canvas_y: 0, lat: 47.6, lng: -122.3,
  }));
}

/** Lets a render that was started without being awaited (validateCurrentLabel's advance, the button's click) land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('undoing a validation', () => {
  let labelContainer;
  let undoValidation;
  let missionContainer;
  let undoButton;
  let tracker;
  let statusField;
  let validationMenu;
  let modalMissionComplete;
  let holdNextLoad;
  let releaseLoad;

  /**
   * Builds the button over a real container and mission, wired the way Main.js wires them, with the first label on
   * screen.
   * @param {number} labelsValidated - How many labels the mission asks for.
   * @param {Array} [labels] - The mission's labels.
   */
  async function build(labelsValidated = 5, labels = threeLabels()) {
    const el = () => document.createElement('div');
    missionContainer = new MissionContainer(
      statusField, { setMissionMessage: jest.fn() }, modalMissionComplete, { markLive: jest.fn() }, tracker,
    );
    const panoManager = {
      setPanorama: jest.fn((panoId) => {
        if (!holdNextLoad) return Promise.resolve({ panoData: { panoId } });
        holdNextLoad = false;
        return new Promise((resolve) => { releaseLoad = () => resolve({ panoData: { panoId } }); });
      }),
      renderPanoMarker: jest.fn(),
      prefetchPano: jest.fn(),
      prefetchBackups: jest.fn(),
      blanksPanoWhileLoading: () => false,
      getActiveViewerName: () => 'Default',
      revealPendingCanvas: jest.fn(),
      panoViewer: { getViewerType: () => 'gsv', getPov: () => ({ heading: 10, pitch: 5, zoom: 1 }) },
    };
    labelContainer = new LabelContainer(labels, 'Obstacle',
      { holder: el(), busyRegion: [el()], viewer: { controlLayer: el() } }, config, panoManager,
      { begin: jest.fn(), setMessage: jest.fn(), end: jest.fn() }, modalMissionComplete,
      { show: jest.fn(), isShowing: () => false }, missionContainer, tracker);
    undoValidation = new UndoValidation({ undoButton }, labelContainer, validationMenu, missionContainer, tracker);

    const render = labelContainer.renderCurrentLabel();
    missionContainer.createAMission(
      { mission_id: 99, mission_type: 'validation', label_type: 'Obstacle', labels_progress: 0,
        labels_validated: labelsValidated, completed: false },
      { agree_count: 0, disagree_count: 0, unsure_count: 0 },
    );
    await render;
  }

  beforeEach(() => {
    document.body.innerHTML = '<button type="button" id="validate-undo-button"></button>';
    undoButton = document.getElementById('validate-undo-button');
    tracker = { push: jest.fn(), flushSoon: jest.fn(), trackMissions: jest.fn() };
    statusField = {
      reset: jest.fn(), updateLabelText: jest.fn(), incrementLabelCounts: jest.fn(), decrementLabelCounts: jest.fn(),
      setProgressBar: jest.fn(), setProgressText: jest.fn(),
    };
    validationMenu = { saveValidationState: jest.fn() };
    modalMissionComplete = { show: jest.fn(), isShowing: () => false };
    holdNextLoad = false;
    releaseLoad = null;
  });

  /** @returns {number} The id of the label the validator is looking at. */
  const currentLabelId = () => labelContainer.getCurrentLabel().getAuditProperty('labelId');

  /** @returns {{labelsProgress: number, agreeCount: number, disagreeCount: number, unsureCount: number}} */
  function missionCounts() {
    const mission = missionContainer.getCurrentMission();
    return Object.fromEntries(
      ['labelsProgress', 'agreeCount', 'disagreeCount', 'unsureCount'].map((key) => [key, mission.getProperty(key)]),
    );
  }

  /**
   * Casts a verdict on the current label the way the menu does, and waits for the advance it starts.
   * @param {string} action - Agree, Disagree, or Unsure.
   * @param {string} [comment] - What the menu compiled from the reason chosen or the text typed.
   */
  async function cast(action, comment = '') {
    labelContainer.validateCurrentLabel(action, new Date(), comment);
    await settle();
  }

  /** Presses Back and waits for the step back it starts. */
  async function pressUndo() {
    undoButton.click();
    await settle();
  }

  test('the button comes on after a verdict, and going back turns it off with the previous label up', async () => {
    await build();
    expect(undoValidation.canUndo()).toBe(false);
    expect(undoButton.disabled).toBe(true);

    await cast('Agree');
    expect(currentLabelId()).toBe(2);
    expect(undoValidation.canUndo()).toBe(true);
    expect(undoButton.disabled).toBe(false);

    await pressUndo();

    expect(currentLabelId()).toBe(1);
    expect(undoValidation.canUndo()).toBe(false);
    expect(undoButton.disabled).toBe(true);
    expect(tracker.push).toHaveBeenCalledWith('ModalUndo_Click');
    // Whatever was typed for the label being left is kept for when the validator comes back to it.
    expect(validationMenu.saveValidationState).toHaveBeenCalledTimes(1);
    // Once for the verdict, once for the retraction: both are worth getting to the server quickly (#5561).
    expect(tracker.flushSoon).toHaveBeenCalledTimes(2);
  });

  describe('each kind of verdict is taken back in full', () => {
    // [what, how the menu would have set the label up, the verdict and comment it would then cast, and what the
    // buffered verdict carries].
    const KINDS = [
      ['an Agree', () => {}, ['Agree', ''], { validation_result: 'Agree', comment: null, new_label_type: null }],
      ['a Disagree with a reason', (label) => label.setProperty('disagreeOption', 'no-button-2'),
        ['Disagree', 'Not an obstacle'],
        { validation_result: 'Disagree', comment: expect.objectContaining({ comment: 'Not an obstacle', label_id: 1 }) }],
      ['an Unsure with a typed comment', (label) => label.setProperty('unsureOption', 'other'),
        ['Unsure', 'Too dark to tell'],
        { validation_result: 'Unsure', comment: expect.objectContaining({ comment: 'Too dark to tell', label_id: 1 }) }],
      ['a wrong-label-type edit', (label) => label.setNewLabelType('SurfaceProblem'), ['Agree', ''],
        { validation_result: 'Agree', label_type: 'Obstacle', new_label_type: 'SurfaceProblem' }],
    ];

    const COUNT_FOR = { Agree: 'agreeCount', Disagree: 'disagreeCount', Unsure: 'unsureCount' };

    test.each(KINDS)('%s: the mission counts and the unsent buffer go back to what they were', async (
      what, setUp, [action, comment], buffered,
    ) => {
      await build();
      const before = missionCounts();
      setUp(labelContainer.getCurrentLabel());

      await cast(action, comment);
      expect(missionCounts()).toEqual({ ...before, labelsProgress: 1, [COUNT_FOR[action]]: 1 });
      expect(labelContainer.getLabelsToSubmit()).toEqual([expect.objectContaining({ label_id: 1, ...buffered })]);
      expect(statusField.incrementLabelCounts).toHaveBeenCalledTimes(1);

      const undoSpy = jest.spyOn(missionContainer, 'updateAMissionUndoValidation');
      await pressUndo();

      expect(currentLabelId()).toBe(1);
      expect(missionCounts()).toEqual(before);
      expect(statusField.decrementLabelCounts).toHaveBeenCalledTimes(1);
      // The mission is told which count to take the verdict off, read from the buffered verdict itself.
      expect(undoSpy).toHaveBeenCalledWith(action);
      // The server never saw this verdict, so there is nothing to retract: it is simply dropped.
      expect(labelContainer.getLabelsToSubmit()).toEqual([]);
    });

    test.each(KINDS)('%s: a verdict already sent gets a retraction, and casting again marks the redo', async (
      what, setUp, [action, comment], buffered,
    ) => {
      await build();
      setUp(labelContainer.getCurrentLabel());
      await cast(action, comment);
      const sent = labelContainer.getLabelsToSubmit()[0];
      labelContainer.refresh(); // The Form drained the buffer, so the verdict is on the server.

      await pressUndo();

      // A copy, marked undone, and not the object that went out: a failed POST may be about to resend that one.
      expect(labelContainer.getLabelsToSubmit()).toEqual([{ ...sent, undone: true, redone: false }]);
      expect(labelContainer.getLabelsToSubmit()[0]).not.toBe(sent);
      expect(missionCounts()).toMatchObject({ labelsProgress: 0, [COUNT_FOR[action]]: 0 });

      await cast(action, comment);

      // The retraction and the new verdict collapse into one row that says it replaced the first: the server keeps a
      // single validation per label and validator, so a retraction followed by a verdict would be two edits of it.
      expect(labelContainer.getLabelsToSubmit())
        .toEqual([expect.objectContaining({ label_id: 1, ...buffered, undone: false, redone: true })]);
      expect(missionCounts()).toMatchObject({ labelsProgress: 1, [COUNT_FOR[action]]: 1 });
      expect(currentLabelId()).toBe(2);
    });

    test('casting again after an unsent verdict was taken back is a plain verdict, not a redo', async () => {
      // `redone` is only set when the buffer's last row is this label's, which after a drop it is not. The server
      // never saw the first verdict, so there is nothing for it to have replaced.
      await build();
      await cast('Agree');
      await pressUndo();

      await cast('Disagree');

      expect(labelContainer.getLabelsToSubmit())
        .toEqual([expect.objectContaining({ label_id: 1, validation_result: 'Disagree', undone: false, redone: false })]);
      expect(missionCounts()).toMatchObject({ labelsProgress: 1, agreeCount: 0, disagreeCount: 1 });
    });
  });

  test('the button goes off as the mission completes, and a press then does nothing', async () => {
    await build(2);
    await cast('Agree');
    expect(undoValidation.canUndo()).toBe(true);

    await cast('Disagree'); // The mission's last label.

    expect(missionContainer.getCurrentMission().isComplete()).toBe(true);
    expect(modalMissionComplete.show).toHaveBeenCalledTimes(1);
    expect(undoValidation.canUndo()).toBe(false);
    expect(undoButton.disabled).toBe(true);
    // The mission's labels went out with it (Form.js), so there is nothing to step back to.
    expect(currentLabelId()).toBe(2);
    const counts = missionCounts();
    tracker.push.mockClear();

    await pressUndo();

    expect(missionCounts()).toEqual(counts);
    expect(currentLabelId()).toBe(2);
    expect(tracker.push).not.toHaveBeenCalledWith('ModalUndo_Click');
  });

  test('the button is off for the first label from the moment its load starts, and stays off once it lands', async () => {
    holdNextLoad = true;
    const building = build();
    await settle();

    expect(undoButton.disabled).toBe(true);
    expect(undoValidation.canUndo()).toBe(false);

    releaseLoad();
    await building;

    expect(undoButton.disabled).toBe(true);
    expect(undoValidation.canUndo()).toBe(false);
  });

  // Pins what the code does today: the button is switched by the load *starting*, so while a later label loads it is
  // already on (the busy region dims it and blocks the pointer, LabelContainer's #setUiBusy). A press that gets
  // through anyway — Enter on a button that kept focus — is dropped by the load guard before anything is touched.
  test('a press while a later label is still loading is dropped and logged, and nothing is rolled back', async () => {
    await build();
    holdNextLoad = true;
    await cast('Agree');
    expect(undoButton.disabled).toBe(false);
    const counts = missionCounts();
    const buffer = [...labelContainer.getLabelsToSubmit()];
    tracker.push.mockClear();

    await pressUndo();

    expect(tracker.push).toHaveBeenCalledWith('ValidateInputDropped_Loading', { source: 'Undo' });
    expect(tracker.push).not.toHaveBeenCalledWith('ModalUndo_Click');
    expect(validationMenu.saveValidationState).not.toHaveBeenCalled();
    expect(missionCounts()).toEqual(counts);
    expect(labelContainer.getLabelsToSubmit()).toEqual(buffer);

    releaseLoad();
    await settle();
    expect(currentLabelId()).toBe(2);
    expect(undoButton.disabled).toBe(false);
  });

  // The container reports an undo it had to abandon as not taken, so the verdict the validator still has standing
  // keeps counting; the button goes off either way, since pressing it again would only repeat the failure.
  test('an undo the container abandons rolls nothing back, and still turns the button off', async () => {
    await build();
    await cast('Agree');
    const counts = missionCounts();
    const buffer = [...labelContainer.getLabelsToSubmit()];
    jest.spyOn(labelContainer, 'undoLabel').mockResolvedValue(false);

    await pressUndo();

    expect(missionCounts()).toEqual(counts);
    expect(labelContainer.getLabelsToSubmit()).toEqual(buffer);
    expect(undoValidation.canUndo()).toBe(false);
    expect(undoButton.disabled).toBe(true);
  });
});
