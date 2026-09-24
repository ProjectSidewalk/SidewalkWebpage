/**
 * Tests for the number-key shortcuts in Validate's KeyboardManager (public/js/validate/src/keyboard/
 * KeyboardManager.js), covering the fourth Missing Curb Ramp disagree reason added for #4871, plus the Ctrl+Z undo
 * that shares the manager's key handling.
 *
 * The reason buttons are one fixed set of elements reused across label types, and `defaultOption` is the flag saying
 * "this type offers this reason" — so the same keypress has to mean different things depending on the label on screen.
 * The rule these pin down: a number key picks the reason it maps to when the type offers it, and otherwise focuses the
 * comment box. That makes the comment box key move from 4 to 5 on the one type with a fourth reason, and leaves it on
 * 4 everywhere else.
 *
 * Loaded the same way as validateLabelCardKeyboard.test.js: the class is a plain top-level declaration, so the source
 * is eval'd with an explicit export and one instance serves the whole file (the constructor registers a window
 * listener that cannot be unregistered).
 */

const fs = require('fs');
const path = require('path');

const MANAGER_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/validate/src/keyboard/KeyboardManager.js'), 'utf8'
);

/** A stand-in for one of the menu's jQuery-wrapped controls; `chosen` drives which verdict is selected. */
function makeControl({ chosen = false } = {}) {
    return {
        on: () => {},
        0: document.createElement('textarea'),
        click: jest.fn(),
        hasClass: (cls) => cls === 'chosen' && chosen,
    };
}

/**
 * Dispatches a number keydown. Both `code` and `key` are set because the manager switches on `code` but reads the
 * digit off `key`.
 */
function pressDigit(n) {
    window.dispatchEvent(new KeyboardEvent('keydown', {
        code: `Digit${n}`, key: String(n), bubbles: true, cancelable: true,
    }));
}

/** The reason buttons a label type offers, as `#renderReasonButtons` leaves the DOM for that type. */
function renderReasons(offered) {
    document.body.innerHTML = [1, 2, 3, 4]
        .map((n) => `<button id="no-button-${n}" class="${offered.includes(n) ? 'defaultOption' : ''}"></button>`)
        .join('');
}

describe('KeyboardManager number-key shortcuts', () => {
    const validationMenuUi = {};
    const clicks = [];

    beforeAll(() => {
        Object.assign(validationMenuUi, {
            optionalCommentTextBox: makeControl(),
            disagreeReasonTextBox: makeControl(),
            unsureReasonTextBox: makeControl(),
            submitButton: makeControl(),
            yesButton: makeControl(),
            noButton: makeControl(),
            unsureButton: makeControl(),
        });

        // Minimal jQuery stand-in over the real DOM: the manager only asks a selector for `hasClass` and `click`.
        window.$ = (selector) => {
            const el = document.querySelector(selector);
            return {
                hasClass: (cls) => !!el && el.classList.contains(cls),
                click: () => { if (el) clicks.push(el.id); },
            };
        };

        window.eval(`${MANAGER_SRC}\nwindow.KeyboardManager = KeyboardManager;`);
        new window.KeyboardManager(validationMenuUi);
    });

    beforeEach(() => {
        clicks.length = 0;
        window.svv = {
            labelVisibilityControl: { hideLabelCard: jest.fn(), isVisible: () => true },
            tracker: { push: jest.fn() },
        };
        for (const box of ['optionalCommentTextBox', 'disagreeReasonTextBox', 'unsureReasonTextBox']) {
            validationMenuUi[box].click = jest.fn();
        }
    });

    /**
     * Selects a verdict, as clicking Agree / Disagree / Unsure would. 'wrongType' is Disagree with the "wrong label
     * type" reason picked on Expert Validate, where the menu swaps the reasons for the type picker's section.
     */
    function choose(verdict) {
        validationMenuUi.yesButton = makeControl({ chosen: verdict === 'yes' });
        validationMenuUi.noButton = makeControl({ chosen: verdict === 'no' || verdict === 'wrongType' });
        validationMenuUi.unsureButton = makeControl({ chosen: verdict === 'unsure' });
        window.svv.validationMenu = { inWrongTypeView: () => verdict === 'wrongType' };
    }

    describe('on a label type with a fourth disagree reason (Missing Curb Ramp)', () => {
        beforeEach(() => {
            renderReasons([1, 2, 3, 4]);
            choose('no');
        });

        it('4 picks the fourth reason', () => {
            pressDigit(4);

            expect(clicks).toEqual(['no-button-4']);
            expect(validationMenuUi.disagreeReasonTextBox.click).not.toHaveBeenCalled();
        });

        it('5 focuses the comment box, which 4 no longer reaches', () => {
            pressDigit(5);

            expect(clicks).toEqual([]);
            expect(validationMenuUi.disagreeReasonTextBox.click).toHaveBeenCalledTimes(1);
        });

        it('1-3 still pick their own reasons', () => {
            pressDigit(1);
            pressDigit(2);
            pressDigit(3);

            expect(clicks).toEqual(['no-button-1', 'no-button-2', 'no-button-3']);
        });
    });

    describe('on a label type with three disagree reasons', () => {
        beforeEach(() => {
            // The fourth button is still in the DOM for every type — only the `defaultOption` flag differs.
            renderReasons([1, 2, 3]);
            choose('no');
        });

        it('4 focuses the comment box rather than picking the hidden fourth button', () => {
            pressDigit(4);

            expect(clicks).toEqual([]);
            expect(validationMenuUi.disagreeReasonTextBox.click).toHaveBeenCalledTimes(1);
        });

        it('5 focuses the comment box too', () => {
            pressDigit(5);

            expect(validationMenuUi.disagreeReasonTextBox.click).toHaveBeenCalledTimes(1);
        });

        it('1-3 still pick their own reasons', () => {
            pressDigit(2);

            expect(clicks).toEqual(['no-button-2']);
        });
    });

    describe('on the "wrong label type" disagree (Expert Validate, #3671, #5409)', () => {
        /** The severity section as the menu leaves it: shown only once a rated type is picked. */
        function renderSeveritySection(shown) {
            document.body.innerHTML = `
                <div id="validate-severity-section" style="display: ${shown ? 'block' : 'none'}"></div>
                <label id="severity-button-1"><input type="radio" id="validate-severity-radio-1"></label>
                <label id="severity-button-2"><input type="radio" id="validate-severity-radio-2"></label>`;
        }

        beforeEach(() => {
            window.svv.adminVersion = true;
            choose('wrongType');
        });

        it('digits rate severity by clicking the radio once a type with a rating has been picked', () => {
            renderSeveritySection(true);

            pressDigit(2);

            expect(clicks).toEqual(['validate-severity-radio-2']);
        });

        it('digits do nothing while the severity section is hidden, so no rating rides along unseen', () => {
            renderSeveritySection(false);

            pressDigit(2);

            expect(clicks).toEqual([]);
            expect(validationMenuUi.optionalCommentTextBox.click).not.toHaveBeenCalled();
        });

        it('4 and 5 reach the comment box rather than severity buttons that do not exist', () => {
            renderSeveritySection(true);

            pressDigit(4);
            pressDigit(5);

            expect(clicks).toEqual([]);
            expect(validationMenuUi.optionalCommentTextBox.click).toHaveBeenCalledTimes(2);
        });

        it('C reaches the optional comment box, not the hidden disagree reason box', () => {
            renderSeveritySection(false);
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', bubbles: true }));

            expect(validationMenuUi.optionalCommentTextBox.click).toHaveBeenCalledTimes(1);
            expect(validationMenuUi.disagreeReasonTextBox.click).not.toHaveBeenCalled();
        });
    });

    describe('Enter', () => {
        /** Presses Enter from whatever has focus. */
        function pressEnter() {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }));
        }

        beforeEach(() => {
            document.body.innerHTML = '<input id="select-tag-ts-control" type="text"><input id="other" type="text">';
            validationMenuUi.submitButton.click = jest.fn();
        });

        afterEach(() => {
            document.body.innerHTML = ''; // Drops the focused box, which would otherwise mute the shortcuts below.
        });

        it('submits from anywhere else, a comment box included', () => {
            document.getElementById('other').focus();
            pressEnter();

            expect(validationMenuUi.submitButton.click).toHaveBeenCalled();
        });

        it('is the tag picker\'s own key while its box has focus, so it does not submit', () => {
            document.getElementById('select-tag-ts-control').focus();
            pressEnter();

            expect(validationMenuUi.submitButton.click).not.toHaveBeenCalled();
        });
    });

    describe('Ctrl+Z, the other way to press Back (#5409)', () => {
        let undoButton;

        /** Presses Ctrl+Z, or Cmd+Z when `mac` is set. */
        function pressUndo({ mac = false } = {}) {
            window.dispatchEvent(new KeyboardEvent('keydown', {
                code: 'KeyZ', key: 'z', ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true,
            }));
        }

        beforeEach(() => {
            undoButton = makeControl();
            window.svv.ui = { undoValidation: { undoButton } };
            window.svv.undoValidation = { canUndo: () => true };
            window.svv.zoomControl = { zoomIn: jest.fn(), zoomOut: jest.fn() };
        });

        it('clicks Back', () => {
            pressUndo();

            expect(undoButton.click).toHaveBeenCalledTimes(1);
        });

        it('works as Cmd+Z, without the bare Z zoom riding along', () => {
            pressUndo({ mac: true });

            expect(undoButton.click).toHaveBeenCalledTimes(1);
            expect(window.svv.zoomControl.zoomIn).not.toHaveBeenCalled();
            expect(window.svv.zoomControl.zoomOut).not.toHaveBeenCalled();
        });

        it('does nothing while Back is disabled', () => {
            window.svv.undoValidation.canUndo = () => false;

            pressUndo();

            expect(undoButton.click).not.toHaveBeenCalled();
        });

        it('leaves the comment box to the browser, where it undoes what was typed', () => {
            const commentBox = validationMenuUi.optionalCommentTextBox[0];
            document.body.appendChild(commentBox);
            commentBox.focus();

            pressUndo();

            expect(undoButton.click).not.toHaveBeenCalled();
            commentBox.remove();
        });
    });

    describe('on the other verdicts', () => {
        it('4 and 5 focus the optional comment box on Agree, never a severity button', () => {
            renderReasons([1, 2, 3, 4]);
            choose('yes');

            pressDigit(4);
            pressDigit(5);

            expect(clicks).toEqual([]);
            expect(validationMenuUi.optionalCommentTextBox.click).toHaveBeenCalledTimes(2);
        });

        it('4 and 5 focus the comment box on Unsure', () => {
            renderReasons([1, 2, 3, 4]);
            choose('unsure');

            pressDigit(4);
            pressDigit(5);

            expect(clicks).toEqual([]);
            expect(validationMenuUi.unsureReasonTextBox.click).toHaveBeenCalledTimes(2);
        });
    });
});
