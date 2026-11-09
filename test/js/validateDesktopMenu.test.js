/**
 * Tests for desktop Validate's verdict menu (frontend/js/validate/menu/DesktopValidationMenu.js): the Agree / Disagree
 * / Unsure buttons and the sections each opens, the canned and typed reasons, what Submit hands the label container,
 * how a label returned to by Back is redrawn, and Expert Validate's tag, severity and label type editors. Every
 * interaction is logged under its own name for a mouse click and a keyboard shortcut, and every write to the label
 * is refused while the next label is still loading (#5211), so both are checked as they come up (#5840).
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker } from './fakes.js';
import { flush } from './support/routeFetch.js';
import { renderDesktopMenu, trustedClick } from './support/desktopValidationMenuHarness.js';

// Echoes the key, with the tag name a string is about appended, so assertions name the string they expect.
mockModule('i18next', () => ({
  default: { t: (key, opts) => (opts?.tag ? `${key}:${opts.tag}` : key) },
}));

/** The city's tags per label type, in the shape the server sends them (LabelFormats.tagWrites). */
const TAGS_BY_TYPE = {
  Obstacle: [
    { tag_id: 10, label_type: 'Obstacle', tag_name: 'pole' },
    { tag_id: 24, label_type: 'Obstacle', tag_name: 'parked car' },
    { tag_id: 11, label_type: 'Obstacle', tag_name: 'tree' },
  ],
  CurbRamp: [
    { tag_id: 3, label_type: 'CurbRamp', tag_name: 'missing tactile warning',
      mutually_exclusive_with: 'tactile warning' },
    { tag_id: 55, label_type: 'CurbRamp', tag_name: 'tactile warning',
      mutually_exclusive_with: 'missing tactile warning' },
  ],
  Signal: [{ tag_id: 67, label_type: 'Signal', tag_name: 'one button' }],
};

let Label;
let DesktopValidationMenu;
let buildReasonButtonInfo;

beforeAll(async () => {
  window.structuredClone ??= (v) => JSON.parse(JSON.stringify(v)); // Missing from this jsdom.
  ({ Label, DesktopValidationMenu, buildReasonButtonInfo } = await loadModules(
    'frontend/js/validate/util/ConstantsValidate.js',
    'frontend/js/validate/label/Label.js',
    'frontend/js/validate/menu/DesktopValidationMenu.js',
  ));
});

let ui;
let config;
let label;
let loading;
let renderedAt;
let tracker;
let labelContainer;
let labelCard;
let panoManager;
let menu;

beforeEach(() => {
  window.matchMedia = () => /** @type {MediaQueryList} */ ({ matches: true }); // jsdom has none; act as a mouse.
  loading = false;
  renderedAt = Date.now() - 5000; // Long enough ago that a verdict counts.
  tracker = fakeTracker();
  labelContainer = {
    getCurrentLabel: () => label,
    dropInputWhileLoading: vi.fn(() => loading),
    onLabelReady: vi.fn(),
    getProperty: (name) => (name === 'renderedTimestamp' ? renderedAt : undefined),
    validateCurrentLabel: vi.fn(),
  };
  labelCard = { render: vi.fn(), onTypePicked: vi.fn() };
  panoManager = { styleMarkerForLabel: vi.fn() };
});

/**
 * @param {object} [overrides] - Fields to replace on the server's label.
 * @returns {Label} A label as Validate's mission hands it over.
 */
function makeLabel(overrides = {}) {
  return new Label({
    label_id: 7, label_type: 'Obstacle', severity: 2, tags: [], ai_tags: null, ai_tags_not_present: null,
    heading: 0, pitch: 0, zoom: 1, canvas_x: 0, canvas_y: 0, pano_id: 'p', ...overrides,
  }, config);
}

/**
 * Draws the page, builds the menu on it, and shows it a first label the way the label container would.
 * @param {{adminVersion?: boolean, label?: object}} [opts] - Expert Validate or not, and the label's server fields.
 */
function setUp({ adminVersion = false, label: labelFields = {} } = {}) {
  ui = renderDesktopMenu({ adminVersion });
  config = { adminVersion, tagsByLabelType: TAGS_BY_TYPE };
  label = makeLabel(labelFields);
  menu = new DesktopValidationMenu(
    ui, config, buildReasonButtonInfo(), labelContainer, labelCard, panoManager, tracker,
  );
  labelContainer.onLabelReady.mock.calls[0][0](label);
}

/** @returns {string[]} The menu sections on show, by element id. */
const shownSections = () => [
  'labelTypeMenu', 'tagsMenu', 'severityMenu', 'optionalCommentSection', 'noMenu', 'unsureMenu',
].filter((name) => ui[name]?.style.display === 'block').map((name) => ui[name].id);
/** @returns {string[]} The ids of the buttons marked chosen. */
const chosen = () => [...document.querySelectorAll('.is-chosen')].map((el) => el.id);
const byId = (id) => document.getElementById(id);

describe('the verdict buttons', () => {
  beforeEach(() => setUp());

  test.each([
    ['yes', 'Agree', ['validate-optional-comment-section']],
    ['no', 'Disagree', ['validate-why-no-section']],
    ['unsure', 'Unsure', ['validate-why-unsure-section']],
  ])('%s records %s, opens its section and lets Submit go', (button, verdict, sections) => {
    trustedClick(byId(`validate-${button}-button`));

    expect(label.getProperty('validationResult')).toBe(verdict);
    expect(shownSections()).toEqual(sections);
    expect(chosen()).toEqual([`validate-${button}-button`]);
    expect(ui.holder.classList.contains('has-verdict')).toBe(true);
    expect(ui.submitButton.disabled).toBe(false);
    expect(tracker.push).toHaveBeenCalledWith(`ValidationButtonClick_${verdict}`);
  });

  test.each([['yes', 'Agree'], ['no', 'Disagree'], ['unsure', 'Unsure']])(
    'a keyboard shortcut on %s logs as a shortcut', (button, verdict) => {
      byId(`validate-${button}-button`).click();
      expect(tracker.push).toHaveBeenCalledWith(`ValidationKeyboardShortcut_${verdict}`);
    },
  );

  test.each([['yes', 'Agree'], ['no', 'Disagree'], ['unsure', 'Unsure']])(
    '%s pressed while the next label loads is dropped', (button, verdict) => {
      loading = true;
      byId(`validate-${button}-button`).click();

      expect(labelContainer.dropInputWhileLoading).toHaveBeenCalledWith(verdict);
      expect(label.getProperty('validationResult')).toBeUndefined();
      expect(tracker.push).not.toHaveBeenCalled();
      expect(shownSections()).toEqual([]);
    },
  );

  test('a new label starts with nothing chosen and Submit off', () => {
    expect(shownSections()).toEqual([]);
    expect(chosen()).toEqual([]);
    expect(ui.holder.classList.contains('has-verdict')).toBe(false);
    expect(ui.submitButton.disabled).toBe(true);
  });
});

describe('the reason buttons follow the label type', () => {
  test('an Obstacle offers its three disagree reasons, hides the fourth button, and shows example images', async () => {
    setUp();
    await flush();

    const noButtons = [1, 2, 3, 4].map((n) => byId(`no-button-${n}`));
    expect(noButtons.map((b) => b.style.display)).toEqual(['flex', 'flex', 'flex', 'none']);
    expect(noButtons.map((b) => b.classList.contains('defaultOption'))).toEqual([true, true, true, false]);
    expect(noButtons[1].textContent).toBe('common:validation-reason.not-pedestrian-path.text');
    expect(noButtons[1].getAttribute('data-ps-tooltip-html')).toContain('ObstacleDisagree1.png');
  });

  test('a reason with no example image gets a text-only tooltip', () => {
    setUp({ label: { label_type: 'Crosswalk' } });

    const tooltip = byId('no-button-1').getAttribute('data-ps-tooltip-html');
    expect(tooltip).toBe('common:validation-reason.wrong-type.tooltip-crosswalk (1)');
    expect(byId('unsure-button-3').style.display).toBe('none'); // Crosswalk has two unsure reasons.
  });

  test('a touch device gets no tooltips, which a tap would pin open', async () => {
    window.matchMedia = () => /** @type {MediaQueryList} */ ({ matches: false });
    setUp({ label: { label_type: 'Crosswalk' } });
    await flush();

    expect(document.querySelectorAll('[data-ps-tooltip-html]')).toHaveLength(0);
  });

  test('a button the next label\'s type does not offer loses the shortcut flag it had', () => {
    setUp({ label: { label_type: 'Crosswalk' } });
    expect(byId('no-button-4').classList.contains('defaultOption')).toBe(true);

    label = makeLabel({ label_type: 'Obstacle' });
    menu.resetMenu(label);

    expect(byId('no-button-4').classList.contains('defaultOption')).toBe(false);
  });
});

describe.each([
  ['disagree', 'no', 'Disagree', 'add-disagree-comment', 'disagreeOption', 'DisagreeReason'],
  ['unsure', 'unsure', 'Unsure', 'add-unsure-comment', 'unsureOption', 'UnsureReason'],
])('picking a %s reason', (_, prefix, verdict, boxId, property, source) => {
  beforeEach(() => {
    setUp();
    byId(`validate-${prefix}-button`).click();
  });

  test('a canned reason is stored by its button and marked, and empties the typed box', () => {
    byId(boxId).value = 'leftover';
    trustedClick(byId(`${prefix}-button-2`));

    expect(label.getProperty(property)).toBe(`${prefix}-button-2`);
    expect(chosen()).toEqual([`validate-${prefix}-button`, `${prefix}-button-2`]);
    expect(byId(boxId).value).toBe('');
    expect(tracker.push).toHaveBeenCalledWith(`Click=${source}_Option=${prefix}-button-2`);
  });

  test('a keyboard shortcut picks the same way and logs as a shortcut', () => {
    byId(`${prefix}-button-3`).click();

    expect(label.getProperty(property)).toBe(`${prefix}-button-3`);
    expect(tracker.push).toHaveBeenCalledWith(`KeyboardShortcut_${source}_Option=${prefix}-button-3`);
  });

  test('typing a reason unpicks the canned one, and emptying the box forgets it', () => {
    byId(`${prefix}-button-2`).click();
    const box = byId(boxId);

    box.value = 'blocked by scaffolding';
    box.dispatchEvent(new Event('input'));
    expect(label.getProperty(property)).toBe('other');
    expect(chosen()).toEqual([`validate-${prefix}-button`, boxId]);

    box.value = '';
    box.dispatchEvent(new Event('input'));
    expect(label.getProperty(property)).toBeUndefined();
    expect(chosen()).toEqual([`validate-${prefix}-button`]);
  });

  test('a reason or typing while the next label loads is dropped', () => {
    loading = true;
    byId(`${prefix}-button-2`).click();
    byId(boxId).value = 'typed';
    byId(boxId).dispatchEvent(new Event('input'));

    expect(label.getProperty(property)).toBeUndefined();
    expect(chosen()).toEqual([`validate-${prefix}-button`]);
    expect(labelContainer.dropInputWhileLoading).toHaveBeenCalledWith(source);
    expect(tracker.push).not.toHaveBeenCalledWith(expect.stringContaining('_Option='));
  });

  test(`Submit sends the canned reason's text and id with a ${verdict}`, () => {
    byId(`${prefix}-button-2`).innerHTML = 'Two<br>lines';
    byId(`${prefix}-button-2`).click();
    trustedClick(ui.submitButton);

    expect(labelContainer.validateCurrentLabel).toHaveBeenCalledWith(verdict, expect.any(Date), 'Two lines');
    const reasonIds = { Disagree: 'not-pedestrian-path', Unsure: 'placement-incorrect' };
    expect(label.getProperty('reasonId')).toBe(reasonIds[verdict]);
    expect(tracker.push).toHaveBeenCalledWith(`Click=Submit_Validation=${verdict}`);
  });

  test(`Submit sends the typed reason with a ${verdict}, and keeps it on the label for Back`, () => {
    byId(boxId).value = 'blocked by scaffolding';
    byId(boxId).dispatchEvent(new Event('input'));
    ui.submitButton.click();

    expect(labelContainer.validateCurrentLabel)
      .toHaveBeenCalledWith(verdict, expect.any(Date), 'blocked by scaffolding');
    expect(label.getProperty('reasonId')).toBeNull();
    expect(label.getProperty(`${prefix === 'no' ? 'disagree' : 'unsure'}ReasonTextBox`)).toBe('blocked by scaffolding');
    expect(tracker.push).toHaveBeenCalledWith(`ValidationKeyboardShortcut_Submit_Validation=${verdict}`);
  });

  test(`Submit sends a ${verdict} with no reason as an empty comment`, () => {
    ui.submitButton.click();

    expect(labelContainer.validateCurrentLabel).toHaveBeenCalledWith(verdict, expect.any(Date), '');
    expect(label.getProperty('reasonId')).toBeNull();
  });
});

describe('the text boxes', () => {
  beforeEach(() => setUp());

  test.each([
    ['add-optional-comment', 'yes', 'AgreeCommentTextbox'],
    ['add-disagree-comment', 'no', 'DisagreeReasonTextbox'],
    ['add-unsure-comment', 'unsure', 'UnsureReasonTextbox'],
  ])('%s takes focus on a shortcut and logs how it was reached', (id, verdictButton, name) => {
    byId(`validate-${verdictButton}-button`).click(); // jsdom won't focus a box in a hidden section.
    byId(id).click();
    expect(document.activeElement).toBe(byId(id));
    expect(tracker.push).toHaveBeenCalledWith(`KeyboardShortcut=${name}`);

    trustedClick(byId(id));
    expect(tracker.push).toHaveBeenCalledWith(`Click=${name}`);
  });
});

describe('Submit', () => {
  beforeEach(() => setUp());

  test('an Agree carries the optional comment', () => {
    byId('validate-yes-button').click();
    ui.optionalCommentTextBox.value = 'clear photo';
    ui.submitButton.click();

    expect(labelContainer.validateCurrentLabel).toHaveBeenCalledWith('Agree', expect.any(Date), 'clear photo');
    expect(label.getProperty('comment')).toBe('clear photo');
  });

  test('does nothing while there is no verdict to send', () => {
    ui.submitButton.click();

    expect(labelContainer.validateCurrentLabel).not.toHaveBeenCalled();
    expect(tracker.push).not.toHaveBeenCalled();
  });

  // Older browsers hand a click on a disabled button's child (the underlined shortcut letter) to the child, and it
  // bubbles up to the button's listener even though the button itself would never fire.
  test('a click that reaches a disabled Submit through its underlined letter sends nothing', () => {
    ui.submitButton.querySelector('u').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(labelContainer.validateCurrentLabel).not.toHaveBeenCalled();
    expect(tracker.push).not.toHaveBeenCalled();
  });

  test('right after the label appears it is taken as a double tap and only logged', () => {
    byId('validate-yes-button').click();
    renderedAt = Date.now();
    ui.submitButton.click();

    expect(labelContainer.validateCurrentLabel).not.toHaveBeenCalled();
    expect(tracker.push).toHaveBeenCalledWith('ValidateInputDropped_Debounce', {
      source: 'Submit=Agree', sinceMs: expect.any(Number),
    });
  });

  test('while the next label loads it is dropped before it logs anything', () => {
    byId('validate-yes-button').click();
    loading = true;
    ui.submitButton.click();

    expect(labelContainer.dropInputWhileLoading).toHaveBeenCalledWith('Submit=Agree');
    expect(labelContainer.validateCurrentLabel).not.toHaveBeenCalled();
    expect(tracker.push).not.toHaveBeenCalledWith(expect.stringContaining('Submit_Validation'));
  });
});

describe('going Back to a label redraws the answer it was given', () => {
  beforeEach(() => setUp());

  /**
   * Shows the menu a label as Back returns it: with the verdict and what was entered for it.
   * @param {object} props - Label properties to set before it is shown.
   */
  function returnTo(props) {
    label = makeLabel();
    for (const [name, value] of Object.entries(props)) label.setProperty(name, value);
    menu.resetMenu(label);
  }

  test('an Agree, with its comment', () => {
    returnTo({ validationResult: 'Agree', agreeComment: 'clear photo' });

    expect(chosen()).toEqual(['validate-yes-button']);
    expect(ui.optionalCommentTextBox.value).toBe('clear photo');
    expect(ui.submitButton.disabled).toBe(false);
  });

  test('a Disagree with a canned reason', () => {
    returnTo({ validationResult: 'Disagree', disagreeOption: 'no-button-3' });

    expect(chosen()).toEqual(['validate-no-button', 'no-button-3']);
    expect(shownSections()).toEqual(['validate-why-no-section']);
    expect(ui.disagreeReasonTextBox.value).toBe('');
  });

  test('a Disagree with a typed reason', () => {
    returnTo({ validationResult: 'Disagree', disagreeOption: 'other', disagreeReasonTextBox: 'too blurry' });

    expect(chosen()).toEqual(['validate-no-button', 'add-disagree-comment']);
    expect(ui.disagreeReasonTextBox.value).toBe('too blurry');
  });

  test('an Unsure with a canned reason', () => {
    returnTo({ validationResult: 'Unsure', unsureOption: 'unsure-button-1' });

    expect(chosen()).toEqual(['validate-unsure-button', 'unsure-button-1']);
    expect(shownSections()).toEqual(['validate-why-unsure-section']);
  });

  test('an Unsure with a typed reason', () => {
    returnTo({ validationResult: 'Unsure', unsureOption: 'other', unsureReasonTextBox: 'dark' });

    expect(chosen()).toEqual(['validate-unsure-button', 'add-unsure-comment']);
    expect(ui.unsureReasonTextBox.value).toBe('dark');
  });

  test('a fresh label after one with answers clears every trace of them', () => {
    returnTo({ validationResult: 'Disagree', disagreeOption: 'other', disagreeReasonTextBox: 'too blurry' });
    ui.optionalCommentTextBox.value = 'stale';

    label = makeLabel();
    menu.resetMenu(label);

    expect(chosen()).toEqual([]);
    expect(ui.disagreeReasonTextBox.value).toBe('');
    expect(ui.optionalCommentTextBox.value).toBe('');
    expect(ui.submitButton.disabled).toBe(true);
  });
});

describe('Expert Validate\'s editors', () => {
  /** @returns {string[]} The tag pills on the label, by their shown name. */
  const tagPills = () => [...ui.currentTags.querySelectorAll('.tag-name')].map((el) => el.textContent);
  /** @returns {object} The tag search box's TomSelect, which hangs itself on the select it replaces. */
  const tagSelect = () => /** @type {any} */ (byId('select-tag')).tomselect;
  /** @returns {string[]} The AI suggestions on show, as their text. */
  const suggestions = () => [...document.querySelectorAll('.sidewalk-ai-suggested-tag:not(template *)')]
    .map((el) => el.textContent);

  describe('tags', () => {
    test('Agree shows the label\'s tags, and a tag the city no longer offers is left out', () => {
      setUp({ adminVersion: true, label: { tags: ['pole', 'retired tag'] } });
      byId('validate-yes-button').click();

      expect(shownSections()).toEqual(['validate-tags-section', 'validate-severity-section',
        'validate-optional-comment-section']);
      expect(tagPills()).toEqual(['common:tag.pole']);
      expect(ui.currentTags.style.display).toBe('flex');
      expect(ui.currentTags.querySelector('.remove-tag-x').getAttribute('aria-label'))
        .toBe('validate:validate-menu.remove-tag:common:tag.pole');
      expect(Object.keys(tagSelect().options).sort()).toEqual(['parked car', 'tree']);
    });

    test('a label with no tags hides the empty list', () => {
      setUp({ adminVersion: true });
      byId('validate-yes-button').click();
      expect(ui.currentTags.style.display).toBe('none');
    });

    test('a type the city has no tags for offers none', () => {
      setUp({ adminVersion: true, label: { label_type: 'NoSidewalk' } });
      byId('validate-yes-button').click();
      expect(Object.keys(tagSelect().options)).toEqual([]);
    });

    test('picking a tag from the search adds it, logs it, and takes it out of the search', () => {
      setUp({ adminVersion: true });
      byId('validate-yes-button').click();

      tagSelect().addItem('tree');

      expect(label.getProperty('newTags')).toEqual(['tree']);
      expect(tagPills()).toEqual(['common:tag.tree']);
      expect(Object.keys(tagSelect().options).sort()).toEqual(['parked car', 'pole']);
      expect(tracker.push).toHaveBeenCalledWith('Click=TagAdd_Tag="tree"_FromAiSuggestion=false');
      expect(labelCard.render).toHaveBeenLastCalledWith(label);
    });

    test('a tag that rules out one already on the label takes that one off', () => {
      setUp({ adminVersion: true, label: { label_type: 'CurbRamp', tags: ['missing tactile warning'] } });
      byId('validate-yes-button').click();

      tagSelect().addItem('tactile warning');

      expect(label.getProperty('newTags')).toEqual(['tactile warning']);
      expect(tracker.push).toHaveBeenCalledWith('TagAutoRemove_Tag="missing tactile warning"');
    });

    test('the remove X takes a tag off and logs it', () => {
      setUp({ adminVersion: true, label: { tags: ['pole', 'tree'] } });
      byId('validate-yes-button').click();

      ui.currentTags.querySelector('.remove-tag-x').click();

      expect(label.getProperty('newTags')).toEqual(['tree']);
      expect(tagPills()).toEqual(['common:tag.tree']);
      expect(tracker.push).toHaveBeenCalledWith('Click=TagRemove_Tag="pole"_FromAiSuggestion=false');
    });

    test('a tag picked or removed while the next label loads is dropped', () => {
      setUp({ adminVersion: true, label: { tags: ['pole'] } });
      byId('validate-yes-button').click();
      loading = true;

      tagSelect().addItem('tree');
      ui.currentTags.querySelector('.remove-tag-x').click();

      expect(label.getProperty('newTags')).toEqual(['pole']);
      expect(labelContainer.dropInputWhileLoading).toHaveBeenCalledWith('TagAdd');
      expect(labelContainer.dropInputWhileLoading).toHaveBeenCalledWith('TagRemove');
    });

    test('focusing the search is logged', () => {
      setUp({ adminVersion: true });
      byId('validate-yes-button').click(); // jsdom won't focus a box in a hidden section.
      tagSelect().control_input.focus();
      expect(tracker.push).toHaveBeenCalledWith('Click=TagSearch');
    });

    test('a tag clicked in the list leaves the box, so the letter keys are shortcuts again (#5946)', () => {
      setUp({ adminVersion: true });
      byId('validate-yes-button').click();
      const search = tagSelect();
      search.control_input.focus();
      search.open();
      search.refreshOptions(false);

      search.dropdown_content.querySelector('[data-value="tree"]').click();

      expect(label.getProperty('newTags')).toEqual(['tree']);
      expect(document.activeElement).not.toBe(search.control_input);
      expect(search.isOpen).toBe(false);
    });

    test('a tag picked by Enter keeps the box, for adding another', () => {
      setUp({ adminVersion: true });
      byId('validate-yes-button').click();
      const search = tagSelect();
      search.control_input.focus();
      search.open();
      search.refreshOptions(false);
      search.setActiveOption(search.getOption('tree'));

      search.control_input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));

      expect(label.getProperty('newTags')).toEqual(['tree']);
      expect(document.activeElement).toBe(search.control_input);
    });

    test('the search lists each option as a pill with an example, and says when nothing matches', () => {
      setUp({ adminVersion: true });
      byId('validate-yes-button').click();
      const search = tagSelect();

      search.open();
      search.refreshOptions(false);
      const option = search.dropdown_content.querySelector('.tag-pill');
      expect(option.textContent).toBe('common:tag.pole');
      expect(option.getAttribute('data-ps-tooltip-html')).toContain('images/examples/tags/10.png');

      search.setTextboxValue('zzz');
      search.refreshOptions(false);
      expect(search.dropdown_content.textContent).toBe('validate:validate-menu.tag-search-no-results');
    });
  });

  describe('AI tag suggestions', () => {
    test('suggest adding a missing tag and removing one the AI saw no sign of, and log both', () => {
      setUp({ adminVersion: true, label: { tags: ['pole'], ai_tags: ['tree'], ai_tags_not_present: ['pole'] } });
      byId('validate-yes-button').click();

      expect(ui.aiSuggestionSection.style.display).toBe('');
      expect(suggestions()).toEqual(['expert-validate.add-tag:common:tag.tree',
        'expert-validate.remove-tag:common:tag.pole']);
      expect(tracker.push).toHaveBeenCalledWith('ShowingAiSuggestions', { add: '"tree"', remove: '"pole"' });
    });

    test('accepting an add suggestion adds the tag, logged as from the AI', () => {
      setUp({ adminVersion: true, label: { ai_tags: ['tree'] } });
      byId('validate-yes-button').click();

      document.querySelector('.sidewalk-ai-suggested-tag.to-add').click();

      expect(label.getProperty('newTags')).toEqual(['tree']);
      expect(tracker.push).toHaveBeenCalledWith('Click=TagAdd_Tag="tree"_FromAiSuggestion=true');
      expect(suggestions()).toEqual([]);
    });

    test('accepting a remove suggestion removes the tag, logged as from the AI', () => {
      setUp({ adminVersion: true, label: { tags: ['pole'], ai_tags_not_present: ['pole'] } });
      byId('validate-yes-button').click();

      document.querySelector('.sidewalk-ai-suggested-tag.to-remove').click();

      expect(label.getProperty('newTags')).toEqual([]);
      expect(tracker.push).toHaveBeenCalledWith('Click=TagRemove_Tag="pole"_FromAiSuggestion=true');
    });

    test('accepting a suggestion while the next label loads is dropped', () => {
      setUp({ adminVersion: true, label: { ai_tags: ['tree'] } });
      byId('validate-yes-button').click();
      loading = true;

      document.querySelector('.sidewalk-ai-suggested-tag.to-add').click();

      expect(label.getProperty('newTags')).toEqual([]);
    });

    test('never suggest removing a tag the validator just added, or one the city no longer offers', () => {
      setUp({ adminVersion: true, label: { tags: ['retired tag'], ai_tags_not_present: ['tree', 'retired tag'] } });
      byId('validate-yes-button').click();

      tagSelect().addItem('tree');

      expect(suggestions()).toEqual([]);
      expect(ui.aiSuggestionSection.style.display).toBe('none');
    });

    test('a picked label type hides them, since the AI judged the original type', () => {
      setUp({ adminVersion: true, label: { ai_tags: ['tree'] } });
      menu.pickNewLabelType('SurfaceProblem');
      expect(suggestions()).toEqual([]);
    });
  });

  describe('severity', () => {
    test('a problem type reads as severity, with the label\'s rating checked and its smiley filled', () => {
      setUp({ adminVersion: true });
      byId('validate-yes-button').click();

      expect(byId('validate-severity-header').textContent).toBe('common:update-severity-level');
      expect([...document.querySelectorAll('.severity-button__label')].map((el) => el.textContent))
        .toEqual(['common:low', 'common:medium', 'common:high']);
      expect(document.querySelector('#severity-button-2 .severity-button__icon').getAttribute('src'))
        .toContain('sev-2-negative-filled.svg');
      expect(byId('validate-severity-radio-2').checked).toBe(true);
      expect(byId('severity-button-1').getAttribute('data-ps-tooltip-html'))
        .toContain('images/examples/severity/Obstacle_Severity1.png');
    });

    test('a feature type reads as quality', () => {
      setUp({ adminVersion: true, label: { label_type: 'CurbRamp' } });
      byId('validate-yes-button').click();

      expect(byId('validate-severity-header').textContent).toBe('common:update-quality-level');
      expect(byId('severity-button-1').getAttribute('data-ps-tooltip-html'))
        .toContain('common:quality-example-tooltip-1');
    });

    test('an unrated type shows no severity, and a stray rating click does nothing', () => {
      setUp({ adminVersion: true, label: { label_type: 'Signal', severity: null } });
      byId('validate-yes-button').click();
      expect(shownSections()).toEqual(['validate-tags-section', 'validate-optional-comment-section']);

      byId('severity-button-3').click();

      expect(label.getProperty('newSeverity')).toBeNull();
      expect(tracker.push).not.toHaveBeenCalledWith(expect.stringContaining('Severity_Old'));
    });

    test('clicking the rating already given changes and logs nothing', () => {
      setUp({ adminVersion: true });
      byId('validate-yes-button').click();

      byId('severity-button-2').click();

      expect(tracker.push).not.toHaveBeenCalledWith(expect.stringContaining('Severity_Old'));
      expect(labelCard.render).not.toHaveBeenCalled();
    });

    test('a rating clicked while the next label loads is dropped', () => {
      setUp({ adminVersion: true });
      byId('validate-yes-button').click();
      loading = true;

      byId('severity-button-3').click();

      expect(label.getProperty('newSeverity')).toBe(2);
      expect(labelContainer.dropInputWhileLoading).toHaveBeenCalledWith('Severity');
    });
  });

  describe('the "wrong label type" disagree', () => {
    /** @returns {HTMLElement} The picker's chip for a type. */
    const chip = (labelType) => ui.labelTypePicker.querySelector(`[data-label-type="${labelType}"]`);

    beforeEach(() => {
      setUp({ adminVersion: true, label: { tags: ['pole'] } });
      byId('validate-no-button').click();
      byId('no-button-1').click();
    });

    test('a pick from the picker shows the editors for the new type and folds the picker', () => {
      chip('SurfaceProblem').click();

      expect(label.getProperty('newLabelType')).toBe('SurfaceProblem');
      expect(shownSections()).toEqual(['validate-label-type-section', 'validate-tags-section',
        'validate-severity-section', 'validate-optional-comment-section']);
      expect(ui.labelTypePicker.classList.contains('label-type-picker--collapsed')).toBe(true);
      expect(menu.inWrongTypeView()).toBe(true);
      expect(tracker.push).toHaveBeenCalledWith('Click=NewLabelType_Old=Obstacle_New=SurfaceProblem');
    });

    test('opening the folded picker hides the editors, and folding it again brings them back', () => {
      chip('SurfaceProblem').click();

      chip('SurfaceProblem').click();
      expect(shownSections()).toEqual(['validate-label-type-section']);

      chip('SurfaceProblem').click();
      expect(shownSections()).toContain('validate-tags-section');
    });

    test('a pick made while the next label loads is dropped', () => {
      loading = true;
      chip('SurfaceProblem').click();

      expect(label.getProperty('newLabelType')).toBe('Obstacle');
      expect(labelContainer.dropInputWhileLoading).toHaveBeenCalledWith('LabelType');
    });

    test('Submit sends an Agree that names the new type', () => {
      chip('SurfaceProblem').click();
      ui.submitButton.click();

      expect(tracker.push).toHaveBeenCalledWith(
        'ValidationKeyboardShortcut_Submit_Validation=Agree_NewLabelType=SurfaceProblem',
      );
      expect(labelContainer.validateCurrentLabel).toHaveBeenCalledWith('Agree', expect.any(Date), '');
    });

    test('switching to Unsure puts the label back on its own type and redraws its marker', () => {
      chip('SurfaceProblem').click();
      panoManager.styleMarkerForLabel.mockClear();

      byId('validate-unsure-button').click();

      expect(label.getProperty('newLabelType')).toBe('Obstacle');
      expect(panoManager.styleMarkerForLabel).toHaveBeenCalledWith(label);
      expect(shownSections()).toEqual(['validate-why-unsure-section']);
    });

    test('switching to Agree puts the label back on its own type before drawing the editors', () => {
      chip('SurfaceProblem').click();
      byId('validate-yes-button').click();

      expect(label.getProperty('newLabelType')).toBe('Obstacle');
      expect(label.getProperty('validationResult')).toBe('Agree');
      expect(menu.inWrongTypeView()).toBe(false);
    });

    test('the X takes the pick back with the verdict, and focus lands on Disagree', () => {
      chip('SurfaceProblem').click();
      ui.verdictClearButton.focus();

      ui.verdictClearButton.click();

      expect(label.getProperty('newLabelType')).toBe('Obstacle');
      expect(document.activeElement).toBe(ui.noButton);
    });

    test('going Back to it reopens the picker on the type that was picked', () => {
      chip('SurfaceProblem').click();

      menu.resetMenu(label);

      expect(menu.inWrongTypeView()).toBe(true);
      expect(chip('SurfaceProblem').getAttribute('aria-checked')).toBe('true');
      expect(ui.submitButton.disabled).toBe(false);
    });
  });

  describe('a pick from the label card\'s type dropdown', () => {
    beforeEach(() => setUp({ adminVersion: true }));

    test('arrives through the card and is the same disagree with the type picked', () => {
      labelCard.onTypePicked.mock.calls[0][0]('Signal');

      expect(label.getProperty('newLabelType')).toBe('Signal');
      expect(shownSections()).toEqual(['validate-label-type-section', 'validate-tags-section',
        'validate-optional-comment-section']);
    });

    test('picking the type already picked changes and logs nothing more', () => {
      menu.pickNewLabelType('Signal');
      tracker.push.mockClear();

      menu.pickNewLabelType('Signal');

      expect(tracker.push).not.toHaveBeenCalledWith(expect.stringContaining('NewLabelType'));
    });

    test('is dropped while the next label loads', () => {
      loading = true;
      menu.pickNewLabelType('Signal');

      expect(label.getProperty('newLabelType')).toBe('Obstacle');
      expect(label.getProperty('validationResult')).toBeUndefined();
    });
  });

  test('a typed disagree reason on Expert Validate is a plain reason, not a type change', () => {
    setUp({ adminVersion: true });
    byId('validate-no-button').click();
    ui.disagreeReasonTextBox.value = 'not a pole';
    ui.disagreeReasonTextBox.dispatchEvent(new Event('input'));

    expect(label.getProperty('disagreeOption')).toBe('other');
    expect(menu.inWrongTypeView()).toBe(false);
  });

  test('the tag search is named by the section header', () => {
    setUp({ adminVersion: true });
    expect(tagSelect().control_input.getAttribute('aria-labelledby')).toBe('validate-tags-header');
  });
});
