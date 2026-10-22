/**
 * Tests for the canned-reason vocabulary (frontend/js/common/validationReasons.js) and the chips that offer it
 * (frontend/js/common/ReasonChips.js), #5475.
 *
 * The vocabulary is read off the page stamp the backend writes (`window.validationReasons`), from the same committed
 * fixture ValidationReasonSpec holds to what the pages stamp (test/js/setup.js stamps it), so a reason offered here
 * is one the backend offers. The strings come from the real English locale file, so a reason with no text, a raw key
 * on screen, fails here.
 */

import fs from 'fs';
import path from 'path';
import { loadModules, mockModule, REPO_ROOT } from './loader.js';

const EN_COMMON = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'public/locales/en/common.json'), 'utf8'));

/** @returns {string|undefined} What the real English common.json holds at a `common:` key. */
function lookup(key) {
  const [ns, rest] = key.split(':');
  if (ns !== 'common') return undefined;
  return rest.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), EN_COMMON);
}

// An i18next stand-in over the real English common.json, so `exists` answers like the real thing.
mockModule('i18next', () => ({
  default: {
    t: (key) => (typeof lookup(key) === 'string' ? lookup(key) : key),
    exists: (key) => typeof lookup(key) === 'string',
  },
}));

let validationReasons;
let ReasonChips;
let stamp;

beforeEach(async () => {
  stamp = JSON.parse(JSON.stringify(window.validationReasons));
  ({ validationReasons, ReasonChips } = await loadModules(
    'frontend/js/common/validationReasons.js',
    'frontend/js/common/ReasonChips.js',
  ));
});

afterEach(() => {
  window.validationReasons = stamp; // A test may edit or drop the stamp; the next one gets the fixture back.
});

describe('validationReasons', () => {
  test('offers each type its reasons in the backend\'s order, and nothing for a type or vote with none', () => {
    expect(validationReasons.idsFor('CurbRamp', 'Disagree')).toEqual(['wrong-type', 'driveway', 'driveway-transition']);
    expect(validationReasons.idsFor('Crosswalk', 'Unsure')).toEqual(['better-image', 'placement-incorrect']);
    expect(validationReasons.idsFor('CurbRamp', 'Agree')).toEqual([]);
    expect(validationReasons.idsFor('Other', 'Disagree')).toEqual([]);
    expect(validationReasons.hasReasons('Obstacle', 'Unsure')).toBe(true);
    expect(validationReasons.hasReasons('Occlusion', 'Unsure')).toBe(false);
  });

  test('every stamped reason has English text, so no chip can render as a raw key', () => {
    const missing = [];
    for (const labelType of validationReasons.labelTypes()) {
      for (const vote of ['Disagree', 'Unsure']) {
        for (const id of validationReasons.idsFor(labelType, vote)) {
          if (validationReasons.text(id) === null) missing.push(`${labelType}/${vote}/${id}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('a type with its own wording for a shared reason gets it, and the rest get the generic tooltip', () => {
    // "Wrong type" explains itself differently per type; the generic line is the fallback for types without one.
    expect(validationReasons.tooltip('wrong-type', 'CurbRamp'))
      .toBe(EN_COMMON['validation-reason']['wrong-type']['tooltip-curb-ramp']);
    expect(validationReasons.tooltip('wrong-type', 'Crosswalk')).toBe(EN_COMMON['validation-reason']['wrong-type'].tooltip);
    expect(validationReasons.tooltip('driveway', 'CurbRamp')).toBeNull();
  });

  test('an unknown id resolves to no text rather than a key, and leaves the list rather than joining it', () => {
    window.validationReasons.CurbRamp.Disagree.push('brand-new-reason');
    expect(validationReasons.text('brand-new-reason')).toBeNull();
    expect(validationReasons.forLabel('CurbRamp', 'Disagree').map((r) => r.id))
      .toEqual(['wrong-type', 'driveway', 'driveway-transition']);
  });

  test('a page with no stamp gets empty lists, not an error', () => {
    delete window.validationReasons;
    expect(validationReasons.labelTypes()).toEqual([]);
    expect(validationReasons.forLabel('CurbRamp', 'Disagree')).toEqual([]);
  });
});

describe('ReasonChips', () => {
  let root;
  let onPick;
  let onOther;
  let chips;

  const chipEls = () => [...root.querySelectorAll('.reason-chips__group .reason-chips__chip')];
  const other = () => root.querySelector('.reason-chips__chip--other');

  beforeEach(() => {
    document.body.innerHTML = '<div id="row"></div>';
    root = document.getElementById('row');
    onPick = vi.fn();
    onOther = vi.fn();
    chips = new ReasonChips(root, { onPick, onOther, showKeys: true });
  });

  test('draws one toggle per reason under a prompt for the vote, plus Other, and hides for an Agree', () => {
    expect(root.hidden).toBe(true);
    expect(chips.render({ labelType: 'NoCurbRamp', vote: 'Disagree' })).toBe(4);
    expect(root.hidden).toBe(false);
    expect(root.classList.contains('reason-chips--disagree')).toBe(true);
    expect(root.querySelector('.reason-chips__prompt').textContent).toBe('Why do you disagree?');
    expect(chipEls().map((c) => c.dataset.reasonId))
      .toEqual(['wrong-type', 'residential-walkway', 'no-sidewalk-here', 'unsafe-crossing']);
    expect(chipEls()[1].textContent).toBe('This is a residential walkway');
    expect(other().textContent).toBe('Other…');
    // The number keys are named where the host routes them, tooltips only, so the chip text stays the reason.
    expect(other().getAttribute('data-ps-tooltip')).toBe('Write your own reason (5)');
    expect(chipEls()[0].getAttribute('data-ps-tooltip')).toMatch(/\(1\)$/);

    expect(chips.render({ labelType: 'NoCurbRamp', vote: 'Unsure' })).toBe(3);
    expect(root.querySelector('.reason-chips__prompt').textContent).toBe('What makes you unsure?');
    expect(root.classList.contains('reason-chips--unsure')).toBe(true);

    expect(chips.render({ labelType: 'NoCurbRamp', vote: 'Agree' })).toBe(0);
    expect(root.hidden).toBe(true);
    expect(chips.render({ labelType: 'Other', vote: 'Disagree' })).toBe(0);
    expect(root.hidden).toBe(true);
  });

  test('is a named group of toggles with a roving tabindex that arrow keys move without picking', () => {
    chips.render({ labelType: 'Obstacle', vote: 'Disagree' });
    const group = root.querySelector('[role="group"]');
    expect(group.getAttribute('aria-labelledby')).toBe(root.querySelector('.reason-chips__prompt').id);
    // "Other…" opens a box rather than picking, so it stands beside the group, not among its toggles.
    expect(group.contains(other())).toBe(false);
    expect(root.querySelector('.reason-chips__list').contains(other())).toBe(true);
    expect(chipEls().map((c) => c.tabIndex)).toEqual([0, -1, -1]);
    expect(chipEls().map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);

    chipEls()[0].focus();
    chipEls()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(chipEls()[1]);
    expect(chipEls().map((c) => c.tabIndex)).toEqual([-1, 0, -1]);
    chipEls()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    chipEls()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(chipEls()[2]); // Wraps.
    expect(onPick).not.toHaveBeenCalled();
  });

  test('a click picks, telling the host whether the keyboard did it, and re-picking the selection is a no-op', () => {
    chips.render({ labelType: 'Obstacle', vote: 'Disagree' });
    chipEls()[2].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(onPick).toHaveBeenCalledWith('ample-space', false);
    chipEls()[1].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(onPick).toHaveBeenLastCalledWith('not-pedestrian-path', true);

    // The host reflects the server's answer; until it does, nothing is selected.
    expect(chips.getSelected()).toBeNull();
    chips.setSelected('ample-space');
    expect(chipEls()[2].getAttribute('aria-pressed')).toBe('true');
    expect(chipEls()[2].classList.contains('reason-chips__chip--selected')).toBe(true);
    expect(chipEls().map((c) => c.tabIndex)).toEqual([-1, -1, 0]);
    onPick.mockClear();
    chipEls()[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPick).not.toHaveBeenCalled();

    other().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(onOther).toHaveBeenCalledWith(false);
  });

  test('renders a reason already on record as selected', () => {
    chips.render({ labelType: 'SurfaceProblem', vote: 'Unsure', selected: 'too-minor-unsure' });
    expect(chipEls().map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
  });

  test('number keys pick 1–N, N+1 is Other, and anything else is left to the page', () => {
    chips.render({ labelType: 'Crosswalk', vote: 'Unsure' }); // Two reasons.
    expect(chips.pickByNumber(2)).toBe(true);
    expect(onPick).toHaveBeenCalledWith('placement-incorrect', true);
    expect(chips.pickByNumber(3)).toBe(true);
    expect(onOther).toHaveBeenCalledWith(true);
    expect(chips.pickByNumber(4)).toBe(false);
    expect(chips.pickByNumber(0)).toBe(false);

    chips.render({ labelType: 'Crosswalk', vote: 'Agree' });
    expect(chips.isShowing).toBe(false);
    expect(chips.pickByNumber(1)).toBe(false);
  });

  test('showOther: false draws no "Other…" button, but N+1 still reaches the host', () => {
    chips = new ReasonChips(root, { onPick, onOther, showOther: false });
    chips.render({ labelType: 'Crosswalk', vote: 'Unsure' });
    expect(other()).toBeNull();
    expect(chips.pickByNumber(3)).toBe(true);
    expect(onOther).toHaveBeenCalledWith(true);
  });

  test('takes no pick while busy, and keeps focus on the row across a redraw', () => {
    chips.render({ labelType: 'Obstacle', vote: 'Disagree' });
    chips.setBusy(true);
    expect(root.classList.contains('reason-chips--busy')).toBe(true);
    expect(chipEls()[0].getAttribute('aria-disabled')).toBe('true');
    chipEls()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(chips.pickByNumber(1)).toBe(true); // Claimed, so the key doesn't fall through to the page.
    expect(onPick).not.toHaveBeenCalled();
    chips.setBusy(false);

    chips.focus();
    expect(document.activeElement).toBe(chipEls()[0]);
    // A redraw keeps focus on the chip that had it, so a host re-rendering mid-arrow-navigation doesn't move it;
    // only when that chip is gone does focus fall to the selected one.
    chipEls()[1].focus();
    chips.render({ labelType: 'Obstacle', vote: 'Disagree', selected: 'ample-space' });
    expect(document.activeElement).toBe(chipEls()[1]);
    chips.render({ labelType: 'Crosswalk', vote: 'Disagree', selected: 'stop-line' });
    expect(document.activeElement).toBe(chipEls()[2]);
  });
});
