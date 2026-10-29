/**
 * What the Validate LabelContainer suites build their container over: a label that is only its properties, the
 * collaborators the container takes that a suite has no opinion on, and the wiring Main.js gives the card and menu.
 */

/** A Validate Label that is only its properties: the geometry and the card need a live pano viewer. */
export class FakeLabel {
  constructor(params) {
    this.auditProps = params;
    this.props = {};
    this.validate = vi.fn();
  }

  getAuditProperty(key) { return this.auditProps[key]; }
  setProperty(key, value) { this.props[key] = value; }
  getProperty(key) { return this.props[key]; }
  getProperties() { return this.props; }
  commentData() { return null; }
}

/**
 * Fills in the collaborators LabelContainer takes that the suite has no opinion on.
 * @param {Record<string, any>} suiteDeps - The suite's own fakes (`ui`, `panoManager`, `modalNoNewMission`, `tracker`,
 *   `labelCard`, `validationMenu` at least), which win where they overlap.
 * @returns {Record<string, any>} The full set.
 */
export function fakeLabelContainerDeps(suiteDeps) {
  const mission = { updateValidationResult: vi.fn(), isComplete: () => true, getProperty: () => 1 };
  const deps = {
    config: {
      validateParams: {}, source: 'Validate', canvasWidth: () => 720, canvasHeight: () => 480, labelRadius: 10,
    },
    panoLoadingStatus: { begin: vi.fn(), setMessage: vi.fn(), end: vi.fn() },
    modalMissionComplete: { isShowing: () => false },
    missionContainer: { getCurrentMission: () => mission, updateAMission: vi.fn() },
    ...suiteDeps,
  };
  deps.tracker.flushSoon ??= vi.fn();
  deps.modalNoNewMission.isShowing ??= () => false;
  Object.assign(deps.panoManager, {
    blanksPanoWhileLoading: () => false,
    getActiveViewerName: () => 'Default',
    revealPendingCanvas: vi.fn(),
    prefetchBackups: deps.panoManager.prefetchBackups ?? vi.fn(),
    panoViewer: { getViewerType: () => 'gsv' },
  });
  return deps;
}

/**
 * Builds a container over the fakes, with the card and menu listening the way Main.js wires them.
 * @param {Function} LabelContainer - The class under test.
 * @param {Record<string, any>} deps - From `fakeLabelContainerDeps`.
 * @param {Array} labelList - Label metadata to start with.
 * @param {string} labelType - The mission's label type.
 * @returns {object} The container, before its first render.
 */
export function newLabelContainer(LabelContainer, deps, labelList, labelType) {
  const labelContainer = new LabelContainer(labelList, labelType, deps.ui, deps.config, deps.panoManager,
    deps.panoLoadingStatus, deps.modalMissionComplete, deps.modalNoNewMission, deps.missionContainer, deps.tracker);
  labelContainer.onLabelReady((label) => deps.labelCard.render(label));
  labelContainer.onLabelReady((label) => deps.validationMenu.resetMenu(label));
  return labelContainer;
}

/**
 * @param {Function} LabelContainer - The class under test.
 * @param {Record<string, any>} deps - From `fakeLabelContainerDeps`.
 * @param {Array} labelList - Label metadata to start with.
 * @param {string} labelType - The mission's label type.
 * @returns {Promise<object>} The container with its first label rendered.
 */
export async function buildLabelContainer(LabelContainer, deps, labelList, labelType) {
  const labelContainer = newLabelContainer(LabelContainer, deps, labelList, labelType);
  await labelContainer.renderCurrentLabel();
  return labelContainer;
}
