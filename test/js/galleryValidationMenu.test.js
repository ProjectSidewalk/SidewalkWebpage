/**
 * Tests the vote buttons on a Gallery card (public/js/gallery/src/validation/ValidationMenu.js, #5517).
 *
 * Each button keeps its own color class for its whole life, and a vote only adds or removes `is-selected` and flips
 * `aria-pressed`. Overwriting the class list instead would wipe the color class and turn the button white.
 */

const fs = require('fs');
const path = require('path');

const { REPO_ROOT } = require('./loadGlobalScript');

const SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/gallery/src/validation/ValidationMenu.js'), 'utf8');

/**
 * @param {?string} userValidation - The vote the viewer already had on this label when the page loaded.
 * @returns {{menu: Object, card: HTMLElement}} A menu built on a fresh card, and that card.
 */
function makeMenu(userValidation = null) {
  const card = document.createElement('div');
  const image = document.createElement('div');
  card.append(image);
  document.body.replaceChildren(card);
  const props = { user_validation: userValidation, from_current_user: false };
  const refCard = {
    getProperty: (key) => props[key],
    validationInfoDisplay: { agreeContainer: document.createElement('div'),
      disagreeContainer: document.createElement('div'), setVoteIconFilled: () => {} },
  };
  return { menu: new window.ValidationMenu(refCard, image), card };
}

/**
 * @param {string} option - 'agree', 'disagree', or 'unsure'.
 * @returns {HTMLButtonElement} That option's button on the current card.
 */
const button = (option) => document.querySelector(`.gallery-card-${option}-button`);

describe('Gallery card vote buttons', () => {
  beforeAll(() => {
    window.i18next = { t: (key) => key };
    window.eval(`${SRC}\nwindow.ValidationMenu = ValidationMenu;`);
  });

  it('starts with nothing pressed', () => {
    makeMenu();

    for (const option of ['agree', 'disagree', 'unsure']) {
      expect(button(option).classList.contains('is-selected')).toBe(false);
      expect(button(option).getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('marks an earlier vote as pressed on load', () => {
    makeMenu('Disagree');

    expect(button('disagree').classList.contains('is-selected')).toBe(true);
    expect(button('disagree').getAttribute('aria-pressed')).toBe('true');
  });

  it('moves the pressed state when the vote changes, keeping each button\'s own class', () => {
    const { menu, card } = makeMenu('Agree');

    menu.showValidationOnCard('Unsure');

    expect(button('agree').className).toBe('validation-button gallery-card-agree-button');
    expect(button('agree').getAttribute('aria-pressed')).toBe('false');
    expect(button('unsure').classList.contains('gallery-card-unsure-button')).toBe(true);
    expect(button('unsure').classList.contains('is-selected')).toBe(true);
    expect(button('unsure').getAttribute('aria-pressed')).toBe('true');
    expect(card.classList.contains('validate-unsure')).toBe(true);
    expect(card.classList.contains('validate-agree')).toBe(false);
  });

  it('clears the pressed state when the vote is taken back', () => {
    const { menu, card } = makeMenu('Agree');

    menu.showValidationOnCard(null);

    expect(button('agree').classList.contains('is-selected')).toBe(false);
    expect(button('agree').getAttribute('aria-pressed')).toBe('false');
    expect(card.classList.contains('validate-agree')).toBe(false);
  });
});
