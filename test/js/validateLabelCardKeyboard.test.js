/**
 * Tests for the label-card keyboard scope in Validate's KeyboardManager (public/js/validate/src/keyboard/
 * KeyboardManager.js), added for #4729.
 *
 * The manager listens on window with capture and treats most keys as global shortcuts — Enter submits the current
 * validation from anywhere. The marker and the card it opens are the exception: while focus is on either, keys
 * belong to them (Enter/Space toggles the card, Escape closes it and returns focus to the marker, Tab walks the
 * card's controls) and none of the global shortcuts may fire. These tests pin that boundary from both sides, since
 * a regression on the inside submits validations from a control that means "open", and one on the outside breaks
 * every existing shortcut.
 *
 * The class is a plain top-level declaration, so the source is eval'd with an explicit export, the same way
 * share-widget.test.js loads ShareWidget. One instance is created for the whole file — the constructor registers a
 * window listener that cannot be unregistered — and each test swaps the svv/menu stubs it reads at event time.
 */

const fs = require('fs');
const path = require('path');

const MANAGER_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/validate/src/keyboard/KeyboardManager.js'), 'utf8'
);

/** A stand-in for one of the menu's jQuery-wrapped controls. */
function makeControl() {
    return { on: () => {}, 0: document.createElement('textarea'), click: jest.fn(), hasClass: () => false };
}

/** Dispatches a keydown with the given code on a target, returning the event for defaultPrevented checks. */
function key(code, target) {
    const ev = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
}

describe('KeyboardManager label-card scope', () => {
    // Shared across tests: the constructor's window listener reads these objects' properties at event time.
    const validationMenuUi = {};

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
        window.eval(`${MANAGER_SRC}\nwindow.KeyboardManager = KeyboardManager;`);
        new window.KeyboardManager(validationMenuUi);
    });

    beforeEach(() => {
        document.body.innerHTML = `
          <div id="view-control-layer"><div id="validate-pano-marker" tabindex="0"></div></div>
          <div id="label-card"><button type="button" id="label-visibility-button-on-label"></button></div>`;
        validationMenuUi.submitButton.click = jest.fn();
        validationMenuUi.yesButton = makeControl();
        window.svv = {
            labelVisibilityControl: {
                hideLabelCard: jest.fn(),
                toggleLabelCard: jest.fn(),
                isVisible: () => true,
                hideLabel: jest.fn(),
                unhideLabel: jest.fn(),
            },
            tracker: { push: jest.fn() },
            undoValidation: { canUndo: () => false },
        };
    });

    const marker = () => document.getElementById('validate-pano-marker');
    const cardButton = () => document.getElementById('label-visibility-button-on-label');

    describe('inside the scope', () => {
        it('Enter on the marker toggles the card instead of submitting the validation', () => {
            const ev = key('Enter', marker());

            expect(window.svv.labelVisibilityControl.toggleLabelCard).toHaveBeenCalledTimes(1);
            expect(validationMenuUi.submitButton.click).not.toHaveBeenCalled();
            expect(ev.defaultPrevented).toBe(true);
        });

        it('Space on the marker toggles the card', () => {
            const ev = key('Space', marker());

            expect(window.svv.labelVisibilityControl.toggleLabelCard).toHaveBeenCalledTimes(1);
            expect(ev.defaultPrevented).toBe(true); // Space would otherwise also scroll the page.
        });

        it('Escape inside the card closes it and puts focus back on the marker', () => {
            cardButton().focus();
            key('Escape', cardButton());

            expect(window.svv.labelVisibilityControl.hideLabelCard).toHaveBeenCalledTimes(1);
            expect(document.activeElement).toBe(marker());
        });

        it('Tab on the marker does not blanket-hide the card, so it can be tabbed into', () => {
            key('Tab', marker());

            expect(window.svv.labelVisibilityControl.hideLabelCard).not.toHaveBeenCalled();
        });

        it('validation shortcuts do not fire from inside the card', () => {
            key('KeyY', cardButton());

            expect(validationMenuUi.yesButton.click).not.toHaveBeenCalled();
        });
    });

    describe('outside the scope', () => {
        it('Enter still submits the validation', () => {
            key('Enter', document.body);

            expect(validationMenuUi.submitButton.click).toHaveBeenCalledTimes(1);
        });

        it('shortcut keys still act and still take the card down', () => {
            key('KeyY', document.body);

            expect(validationMenuUi.yesButton.click).toHaveBeenCalledTimes(1);
            expect(window.svv.labelVisibilityControl.hideLabelCard).toHaveBeenCalledTimes(1);
        });
    });
});
