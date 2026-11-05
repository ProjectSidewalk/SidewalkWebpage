/**
 * Tests for the label-type ribbon above Explore's pano (frontend/js/explore/menu/RibbonMenu.js, #5840): the buttons
 * switch LabelModes and light up for the armed type, dim while the tutorial or a pop-up holds switching, open the
 * Other menu on hover, and carry the tutorial's attention halo. explorePanoExitToast.test.js pins the
 * `explore-labeling` body class, so it is not repeated here.
 */

import { loadModules, mockModule } from './loader.js';
import { fakeTracker } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key, opts) => (opts?.key ? `${key}:${opts.key}` : key) } }));

/** The ribbon as explore.scala.html lays it out: the Other button holds its own menu of subcategories. */
const RIBBON = `
  <div id="ribbon-menu-holder">
    <span id="mode-switch-button-walk" class="label-type-button-holder" val="Walk"><img class="label-type-icon"></span>
    <span class="label-type-button-holder" val="CurbRamp"><img class="label-type-icon"></span>
    <span class="label-type-button-holder" val="Obstacle"><img class="label-type-icon"></span>
    <span id="mode-switch-button-other" class="label-type-button-holder" val="Other">
      <img class="label-type-icon">
      <div id="ribbon-menu-other-subcategory-holder">
        <div class="ribbon-menu-other-subcategory" val="Occlusion"></div>
        <div class="ribbon-menu-other-subcategory" val="Other"></div>
      </div>
    </span>
  </div>
  <div id="pano-border-frame"></div>`;

describe('RibbonMenu', () => {
  let labelModes;
  let keyboardShortcutAlert;
  let tracker;
  let util;

  /** @returns {Element} The ribbon button or Other-menu entry for a mode. */
  const buttonFor = (mode) => document.querySelector(`.label-type-button-holder[val="${mode}"]`);
  const entryFor = (mode) => document.querySelector(`.ribbon-menu-other-subcategory[val="${mode}"]`);
  /** @returns {string} A button's icon color, which is how the ribbon shows the armed or hovered type. */
  const iconColor = (mode) => buttonFor(mode).querySelector('.label-type-icon').style.borderColor;
  /** @returns {string} A label type's color as jsdom writes it back from a style property. */
  const cssColor = (mode) => {
    const probe = document.createElement('div');
    probe.style.borderColor = util.misc.getLabelColors(mode);
    return probe.style.borderColor;
  };
  const subcategoryHolder = () => document.getElementById('ribbon-menu-other-subcategory-holder');
  const hover = (el) => el.dispatchEvent(new MouseEvent('mouseenter'));
  const unhover = (el) => el.dispatchEvent(new MouseEvent('mouseleave'));

  beforeEach(async () => {
    document.body.innerHTML = RIBBON;
    keyboardShortcutAlert = { modeSwitchButtonClicked: vi.fn() };
    tracker = fakeTracker();
    let LabelModes;
    let RibbonMenu;
    ({ LabelModes, RibbonMenu, util } = await loadModules('frontend/js/explore/menu/LabelModes.js',
      'frontend/js/explore/menu/RibbonMenu.js', 'frontend/js/common/utilities.js'));
    labelModes = new LabelModes(fakeTracker());
    new RibbonMenu(labelModes, keyboardShortcutAlert, tracker);
  });

  describe('set-up', () => {
    test('each label type button gets its shortcut key as a tooltip; Walk and Other have no key', () => {
      expect(buttonFor('CurbRamp').getAttribute('data-ps-tooltip'))
        .toBe(`top-ui.press-key:${util.misc.getLabelDescriptions('CurbRamp').keyChar}`);
      expect(buttonFor('CurbRamp').hasAttribute('data-ps-tooltip-placement')).toBe(false);
      expect(buttonFor('Walk').hasAttribute('data-ps-tooltip')).toBe(false);
      expect(buttonFor('Other').hasAttribute('data-ps-tooltip')).toBe(false);
    });

    test('the Other menu entries stack, so their tooltips sit beside them', () => {
      expect(entryFor('Occlusion').getAttribute('data-ps-tooltip-placement')).toBe('left');
      expect(entryFor('Occlusion').getAttribute('data-ps-tooltip')).toContain('top-ui.press-key');
      expect(entryFor('Other').hasAttribute('data-ps-tooltip')).toBe(false);
    });

    test('lights the Walk button for the starting mode and no other', () => {
      expect(iconColor('Walk')).toBe(cssColor('Walk'));
      expect(iconColor('CurbRamp')).toBe('transparent');
    });

    test('resets the Other button\'s display for Safari (#3180)', async () => {
      vi.useFakeTimers();
      document.body.innerHTML = RIBBON;
      const { LabelModes, RibbonMenu } = await loadModules('frontend/js/explore/menu/LabelModes.js',
        'frontend/js/explore/menu/RibbonMenu.js');
      new RibbonMenu(new LabelModes(fakeTracker()), keyboardShortcutAlert, tracker);

      const other = document.getElementById('mode-switch-button-other');
      expect(other.style.display).toBe('block');
      vi.advanceTimersByTime(500);
      expect(other.style.display).toBe('inline-block');
    });
  });

  describe('clicking a button', () => {
    test('arms its type, lights it, colors the pano frame and tells the shortcut hint', () => {
      buttonFor('CurbRamp').click();

      expect(labelModes.getMode()).toBe('CurbRamp');
      expect(iconColor('CurbRamp')).toBe(cssColor('CurbRamp'));
      expect(iconColor('Walk')).toBe('transparent');
      expect(document.getElementById('pano-border-frame').style.borderColor).toBe(cssColor('CurbRamp'));
      expect(tracker.push).toHaveBeenCalledWith('Click_ModeSwitch_CurbRamp');
      expect(keyboardShortcutAlert.modeSwitchButtonClicked).toHaveBeenCalledWith('CurbRamp');
    });

    test('does nothing while the type can\'t be switched to', () => {
      labelModes.switching.hold('popup');

      buttonFor('CurbRamp').click();

      expect(labelModes.getMode()).toBe('Walk');
      expect(tracker.push).not.toHaveBeenCalled();
      expect(keyboardShortcutAlert.modeSwitchButtonClicked).not.toHaveBeenCalled();
    });

    test('an Other menu entry arms that type and closes the menu, without the Other button also firing', () => {
      hover(buttonFor('Other'));
      expect(subcategoryHolder().style.visibility).toBe('visible');

      entryFor('Occlusion').click();

      expect(labelModes.getMode()).toBe('Occlusion');
      expect(subcategoryHolder().style.visibility).toBe('hidden');
      expect(tracker.push).toHaveBeenCalledTimes(1);
      expect(tracker.push).toHaveBeenCalledWith('Click_Subcategory_Occlusion');
      expect(keyboardShortcutAlert.modeSwitchButtonClicked).toHaveBeenCalledWith('Occlusion');
    });

    test('an Other menu entry the tutorial has not enabled does nothing', () => {
      labelModes.switching.hold('tutorial');
      labelModes.enableMode('Other');

      entryFor('Other').click();

      expect(labelModes.getMode()).toBe('Walk');
      expect(tracker.push).not.toHaveBeenCalled();
    });

    test('a page without a pano frame still switches', async () => {
      document.body.innerHTML = RIBBON;
      document.getElementById('pano-border-frame').remove();
      const { LabelModes, RibbonMenu } = await loadModules('frontend/js/explore/menu/LabelModes.js',
        'frontend/js/explore/menu/RibbonMenu.js');
      labelModes = new LabelModes(fakeTracker());
      new RibbonMenu(labelModes, keyboardShortcutAlert, tracker);

      expect(() => buttonFor('Obstacle').click()).not.toThrow();
      expect(labelModes.getMode()).toBe('Obstacle');
    });
  });

  describe('hovering a button', () => {
    test('previews its color, and leaving goes back to the armed type\'s', () => {
      buttonFor('CurbRamp').click();

      hover(buttonFor('Obstacle'));
      expect(iconColor('Obstacle')).toBe(cssColor('Obstacle'));
      expect(iconColor('CurbRamp')).toBe('transparent');

      unhover(buttonFor('Obstacle'));
      expect(iconColor('Obstacle')).toBe('transparent');
      expect(iconColor('CurbRamp')).toBe(cssColor('CurbRamp'));
    });

    test('Other opens its menu, and leaving closes it', () => {
      hover(buttonFor('Other'));
      expect(subcategoryHolder().style.visibility).toBe('visible');
      unhover(buttonFor('Other'));
      expect(subcategoryHolder().style.visibility).toBe('hidden');
    });

    test('a dimmed button shows no preview', () => {
      labelModes.switching.hold('popup');

      hover(buttonFor('Other'));

      expect(iconColor('Other')).toBe('transparent');
      expect(subcategoryHolder().style.visibility).toBe('');
    });
  });

  describe('availability', () => {
    test('dims every button while switching is held, and undims them when it opens', () => {
      labelModes.switching.hold('popup');
      for (const el of document.querySelectorAll('.label-type-button-holder, .ribbon-menu-other-subcategory')) {
        expect(el.style.opacity).toBe('0.4');
        expect(el.style.cursor).toBe('default');
      }

      labelModes.switching.release('popup');
      for (const el of document.querySelectorAll('.label-type-button-holder, .ribbon-menu-other-subcategory')) {
        expect(el.style.opacity).toBe('1');
        expect(el.style.cursor).toBe('pointer');
      }
    });

    test('the tutorial can undim the ribbon\'s Other button apart from the Other entry in its menu', () => {
      labelModes.switching.hold('tutorial');
      labelModes.enableMode('Other', 'Occlusion');

      expect(buttonFor('Other').style.opacity).toBe('1');
      expect(entryFor('Occlusion').style.opacity).toBe('1');
      expect(entryFor('Other').style.opacity).toBe('0.4');
      expect(buttonFor('CurbRamp').style.opacity).toBe('0.4');
    });
  });

  describe('the tutorial\'s attention halo', () => {
    let ribbon;

    beforeEach(async () => {
      document.body.innerHTML = RIBBON;
      const { LabelModes, RibbonMenu } = await loadModules('frontend/js/explore/menu/LabelModes.js',
        'frontend/js/explore/menu/RibbonMenu.js');
      labelModes = new LabelModes(fakeTracker());
      ribbon = new RibbonMenu(labelModes, keyboardShortcutAlert, tracker);
    });

    const halo = (el) => el.classList.contains('onboarding-attention');

    test('goes on the button\'s icon, and moves when another type is named', () => {
      ribbon.startBlinking('CurbRamp');
      expect(halo(buttonFor('CurbRamp').children[0])).toBe(true);

      ribbon.startBlinking('Obstacle');
      expect(halo(buttonFor('CurbRamp').children[0])).toBe(false);
      expect(halo(buttonFor('Obstacle').children[0])).toBe(true);
    });

    test('also marks the named entry in the Other menu, and stopBlinking clears both', () => {
      ribbon.startBlinking('Other', 'Occlusion');
      expect(halo(buttonFor('Other').children[0])).toBe(true);
      expect(halo(entryFor('Occlusion'))).toBe(true);

      ribbon.stopBlinking();
      expect(document.querySelectorAll('.onboarding-attention')).toHaveLength(0);
    });
  });
});
