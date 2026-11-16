/**
 * Tests for LabelTypeDropdown (frontend/js/common/LabelTypePicker.js) in a browser with the Popover API, where the
 * browser does the showing and hiding and the dropdown only answers its toggle events. jsdom has no Popover API, so
 * validateWrongType.test.js covers the plain-block fallback and this suite fakes the API before the module loads,
 * since the module checks for it only then (#5840).
 */

import { loadModules, mockModule } from './loader.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

let LabelTypeDropdown;
let opens;
let picks;
let closes;
let allowOpen;
/** @type {WeakSet<Element>} The popovers the fake API has showing. */
let shown;

/**
 * Stands in for the Popover API as a browser runs it: showing or hiding fires a `beforetoggle` (which can refuse an
 * open) and then a `toggle`, each carrying the new state, and `:popover-open` matches while shown.
 */
function installPopoverApi() {
  shown = new WeakSet();
  const toggleTo = (el, newState) => {
    const before = Object.assign(new Event('beforetoggle', { cancelable: newState === 'open' }), { newState });
    if (!el.dispatchEvent(before)) return;
    if (newState === 'open') shown.add(el);
    else shown.delete(el);
    el.dispatchEvent(Object.assign(new Event('toggle'), { newState }));
  };
  HTMLElement.prototype.showPopover = function () {
    if (!shown.has(this)) toggleTo(this, 'open');
  };
  HTMLElement.prototype.hidePopover = function () {
    if (shown.has(this)) toggleTo(this, 'closed');
  };
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (selector) {
    return selector === ':popover-open' ? shown.has(this) : matches.call(this, selector);
  });
}

/** @returns {object} A dropdown over the markup components/labelTypeTrigger and labelTypePopover render. */
function build() {
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
  const popoverEl = document.querySelector('.label-type-popover');
  const dropdown = new LabelTypeDropdown(document.getElementById('title'), popoverEl, {
    onOpen: () => {
      opens += 1;
      if (allowOpen) dropdown.picker.render({ current: 'Obstacle' });
      return allowOpen;
    },
    onPick: (t) => picks.push(t),
    onClose: () => { closes += 1; },
  });
  dropdown.setEditable(true);
  return dropdown;
}

const button = () => document.querySelector('.label-type-trigger__button');
const popover = () => document.querySelector('.label-type-popover');

beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, 'popover', { configurable: true, value: null, writable: true });
  try {
    ({ LabelTypeDropdown } = await loadModules('frontend/js/common/LabelTypePicker.js'));
  } finally {
    delete HTMLElement.prototype.popover;
  }
});

beforeEach(() => {
  installPopoverApi();
  opens = 0;
  picks = [];
  closes = 0;
  allowOpen = true;
});

afterEach(() => {
  delete HTMLElement.prototype.showPopover;
  delete HTMLElement.prototype.hidePopover;
});

test('the browser shows it: drawn through onOpen, focus on a chip, the button marked expanded', () => {
  const dropdown = build();
  expect(popover().hidden).toBe(false); // The browser's popover state hides it now, not `hidden`.
  expect(button().popoverTargetElement).toBe(popover());

  dropdown.setOpen(true);
  expect(dropdown.isOpen()).toBe(true);
  expect(opens).toBe(1);
  expect(button().getAttribute('aria-expanded')).toBe('true');
  expect(popover().contains(document.activeElement)).toBe(true);
});

test('an open that onOpen refuses never shows', () => {
  const dropdown = build();
  allowOpen = false;

  popover().showPopover(); // What the browser does for a click on the button.
  expect(dropdown.isOpen()).toBe(false);
  expect(button().getAttribute('aria-expanded')).toBe('false');
});

test('a pick closes it through the browser, and the host hears it closed', () => {
  const dropdown = build();
  dropdown.setOpen(true);

  popover().querySelector('[data-label-type="Signal"]').click();
  expect(dropdown.isOpen()).toBe(false);
  expect(button().getAttribute('aria-expanded')).toBe('false');
  expect(closes).toBe(1);
  expect(picks).toEqual(['Signal']);
});
