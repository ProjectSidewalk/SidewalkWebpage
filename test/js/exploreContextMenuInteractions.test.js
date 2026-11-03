/**
 * Tests for working the context menu a clicked label opens (frontend/js/explore/canvas/ContextMenu.js, #5840):
 * what show() fills in, the rating segments and their smileys, mutually exclusive tags, the tooltips built from
 * example images, the description box's hold on mode switching, every way the panel closes, the tutorial's locks,
 * and the header's share control. Opening/closing repaints are pinned in exploreContextMenuRerender.test.js and the
 * tag row's build in exploreContextMenuTagButtons.test.js.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { makeContextMenuUi } from './contextMenuUiStub.js';
import { fakeGate, fakeTracker } from './fakes.js';
import { routeFetch, flush } from './support/routeFetch.js';

/** Two tag texts of the shapes the tooltip builder tells apart: the shortcut letter first, or further in. */
const TAG_TEXTS = {
  'center-ui.context-menu.tag.narrow': '<tag-underline>n</tag-underline>arrow',
  'center-ui.context-menu.tag.tactile-warning': 'tactile <tag-underline>w</tag-underline>arning',
};
mockModule('i18next', () => ({ default: {
  t: (key, opts = {}) =>
    TAG_TEXTS[key] ?? (opts.c ? `${key}:${opts.c}` : (opts.labelType ? `${key}:${opts.labelType}` : key)),
} }));

/** @type {Array<object>} The share widgets built so far, newest last. */
let shareWidgets = [];
mockModule('frontend/js/common/share/ShareWidget.js', () => ({
  ShareWidget: class {
    constructor(trigger, opts) {
      this.trigger = trigger;
      this.opts = opts;
      this.open = false;
      this.setTarget = vi.fn();
      this.close = vi.fn();
      shareWidgets.push(this);
    }

    isOpen() { return this.open; }
  },
}));

/**
 * @param {object} [props] - Overrides for the label's properties.
 * @returns {object} A label with the methods ContextMenu calls, whose edits land on its properties.
 */
function makeLabel(props = {}) {
  const all = {
    labelType: 'CurbRamp', severity: null, description: '', tagIds: [], tutorialLabelNumber: undefined,
    labelId: 'DefaultValue', ...props,
  };
  return {
    getLabelType: () => all.labelType,
    getCanvasXY: () => ({ x: 100, y: 100 }),
    getProperty: (key) => all[key],
    getProperties: () => all,
    isDeleted: () => false,
    edit: vi.fn((changes) => { Object.assign(all, changes); }),
  };
}

const TAGS = [
  { tag_id: 1, label_type: 'CurbRamp', tag: 'narrow' },
  { tag_id: 2, label_type: 'CurbRamp', tag: 'tactile warning', mutually_exclusive_with: 'missing tactile warning' },
  { tag_id: 3, label_type: 'CurbRamp', tag: 'missing tactile warning', mutually_exclusive_with: 'tactile warning' },
  { tag_id: 4, label_type: 'CurbRamp', tag: 'not enough landing space', mutually_exclusive_with: 'no such tag' },
];

describe('ContextMenu', () => {
  let menu;
  let ui;
  let config;
  let labelContainer;
  let switching;
  let moveStarted;
  let ratingReminderAlert;
  let form;
  let tracker;
  let getImage;
  let util;

  const tagButton = (tagId) => ui.tagHolder.querySelector(`[data-tag-id="${tagId}"]`);
  const severityButton = (sev) => ui.severityRadioHolder.querySelector(`.severity-button[data-severity="${sev}"]`);

  beforeEach(async () => {
    shareWidgets = [];
    document.body.innerHTML = '<span id="severity-header-text"></span><img id="severity-header-info" alt="x">';
    window.cityId = 'seattle';
    // Images resolve to a token naming their URL, so a tooltip says which example it was built from.
    getImage = vi.fn((url) => Promise.resolve(`img:${url}`));
    useUtil({ getImage });

    let ContextMenu;
    ({ ContextMenu, util } = await loadModules('frontend/js/explore/canvas/ContextMenu.js',
      'frontend/js/common/utilities.js'));
    ui = makeContextMenuUi();
    document.body.append(ui.holder, ui.severityRadioHolder, ui.tagHolder, ui.textBox);
    config = { isOnboarding: false };
    labelContainer = { canDelete: () => true, getAllLabels: () => [], removeLabel: vi.fn() };
    switching = fakeGate();
    moveStarted = vi.fn();
    ratingReminderAlert = { ratingClicked: vi.fn() };
    form = { ensureLabelSaved: vi.fn(async () => {}) };
    tracker = fakeTracker();
    menu = new ContextMenu(ui, config, { iconRadius: 17 }, labelContainer, { switching },
      { onMoveStarted: moveStarted }, ratingReminderAlert, form, tracker);
    menu.labelTags = TAGS;
  });

  afterEach(() => menu.hide());

  describe('show()', () => {
    test('names the label in the header and restores what was already rated and written', () => {
      const label = makeLabel({ severity: 2, description: 'steep', tagIds: [1] });

      menu.show(label);

      expect(ui.holder.querySelector('#context-menu-icon').getAttribute('src'))
        .toBe(util.misc.getIconImagePaths('CurbRamp').iconImagePath);
      expect(ui.holder.querySelector('#context-menu-type').textContent).toBe('common:curb-ramp');
      expect(ui.radioButtons.map((r) => r.checked)).toEqual([false, true, false]);
      expect(ui.textBox.value).toBe('steep');
      expect(tagButton(1).classList.contains('tag-pill--active')).toBe(true);
      expect(ui.holder.style.visibility).toBe('visible');
      expect(tracker.push).toHaveBeenCalledWith('ContextMenu_Open', null, label);
    });

    test('hides the rating section for a type that takes no rating', () => {
      menu.show(makeLabel({ labelType: 'Signal' }));
      expect(ui.severityMenu.classList.contains('ps-hidden')).toBe(true);

      menu.show(makeLabel({ labelType: 'Obstacle' }));
      expect(ui.severityMenu.classList.contains('ps-hidden')).toBe(false);
    });

    test('hides the Delete button when the tutorial forbids deleting this label', () => {
      labelContainer.canDelete = () => false;
      menu.show(makeLabel());
      expect(ui.holder.classList.contains('context-menu--no-delete')).toBe(true);
    });

    test('closes when the labeler walks off', () => {
      menu.show(makeLabel());
      moveStarted.mock.calls[0][0]();
      expect(menu.isOpen()).toBe(false);
      // Nothing to close, so nothing is logged a second time.
      moveStarted.mock.calls[0][0]();
      expect(tracker.push.mock.calls.filter(([name]) => name === 'ContextMenu_Close')).toHaveLength(1);
    });

    test('a page without the rating segments still opens', async () => {
      const { ContextMenu } = await loadModules('frontend/js/explore/canvas/ContextMenu.js');
      const bare = new ContextMenu({ ...makeContextMenuUi(), severityRadioHolder: null }, config, { iconRadius: 17 },
        labelContainer, { switching }, { onMoveStarted: vi.fn() }, ratingReminderAlert, form, tracker);
      expect(() => bare.show(makeLabel())).not.toThrow();
      bare.hide();
    });
  });

  describe('rating', () => {
    test('checkRadioButton rates the label the way a click on its segment would', () => {
      const label = makeLabel();
      const changed = vi.fn();
      menu.onChange(changed);
      menu.show(label);
      changed.mockClear();

      menu.checkRadioButton(3);

      expect(label.edit).toHaveBeenCalledWith({ severity: 3 });
      expect(changed).toHaveBeenCalledTimes(1);
      expect(tracker.push).toHaveBeenCalledWith('ContextMenu_RadioChange', { LabelType: 'CurbRamp', RadioValue: 3 },
        label);
    });

    test('a value with no segment does nothing', () => {
      const label = makeLabel();
      menu.show(label);
      menu.checkRadioButton(7);
      expect(label.edit).not.toHaveBeenCalled();
    });

    test('the chosen segment gets the filled smiley, its level colour and the checked class', () => {
      menu.show(makeLabel({ labelType: 'Obstacle' }));
      menu.checkRadioButton(2);

      expect(severityButton(2).querySelector('img').getAttribute('src'))
        .toBe(util.misc.getSmileyIconPath(2, 'Obstacle', true));
      expect(severityButton(1).querySelector('img').getAttribute('src'))
        .toBe(util.misc.getSmileyIconPath(1, 'Obstacle', false));
      expect(severityButton(2).classList.contains('severity-button--checked')).toBe(true);
      expect(severityButton(1).classList.contains('severity-button--checked')).toBe(false);
      expect(severityButton(2).style.getPropertyValue('--level-wash'))
        .toBe(util.misc.getSeverityLevelColors(2, 'Obstacle').wash);
    });

    test('a positive type reads as quality with good/okay/bad; a negative one as severity with low/medium/high', () => {
      const header = document.getElementById('severity-header-text');
      const info = document.getElementById('severity-header-info');
      const levels = () =>
        [1, 2, 3].map((sev) => severityButton(sev).querySelector('.severity-button__label').textContent);

      menu.show(makeLabel({ labelType: 'CurbRamp' }));
      expect(header.textContent).toBe('common:rate-quality');
      expect(info.getAttribute('data-ps-tooltip')).toBe('common:rate-quality-info');
      expect(info.getAttribute('alt')).toBe('common:rate-quality-info');
      expect(levels()).toEqual(['common:good', 'common:okay', 'common:bad']);

      menu.show(makeLabel({ labelType: 'Obstacle' }));
      expect(header.textContent).toBe('common:rate-severity');
      expect(levels()).toEqual(['common:low', 'common:medium', 'common:high']);
    });

    test('each segment gets a tooltip built from its example image for the open type', async () => {
      menu.show(makeLabel({ labelType: 'CurbRamp' }));
      await flush();

      const tooltip = severityButton(1).getAttribute('data-ps-tooltip-html');
      expect(tooltip).toContain('common:quality-example-tooltip-1<br/>');
      expect(tooltip).toContain(`src="img:${util.assetPath('images/examples/severity/CurbRamp_Severity1.png')}"`);
      expect(tooltip).toContain('<i>center-ui.context-menu.severity-shortcuts</i>');
      expect(severityButton(3).getAttribute('data-ps-tooltip-html')).toContain('common:quality-example-tooltip-3');

      // Other is rated but has no example images, so the previous type's tooltips come off and none go on.
      menu.show(makeLabel({ labelType: 'Other' }));
      await flush();
      expect(severityButton(1).hasAttribute('data-ps-tooltip-html')).toBe(false);
      expect(getImage.mock.calls.some(([url]) => url.includes('Other_Severity'))).toBe(false);
    });
  });

  describe('tags', () => {
    test('picking a tag drops the one it is mutually exclusive with, logging the automatic removal', () => {
      const label = makeLabel();
      menu.show(label);

      tagButton(2).click();
      expect(label.getProperty('tagIds')).toEqual([2]);

      tagButton(3).click();
      expect(label.getProperty('tagIds')).toEqual([3]);
      expect(tagButton(2).classList.contains('tag-pill--active')).toBe(false);
      expect(tagButton(3).classList.contains('tag-pill--active')).toBe(true);
      expect(tracker.push).toHaveBeenCalledWith('ContextMenu_TagAutoRemoved', { tagId: 2, tagName: 'tactile warning' },
        label);
    });

    test('an exclusion naming a tag the city has not got is ignored', () => {
      const label = makeLabel({ tagIds: [1] });
      menu.show(label);

      tagButton(4).click();

      expect(label.getProperty('tagIds')).toEqual([1, 4]);
    });

    test('a second pick removes the tag and tells whoever watches the tag list', () => {
      const label = makeLabel({ tagIds: [1] });
      const updated = vi.fn();
      ui.tagHolder.addEventListener('tagIds-updated', updated);
      menu.show(label);

      tagButton(1).click();

      expect(label.getProperty('tagIds')).toEqual([]);
      expect(tagButton(1).classList.contains('tag-pill--active')).toBe(false);
      expect(updated).toHaveBeenCalledTimes(1);
    });

    // The pointer's own click, logged as ContextMenu_TagAdded, can't be made here: jsdom marks every event a test
    // can send untrusted, and the split reads that flag.
    test('a pick with no pointer position is logged as a keyboard shortcut', () => {
      const label = makeLabel();
      menu.show(label);

      tagButton(1).click();
      tagButton(1).click();

      expect(tracker.push).toHaveBeenCalledWith('KeyboardShortcut_TagAdded', { tagId: 1, tagName: 'narrow' }, label);
      expect(tracker.push).toHaveBeenCalledWith('KeyboardShortcut_TagRemoved', { tagId: 1, tagName: 'narrow' }, label);
    });

    test('each tag button gets a tooltip: its text with the shortcut letter capitalized, the example, the hint',
      async () => {
        menu.show(makeLabel());
        await flush();

        expect(tagButton(1).getAttribute('data-ps-tooltip-html')).toBe('<tag-underline>N</tag-underline>arrow<br/>'
          + `<img class="context-menu-tooltip__img--tag" src="img:${util.assetPath('images/examples/tags/1.png')}"/>`
          + '<br/> <i>center-ui.context-menu.label-popup-shortcuts:n</i>');
        expect(tagButton(2).getAttribute('data-ps-tooltip-html'))
          .toMatch(/^Tactile <tag-underline>w<\/tag-underline>arning<br\/>.*shortcuts:w<\/i>$/);
      });

    test('a city with its own example images shows those, falling back to the shared one it lacks', async () => {
      window.cityId = 'chandigarh-india';
      getImage.mockImplementation((url) => (url.includes('/india/1.png')
        ? Promise.reject(new Error('Image not found')) : Promise.resolve(`img:${url}`)));

      menu.show(makeLabel());
      await flush();

      expect(tagButton(1).getAttribute('data-ps-tooltip-html')).toContain(
        `img:${util.assetPath('images/examples/tags/1.png')}`,
      );
      expect(tagButton(2).getAttribute('data-ps-tooltip-html'))
        .toContain(`img:${util.assetPath('images/examples/tags/india/2.png')}`);
    });

    test('Zurich and its stand-ins share one set of city examples', async () => {
      window.cityId = 'zurich-infra3d';
      menu.show(makeLabel());
      await flush();

      expect(tagButton(1).getAttribute('data-ps-tooltip-html'))
        .toContain(`img:${util.assetPath('images/examples/tags/zurich/1.png')}`);
    });

    test('fetchLabelTags keeps what the server sends and then runs the callback', async () => {
      const tags = [{ tag_id: 9, label_type: 'Obstacle', tag: 'pole' }];
      routeFetch({ '/label/tags': tags });
      const done = vi.fn();

      menu.fetchLabelTags(done);
      await flush();

      expect(menu.labelTags).toEqual(tags);
      expect(done).toHaveBeenCalledTimes(1);
    });
  });

  describe('the description box', () => {
    test('typing holds mode switching, and the shortcuts are told, until the box loses focus', () => {
      const focused = vi.fn();
      menu.onTextFieldFocusChanged(focused);
      const label = makeLabel();
      menu.show(label);

      ui.textBox.dispatchEvent(new Event('focus'));
      expect(switching.hold).toHaveBeenCalledWith('description');
      expect(focused).toHaveBeenLastCalledWith(true);
      expect(tracker.push).toHaveBeenCalledWith('ContextMenu_TextBoxFocus', null, label);

      ui.textBox.dispatchEvent(new Event('blur'));
      expect(switching.release).toHaveBeenCalledWith('description');
      expect(focused).toHaveBeenLastCalledWith(false);
      expect(tracker.push).toHaveBeenCalledWith('ContextMenu_TextBoxBlur', null, label);
    });

    test('closing while typing blurs the box, so its hold on switching goes with the panel', () => {
      menu.show(makeLabel());
      ui.textBox.focus();
      expect(document.activeElement).toBe(ui.textBox);

      menu.hide();

      expect(document.activeElement).not.toBe(ui.textBox);
      expect(switching.release).toHaveBeenCalledWith('description');
      const rows = tracker.push.mock.calls.map(([name]) => name);
      expect(rows.indexOf('ContextMenu_TextBoxBlur')).toBeLessThan(rows.indexOf('ContextMenu_Close'));
    });
  });

  describe('closing', () => {
    test('the Close button closes and asks the rating reminder whether the last label was rated', () => {
      const label = makeLabel({ severity: null });
      labelContainer.getAllLabels = () => [makeLabel({ severity: 1 }), label];
      menu.show(label);

      ui.closeButton.click();

      expect(menu.isOpen()).toBe(false);
      expect(ratingReminderAlert.ratingClicked).toHaveBeenCalledWith(null);
      expect(tracker.push).toHaveBeenCalledWith('ContextMenu_CloseButtonClick', null, label);
    });

    test('the Done button does the same', () => {
      const label = makeLabel({ severity: 2 });
      labelContainer.getAllLabels = () => [label];
      menu.show(label);

      ui.holder.querySelector('#context-menu-done').click();

      expect(menu.isOpen()).toBe(false);
      expect(ratingReminderAlert.ratingClicked).toHaveBeenCalledWith(2);
      expect(tracker.push).toHaveBeenCalledWith('ContextMenu_DoneButtonClick', null, label);
    });

    test('the rating reminder is left alone when the last label takes no rating, or there are none', () => {
      menu.handleSeverityPopup();
      labelContainer.getAllLabels = () => [makeLabel({ labelType: 'Signal' })];
      menu.handleSeverityPopup();
      expect(ratingReminderAlert.ratingClicked).not.toHaveBeenCalled();
    });

    test('a press outside the panel closes it; one inside does not', () => {
      const label = makeLabel();
      menu.show(label);

      ui.holder.querySelector('#context-menu-type').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(menu.isOpen()).toBe(true);

      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(menu.isOpen()).toBe(false);
      expect(tracker.push).toHaveBeenCalledWith('ContextMenu_CloseClickOut', null, label);
    });

    test('the Delete button closes the panel and removes its label', () => {
      const label = makeLabel();
      menu.show(label);

      ui.holder.querySelector('#context-menu-delete').click();

      expect(menu.isOpen()).toBe(false);
      expect(labelContainer.removeLabel).toHaveBeenCalledWith(label);
      expect(tracker.push).toHaveBeenCalledWith('ContextMenu_LabelDelete', { labelType: 'CurbRamp' }, label);
    });

    test('Delete does nothing for a label the tutorial will not let go', () => {
      labelContainer.canDelete = () => false;
      menu.show(makeLabel());

      ui.holder.querySelector('#context-menu-delete').click();

      expect(menu.isOpen()).toBe(true);
      expect(labelContainer.removeLabel).not.toHaveBeenCalled();
    });
  });

  describe('in the tutorial', () => {
    const radiosDisabled = () => ui.radioButtons.every((r) => r.disabled);
    const tagsDisabled = () => Array.from(ui.tagHolder.querySelectorAll('button')).every((b) => b.disabled);

    beforeEach(() => {
      config.isOnboarding = true;
    });

    test('rating and tagging start locked for a label the tutorial has not reached', () => {
      menu.show(makeLabel({ tutorialLabelNumber: 1 }));

      expect(ui.severityRadioHolder.classList.contains('is-disabled')).toBe(true);
      expect(radiosDisabled()).toBe(true);
      expect(tagsDisabled()).toBe(true);
      expect(menu.isTaggingDisabled()).toBe(true);
    });

    test('reaching the label unlocks them, and the tutorial can lock them again', () => {
      menu.show(makeLabel({ tutorialLabelNumber: 1 }));

      menu.enableRatingSeverityForTutorialLabel(1);
      menu.enableTaggingForTutorialLabel(1);
      expect(ui.severityRadioHolder.classList.contains('is-disabled')).toBe(false);
      expect(radiosDisabled()).toBe(false);
      expect(tagsDisabled()).toBe(false);

      menu.disableRatingSeverity();
      menu.disableTagging();
      expect(radiosDisabled()).toBe(true);
      expect(tagsDisabled()).toBe(true);
    });

    test('unlocking another label\'s number changes nothing for the open one', () => {
      menu.show(makeLabel({ tutorialLabelNumber: 2 }));

      menu.enableRatingSeverityForTutorialLabel(1);
      menu.enableTaggingForTutorialLabel(1);

      expect(radiosDisabled()).toBe(true);
      expect(tagsDisabled()).toBe(true);
    });

    test('a label unlocked earlier in the step reopens unlocked', () => {
      const label = makeLabel({ tutorialLabelNumber: 1 });
      menu.show(label);
      menu.enableRatingSeverityForTutorialLabel(1);
      menu.enableTaggingForTutorialLabel(1);
      menu.hide();

      menu.show(label);

      expect(radiosDisabled()).toBe(false);
      expect(tagsDisabled()).toBe(false);
    });

    test('tutorial labels are never shared, since the server never gives them an id', () => {
      menu.show(makeLabel({ tutorialLabelNumber: 1 }));
      expect(ui.holder.classList.contains('context-menu--no-share')).toBe(true);
      expect(shareWidgets[0].setTarget).not.toHaveBeenCalled();
    });
  });

  describe('the share control', () => {
    test('is built on the header button, fitted to the viewport', () => {
      expect(shareWidgets).toHaveLength(1);
      expect(shareWidgets[0].trigger).toBe(document.getElementById('context-menu-share'));
      expect(shareWidgets[0].opts.fitToViewport).toBe(true);
    });

    test('points at the open label\'s page, or nowhere until the label has an id', () => {
      menu.show(makeLabel({ labelId: 12 }));
      expect(shareWidgets[0].setTarget).toHaveBeenLastCalledWith({
        url: `${window.location.origin}/label/12`,
        title: 'common:share.text:common:curb-ramp',
        text: 'common:share.text:common:curb-ramp',
      });

      menu.show(makeLabel());
      expect(shareWidgets[0].setTarget).toHaveBeenLastCalledWith(expect.objectContaining({ url: '' }));
      expect(ui.holder.classList.contains('context-menu--no-share')).toBe(false);
    });

    test('saves the label before opening, then points at the id that came back', async () => {
      const label = makeLabel();
      menu.show(label);
      form.ensureLabelSaved.mockImplementation(async () => label.edit({ labelId: 34 }));

      await shareWidgets[0].opts.beforeOpen();

      expect(form.ensureLabelSaved).toHaveBeenCalledWith(label);
      expect(shareWidgets[0].setTarget).toHaveBeenLastCalledWith(expect.objectContaining({
        url: `${window.location.origin}/label/34`,
      }));
    });

    test('logs the opening click but not the one that dismisses the popover', () => {
      menu.show(makeLabel());
      const trigger = document.getElementById('context-menu-share');

      trigger.click();
      shareWidgets[0].open = true;
      trigger.click();

      expect(tracker.push.mock.calls.filter(([name]) => name === 'Click_LabelCardShare'))
        .toEqual([['Click_LabelCardShare', { labelType: 'CurbRamp' }]]);
    });

    test('goes away with the panel', () => {
      menu.show(makeLabel());
      menu.hide();
      expect(shareWidgets[0].close).toHaveBeenCalled();
    });
  });
});
