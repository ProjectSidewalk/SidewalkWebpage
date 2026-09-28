/**
 * Tests for the image adjustments keyboard scope in Validate's KeyboardManager (public/js/validate/src/keyboard/
 * KeyboardManager.js), added for #5501.
 *
 * The manager listens on window with capture and treats most keys as global shortcuts, Enter submitting the current
 * validation from anywhere. The image adjustments panel is an exception: while focus is inside it, or while it is
 * open at all, keys belong to the sliders and to the panel's own Escape handler, and no shortcut may fire. The pills
 * in the pano's top-left group (Hide label, Image) are a narrower exception: Enter and Space activate the focused
 * pill rather than submitting, while the letter shortcuts keep working, since a mouse click leaves focus on the pill.
 * These tests pin both boundaries: a regression inside submits or re-labels from a slider, and one outside breaks
 * the shortcuts a validator uses right after clicking a pill.
 *
 * Loaded the same way as validateLabelCardKeyboard.test.js: the class is a plain top-level declaration, so the
 * source is eval'd with an explicit export, and one instance serves the whole file because the constructor registers
 * a window listener that cannot be unregistered. Each test swaps the svv/menu stubs it reads at event time.
 */

const fs = require('fs');
const path = require('path');

const MANAGER_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/validate/src/keyboard/KeyboardManager.js'), 'utf8'
);

/** A stand-in for one of the menu's controls, with its click spied. */
function makeControl() {
    const control = document.createElement('textarea');
    control.click = jest.fn();
    return control;
}

/** Dispatches a keydown with the given code on a target, returning the event for defaultPrevented checks. */
function key(code, target) {
    const ev = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
}

describe('KeyboardManager image adjustments scope', () => {
    // Shared across tests: the constructor's window listener reads these objects' properties at event time.
    const validationMenuUi = {};
    let panelOpen;

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
          <div id="label-visibility-control-holder">
            <button type="button" id="label-visibility-control-button"></button>
            <button type="button" id="validate-control-image"></button>
          </div>
          <div id="label-card"><button type="button" id="label-visibility-button-on-label"></button></div>
          <div id="pano-image-adjustments" popover="manual">
            <input type="range" id="pano-image-adjustments-shadows" data-adjust="shadows">
          </div>`;
        panelOpen = false;
        validationMenuUi.submitButton.click = jest.fn();
        validationMenuUi.yesButton = makeControl();
        window.svv = {
            imageAdjustmentsPopover: { isOpen: () => panelOpen },
            labelVisibilityControl: {
                hideLabelCard: jest.fn(),
                toggleLabelCard: jest.fn(),
                isCardVisible: () => true,
                isVisible: () => true,
                hideLabel: jest.fn(),
                unhideLabel: jest.fn(),
            },
            tracker: { push: jest.fn() },
            undoValidation: { canUndo: () => false },
        };
    });

    const pill = () => document.getElementById('validate-control-image');
    const hideLabelToggle = () => document.getElementById('label-visibility-control-button');
    const slider = () => document.getElementById('pano-image-adjustments-shadows');

    describe('the top-left pills', () => {
        it('Enter on the Image pill is left to the button instead of submitting the validation', () => {
            const ev = key('Enter', pill());

            expect(ev.defaultPrevented).toBe(false);
            expect(validationMenuUi.submitButton.click).not.toHaveBeenCalled();
        });

        it('Enter on the hide-label toggle is left to the button instead of submitting the validation', () => {
            const ev = key('Enter', hideLabelToggle());

            expect(ev.defaultPrevented).toBe(false);
            expect(validationMenuUi.submitButton.click).not.toHaveBeenCalled();
        });

        it('Space on a pill does not reach the shortcuts', () => {
            key('Space', pill());

            expect(window.svv.labelVisibilityControl.hideLabelCard).not.toHaveBeenCalled();
        });

        it('letter shortcuts still fire from a pill a mouse click left focused', () => {
            key('KeyY', hideLabelToggle());

            expect(validationMenuUi.yesButton.click).toHaveBeenCalledTimes(1);
        });
    });

    describe('inside the panel', () => {
        it.each(['Enter', 'NumpadEnter', 'KeyS'])('%s on a slider neither submits nor hides the card', (code) => {
            const ev = key(code, slider());

            expect(ev.defaultPrevented).toBe(false);
            expect(validationMenuUi.submitButton.click).not.toHaveBeenCalled();
            expect(window.svv.labelVisibilityControl.hideLabelCard).not.toHaveBeenCalled();
        });

        it('KeyY on a slider does not agree', () => {
            key('KeyY', slider());

            expect(validationMenuUi.yesButton.click).not.toHaveBeenCalled();
            expect(window.svv.labelVisibilityControl.hideLabelCard).not.toHaveBeenCalled();
        });

        it('Arrow keys on a slider reach no shortcut', () => {
            const ev = key('ArrowRight', slider());

            expect(ev.defaultPrevented).toBe(false);
            expect(window.svv.labelVisibilityControl.hideLabelCard).not.toHaveBeenCalled();
        });

        it('Escape on a slider is left to the panel rather than closing the label card', () => {
            key('Escape', slider());

            expect(window.svv.labelVisibilityControl.hideLabelCard).not.toHaveBeenCalled();
            expect(window.svv.tracker.push).not.toHaveBeenCalled();
        });
    });

    describe('while the panel is open', () => {
        it('KeyY on the body is inert, since a click on the panel whitespace leaves focus there', () => {
            panelOpen = true;
            key('KeyY', document.body);

            expect(validationMenuUi.yesButton.click).not.toHaveBeenCalled();
            expect(window.svv.labelVisibilityControl.hideLabelCard).not.toHaveBeenCalled();
        });

        it('Escape inside the label card is left to the panel', () => {
            panelOpen = true;
            key('Escape', document.getElementById('label-visibility-button-on-label'));

            expect(window.svv.labelVisibilityControl.hideLabelCard).not.toHaveBeenCalled();
        });
    });

    describe('with the panel closed', () => {
        it('shortcuts on the body still act', () => {
            key('KeyY', document.body);
            key('Enter', document.body);

            expect(validationMenuUi.yesButton.click).toHaveBeenCalledTimes(1);
            expect(validationMenuUi.submitButton.click).toHaveBeenCalledTimes(1);
        });

        it('still works on a page without the panel, where there is no popover object', () => {
            delete window.svv.imageAdjustmentsPopover;
            document.getElementById('pano-image-adjustments').remove();
            key('KeyY', document.body);

            expect(validationMenuUi.yesButton.click).toHaveBeenCalledTimes(1);
        });
    });
});
