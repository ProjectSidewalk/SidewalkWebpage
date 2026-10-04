/**
 * Tests for the image adjustments keyboard scope in Validate's KeyboardManager (frontend/js/validate/keyboard/
 * KeyboardManager.js), added for #5501.
 *
 * The manager listens on window with capture and treats most keys as global shortcuts, Enter submitting the current
 * validation from anywhere. The image adjustments panel is an exception: while focus is inside it, or while it is
 * open at all, keys belong to the sliders and to the panel's own Escape handler, and no shortcut may fire. The
 * controls in the pano's top-left group (Hide label, the chevron and the Image pill in its menu) are a narrower
 * exception: Space is left to the browser, which activates the focused control. Enter still submits from the two
 * pills, as from any focused button on Validate, because closing the panel puts focus back on the Image pill and a
 * validator's next Enter means "submit". The chevron takes Enter as well, but only when reached by keyboard
 * (`:focus-visible`): after a mouse click it submits like any other button. The letter shortcuts keep working
 * throughout, since a mouse click leaves focus on the control. These tests pin both boundaries: a regression inside
 * submits or re-labels from a slider, and one outside breaks the shortcuts a validator uses right after clicking a
 * pill.
 *
 * One case loads the real PanoImageAdjustmentsPopover, to show that Escape from a slider gets through
 * KeyboardManager's window-capture listener to the panel's own handler and actually closes it. jsdom has no Popover
 * API, so the popover runs on its `hidden` fallback there.
 *
 * Loaded the same way as validateLabelCardKeyboard.test.js: the class is a plain top-level declaration, so the
 * source is eval'd with an explicit export, and one instance serves the whole file because the constructor registers
 * a window listener that cannot be unregistered. Each test swaps the svv/menu stubs it reads at event time.
 */

const { loadModules } = require('./loadGlobalScript');

/** A stand-in for one of the menu's controls, with its click spied. */
function makeControl() {
    const control = document.createElement('textarea');
    control.click = jest.fn();
    return control;
}

/**
 * Dispatches a keydown on a target, returning the event for defaultPrevented checks. A numpad Enter's `key` is
 * `Enter`, as a real keyboard's is.
 */
function key(code, target, keyName = code === 'NumpadEnter' ? 'Enter' : code) {
    const ev = new KeyboardEvent('keydown', { code, key: keyName, bubbles: true, cancelable: true });
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
        // Registered first, as on the page, so its window-capture listener sees every key before the popover's.
        Object.assign(window, loadModules('frontend/js/common/KeyboardShortcuts.js', 'frontend/js/validate/keyboard/KeyboardManager.js'));
        new window.KeyboardManager(validationMenuUi);
        Object.assign(window, loadModules('frontend/js/common/PanoImageAdjustments.js'));
        Object.assign(window, loadModules('frontend/js/common/PanoImageAdjustmentsPopover.js'));
    });

    beforeEach(() => {
        document.body.innerHTML = `
          <div id="label-visibility-control-holder">
            <button type="button" id="label-visibility-control-button"></button>
            <button type="button" id="validate-control-buttons-toggle" aria-expanded="true"></button>
            <div id="validate-control-menu">
              <button type="button" id="validate-control-image"></button>
            </div>
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
    const chevron = () => document.getElementById('validate-control-buttons-toggle');
    const hideLabelToggle = () => document.getElementById('label-visibility-control-button');
    const slider = () => document.getElementById('pano-image-adjustments-shadows');

    describe('the top-left pills', () => {
        it('Space on the Image pill is left to the browser to activate the button', () => {
            const ev = key('Space', pill());

            expect(ev.defaultPrevented).toBe(false);
            expect(validationMenuUi.submitButton.click).not.toHaveBeenCalled();
            expect(window.svv.labelVisibilityControl.hideLabelCard).not.toHaveBeenCalled();
        });

        it('Space on the hide-label toggle is left to the browser too', () => {
            const ev = key('Space', hideLabelToggle());

            expect(ev.defaultPrevented).toBe(false);
            expect(validationMenuUi.submitButton.click).not.toHaveBeenCalled();
        });

        it('Enter on the focused Image pill submits, as from any other focused button', () => {
            pill().focus();
            const ev = key('Enter', pill());

            expect(ev.defaultPrevented).toBe(true);
            expect(validationMenuUi.submitButton.click).toHaveBeenCalledTimes(1);
        });

        it('Space on the chevron is left to the browser', () => {
            const ev = key('Space', chevron());

            expect(ev.defaultPrevented).toBe(false);
            expect(validationMenuUi.submitButton.click).not.toHaveBeenCalled();
        });

        // jsdom reports :focus-visible true for any focused element, so focus() stands for a Tab onto the chevron.
        it.each(['Enter', 'NumpadEnter'])('%s on a keyboard-focused chevron is left to the browser and does not submit',
            (code) => {
                chevron().focus();
                const ev = key(code, chevron());

                expect(ev.defaultPrevented).toBe(false);
                expect(validationMenuUi.submitButton.click).not.toHaveBeenCalled();
                expect(window.svv.labelVisibilityControl.hideLabelCard).not.toHaveBeenCalled();
            });

        it('Enter on a chevron a mouse click focused submits, as from any other clicked button', () => {
            chevron().focus();
            // A click leaves :focus-visible false in a browser; jsdom can't tell, so the selector answers as one would.
            const matches = chevron().matches.bind(chevron());
            chevron().matches = (sel) => (sel === ':focus-visible' ? false : matches(sel));
            const ev = key('Enter', chevron());

            expect(ev.defaultPrevented).toBe(true);
            expect(validationMenuUi.submitButton.click).toHaveBeenCalledTimes(1);
        });

        it('Enter on the chevron submits where the browser rejects :focus-visible', () => {
            chevron().focus();
            chevron().matches = () => { throw new SyntaxError('unsupported selector'); };
            const ev = key('Enter', chevron());

            expect(ev.defaultPrevented).toBe(true);
            expect(validationMenuUi.submitButton.click).toHaveBeenCalledTimes(1);
        });

        it('Enter on the hide-label toggle submits, as from any other focused button', () => {
            const ev = key('Enter', hideLabelToggle());

            expect(ev.defaultPrevented).toBe(true);
            expect(validationMenuUi.submitButton.click).toHaveBeenCalledTimes(1);
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

    // Last in the file: the real popover's document listeners outlive the markup, so nothing runs after it.
    describe('with the real popover', () => {
        it('Escape from a slider closes the panel and returns focus to the pill', () => {
            const model = new window.PanoImageAdjustments(document.createElement('div'), null);
            const popover = new window.PanoImageAdjustmentsPopover(model, pill(),
                document.getElementById('pano-image-adjustments'));
            window.svv.imageAdjustmentsPopover = popover;
            popover.open();
            expect(popover.isOpen()).toBe(true);
            expect(document.activeElement).toBe(slider());

            key('Escape', slider(), 'Escape');

            expect(popover.isOpen()).toBe(false);
            expect(document.getElementById('pano-image-adjustments').hidden).toBe(true);
            expect(document.activeElement).toBe(pill());
            expect(window.svv.labelVisibilityControl.hideLabelCard).not.toHaveBeenCalled();
        });
    });
});
