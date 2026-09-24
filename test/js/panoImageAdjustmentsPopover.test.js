/**
 * Tests for PanoImageAdjustmentsPopover (public/js/common/PanoImageAdjustmentsPopover.js), the slider panel behind
 * Explore's Image pill (#3136).
 *
 * Pins the contract the page relies on: the trigger's ARIA state, sliders taking their range from the model's SPECS
 * rather than the markup, `input` applying and `change` (release) being the one that logs, the Reset button's
 * enabled state and the trigger's active dot tracking "anything off default", the open/close hooks that Explore uses
 * to suspend its keyboard shortcuts, and light dismiss via Escape and outside clicks. jsdom implements neither the
 * Popover API nor `:popover-open`, so the test stands up showPopover/hidePopover the way panoInfoViewLink.test.js does.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MODEL_SRC = fs.readFileSync(path.join(ROOT, 'public/js/common/PanoImageAdjustments.js'), 'utf8');
const POPOVER_SRC = fs.readFileSync(path.join(ROOT, 'public/js/common/PanoImageAdjustmentsPopover.js'), 'utf8');

// The parts of app/views/common/panoImageAdjustments.scala.html and the Explore pill the class actually reads.
const MARKUP = `
<div id="street-view-holder">
  <button type="button" id="explore-control-image" class="pano-overlay-button">
    <img alt=""><span>Image</span>
  </button>
  <div id="pano"></div>
</div>
<div id="pano-image-adjustments" popover="manual">
  <button type="button" data-action="close"></button>
  <output data-adjust-value="shadows"></output>
  <input type="range" data-adjust="shadows">
  <output data-adjust-value="brightness"></output>
  <input type="range" data-adjust="brightness">
  <output data-adjust-value="contrast"></output>
  <input type="range" data-adjust="contrast">
  <button type="button" data-action="reset"></button>
</div>`;

function loadClasses() {
    (0, eval)(`${MODEL_SRC}\nwindow.PanoImageAdjustments = PanoImageAdjustments;`);
    (0, eval)(`${POPOVER_SRC}\nwindow.PanoImageAdjustmentsPopover = PanoImageAdjustmentsPopover;`);
}

function memoryStorage() {
    const data = {};
    return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
}

let button;
let popover;
let pano;
let model;
let hooks;
let shown;

/** Builds the panel over fresh markup, with Popover API stubs that record their state in `shown`. */
function mount() {
    document.body.innerHTML = MARKUP;
    button = document.getElementById('explore-control-image');
    popover = document.getElementById('pano-image-adjustments');
    pano = document.getElementById('pano');
    shown = false;
    popover.showPopover = jest.fn(() => { shown = true; });
    popover.hidePopover = jest.fn(() => { shown = false; });
    model = new window.PanoImageAdjustments(pano, memoryStorage());
    hooks = { onOpen: jest.fn(), onClose: jest.fn(), onChange: jest.fn(), onReset: jest.fn() };
    return new window.PanoImageAdjustmentsPopover(model, button, popover, hooks);
}

const slider = (key) => popover.querySelector(`[data-adjust="${key}"]`);
const output = (key) => popover.querySelector(`[data-adjust-value="${key}"]`);
const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

beforeAll(loadClasses);

describe('setup', () => {
    test('gives the trigger the disclosure ARIA and sliders their range from SPECS', () => {
        mount();
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(button.getAttribute('aria-controls')).toBe('pano-image-adjustments');
        expect(button.getAttribute('aria-haspopup')).toBe('dialog');
        expect([slider('shadows').min, slider('shadows').max, slider('shadows').step]).toEqual(['0', '100', '1']);
        expect([slider('brightness').min, slider('brightness').max]).toEqual(['50', '200']);
        expect([slider('contrast').min, slider('contrast').max]).toEqual(['50', '150']);
    });

    test('renders the model\'s current state, including a persisted non-default one', () => {
        document.body.innerHTML = MARKUP;
        const storage = memoryStorage();
        storage.data.panoImageAdjustments = JSON.stringify({ v: 1, shadows: 30, brightness: 100, contrast: 100 });
        const m = new window.PanoImageAdjustments(document.getElementById('pano'), storage);
        const b = document.getElementById('explore-control-image');
        const p = document.getElementById('pano-image-adjustments');
        new window.PanoImageAdjustmentsPopover(m, b, p);
        expect(p.querySelector('[data-adjust="shadows"]').value).toBe('30');
        expect(p.querySelector('[data-adjust-value="shadows"]').textContent).toBe('+30');
        expect(p.querySelector('[data-action="reset"]').disabled).toBe(false);
        expect(b.classList.contains('pano-overlay-button--active')).toBe(true);
    });

    test('survives a missing popover element without wiring anything', () => {
        document.body.innerHTML = '<button id="explore-control-image"></button><div id="pano"></div>';
        const err = jest.spyOn(console, 'error').mockImplementation(() => {});
        const m = new window.PanoImageAdjustments(document.getElementById('pano'), memoryStorage());
        expect(() => new window.PanoImageAdjustmentsPopover(m, document.getElementById('explore-control-image'), null))
            .not.toThrow();
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });
});

describe('open and close', () => {
    test('the trigger toggles the popover, ARIA state and the hooks', () => {
        const panel = mount();
        button.click();
        expect(shown).toBe(true);
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(panel.isOpen()).toBe(true);
        expect(hooks.onOpen).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(slider('shadows'));

        button.click();
        expect(shown).toBe(false);
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(hooks.onClose).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(button);
    });

    test('a click on the trigger\'s own icon counts as the trigger, not as outside', () => {
        mount();
        button.querySelector('img').click();
        expect(shown).toBe(true);
        button.querySelector('span').click();
        expect(shown).toBe(false);
        expect(hooks.onClose).toHaveBeenCalledTimes(1);
    });

    test('Escape closes it and is stopped before the page sees it', () => {
        mount();
        button.click();
        const pageSaw = jest.fn();
        window.addEventListener('keydown', pageSaw);
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(shown).toBe(false);
        expect(hooks.onClose).toHaveBeenCalledTimes(1);
        expect(pageSaw).not.toHaveBeenCalled();
        window.removeEventListener('keydown', pageSaw);

        // Escape with the panel closed is left alone for whoever else wants it.
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(hooks.onClose).toHaveBeenCalledTimes(1);
    });

    test('a click outside closes it; a click inside does not', () => {
        mount();
        button.click();
        slider('contrast').click();
        expect(shown).toBe(true);
        pano.click();
        expect(shown).toBe(false);
        expect(hooks.onClose).toHaveBeenCalledTimes(1);
    });

    test('the close button closes it', () => {
        mount();
        button.click();
        popover.querySelector('[data-action="close"]').click();
        expect(shown).toBe(false);
    });

    test('falls back to the hidden attribute where the Popover API is missing', () => {
        document.body.innerHTML = MARKUP;
        const p = document.getElementById('pano-image-adjustments');
        p.setAttribute('hidden', '');
        const m = new window.PanoImageAdjustments(document.getElementById('pano'), memoryStorage());
        const b = document.getElementById('explore-control-image');
        new window.PanoImageAdjustmentsPopover(m, b, p);
        b.click();
        expect(p.hasAttribute('hidden')).toBe(false);
        b.click();
        expect(p.hasAttribute('hidden')).toBe(true);
    });
});

describe('sliders', () => {
    test('input applies to the pano immediately and updates the readout; change is what logs', () => {
        mount();
        const s = slider('brightness');
        s.value = '140';
        fire(s, 'input');
        expect(model.get('brightness')).toBe(140);
        expect(pano.style.filter).toBe('brightness(1.4)');
        expect(output('brightness').textContent).toBe('140%');
        expect(s.getAttribute('aria-valuetext')).toBe('140%');
        expect(hooks.onChange).not.toHaveBeenCalled();

        fire(s, 'change');
        expect(hooks.onChange).toHaveBeenCalledTimes(1);
        expect(hooks.onChange).toHaveBeenCalledWith({ shadows: 0, brightness: 140, contrast: 100 });
    });

    test('the shadows readout is a signed strength', () => {
        mount();
        const s = slider('shadows');
        s.value = '45';
        fire(s, 'input');
        expect(output('shadows').textContent).toBe('+45');
        s.value = '0';
        fire(s, 'input');
        expect(output('shadows').textContent).toBe('0');
    });

    test('Reset is disabled at defaults, enabled once anything moves, and the trigger shows the active dot', () => {
        mount();
        const reset = popover.querySelector('[data-action="reset"]');
        expect(reset.disabled).toBe(true);
        expect(button.classList.contains('pano-overlay-button--active')).toBe(false);

        const s = slider('contrast');
        s.value = '120';
        fire(s, 'input');
        expect(reset.disabled).toBe(false);
        expect(button.classList.contains('pano-overlay-button--active')).toBe(true);

        s.value = '100';
        fire(s, 'input');
        expect(reset.disabled).toBe(true);
        expect(button.classList.contains('pano-overlay-button--active')).toBe(false);
    });

    test('Reset returns every slider and the pano to default and logs once', () => {
        mount();
        button.click();
        for (const [key, value] of [['shadows', '70'], ['brightness', '160'], ['contrast', '60']]) {
            slider(key).value = value;
            fire(slider(key), 'input');
        }
        expect(pano.style.filter).toBe('url(#ps-pano-tone-curve) brightness(1.6) contrast(0.6)');

        popover.querySelector('[data-action="reset"]').click();
        expect(model.isDefault()).toBe(true);
        expect(pano.style.filter).toBe('');
        expect(slider('shadows').value).toBe('0');
        expect(slider('brightness').value).toBe('100');
        expect(slider('contrast').value).toBe('100');
        expect(hooks.onReset).toHaveBeenCalledTimes(1);
        expect(hooks.onChange).not.toHaveBeenCalled();
        // Reset keeps the panel open with focus on a slider, so the next nudge is one keypress away.
        expect(shown).toBe(true);
        expect(document.activeElement).toBe(slider('shadows'));
    });

    test('a model change from elsewhere is reflected in the sliders', () => {
        mount();
        model.set('brightness', 75);
        expect(slider('brightness').value).toBe('75');
        expect(output('brightness').textContent).toBe('75%');
    });
});
