/**
 * Tests for Validate's label card (frontend/js/validate/label/LabelCard.js) and the control that shows, hides and
 * anchors it (frontend/js/validate/label/LabelVisibilityControl.js), run together as Main.js builds them over the
 * shared card markup (views/components/labelCard.scala.html): the plain header on regular and mobile Validate, and
 * Expert Validate's type dropdown (#5409). The share popover is a stand-in, as ShareWidget has its own suite (#5840).
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeTracker } from './fakes.js';
import { textOf } from './support/routeFetch.js';

// i18next echoes its key, with the label type tacked on where one is passed, so assertions name the key they expect.
mockModule('i18next', () => ({
  default: { t: (key, opts) => (opts?.labelType ? `${key}:${opts.labelType}` : key) },
}));

/** @type {Array<FakeShareWidget>} Every share widget built, newest last. */
let shareWidgets = [];

/** A ShareWidget that only remembers what it was told and whether a test opened it. */
class FakeShareWidget {
  /**
   * @param {HTMLButtonElement} trigger - The share button.
   * @param {{onDismiss: () => void}} opts - What the card does when the user closes the popover.
   */
  constructor(trigger, opts) {
    this.trigger = trigger;
    this.opts = opts;
    this.open = false;
    this.target = null;
    shareWidgets.push(this);
  }

  /** @returns {boolean} Whether the popover is up. */
  isOpen() { return this.open; }

  /** @param {{url: string, title: string, text: string}} target - What a share would send. */
  setTarget(target) { this.target = target; }

  /** Takes the popover down, as the host's own close does. */
  close() { this.open = false; }
}
mockModule('frontend/js/common/share/ShareWidget.js', () => ({ ShareWidget: FakeShareWidget }));

/** A transparent 1x1 image, as the template's placeholders are. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * The pano's marker layer, the top-left Hide-label pill, and the card as labelCard.scala.html renders it for
 * Validate, cut down to what the card's code reads.
 * @param {boolean} typeEditable - Expert Validate's form, whose header is a type dropdown.
 * @returns {string} The markup.
 */
function pageMarkup(typeEditable) {
  const header = typeEditable
    ? `<span class="label-hover-card__type-dropdown">
         <span class="label-type-trigger label-type-trigger--static">
           <img class="label-type-trigger__icon" src="${BLANK}" alt="">
           <span id="label-card-type" class="label-type-trigger__name"></span>
         </span>
         <button type="button" class="label-type-trigger label-type-trigger__button" hidden aria-expanded="false">
           <img class="label-type-trigger__icon" src="${BLANK}" alt=""><span class="label-type-trigger__name"></span>
         </button>
       </span>`
    : `<img class="label-hover-card__icon" src="${BLANK}" alt="">
       <span id="label-card-type" class="label-hover-card__type"></span>`;
  const popover = typeEditable
    ? `<div class="label-type-popover" popover hidden>
         <p class="label-type-popover__hint" hidden></p><div class="label-type-popover__chips"></div>
       </div>`
    : '';
  return `
    <div id="view-control-layer"><div id="validate-pano-marker"></div></div>
    <div id="label-visibility-control-holder">
      <button type="button" id="label-visibility-control-button"></button>
    </div>
    <div id="label-card" class="label-anchored-panel label-hover-card" role="dialog" aria-labelledby="label-card-type">
      <div class="label-hover-card__header">
        ${header}
        <div class="label-detail__share">
          <button type="button" id="label-card-share" class="label-detail__share-trigger"></button>
        </div>
      </div>
      ${popover}
      <div class="label-hover-card__ai"><span>AI generated</span></div>
      <div class="label-hover-card__body">
        <span class="label-hover-card__severity">
          <img class="label-hover-card__severity-icon" src="${BLANK}" alt="">
          <span class="label-hover-card__severity-text"></span>
        </span>
        <span class="label-hover-card__tags"></span>
        <span class="label-hover-card__description"></span>
        <span class="label-hover-card__no-info">No available information</span>
      </div>
      <div class="label-hover-card__actions">
        <button type="button" id="label-visibility-button-on-label"></button>
      </div>
    </div>`;
}

/** The tags each type offers, as Main.js builds them from the city's tag list. */
const CONFIG = {
  tagsByLabelType: { Obstacle: [{ tag_name: 'pole' }], SurfaceProblem: [{ tag_name: 'cracks' }] },
};

describe('Validate label card', () => {
  let Label;
  let tracker;
  let loading;
  let currentLabel;
  let readyListeners;
  let shownListeners;
  let markerCreated;
  let markerDrawn;
  let loadingListener;
  let control;
  let card;

  /** @returns {HTMLElement} The card element. */
  const cardEl = () => document.getElementById('label-card');
  /** @returns {HTMLElement} The label's marker on the pano. */
  const marker = () => document.getElementById('validate-pano-marker');
  /** @returns {boolean} Whether the card is showing. */
  const cardShowing = () => cardEl().style.visibility === 'visible';

  /**
   * Builds the desktop page and the control (which builds the card) over it.
   * @param {object} [options]
   * @param {boolean} [options.typeEditable] - Expert Validate's form of the card.
   */
  async function build({ typeEditable = false } = {}) {
    document.body.innerHTML = pageMarkup(typeEditable);
    useUtil({ isMobile: () => false });
    let LabelVisibilityControl;
    ({ Label, LabelVisibilityControl } = await loadModules('frontend/js/validate/label/Label.js',
      'frontend/js/validate/label/LabelVisibilityControl.js'));
    const labelContainer = {
      onLabelReady: (listener) => readyListeners.push(listener),
      onLabelShown: (listener) => shownListeners.push(listener),
      onLoadingChange: (listener) => { loadingListener = listener; },
      dropInputWhileLoading: () => loading,
      getCurrentLabel: () => currentLabel,
    };
    const panoManager = {
      getPanoMarker: () => ({ marker_: marker() }),
      onMarkerCreated: (listener) => { markerCreated = listener; },
      onMarkerDrawn: (listener) => { markerDrawn = listener; },
    };
    control = new LabelVisibilityControl({ controlLayer: document.getElementById('view-control-layer') },
      { viewerType: class GsvViewer {} }, labelContainer, panoManager, tracker);
    card = control.getLabelCard();
  }

  /**
   * Makes a label current and tells the card about it, as LabelContainer does once its pano is up.
   * @param {Record<string, any>} [overrides] - Backend fields to replace.
   * @returns {object} The label.
   */
  function showLabel(overrides = {}) {
    currentLabel = new Label({
      label_id: 42, label_type: 'Obstacle', severity: 2, tags: ['pole'], description: 'blocks the path',
      ai_generated: false, admin_data: null, ...overrides,
    }, CONFIG);
    for (const listener of readyListeners) listener(currentLabel);
    for (const listener of shownListeners) listener(currentLabel);
    return currentLabel;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    shareWidgets = [];
    tracker = fakeTracker();
    loading = false;
    readyListeners = [];
    shownListeners = [];
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('on regular Validate', () => {
    beforeEach(async () => {
      await build();
    });

    test('shows the label as it was filed: its type, rating, tags and description', () => {
      showLabel({ ai_generated: true });

      expect(textOf(document.getElementById('label-card-type'))).toBe('common:obstacle');
      expect(textOf(cardEl().querySelector('.label-hover-card__tags'))).toContain('common:tag.pole');
      expect(textOf(cardEl().querySelector('.label-hover-card__description'))).toBe('blocks the path');
      expect(cardEl().querySelector('.label-hover-card__ai').style.display).toBe('flex');
    });

    test('a tag with a colon in it is looked up under a dash, the form translation keys take', () => {
      showLabel({ tags: ['height difference:small'] });

      expect(textOf(cardEl().querySelector('.label-hover-card__tags'))).toContain('common:tag.height difference-small');
    });

    test('a label sent without tags shows none', () => {
      const params = { label_id: 9, label_type: 'Obstacle', severity: 2, description: null, admin_data: null };
      currentLabel = new Label(params, CONFIG);
      for (const listener of readyListeners) listener(currentLabel);

      expect(cardEl().querySelector('.label-hover-card__tags').children).toHaveLength(0);
    });

    test('the share button points at the label\'s public page, named by its type', () => {
      showLabel();

      expect(shareWidgets[0].target).toEqual({
        url: `${window.location.origin}/label/42`,
        title: 'common:share.text:common:obstacle',
        text: 'common:share.text:common:obstacle',
      });
    });

    test('opening the share popover is logged with the label type; the click that closes it is not', () => {
      showLabel();
      const trigger = document.getElementById('label-card-share');

      trigger.click();
      shareWidgets[0].open = true;
      trigger.click();

      expect(tracker.push.mock.calls.filter(([name]) => name === 'Click_LabelCardShare'))
        .toEqual([['Click_LabelCardShare', { labelType: 'Obstacle' }]]);
    });

    test('there is no type dropdown, so Escape has none to close', () => {
      showLabel();

      expect(card.closeTypeDropdown()).toBe(false);
      expect(cardEl().querySelector('.label-type-trigger__button')).toBeNull();
    });
  });

  describe('showing and hiding the card', () => {
    beforeEach(async () => {
      await build();
      showLabel();
      markerCreated({ marker_: marker() });
    });

    test('keyboard focus on the marker opens the card, logged as a keyboard open', () => {
      marker().dispatchEvent(new FocusEvent('focus'));

      expect(cardShowing()).toBe(true);
      expect(marker().getAttribute('aria-expanded')).toBe('true');
      expect(tracker.push).toHaveBeenCalledWith('KeyboardShortcut_ShowLabelCard');
    });

    test('focus walking back from the card onto the marker keeps the card up without re-opening it', () => {
      control.showLabelCard();
      tracker.push.mockClear();
      const hideButton = document.getElementById('label-visibility-button-on-label');

      cardEl().dispatchEvent(new FocusEvent('focusout', { relatedTarget: marker() }));
      marker().dispatchEvent(new FocusEvent('focus', { relatedTarget: hideButton }));
      vi.runAllTimers();

      expect(cardShowing()).toBe(true);
      expect(tracker.push).not.toHaveBeenCalled();
    });

    test('toggling opens the card, then closes it', () => {
      control.toggleLabelCard();
      expect(cardShowing()).toBe(true);

      control.toggleLabelCard();
      expect(cardShowing()).toBe(false);
      expect(marker().getAttribute('aria-expanded')).toBe('false');
    });

    test('with no marker on the pano yet there is nothing to hang the card off, so it stays shut', () => {
      marker().remove();

      control.showLabelCard();

      expect(cardShowing()).toBe(false);
      expect(tracker.push).not.toHaveBeenCalledWith('MouseOver_Label');
    });

    test('a redraw that parks the marker off-screen, behind the camera, takes the card down', () => {
      control.showLabelCard();
      Object.defineProperty(marker(), 'offsetLeft', { value: -5000 });

      markerDrawn();

      expect(cardShowing()).toBe(false);
    });

    test('a redraw while the card is up keeps it up, glued to the marker', () => {
      control.showLabelCard();

      markerDrawn();

      expect(cardShowing()).toBe(true);
    });

    test('hovering the marker again while the card is up does not log a second open', () => {
      marker().dispatchEvent(new MouseEvent('mouseover'));
      marker().dispatchEvent(new MouseEvent('mouseover'));

      expect(tracker.push.mock.calls.filter(([name]) => name === 'MouseOver_Label')).toHaveLength(1);
    });

    test('the next label starting to load takes the card down, and the load finishing leaves the card alone', () => {
      control.showLabelCard();

      loadingListener(true);
      expect(cardShowing()).toBe(false);

      control.showLabelCard();
      loadingListener(false);
      expect(cardShowing()).toBe(true);
    });

    test('a redraw while the card is shut leaves it shut', () => {
      markerDrawn();

      expect(cardShowing()).toBe(false);
    });

    test('the Hide-label pill hides the label and shows it again, each click logged', () => {
      const pill = document.getElementById('label-visibility-control-button');

      pill.click();
      expect(marker().classList.contains('label-marker--hidden')).toBe(true);
      pill.click();
      expect(marker().classList.contains('label-marker--hidden')).toBe(false);

      expect(tracker.push).toHaveBeenCalledWith('Click_HideLabel');
      expect(tracker.push).toHaveBeenCalledWith('Click_UnhideLabel');
    });

    test('the pointer leaving the card while the share popover is open leaves the card up', () => {
      control.showLabelCard();
      shareWidgets[0].open = true;

      cardEl().dispatchEvent(new MouseEvent('mouseleave'));
      vi.runAllTimers();

      expect(cardShowing()).toBe(true);
    });

    test('once the share popover is dismissed, the card goes after the usual grace period', () => {
      control.showLabelCard();
      shareWidgets[0].open = true;
      cardEl().dispatchEvent(new MouseEvent('mouseleave'));
      shareWidgets[0].open = false;

      shareWidgets[0].opts.onDismiss();
      expect(cardShowing()).toBe(true);
      vi.advanceTimersByTime(200);

      expect(cardShowing()).toBe(false);
    });

    test('a popover dismissed with keyboard focus still in the card leaves the card up', () => {
      control.showLabelCard();
      document.getElementById('label-visibility-button-on-label').focus();

      shareWidgets[0].opts.onDismiss();
      vi.runAllTimers();

      expect(cardShowing()).toBe(true);
    });

    test('a popover dismissed after the card already went leaves it gone', () => {
      shareWidgets[0].opts.onDismiss();
      vi.runAllTimers();

      expect(cardShowing()).toBe(false);
    });

    test('taking the card down closes the share popover with it', () => {
      control.showLabelCard();
      shareWidgets[0].open = true;

      control.hideLabelCard();

      expect(shareWidgets[0].open).toBe(false);
    });
  });

  describe('on Expert Validate, with the type dropdown in the header (#5409)', () => {
    let picks;

    beforeEach(async () => {
      await build({ typeEditable: true });
      picks = [];
      card.onTypePicked((labelType) => picks.push(labelType));
    });

    /** @returns {HTMLButtonElement} The dropdown's button. */
    const typeButton = () => cardEl().querySelector('.label-type-trigger__button');
    /** @returns {HTMLElement} The dropdown's popover. */
    const popover = () => cardEl().querySelector('.label-type-popover');
    /** @returns {HTMLElement} The chip for a type. */
    const chip = (labelType) => popover().querySelector(`[data-label-type="${labelType}"]`);

    test('the card shows what Submit would save: the type, rating and tags the expert picked', () => {
      const label = showLabel();
      label.setNewLabelType('SurfaceProblem');
      label.setProperty('newTags', ['cracks']);

      card.render(label);

      expect(textOf(typeButton())).toBe('common:surface-problem');
      expect(textOf(cardEl().querySelector('.label-hover-card__tags'))).toBe('common:tag.cracks');
      // The link still opens the label as filed, so the share text names that type.
      expect(shareWidgets[0].target.title).toBe('common:share.text:common:obstacle');
    });

    test('opening the dropdown is logged and draws the chips with the label\'s own type not pickable', () => {
      showLabel();

      typeButton().click();

      expect(card.isPopoverOpen()).toBe(true);
      expect(tracker.push).toHaveBeenCalledWith('Click_LabelCardTypeMenu', { labelType: 'Obstacle' });
      expect(chip('Obstacle').getAttribute('aria-disabled')).toBe('true');
      expect(popover().querySelector('[aria-checked="true"]')).toBeNull();
    });

    test('reopened after a pick, the dropdown shows that pick as chosen', () => {
      showLabel().setNewLabelType('SurfaceProblem');

      typeButton().click();

      expect(chip('SurfaceProblem').getAttribute('aria-checked')).toBe('true');
    });

    test('a pick from the dropdown goes to the verdict menu, and the dropdown closes', () => {
      showLabel();
      typeButton().click();

      chip('CurbRamp').click();

      expect(picks).toEqual(['CurbRamp']);
      expect(card.isPopoverOpen()).toBe(false);
    });

    test('the dropdown will not open while the next label is still loading', () => {
      showLabel();
      loading = true;

      typeButton().click();

      expect(card.isPopoverOpen()).toBe(false);
      expect(tracker.push).not.toHaveBeenCalledWith('Click_LabelCardTypeMenu', expect.anything());
    });

    test('Escape closes an open dropdown and puts focus back on its button', () => {
      showLabel();
      typeButton().click();

      expect(card.closeTypeDropdown()).toBe(true);

      expect(card.isPopoverOpen()).toBe(false);
      expect(document.activeElement).toBe(typeButton());
    });

    test('taking the card down closes an open dropdown with it', () => {
      showLabel();
      control.showLabelCard();
      typeButton().click();

      control.hideLabelCard();

      expect(card.isPopoverOpen()).toBe(false);
    });
  });
});
