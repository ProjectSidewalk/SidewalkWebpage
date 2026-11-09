/**
 * Tests for Validate's start-up in frontend/js/validate/Main.js on each page that runs it: the phone
 * (mobileValidate.scala.html), the desktop tool, and Expert Validate. What Main decides per layout (which modules it
 * builds, what it tells them, how it answers a resize, focus change or the sign-in dialog) is its own logic, so every
 * module it builds is a recording fake here; validateMainWiring.test.js covers the real subscribers it hooks up
 * to the label container, and these cover everything else Main decides on its own (#5840).
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeTracker } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

/**
 * @type {Record<string, Array<{args: any[], instance: Record<string, any>}>>} Each fake built during the test, by its
 * export name, with what it was built with.
 */
let built = {};

/** @type {Record<string, any>} What the fakes answer, set per test before Main builds them. */
let answers = {};

/**
 * A class that records each build and gives its instances spies for the named methods.
 * @param {string} name - The export it stands in for.
 * @param {Record<string, Function>} [methods] - Method name to what it does; each becomes a spy.
 * @returns {new (...args: any[]) => any} The fake class.
 */
function recording(name, methods = {}) {
  return class {
    /** @param {...any} args - Whatever Main builds it with. */
    constructor(...args) {
      for (const [method, impl] of Object.entries(methods)) this[method] = vi.fn(impl);
      (built[name] ??= []).push({ args, instance: this });
    }
  };
}

/** @returns {any[]} The arguments the one instance of `name` was built with. */
const argsOf = (name) => {
  expect(built[name]).toHaveLength(1);
  return built[name][0].args;
};

/** @returns {Record<string, any>} The one instance of `name` built. */
const instanceOf = (name) => {
  expect(built[name]).toHaveLength(1);
  return built[name][0].instance;
};

const toast = { show: vi.fn(), repositionAll: vi.fn() };

/** Every module Main builds from, path to the export it takes and that export's stand-in. */
const FAKES = {
  'frontend/js/common/BadgeAchievements.js': { BadgeAchievements: { seedCounts: () => {} } },
  'frontend/js/common/ImmersiveMode.js': {
    ImmersiveMode: recording('ImmersiveMode', { isActive: () => answers.immersive, logRestored: () => {} }),
  },
  'frontend/js/common/MissionStartTutorial.js': { MissionStartTutorial: recording('MissionStartTutorial') },
  'frontend/js/common/PanoImageAdjustments.js': {
    PanoImageAdjustments: recording('PanoImageAdjustments', {
      isDefault: () => answers.adjustmentsDefault,
      onChange: () => {},
      values: () => ({ brightness: 1.4, contrast: 1, shadows: 0 }),
    }),
  },
  'frontend/js/common/PanoImageAdjustmentsPopover.js': {
    PanoImageAdjustmentsPopover: recording('PanoImageAdjustmentsPopover'),
  },
  'frontend/js/common/SpeedLimit.js': { SpeedLimit: recording('SpeedLimit', { refresh: () => {} }) },
  'frontend/js/common/Toast.js': { Toast: toast },
  'frontend/js/common/pano-viewer/PanoImageCache.js': { PanoImageCache: recording('PanoImageCache') },
  'frontend/js/common/pano-viewer/PanoInfoPopover.js': { PanoInfoPopover: recording('PanoInfoPopover') },
  'frontend/js/common/pano-viewer/PanoStore.js': { PanoStore: recording('PanoStore') },
  'frontend/js/validate/Tracker.js': { Tracker: class { constructor() { return answers.tracker; } } },
  'frontend/js/validate/data/Form.js': { Form: recording('Form', { attachSession: () => {} }) },
  'frontend/js/validate/keyboard/KeyboardManager.js': { KeyboardManager: recording('KeyboardManager') },
  'frontend/js/validate/label/LabelContainer.js': {
    LabelContainer: recording('LabelContainer', {
      onLabelReady: () => {}, onLabelShown: () => {}, renderCurrentLabel: async () => {}, getCurrentLabel: () => null,
    }),
  },
  'frontend/js/validate/label/LabelVisibilityControl.js': {
    LabelVisibilityControl: recording('LabelVisibilityControl', { getLabelCard: () => ({}), hideLabelCard: () => {} }),
  },
  'frontend/js/validate/menu/DesktopValidationMenu.js': { DesktopValidationMenu: recording('DesktopValidationMenu') },
  'frontend/js/validate/menu/MobileValidationMenu.js': { MobileValidationMenu: recording('MobileValidationMenu') },
  'frontend/js/validate/menu/UndoValidation.js': { UndoValidation: recording('UndoValidation') },
  'frontend/js/validate/mission/MissionContainer.js': {
    MissionContainer: recording('MissionContainer', { createAMission: () => {} }),
  },
  'frontend/js/validate/modal/ModalMission.js': { ModalMission: recording('ModalMission') },
  'frontend/js/validate/modal/ModalGoldFeedback.js': { ModalGoldFeedback: recording('ModalGoldFeedback') },
  'frontend/js/validate/modal/ModalMissionComplete.js': { ModalMissionComplete: recording('ModalMissionComplete') },
  'frontend/js/validate/modal/ModalNoNewMission.js': {
    ModalNoNewMission: recording('ModalNoNewMission', { show: () => {}, isShowing: () => false }),
  },
  'frontend/js/validate/panorama/PanoControlMenu.js': {
    PanoControlMenu: recording('PanoControlMenu', { setCollapsedIndicator: () => {} }),
  },
  'frontend/js/validate/panorama/PanoLoadingStatus.js': { PanoLoadingStatus: recording('PanoLoadingStatus') },
  'frontend/js/validate/panorama/PanoManager.js': {
    PanoManager: { create: async () => answers.panoManager },
  },
  'frontend/js/validate/panorama/PanoOverlay.js': { PanoOverlay: recording('PanoOverlay') },
  'frontend/js/validate/status/AdminInfo.js': { AdminInfo: recording('AdminInfo', { updateAdminInfo: () => {} }) },
  'frontend/js/validate/status/StatusField.js': { StatusField: recording('StatusField') },
  'frontend/js/validate/util/ConstantsValidate.js': { buildReasonButtonInfo: () => ({}) },
  'frontend/js/validate/util/MissionLiveMarker.js': {
    MissionLiveMarker: recording('MissionLiveMarker', { takeUnexpectedUnload: () => null, markLive: () => {} }),
  },
  'frontend/js/validate/zoom/PinchZoomDetector.js': { PinchZoomDetector: recording('PinchZoomDetector') },
  'frontend/js/validate/zoom/ZoomControl.js': {
    ZoomControl: recording('ZoomControl', { updateZoomAvailability: () => {} }),
  },
};
for (const [path, exports] of Object.entries(FAKES)) mockModule(path, () => exports);

/** The desktop view (validate.scala.html), cut down to what Main reads itself. */
const DESKTOP = `
  <div id="page-loading"></div>
  <div class="tool-ui ps-invisible">
    <div id="svv-application-holder">
      <div id="svv-panorama-holder"><div id="view-control-layer"></div></div>
      <button type="button" id="zoom-in-button" data-ps-tooltip="Zoom in"></button>
    </div>
    <div id="validation-menu-holder"></div>
  </div>`;

/** The phone's view (mobileValidate.scala.html): its controls lie over the pano, each dimmed on its own. */
const MOBILE = `
  <div id="page-loading"></div>
  <div class="tool-ui ps-invisible">
    <div id="svv-panorama-holder"><div id="view-control-layer"></div></div>
    <div id="validation-button-holder"></div>
    <div id="validate-why-no-section"></div>
    <div id="validate-why-unsure-section"></div>
    <div id="mobile-popup-notch"></div>
    <button type="button" id="validate-undo-button"></button>
    <div id="label-visibility-control-holder"></div>
    <button type="button" id="label-visibility-button-on-label" data-ps-tooltip-html="Hide &lt;u&gt;l&lt;/u&gt;abel">
    </button>
  </div>`;

/**
 * @param {boolean} adminVersion - Whether this is Expert Validate.
 * @returns {Record<string, any>} The page-data block's scalars.
 */
const pageParams = (adminVersion) => ({
  validateParams: { admin_version: adminVersion },
  viewerType: class FakeViewerType {},
  tagList: [{ label_type: 'Obstacle', tag_name: 'pole' }, { label_type: 'Obstacle', tag_name: 'tree' }],
  dataStoreUrl: '/validate/store',
  viewerAccessToken: 'token',
  language: 'en',
  countryId: 'usa',
});

/** @returns {Record<string, any>} What /validationTask/mission answers for a mission of one Obstacle label. */
const firstMission = () => ({
  has_mission_available: true,
  mission: {
    mission_id: 7, mission_type: 'validation', label_type: 'Obstacle', labels_progress: 0, labels_validated: 1,
    completed: false,
  },
  labels: [{ labelId: 1, panoId: 'pano1', labelType: 'Obstacle' }],
  progress: { agree_count: 0, disagree_count: 0, unsure_count: 0 },
  completed_validations: 12,
});

const { Main } = await loadModules('frontend/js/validate/Main.js');

/** @type {{width: number, height: number}} The viewport jsdom reports; it lays nothing out, so it is stated here. */
let viewport;
Object.defineProperty(document.documentElement, 'clientWidth', { get: () => viewport.width, configurable: true });
Object.defineProperty(document.documentElement, 'clientHeight', { get: () => viewport.height, configurable: true });

let tracker;
let isMobile;
let hoverable;
const applyToolScale = vi.fn(() => 1.25);

beforeEach(() => {
  built = {};
  tracker = fakeTracker();
  isMobile = false;
  hoverable = true;
  viewport = { width: 390, height: 844 };
  answers = {
    tracker,
    immersive: false,
    adjustmentsDefault: true,
    panoManager: {
      replayMarkerPulse: vi.fn(),
      setMarkerScale: vi.fn(),
      sizePano: vi.fn(),
      getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
      panoViewer: { resize: vi.fn(), repaint: vi.fn(), getPosition: () => null, getPanoId: () => 'pano1' },
    },
  };
  useUtil({ isMobile: () => isMobile, applyToolScale });
  window.matchMedia = /** @type {any} */ (vi.fn((query) => ({ matches: query === '(hover: hover)' && hoverable })));
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/**
 * Starts Validate on the given markup.
 * @param {string} markup - The layout's view.
 * @param {boolean} [adminVersion] - Whether this is Expert Validate.
 * @returns {Promise<Record<string, any>>} The console handle, once the first label is up.
 */
function start(markup, adminVersion = false) {
  document.body.innerHTML = markup;
  return new Main(pageParams(adminVersion), firstMission()).start();
}

/** @returns {Array<object>} The notes of every push of `action` so far. */
const pushed = (action) => tracker.push.mock.calls.filter((call) => call[0] === action).map((call) => call[1]);

describe('on the phone', () => {
  beforeEach(() => {
    isMobile = true;
  });

  test('records its submissions as ValidateMobile, with the bigger marker a finger needs', async () => {
    await start(MOBILE);

    const config = argsOf('Form')[1];
    expect(config.source).toBe('ValidateMobile');
    expect(config.labelRadius).toBe(15);
    expect(config.tagsByLabelType.Obstacle.map((t) => t.tag_name)).toEqual(['pole', 'tree']);
  });

  test('dims its overlaid controls one by one while a label loads, never the pano they sit on', async () => {
    await start(MOBILE);

    const ids = argsOf('LabelContainer')[2].busyRegion.map((el) => el.id);
    expect(ids.sort()).toEqual([
      'label-visibility-control-holder', 'mobile-popup-notch', 'validate-undo-button', 'validate-why-no-section',
      'validate-why-unsure-section', 'validation-button-holder',
    ]);
  });

  test('builds the touch pieces and none of the desktop ones', async () => {
    const handle = await start(MOBILE);

    expect(built.MobileValidationMenu).toHaveLength(1);
    expect(built.PinchZoomDetector).toHaveLength(1);
    for (const name of ['DesktopValidationMenu', 'ZoomControl', 'ImmersiveMode', 'PanoOverlay', 'SpeedLimit',
      'PanoImageAdjustments', 'KeyboardManager', 'MissionStartTutorial', 'PanoInfoPopover']) {
      expect({ [name]: built[name] }).toEqual({ [name]: undefined });
    }
    // The phone briefs each mission through ModalMission, so the mission-complete screen raises no tutorial.
    expect(argsOf('ModalMissionComplete')[2]).toBeNull();
    expect(handle).not.toHaveProperty('imageAdjustmentsPopover');
    expect(toast.show).not.toHaveBeenCalled();
  });

  test('the tool is revealed and the first mission begins once the first label is up', async () => {
    await start(MOBILE);

    expect(document.querySelector('.tool-ui').classList.contains('ps-invisible')).toBe(false);
    expect(document.getElementById('page-loading').style.visibility).toBe('hidden');
    expect(instanceOf('MissionContainer').createAMission).toHaveBeenCalledWith(
      firstMission().mission, firstMission().progress,
    );
    expect(pushed('ImageAdjustments_Restored')).toEqual([]);
  });

  describe('when the screen changes shape', () => {
    beforeEach(async () => {
      await start(MOBILE);
      // The throttle's clock, so each resize below lands after the last one's window.
      vi.useFakeTimers();
    });

    /** Resizes the viewport and lets the throttle's window pass. */
    function resizeTo(width, height) {
      viewport = { width, height };
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(200);
    }

    test('a rotation re-sizes the pano in place and says it turned', () => {
      resizeTo(844, 390);

      expect(answers.panoManager.sizePano).toHaveBeenCalledTimes(1);
      expect(answers.panoManager.panoViewer.resize).toHaveBeenCalledTimes(1);
      expect(answers.panoManager.panoViewer.repaint).toHaveBeenCalledTimes(1);
      expect(pushed('Window_Resized')).toEqual([{ width: 844, height: 390, orientation: 'landscape', rotated: true }]);
    });

    test('a keyboard opening resizes without a rotation', () => {
      resizeTo(390, 500);

      expect(pushed('Window_Resized')).toEqual([{ width: 390, height: 500, orientation: 'portrait', rotated: false }]);
    });

    test('a pinch, which fires resize but leaves the layout as it was, changes nothing', () => {
      resizeTo(390, 844);

      expect(answers.panoManager.sizePano).not.toHaveBeenCalled();
      expect(pushed('Window_Resized')).toEqual([]);
    });
  });
});

describe('on a touch screen', () => {
  test('the markup’s tooltips are taken off, since a tap would pin them open', async () => {
    isMobile = true;
    hoverable = false;

    await start(MOBILE);

    expect(document.querySelector('[data-ps-tooltip], [data-ps-tooltip-html]')).toBeNull();
  });

  test('a mouse keeps them', async () => {
    await start(DESKTOP);

    expect(document.getElementById('zoom-in-button').getAttribute('data-ps-tooltip')).toBe('Zoom in');
  });
});

describe('on desktop', () => {
  test('the regular tool records its submissions as Validate, and has no admin panel', async () => {
    await start(DESKTOP);

    const config = argsOf('Form')[1];
    expect(config.source).toBe('Validate');
    expect(config.labelRadius).toBe(10);
    expect(built.AdminInfo).toBeUndefined();
    expect(argsOf('ImmersiveMode')[0].isDisabled()).toBe(false);
  });

  test('Expert Validate records as ExpertValidate, adds the admin panel, and keeps the boxed layout', async () => {
    await start(DESKTOP, true);

    expect(argsOf('Form')[1].source).toBe('ExpertValidate');
    expect(built.AdminInfo).toHaveLength(1);
    expect(argsOf('AdminInfo')[1]).toBe(tracker);
    expect(argsOf('ImmersiveMode')[0].isDisabled()).toBe(true);
  });

  test('the Details popover logs a click on its label link with that link\'s label', async () => {
    await start(DESKTOP);
    argsOf('PanoInfoPopover')[13].linkLogging(42);
    expect(pushed('PanoInfoLabelLink_Click')).toEqual([{ labelId: 42 }]);
  });

  test('the whole tool dims while a label loads', async () => {
    await start(DESKTOP);

    expect(argsOf('LabelContainer')[2].busyRegion.map((el) => el.id))
      .toEqual(['svv-application-holder', 'validation-menu-holder']);
  });

  test('the mission-complete screen can raise the next mission’s tutorial', async () => {
    await start(DESKTOP);

    const hooks = argsOf('ModalMissionComplete')[2];
    expect(hooks.tracker).toBe(tracker);
    expect(hooks.zoomControl).toBe(instanceOf('ZoomControl'));
  });

  test('image adjustments carried in from an earlier visit are logged once the mission exists', async () => {
    answers.adjustmentsDefault = false;

    const handle = await start(DESKTOP);

    expect(pushed('ImageAdjustments_Restored')).toEqual([{ brightness: 1.4, contrast: 1, shadows: 0 }]);
    const createdAt = instanceOf('MissionContainer').createAMission.mock.invocationCallOrder[0];
    const loggedAt = tracker.push.mock.invocationCallOrder[
      tracker.push.mock.calls.findIndex((call) => call[0] === 'ImageAdjustments_Restored')];
    expect(loggedAt).toBeGreaterThan(createdAt);
    // The chevron that hides the Image pill carries the active dot.
    expect(instanceOf('PanoControlMenu').setCollapsedIndicator).toHaveBeenCalledWith(true);
    expect(handle.imageAdjustmentsPopover).toBe(instanceOf('PanoImageAdjustmentsPopover'));
  });

  test('untouched image adjustments log nothing', async () => {
    await start(DESKTOP);

    expect(pushed('ImageAdjustments_Restored')).toEqual([]);
    expect(instanceOf('PanoControlMenu').setCollapsedIndicator).toHaveBeenCalledWith(false);
  });

  describe('the hint that the pano can be dragged and zoomed', () => {
    test('shows over the pano at once when no tutorial is up', async () => {
      await start(DESKTOP);

      expect(toast.show).toHaveBeenCalledTimes(1);
      expect(toast.show.mock.calls[0][0]).toMatchObject({
        message: 'center-ui.pano-interactive-message', reference: document.getElementById('view-control-layer'),
      });
    });

    test('waits for the mission-start tutorial to close, since it would land underneath it', async () => {
      const markup = `${DESKTOP}<div class="mission-start-tutorial-overlay"></div>`;

      await start(markup);
      expect(toast.show).not.toHaveBeenCalled();

      document.dispatchEvent(new Event('ps:mission-start-tutorial:done'));
      expect(toast.show).toHaveBeenCalledTimes(1);
    });

    test('a tutorial overlay that is closed does not hold it back', async () => {
      const markup = `${DESKTOP}<div class="mission-start-tutorial-overlay" style="display: none"></div>`;

      await start(markup);

      expect(toast.show).toHaveBeenCalledTimes(1);
    });
  });

  describe('immersive mode', () => {
    test('switching re-fits the tool to the pano alone, and moves the toasts with it', async () => {
      await start(DESKTOP);
      const { relayout } = argsOf('ImmersiveMode')[0];
      answers.immersive = true;
      applyToolScale.mockClear();

      relayout();

      expect(applyToolScale).toHaveBeenCalledWith(
        ['--pano-base-width'], ['--header-base-height', '--pano-base-height'],
        { maxScale: 3, hMargin: 0, bottomReserve: 0 },
      );
      expect(answers.panoManager.setMarkerScale).toHaveBeenLastCalledWith(1.25);
      expect(toast.repositionAll).toHaveBeenCalledTimes(1);
    });

    test('closes the label card before switching, as the card is anchored to a marker the switch moves', async () => {
      await start(DESKTOP);

      argsOf('ImmersiveMode')[0].beforeToggle();

      expect(instanceOf('LabelVisibilityControl').hideLabelCard).toHaveBeenCalledTimes(1);
    });
  });
});

describe('on either layout', () => {
  test('with no mission left to give, the dead end shows on the revealed page and nothing else is built', async () => {
    document.body.innerHTML = DESKTOP;

    const handle = await new Main(pageParams(false), { has_mission_available: false }).start();

    expect(instanceOf('ModalNoNewMission').show).toHaveBeenCalledTimes(1);
    // The Form still owns the exit flush, so the visit is logged.
    expect(argsOf('Form')[2]).toBe(tracker);
    expect(document.querySelector('.tool-ui').classList.contains('ps-invisible')).toBe(false);
    expect(document.getElementById('page-loading').style.visibility).toBe('hidden');
    expect(handle).toEqual({
      validateParams: { admin_version: false }, modalNoNewMission: instanceOf('ModalNoNewMission'),
    });
    expect(built.LabelContainer).toBeUndefined();
  });


  test('the page’s focus is logged as the tool starts and each time it changes', async () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    await start(DESKTOP);
    expect(pushed('PageGainedFocus')).toHaveLength(1);

    hasFocus.mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));

    expect(pushed('PageLostFocus')).toHaveLength(1);
  });

  test('the sign-in dialog pauses the shortcuts and dims the tool while it is open', async () => {
    const markup = `${DESKTOP}<dialog id="sign-in-modal-container"></dialog>`;
    await start(markup);
    const dialog = document.getElementById('sign-in-modal-container');
    const holder = /** @type {HTMLElement} */ (document.querySelector('.tool-ui'));
    const lock = argsOf('ModalNoNewMission')[1];

    dialog.dispatchEvent(new Event('ps:modal:show'));
    expect(lock.isHeld()).toBe(true);
    expect(holder.style.opacity).toBe('0.5');

    dialog.dispatchEvent(new Event('ps:modal:hidden'));
    expect(holder.style.opacity).toBe('1');
    // The tutorial still holds it on desktop; only the dialog's own hold is gone.
    lock.release('tutorial');
    expect(lock.isHeld()).toBe(false);
  });
});
