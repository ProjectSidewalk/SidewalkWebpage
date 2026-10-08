/**
 * Tests for the label-card keyboard scope in Validate's KeyboardManager (frontend/js/validate/keyboard/
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

const { loadModules } = require('./loadGlobalScript');


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
        Object.assign(window, loadModules('frontend/js/common/KeyboardShortcuts.js', 'frontend/js/validate/keyboard/KeyboardManager.js'));
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
                isCardHeldOpen: () => false,
                toggleLabelCard: jest.fn(),
                // The card starts open in most tests; the Escape-against-nothing case flips this.
                isCardVisible: () => true,
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

        it('marks the toggle as a keyboard open, so it is not logged as a pointer hover', () => {
            key('Enter', marker());

            expect(window.svv.labelVisibilityControl.toggleLabelCard)
                .toHaveBeenCalledWith({ viaKeyboard: true });
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
            expect(window.svv.tracker.push).toHaveBeenCalledWith('KeyboardShortcut_HideLabelCard', expect.anything());
            expect(document.activeElement).toBe(marker());
        });

        it('Escape with the card already closed logs nothing, but still keeps focus on the marker', () => {
            window.svv.labelVisibilityControl.isCardVisible = () => false;
            marker().focus();
            key('Escape', marker());

            expect(window.svv.labelVisibilityControl.hideLabelCard).not.toHaveBeenCalled();
            expect(window.svv.tracker.push).not.toHaveBeenCalled();
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

    // Infra3d cities open the card on load and keep it up until something deliberate (#5675).
    describe('a card opened on load', () => {
        beforeEach(() => {
            window.svv.labelVisibilityControl.isCardHeldOpen = () => true;
        });

        it('stays up through keys that aren\'t meant to close it', () => {
            key('KeyQ', document.body); // Unbound, which today would take a hovered card down.

            expect(window.svv.labelVisibilityControl.hideLabelCard).not.toHaveBeenCalled();
        });

        it('closes on Escape from anywhere, logged as a keyboard hide, without moving focus to the marker', () => {
            key('Escape', document.body);

            expect(window.svv.labelVisibilityControl.hideLabelCard).toHaveBeenCalledTimes(1);
            expect(window.svv.tracker.push).toHaveBeenCalledWith('KeyboardShortcut_HideLabelCard', expect.anything());
            expect(document.activeElement).not.toBe(marker());
        });
    });

    it('Escape outside the scope does nothing to a card that was only hovered open', () => {
        key('Escape', document.body);

        expect(window.svv.tracker.push).not.toHaveBeenCalled();
    });
});
