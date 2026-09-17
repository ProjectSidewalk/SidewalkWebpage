/**
 * Tests for Expert Validate's "Wrong type" verdict (#3671), across public/js/common/LabelTypePicker.js,
 * public/js/validate/src/label/Label.js and public/js/validate/src/label/LabelContainer.js.
 *
 * The verdict is stored as an Agree on the type the expert picks, so the two things that must hold are: the label's
 * editable severity and tags follow the picked type by the same rules the server applies (a rating survives only on the
 * same scale, a tag only if the new type offers it), and the submission names both the type the validator saw and the
 * one they picked. The picker itself is checked as the radio group it claims to be.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub, installUtilitiesMisc, REPO_ROOT } = require('./loadGlobalScript');

/**
 * Loads a bare `class` declaration out of a production file into window scope.
 * @param {string} relPath - Path under the repo root.
 * @param {string} name - The class the file declares.
 */
function loadClass(relPath, name) {
  const src = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
  window.eval(`${src}\nwindow.${name} = ${name};`);
}

const TAGS_BY_TYPE = {
  Obstacle: [{ tag_name: 'pole' }, { tag_name: 'trash/recycling can' }],
  SurfaceProblem: [{ tag_name: 'pole' }, { tag_name: 'cracks' }],
  CurbRamp: [{ tag_name: 'narrow' }],
};

beforeAll(() => {
  window.util = {
    assetPath: assetPathStub,
    isMobile: () => false,
    camelToKebab: (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
  };
  installUtilitiesMisc();
  // i18next echoes its key so assertions can name the key they expect rather than an English string.
  window.i18next = { t: (key, opts) => (opts?.labelType ? `${key}:${opts.labelType}` : key) };
  window.moment = (v) => v;
  loadClass('public/js/common/LabelTypePicker.js', 'LabelTypePicker');
  loadClass('public/js/validate/src/label/Label.js', 'Label');
  loadClass('public/js/validate/src/label/LabelContainer.js', 'LabelContainer');
});

beforeEach(() => {
  window.svv = { tagsByLabelType: TAGS_BY_TYPE, tracker: { push: jest.fn() } };
});

/** @returns {Label} An Obstacle label with a rating and two tags, as the backend would hand it over. */
function makeLabel(overrides = {}) {
  return new window.Label({
    label_id: 7, label_type: 'Obstacle', severity: 2, tags: ['pole', 'trash/recycling can'],
    heading: 0, pitch: 0, zoom: 1, canvas_x: 0, canvas_y: 0, pano_id: 'p', ...overrides,
  });
}

describe('Label.setNewLabelType re-bases the editable state on the picked type', () => {
  it('keeps the rating and the shared tags when the new type rates on the same scale', () => {
    const label = makeLabel();
    label.setNewLabelType('SurfaceProblem');

    expect(label.getProperty('newLabelType')).toBe('SurfaceProblem');
    expect(label.getProperty('newSeverity')).toBe(2);
    expect(label.getProperty('newTags')).toEqual(['pole']);
  });

  it('drops the rating when the new type rates on another scale or not at all', () => {
    const toQuality = makeLabel();
    toQuality.setNewLabelType('CurbRamp');
    expect(toQuality.getProperty('newSeverity')).toBeNull();
    expect(toQuality.getProperty('newTags')).toEqual([]);

    const toUnrated = makeLabel();
    toUnrated.setNewLabelType('Signal');
    expect(toUnrated.getProperty('newSeverity')).toBeNull();
  });

  it('picking the original type again restores the original rating and tags', () => {
    const label = makeLabel();
    label.setNewLabelType('CurbRamp');
    label.setNewLabelType('Obstacle');

    expect(label.getProperty('newSeverity')).toBe(2);
    expect(label.getProperty('newTags')).toEqual(['pole', 'trash/recycling can']);
    expect(label.getProperty('oldTags')).toEqual(['pole', 'trash/recycling can']);
  });

  it('the marker icon and color follow the picked type', () => {
    const label = makeLabel();
    expect(label.getIconUrl()).toContain('Obstacle_small.svg');
    label.setNewLabelType('SurfaceProblem');
    expect(label.getIconUrl()).toContain('SurfaceProblem_small.svg');
    expect(label.getIconColor()).toBe(window.util.misc.getLabelColors('SurfaceProblem'));
  });
});

describe('the submission names the type seen and the type picked', () => {
  let container;

  beforeEach(() => {
    window.svv.canvasHeight = () => 480;
    window.svv.canvasWidth = () => 720;
    window.svv.missionContainer = { getCurrentMission: () => ({ getProperty: () => 99 }) };
    window.svv.form = { getSource: () => 'ExpertValidate' };
    window.svv.panoManager = { getActiveViewerName: () => 'gsv' };
    container = new window.LabelContainer([], 'Obstacle');
  });

  it('sends label_type always and new_label_type only when the type changed', () => {
    const unchanged = makeLabel();
    unchanged.setProperty('validationResult', 'Agree');
    container.pushToLabelsToSubmit(7, unchanged.getProperties(), null);

    const changed = makeLabel({ label_id: 8 });
    changed.setNewLabelType('SurfaceProblem');
    changed.setProperty('validationResult', 'Agree');
    container.pushToLabelsToSubmit(8, changed.getProperties(), null);

    const [first, second] = container.getLabelsToSubmit();
    expect(first).toMatchObject({ label_type: 'Obstacle', new_label_type: null, severity: 2 });
    expect(second).toMatchObject({
      label_type: 'Obstacle', new_label_type: 'SurfaceProblem', validation_result: 'Agree', tags: ['pole'],
    });
  });
});

describe('LabelTypePicker', () => {
  let root;
  let picks;

  beforeEach(() => {
    document.body.innerHTML = '<div id="picker"></div>';
    root = document.getElementById('picker');
    picks = [];
  });

  it('draws one radio per stamped type, with the current type shown but not pickable', () => {
    const picker = new window.LabelTypePicker(root, { onPick: (t) => picks.push(t) });
    picker.render({ current: 'Obstacle' });

    const chips = [...root.querySelectorAll('[role="radio"]')];
    expect(root.getAttribute('role')).toBe('radiogroup');
    expect(chips.map((c) => c.dataset.labelType)).toEqual(window.util.misc.VALID_LABEL_TYPES);
    const current = chips.find((c) => c.dataset.labelType === 'Obstacle');
    expect(current.getAttribute('aria-disabled')).toBe('true');
    expect(current.getAttribute('aria-label')).toBe('common:label-type-picker.current:common:obstacle');
    expect(current.querySelector('img').getAttribute('src')).toContain('Obstacle_small.svg');

    current.click();
    expect(picks).toEqual([]);
    expect(picker.getSelected()).toBeNull();
  });

  it('a click picks a chip, checks it alone, and moves the Tab stop onto it', () => {
    const picker = new window.LabelTypePicker(root, { onPick: (t) => picks.push(t) });
    picker.render({ current: 'Obstacle' });

    root.querySelector('[data-label-type="SurfaceProblem"]').click();

    expect(picks).toEqual(['SurfaceProblem']);
    expect(picker.getSelected()).toBe('SurfaceProblem');
    const checked = [...root.querySelectorAll('[aria-checked="true"]')].map((c) => c.dataset.labelType);
    expect(checked).toEqual(['SurfaceProblem']);
    const tabStops = [...root.querySelectorAll('[tabindex="0"]')].map((c) => c.dataset.labelType);
    expect(tabStops).toEqual(['SurfaceProblem']);
  });

  it('arrow keys move between pickable chips, skipping the current type, and pick as they go', () => {
    const picker = new window.LabelTypePicker(root, { onPick: (t) => picks.push(t) });
    picker.render({ current: 'NoCurbRamp', selected: 'CurbRamp' });
    const chip = (t) => root.querySelector(`[data-label-type="${t}"]`);
    chip('CurbRamp').focus();

    chip('CurbRamp').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    // NoCurbRamp is next in the table but is the current type, so focus lands on Obstacle.
    expect(document.activeElement).toBe(chip('Obstacle'));
    expect(picks).toEqual(['Obstacle']);
    expect(picker.getSelected()).toBe('Obstacle');
  });

  it('keeps focus through a host that redraws on every pick, so arrowing carries on', () => {
    // What Expert Validate does: picking re-renders the whole group, which used to destroy the focused chip and drop
    // focus to the body, leaving the next arrow key with nothing to move from.
    const picker = new window.LabelTypePicker(root, {
      onPick: (t) => {
        picks.push(t);
        picker.render({ current: 'NoCurbRamp', selected: t });
      },
    });
    picker.render({ current: 'NoCurbRamp', selected: 'CurbRamp' });
    const chip = (t) => root.querySelector(`[data-label-type="${t}"]`);
    chip('CurbRamp').focus();

    chip('CurbRamp').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(chip('Obstacle'));

    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(chip('SurfaceProblem'));
    expect(picks).toEqual(['Obstacle', 'SurfaceProblem']);
  });

  it('an arrow key opens a folded group back up rather than moving between chips nobody can see', () => {
    const toggles = [];
    const picker = new window.LabelTypePicker(root, { onPick: (t) => picks.push(t), onToggle: (x) => toggles.push(x) });
    picker.render({ current: 'NoCurbRamp' });
    const chip = (t) => root.querySelector(`[data-label-type="${t}"]`);
    chip('Obstacle').click();
    picker.collapse();
    chip('Obstacle').focus();

    chip('Obstacle').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(root.classList.contains('label-type-picker--collapsed')).toBe(false);
    expect(toggles).toEqual([true]);
    expect(document.activeElement).toBe(chip('SurfaceProblem'));
  });

  it('collapse leaves only the picked chip, and clicking it opens the group again', () => {
    const toggles = [];
    const picker = new window.LabelTypePicker(root, { onPick: (t) => picks.push(t), onToggle: (x) => toggles.push(x) });
    picker.render({ current: 'Obstacle' });
    picker.collapse(); // Nothing picked yet, so nothing to fold down to.
    expect(root.querySelectorAll('[hidden]')).toHaveLength(0);

    root.querySelector('[data-label-type="Signal"]').click();
    picker.collapse();
    const visible = [...root.querySelectorAll('[role="radio"]:not([hidden])')].map((c) => c.dataset.labelType);
    expect(visible).toEqual(['Signal']);
    expect(root.classList.contains('label-type-picker--collapsed')).toBe(true);

    root.querySelector('[data-label-type="Signal"]').click();
    expect(root.querySelectorAll('[hidden]')).toHaveLength(0);
    expect(picks).toEqual(['Signal']); // Re-opening is not a pick.
    root.querySelector('[data-label-type="Signal"]').click();
    expect(root.querySelectorAll('[hidden]')).toHaveLength(window.util.misc.VALID_LABEL_TYPES.length - 1);
    expect(toggles).toEqual([true, false]);
  });

  it('render with a saved selection redraws it without firing onPick', () => {
    const picker = new window.LabelTypePicker(root, { onPick: (t) => picks.push(t) });
    picker.render({ current: 'Obstacle', selected: 'Signal' });

    expect(picks).toEqual([]);
    expect(root.querySelector('[aria-checked="true"]').dataset.labelType).toBe('Signal');
  });
});
