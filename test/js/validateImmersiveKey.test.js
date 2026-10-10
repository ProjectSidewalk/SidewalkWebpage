/**
 * Validate's F shortcut for immersive mode (frontend/js/validate/keyboard/KeyboardManager.js, #5560).
 *
 * The key is Explore's, and the same two things keep it from firing by accident: an f typed anywhere editable is text,
 * and F with a modifier belongs to the browser. What is Validate's own is where the check sits: after the marker and
 * label-card scope and the image-adjustments scope, which take every key of theirs, and before the verdict letters,
 * which the mode never touches. Loaded the way validateNumberKeyShortcuts.test.js loads the manager: eval'd with an
 * explicit export, one instance for the file, since the constructor's window listener cannot be unregistered.
 */

const { loadModules } = require('./loadGlobalScript');


/** A menu control with its click spied; a real element, since the manager compares against document.activeElement. */
function makeControl() {
    const control = document.createElement('textarea');
    control.click = jest.fn();
    return control;
}

describe('Validate F shortcut for immersive mode', () => {
    const validationMenuUi = {};
    // The manager keeps the collaborators it was built with, so each test swaps the objects behind these proxies.
    let current = {};
    const live = (name) => new Proxy({}, { get: (_, key) => current[name][key] });
    const config = { adminVersion: false };

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
        new window.KeyboardManager(
            { validationMenu: validationMenuUi, undoValidation: { undoButton: live('undoButton') } }, config,
            { isDisabled: () => false, disableKeyboard: () => {}, enableKeyboard: () => {} },
            { onLoadingChange: () => {} }, live('labelVisibilityControl'), live('labelCard'), live('validationMenu'),
            live('zoomControl'), live('undoValidation'), live('immersiveMode'), live('imageAdjustmentsPopover'),
            live('tracker'),
        );
    });

    beforeEach(() => {
        document.body.innerHTML = '<input id="field"><div id="note" contenteditable="true"></div>';
        current = {
            immersiveMode: { toggle: jest.fn() },
            labelVisibilityControl: {
                hideLabelCard: jest.fn(),
                isCardVisible: () => false,
                isCardHeldOpen: () => false,
            },
            labelCard: { isPopoverOpen: () => false, closeTypeDropdown: () => false },
            validationMenu: { inWrongTypeView: () => false },
            imageAdjustmentsPopover: { isOpen: () => false },
            undoValidation: { canUndo: () => false },
            tracker: { push: jest.fn() },
        };
        validationMenuUi.yesButton.click.mockClear();
        validationMenuUi.submitButton.click.mockClear();
    });

    /** Presses F on the element, as a physical KeyF, with the given modifier state. */
    function pressF(el, init = {}) {
        el.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'f', code: 'KeyF', bubbles: true, cancelable: true, ...init,
        }));
    }

    it('toggles on a bare F, and logs the toggle as a keyboard shortcut', () => {
        pressF(document.body);
        expect(current.immersiveMode.toggle).toHaveBeenCalledWith('KeyboardShortcut');
    });

    it('leaves an f typed into a text field or an editable region alone', () => {
        const field = document.getElementById('field');
        field.focus();
        pressF(field);
        const note = document.getElementById('note');
        // jsdom does not implement isContentEditable, which is what a browser reports for the attribute.
        Object.defineProperty(note, 'isContentEditable', { value: true });
        note.focus();
        pressF(note);
        expect(current.immersiveMode.toggle).not.toHaveBeenCalled();
    });

    it('ignores F with a modifier, which belongs to the browser', () => {
        pressF(document.body, { ctrlKey: true });
        pressF(document.body, { metaKey: true });
        pressF(document.body, { shiftKey: true });
        pressF(document.body, { altKey: true });
        expect(current.immersiveMode.toggle).not.toHaveBeenCalled();
    });

    it('toggles once for a held F, not on every key repeat', () => {
        pressF(document.body);
        pressF(document.body, { repeat: true });
        pressF(document.body, { repeat: true });
        expect(current.immersiveMode.toggle).toHaveBeenCalledTimes(1);
    });

    // Enter submits from any other focused button. On these two it has to reach the button itself: submitting from the
    // X would send the very answer it was pressed to take back.
    it.each(['validate-verdict-clear', 'immersive-toggle-button'])('leaves Enter on #%s to the button', (id) => {
        document.body.insertAdjacentHTML('beforeend', `<button id="${id}"><span class="icon"></span></button>`);
        const button = document.getElementById(id);
        button.focus();
        const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
        button.querySelector('.icon').dispatchEvent(enter);
        expect(enter.defaultPrevented).toBe(false);
        expect(validationMenuUi.submitButton.click).not.toHaveBeenCalled();
    });

    it('still submits on Enter from any other button', () => {
        document.body.insertAdjacentHTML('beforeend', '<button id="other"></button>');
        const button = document.getElementById('other');
        button.focus();
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        expect(validationMenuUi.submitButton.click).toHaveBeenCalledTimes(1);
    });
});
