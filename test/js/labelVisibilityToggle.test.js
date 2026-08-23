/**
 * Tests for public/js/common/LabelVisibilityToggle.js, the Hide-label control shared by Validate and the label
 * detail card (#2477).
 *
 * What its two hosts depend on: every button it owns reads the same (Validate has two running one action), only a
 * real click reports viaClick so the host logs nothing for its own re-asserts, and an unchanged state still reaches
 * the host — that call is how PopupPanoManager gets the hidden class onto a marker it just rebuilt.
 */

const fs = require('fs');
const path = require('path');

const TOGGLE_PATH = path.resolve(__dirname, '..', '..', 'public/js/common/LabelVisibilityToggle.js');

/** Load LabelVisibilityToggle.js (a plain top-level class declaration, concatenation-style). */
function loadToggle() {
  const src = fs.readFileSync(TOGGLE_PATH, 'utf8');
  return (0, eval)(`${src}\nLabelVisibilityToggle;`);
}

const TEXT = {
  hide: 'Hide Label',
  show: 'Show Label',
  hideTooltip: 'Temporarily hide the label.',
  showTooltip: 'Show the label again.',
};

describe('LabelVisibilityToggle', () => {
  const LabelVisibilityToggle = loadToggle();
  let buttons;
  let changes;

  /** @param {Array<?HTMLElement>} [over] - Buttons to hand it; defaults to both of the pair. */
  function build(over) {
    return new LabelVisibilityToggle({
      buttons: over ?? buttons,
      text: TEXT,
      onChange: (visible, detail) => changes.push({ visible, ...detail }),
    });
  }

  beforeEach(() => {
    document.body.innerHTML = '<button id="a"></button><button id="b"></button>';
    buttons = [document.getElementById('a'), document.getElementById('b')];
    changes = [];
  });

  it('starts visible, offering to hide', () => {
    const toggle = build();

    expect(toggle.isVisible()).toBe(true);
    for (const button of buttons) {
      expect(button.textContent).toContain(TEXT.hide);
      expect(button.getAttribute('data-ps-tooltip')).toBe(TEXT.hideTooltip);
      expect(button.querySelector('svg.hide-label-button-icon')).not.toBeNull();
    }
    expect(changes).toEqual([{ visible: true, viaClick: false }]);
  });

  it('relabels every button when one of them is clicked', () => {
    const toggle = build();

    buttons[0].click();

    expect(toggle.isVisible()).toBe(false);
    for (const button of buttons) {
      expect(button.textContent).toContain(TEXT.show);
      expect(button.getAttribute('data-ps-tooltip')).toBe(TEXT.showTooltip);
    }
    expect(changes.at(-1)).toEqual({ visible: false, viaClick: true });
  });

  it('flips back when the other button is clicked', () => {
    const toggle = build();

    buttons[0].click();
    buttons[1].click();

    expect(toggle.isVisible()).toBe(true);
    expect(buttons[0].textContent).toContain(TEXT.hide);
    expect(changes.at(-1)).toEqual({ visible: true, viaClick: true });
  });

  it('reports a host-driven change as not a click, so only real clicks are logged', () => {
    const toggle = build();

    toggle.setVisible(false);

    expect(changes.at(-1)).toEqual({ visible: false, viaClick: false });
  });

  it('notifies the host even when the state is unchanged, so a rebuilt marker gets it', () => {
    const toggle = build();
    changes.length = 0;

    toggle.setVisible(true);

    expect(toggle.isVisible()).toBe(true);
    expect(changes).toEqual([{ visible: true, viaClick: false }]);
  });

  it('ignores a button a host does not render', () => {
    const toggle = build([buttons[0], null]);

    buttons[0].click();

    expect(toggle.isVisible()).toBe(false);
  });
});
