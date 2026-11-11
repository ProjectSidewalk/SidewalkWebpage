/**
 * Tests for taking a verdict back from immersive Validate's dock (DesktopValidationMenu.clearVerdict, #5560).
 *
 * The X in the dock's corner is the only way to un-answer a label without submitting it, so what must hold is that
 * nothing of the answer survives it: not the verdict, not a reason, not typed text, and not an enabled Submit that
 * would send it anyway. The X hides itself with the verdict, so the tests also pin where keyboard focus goes, and that
 * the X, like every other menu control, refuses to act while the next label's pano is still loading (#5211).
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeTracker } from './fakes.js';
import { renderDesktopMenu } from './support/desktopValidationMenuHarness.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

let Label;
let DesktopValidationMenu;
let buildReasonButtonInfo;

beforeAll(async () => {
  window.matchMedia = () => /** @type {MediaQueryList} */ ({ matches: true }); // jsdom has none; act as a mouse.
  // The real one fetches the severity icons over the network.
  useUtil({ getImage: () => Promise.resolve('img') });
  window.structuredClone ??= (v) => JSON.parse(JSON.stringify(v)); // Missing from this jsdom.
  ({ Label, DesktopValidationMenu, buildReasonButtonInfo } = await loadModules(
    'frontend/js/validate/util/ConstantsValidate.js', 'frontend/js/validate/label/Label.js',
    'frontend/js/validate/menu/DesktopValidationMenu.js'));
});

describe('DesktopValidationMenu.clearVerdict', () => {
  let label;
  let loading;
  let tracker;
  let labelContainer;
  const config = { adminVersion: false, tagsByLabelType: { Obstacle: [] } };
  const byId = (id) => document.getElementById(id);

  beforeEach(() => {
    const ui = renderDesktopMenu();

    label = new Label({
      label_id: 7, label_type: 'Obstacle', severity: 2, tags: [], ai_tags: null, ai_tags_not_present: null,
      heading: 0, pitch: 0, zoom: 1, canvas_x: 0, canvas_y: 0, pano_id: 'p',
    }, config);
    loading = false;
    tracker = fakeTracker();
    labelContainer = {
      getCurrentLabel: () => label,
      dropInputWhileLoading: vi.fn(() => loading),
      onLabelReady: vi.fn(),
    };

    const menu = new DesktopValidationMenu(ui, config, buildReasonButtonInfo(), labelContainer,
      { render: vi.fn(), onTypePicked: vi.fn() }, { styleMarkerForLabel: vi.fn() }, tracker);
    menu.resetMenu(label);
  });

  /** Answers No with a typed reason, the fullest state there is to take back. */
  function answerNoWithReason() {
    byId('validate-no-button').click();
    byId('add-disagree-comment').value = 'blocked by a car';
    label.setProperty('disagreeReasonTextBox', 'blocked by a car');
  }

  it('forgets the verdict, its reasons and typed text, and disables Submit', () => {
    answerNoWithReason();
    expect(byId('validation-menu-holder').classList.contains('has-verdict')).toBe(true);
    expect(byId('validate-submit-button').disabled).toBe(false);

    byId('validate-verdict-clear').click();

    expect(label.getProperty('validationResult')).toBeUndefined();
    expect(label.getProperty('disagreeOption')).toBeUndefined();
    // Back to the empty strings Label starts them at, not undefined.
    expect(label.getProperty('disagreeReasonTextBox')).toBe('');
    expect(label.getProperty('agreeComment')).toBe('');
    expect(byId('add-disagree-comment').value).toBe('');
    expect(byId('validate-no-button').classList.contains('is-chosen')).toBe(false);
    expect(byId('validation-menu-holder').classList.contains('has-verdict')).toBe(false);
    expect(byId('validate-submit-button').disabled).toBe(true);
  });

  it('logs the verdict it took back', () => {
    answerNoWithReason();
    byId('validate-verdict-clear').click();
    expect(tracker.push).toHaveBeenCalledWith('Click_ClearVerdict', { verdict: 'Disagree' });
  });

  it('does nothing, and logs nothing, when there is no verdict to take back', () => {
    byId('validate-verdict-clear').click();
    expect(tracker.push).not.toHaveBeenCalledWith('Click_ClearVerdict', expect.anything());
  });

  it('moves focus from the X, which hides itself, to the verdict button it undid', () => {
    answerNoWithReason();
    byId('validate-verdict-clear').focus();
    byId('validate-verdict-clear').click();
    expect(document.activeElement).toBe(byId('validate-no-button'));
  });

  it('leaves focus alone when the X was clicked without being focused', () => {
    answerNoWithReason();
    byId('add-disagree-comment').focus();
    byId('validate-verdict-clear').click();
    expect(document.activeElement).toBe(byId('add-disagree-comment'));
  });

  it('refuses to act while the next label is loading (#5211)', () => {
    answerNoWithReason();
    loading = true;
    byId('validate-verdict-clear').click();
    expect(labelContainer.dropInputWhileLoading).toHaveBeenCalledWith('ClearVerdict');
    expect(label.getProperty('validationResult')).toBe('Disagree');
  });
});
