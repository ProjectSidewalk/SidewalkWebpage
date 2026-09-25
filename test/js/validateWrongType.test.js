/**
 * Tests for changing a label's type on Expert Validate (#3671, #5409), across the files loaded below.
 *
 * The way in is the "wrong label type" disagree reason, first for every type, or the type dropdown in the label card.
 * Either is stored as an Agree on the type the expert picks, so what must hold is: the label's editable severity and
 * tags follow the picked type by the same rules the server applies (a rating survives only on the same scale, a tag
 * only if the new type offers it), and the submission names both the type the validator saw and the one they picked.
 * The picker is checked as the radio group it claims to be, and the dropdown as the disclosure it is.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub, installUtilitiesMisc, REPO_ROOT } = require('./loadGlobalScript');

/**
 * Loads bare top-level declarations out of a production file into window scope.
 * @param {string} relPath - Path under the repo root.
 * @param {...string} names - The classes or functions the file declares.
 */
function loadClass(relPath, ...names) {
  const src = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
  window.eval(`${src}\n${names.map((n) => `window.${n} = ${n};`).join('\n')}`);
}

const TAGS_BY_TYPE = {
  Obstacle: [{ tag_name: 'pole' }, { tag_name: 'trash/recycling can' }],
  SurfaceProblem: [{ tag_name: 'pole' }, { tag_name: 'cracks' }],
  CurbRamp: [{ tag_name: 'narrow' }],
};

beforeAll(() => {
  window.matchMedia = () => /** @type {MediaQueryList} */ ({ matches: true }); // jsdom has none; act as a mouse.
  window.util = {
    assetPath: assetPathStub,
    isMobile: () => false,
    camelToKebab: (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
  };
  installUtilitiesMisc();
  // i18next echoes its key so assertions can name the key they expect rather than an English string.
  window.i18next = { t: (key, opts) => (opts?.labelType ? `${key}:${opts.labelType}` : key) };
  window.moment = (v) => v;
  loadClass('public/js/common/LabelTypePicker.js', 'LabelTypePicker', 'LabelTypeDropdown');
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

  it('arrows survive a pano viewer, which stops them dead at window', () => {
    // Every viewer registers a window-capture listener that stopPropagation()s the arrows so they don't steer the
    // imagery, and every page with this picker has a viewer. A listener on the group itself never sees the key.
    const viewer = (e) => { if (e.key.startsWith('Arrow')) e.stopPropagation(); };
    window.addEventListener('keydown', viewer, { capture: true });
    try {
      const picker = new window.LabelTypePicker(root, { onPick: (t) => picks.push(t) });
      picker.render({ current: 'NoCurbRamp', selected: 'CurbRamp' });
      const chip = (t) => root.querySelector(`[data-label-type="${t}"]`);
      chip('CurbRamp').focus();

      chip('CurbRamp').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

      expect(document.activeElement).toBe(chip('Obstacle'));
    } finally {
      window.removeEventListener('keydown', viewer, { capture: true });
    }
  });

  it('leaves the keys alone while focus is outside the group, since it listens window-wide', () => {
    const picker = new window.LabelTypePicker(root, { onPick: (t) => picks.push(t) });
    picker.render({ current: 'NoCurbRamp', selected: 'CurbRamp' });
    document.body.focus();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(picks).toEqual([]);
    expect(picker.getSelected()).toBe('CurbRamp');
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

  describe('where a pick takes effect at once (commitsOnPick, #5409)', () => {
    const chip = (t) => root.querySelector(`[data-label-type="${t}"]`);

    /** @returns {LabelTypePicker} A picker in a host that saves on every pick, as both popovers do. */
    function build() {
      const picker = new window.LabelTypePicker(root, { commitsOnPick: true, onPick: (t) => picks.push(t) });
      picker.render({ current: 'NoCurbRamp', selected: 'CurbRamp' });
      return picker;
    }

    it('arrow keys only move, so arrowing past a type does not save it', () => {
      const picker = build();
      chip('CurbRamp').focus();

      chip('CurbRamp').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

      expect(document.activeElement).toBe(chip('Obstacle'));
      expect(picks).toEqual([]);
      expect(picker.getSelected()).toBe('CurbRamp');
      // Tab has to come back to where the arrows left off, not to the chip that is still checked.
      const tabStops = [...root.querySelectorAll('[tabindex="0"]')].map((c) => c.dataset.labelType);
      expect(tabStops).toEqual(['Obstacle']);
    });

    it('the chip the arrows land on is picked by pressing it', () => {
      build();
      chip('CurbRamp').focus();
      chip('CurbRamp').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

      chip('Obstacle').click();

      expect(picks).toEqual(['Obstacle']);
    });

    it('picking the already-picked type picks it again rather than folding the group away', () => {
      build();

      chip('CurbRamp').click();

      expect(picks).toEqual(['CurbRamp']);
      expect(root.querySelectorAll('[hidden]')).toHaveLength(0);
    });
  });
});

describe('LabelTypeDropdown', () => {
  let opens;
  let picks;
  let closes;
  let allowOpen;

  /** @returns {LabelTypeDropdown} A dropdown over the markup components/labelTypeTrigger and labelTypePopover render. */
  function build({ hint = null } = {}) {
    document.body.innerHTML = `
      <h2 id="title">
        <span class="label-type-trigger label-type-trigger--static">
          <img class="label-type-trigger__icon" alt=""><span class="label-type-trigger__name"></span>
        </span>
        <button type="button" class="label-type-trigger label-type-trigger__button" hidden aria-expanded="false">
          <img class="label-type-trigger__icon" alt=""><span class="label-type-trigger__name"></span>
        </button>
      </h2>
      <div class="label-type-popover" popover hidden>
        <p class="label-type-popover__hint" hidden></p>
        <div class="label-type-popover__chips"></div>
      </div>`;
    const dropdown = new window.LabelTypeDropdown(
      document.getElementById('title'), document.querySelector('.label-type-popover'), {
        onOpen: () => {
          opens += 1;
          if (allowOpen) dropdown.picker.render({ current: 'Obstacle' });
          return allowOpen;
        },
        onPick: (t) => picks.push(t),
        onClose: () => { closes += 1; },
        hint,
      },
    );
    return dropdown;
  }

  const button = () => document.querySelector('.label-type-trigger__button');
  const popover = () => document.querySelector('.label-type-popover');
  const chip = (t) => popover().querySelector(`[data-label-type="${t}"]`);

  beforeEach(() => {
    opens = 0;
    picks = [];
    closes = 0;
    allowOpen = true;
  });

  it('draws the type into both titles and names the button for what it does', () => {
    const dropdown = build();
    dropdown.setType('Obstacle');

    const names = [...document.querySelectorAll('.label-type-trigger__name')].map((n) => n.textContent);
    expect(names).toEqual(['common:obstacle', 'common:obstacle']);
    expect(button().getAttribute('aria-label')).toBe('common:obstacle: common:label-type-picker.change-type');
    expect(button().querySelector('img').getAttribute('src')).toContain('Obstacle_small.svg');
  });

  it('shows the button only when editable', () => {
    const dropdown = build();
    const plain = document.querySelector('.label-type-trigger--static');
    expect(button().hidden).toBe(true);

    dropdown.setEditable(true);
    expect(button().hidden).toBe(false);
    expect(plain.hidden).toBe(true);

    dropdown.setEditable(false);
    expect(button().hidden).toBe(true);
    expect(plain.hidden).toBe(false);
  });

  it('opens on click, draws through onOpen, and a pick closes it before onPick runs', () => {
    const dropdown = build();
    dropdown.setEditable(true);

    button().click();
    expect(dropdown.isOpen()).toBe(true);
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(opens).toBe(1);
    expect(dropdown.contains(chip('Signal'))).toBe(true);

    chip('Signal').click();
    expect(picks).toEqual(['Signal']);
    expect(dropdown.isOpen()).toBe(false);
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(closes).toBe(1);
  });

  it('opening lands focus on a chip, and a pick made there hands it back to the button', () => {
    const dropdown = build();
    dropdown.setEditable(true);

    button().click();
    expect(popover().contains(document.activeElement)).toBe(true);

    /** @type {HTMLElement} */ (document.activeElement).click();
    expect(document.activeElement).toBe(button());
  });

  it('stays shut when onOpen refuses, or while disabled', () => {
    const dropdown = build();
    dropdown.setEditable(true);
    allowOpen = false;
    button().click();
    expect(dropdown.isOpen()).toBe(false);

    allowOpen = true;
    dropdown.setDisabled(true);
    button().click();
    expect(dropdown.isOpen()).toBe(false);
    expect(opens).toBe(1); // A disabled button never asks.
  });

  it('shows the hint only for a host that gives one', () => {
    build();
    expect(document.querySelector('.label-type-popover__hint').hidden).toBe(true);

    build({ hint: 'Tags may be removed.' });
    const hint = document.querySelector('.label-type-popover__hint');
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe('Tags may be removed.');
  });
});

describe('the disagree reasons (#5409)', () => {
  const EN = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'public/locales/en/validate.json'), 'utf8'));

  /** @returns {?string} The English string an i18next key resolves to, or null when the key is missing. */
  function resolve(key) {
    const [ns, rest] = key.split(':');
    if (ns !== 'validate') return 'not checked here';
    return rest.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : null), EN) ?? null;
  }

  beforeAll(() => {
    loadClass('public/js/validate/src/util/ConstantsValidate.js', 'defineValidateConstants');
  });

  beforeEach(() => {
    window.defineValidateConstants();
  });

  it('every type leads with "wrong label type", and no reason names a type of its own any more', () => {
    for (const [type, reasons] of Object.entries(window.svv.reasonButtonInfo)) {
      expect([type, reasons['no-button-1'].wrongType]).toEqual([type, true]);
      for (const info of Object.values(reasons)) expect(info).not.toHaveProperty('newLabelType');
    }
  });

  it('every reason still points at a string that exists, so the renumbering left nothing dangling', () => {
    const missing = [];
    for (const [type, reasons] of Object.entries(window.svv.reasonButtonInfo)) {
      for (const [id, info] of Object.entries(reasons)) {
        // The tooltip carries its shortcut number, once.
        const tooltipKey = info.tooltipText.replace(/ \(\d\)$/, '');
        for (const key of [info.buttonText, tooltipKey]) {
          if (resolve(key) === null) missing.push(`${type}.${id}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('there are never more disagree reasons than the four buttons the menu has', () => {
    for (const reasons of Object.values(window.svv.reasonButtonInfo)) {
      const ids = Object.keys(reasons).filter((id) => id.startsWith('no-button-'));
      expect(ids.every((id) => Number(id.split('-')[2]) <= 4)).toBe(true);
    }
  });
});

describe('DesktopValidationMenu on Expert Validate', () => {
  let menu;
  let label;

  beforeAll(() => {
    window.eval(fs.readFileSync(path.join(REPO_ROOT, 'public/vendor/tom-select/tom-select-2.6.2.base.min.js'), 'utf8'));
    window.util.getImage = () => Promise.resolve('img');
    window.structuredClone ??= (v) => JSON.parse(JSON.stringify(v)); // Missing from this jsdom.
    loadClass('public/js/validate/src/util/ConstantsValidate.js', 'defineValidateConstants');
    loadClass('public/js/validate/src/menu/DesktopValidationMenu.js', 'DesktopValidationMenu');
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="validate-yes-button"></button>
      <button id="validate-no-button"></button>
      <button id="validate-unsure-button"></button>
      <div id="validate-label-type-section"><div id="label-type-picker"></div></div>
      <div class="current-tag template"><div class="tag-name"></div><button class="remove-tag-x"></button></div>
      <div id="validate-tags-section">
        <div id="current-tags-list"></div>
        <div id="sidewalk-ai-suggestions-block"><div class="sidewalk-ai-suggested-tag template"></div></div>
        <select id="select-tag"></select>
      </div>
      <div id="validate-severity-section"></div>
      <div id="validate-optional-comment-section"><input id="add-optional-comment"></div>
      <div id="validate-why-no-section"><div id="no-reason-options">
        ${[1, 2, 3, 4].map((n) => `<button id="no-button-${n}" class="validation-reason-button"></button>`).join('')}
        <input id="add-disagree-comment">
      </div></div>
      <div id="validate-why-unsure-section"><div id="unsure-reason-options">
        ${[1, 2, 3].map((n) => `<button id="unsure-button-${n}" class="validation-reason-button"></button>`).join('')}
        <input id="add-unsure-comment">
      </div></div>
      <button id="validate-submit-button" disabled></button>`;

    label = makeLabel({ ai_tags: null, ai_tags_not_present: null });
    Object.assign(window.svv, {
      adminVersion: true,
      labelContainer: { getCurrentLabel: () => label, dropInputWhileLoading: () => false },
      panoManager: { styleMarkerForLabel: jest.fn() },
      labelCard: { render: jest.fn() },
    });
    window.defineValidateConstants();

    const byId = (id) => document.getElementById(id);
    menu = new window.DesktopValidationMenu({
      yesButton: byId('validate-yes-button'),
      noButton: byId('validate-no-button'),
      unsureButton: byId('validate-unsure-button'),
      labelTypeMenu: byId('validate-label-type-section'),
      labelTypePicker: byId('label-type-picker'),
      tagsMenu: byId('validate-tags-section'),
      severityMenu: byId('validate-severity-section'),
      optionalCommentSection: byId('validate-optional-comment-section'),
      optionalCommentTextBox: byId('add-optional-comment'),
      noMenu: byId('validate-why-no-section'),
      disagreeReasonOptions: byId('no-reason-options'),
      disagreeReasonTextBox: byId('add-disagree-comment'),
      unsureMenu: byId('validate-why-unsure-section'),
      unsureReasonOptions: byId('unsure-reason-options'),
      unsureReasonTextBox: byId('add-unsure-comment'),
      submitButton: byId('validate-submit-button'),
      currentTags: byId('current-tags-list'),
      aiSuggestionSection: byId('sidewalk-ai-suggestions-block'),
      aiSuggestedTagTemplate: document.querySelector('.sidewalk-ai-suggested-tag.template'),
    });
    menu.resetMenu(label);
  });

  const shown = (id) => document.getElementById(id).style.display === 'block';
  const submitDisabled = () => document.getElementById('validate-submit-button').disabled;

  it('Agree still renders a label that carries AI tag suggestions', () => {
    label = makeLabel({ tags: ['pole'], ai_tags: ['trash/recycling can'], ai_tags_not_present: ['pole'] });
    menu.resetMenu(label);

    document.getElementById('validate-yes-button').click();

    expect(label.getProperty('validationResult')).toBe('Agree');
    expect(document.querySelectorAll('.sidewalk-ai-suggested-tag:not(.template)')).toHaveLength(2);
    expect(submitDisabled()).toBe(false);
  });

  it('the "wrong label type" reason swaps the reasons for the type picker under a chosen Disagree', () => {
    document.getElementById('validate-no-button').click();
    document.getElementById('no-button-1').click();

    expect(document.getElementById('validate-no-button').classList.contains('chosen')).toBe(true);
    expect(shown('validate-label-type-section')).toBe(true);
    expect(shown('validate-why-no-section')).toBe(false);
    expect(label.getProperty('validationResult')).toBe('Agree');
    expect(label.getProperty('disagreeOption')).toBeNull();
    expect(submitDisabled()).toBe(true); // Nothing to submit until a type is picked.
  });

  it('a pick from the label card lands as the same disagree with the type already picked', () => {
    menu.pickNewLabelType('SurfaceProblem');

    expect(label.getProperty('newLabelType')).toBe('SurfaceProblem');
    expect(label.getProperty('validationResult')).toBe('Agree');
    expect(document.getElementById('validate-no-button').classList.contains('chosen')).toBe(true);
    expect(shown('validate-tags-section')).toBe(true);
    expect(submitDisabled()).toBe(false);
    expect(window.svv.panoManager.styleMarkerForLabel).toHaveBeenCalledWith(label);
    expect(window.svv.labelCard.render).toHaveBeenCalledWith(label);
  });

  it('going back to Disagree puts the label back on its own type and brings the reasons back', () => {
    menu.pickNewLabelType('SurfaceProblem');
    document.getElementById('validate-no-button').click();

    expect(label.getProperty('newLabelType')).toBe('Obstacle');
    expect(label.getProperty('validationResult')).toBe('Disagree');
    expect(shown('validate-why-no-section')).toBe(true);
    expect(shown('validate-label-type-section')).toBe(false);
    expect(window.svv.labelCard.render).toHaveBeenLastCalledWith(label);
  });

  it('on regular Validate the reason is a plain disagree reason', () => {
    window.svv.adminVersion = false;
    document.getElementById('validate-no-button').click();
    document.getElementById('no-button-1').click();

    expect(label.getProperty('disagreeOption')).toBe('no-button-1');
    expect(label.getProperty('validationResult')).toBe('Disagree');
    expect(shown('validate-why-no-section')).toBe(true);
  });
});
