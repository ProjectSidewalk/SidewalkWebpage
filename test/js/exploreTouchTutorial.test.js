/**
 * Tests for the tutorial's touch wording and the rating examples card (#5664, slice 5).
 *
 * On a screen without hover the tutorial must not tell anyone to click the pano, hover over a label, or press a key.
 * OnboardingStates swaps each such string for its `-touch` twin, so what matters is (a) which key it picks on which
 * screen, (b) that every twin exists in every locale, and (c) that the English twins really are free of mouse and key
 * wording. The context menu's info icon is the other half: its card carries the example images a touch user can't
 * reach through the hover-only segment cards.
 */

const fs = require('fs');
const path = require('path');
const { loadModules } = require('./loadGlobalScript');
const { makeContextMenuUi } = require('./contextMenuUiStub');

const LOCALES_DIR = path.join(__dirname, '..', '..', 'public', 'locales');
const FULL_LOCALES = ['en', 'es', 'nl', 'de', 'pt-BR', 'zh-TW', 'fr'];

/**
 * @param {string} locale
 * @returns {object} That locale's audit.json.
 */
const audit = (locale) => JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, 'audit.json'), 'utf8'));

/**
 * Looks a dotted i18next key up in a parsed namespace.
 * @param {object} ns
 * @param {string} key - e.g. `tutorial.common.label-too-far-end`.
 * @returns {string|undefined}
 */
const lookup = (ns, key) => key.split('.').reduce((obj, part) => obj?.[part], ns);

/** Loads OnboardingStates.js with just enough of `util` to build the state list. */
function loadOnboardingStates(hover) {
    window.i18next = { t: (key) => key };
    window.util = {
        assetPath: (p) => p,
        misc: {
            getLabelDescriptions: () => ({ tagInfo: new Proxy({}, { get: () => ({ text: '' }) }) }),
            getRatingLevelKeys: () => ({ 1: 'good', 2: 'okay', 3: 'bad' }),
            getSmileyIconPath: () => '',
        },
        pano: { horizonRelativeCoordToPov: () => ({ heading: 0, pitch: 0 }) },
        inputProfile: () => ({ coarse: !hover, hover }),
    };
    return loadModules('frontend/js/explore/onboarding/OnboardingStates.js');
}

/**
 * Every message a state list can show, as the raw text the i18next stub returned (its key).
 * @param {object[]} states
 * @returns {string[]}
 */
function messagesOf(states) {
    return states.flatMap((state) => {
        const message = state.message;
        if (!message) return [];
        // A few steps build their message elsewhere (from a stubbed collaborator here); only text is checked.
        return [typeof message === 'string' ? message : message.message].filter((m) => typeof m === 'string');
    });
}

describe('tutorialCopyKey', () => {
    const { tutorialCopyKey } = loadOnboardingStates(true);

    test('picks the -touch twin on a screen without hover', () => {
        expect(tutorialCopyKey('tutorial.zoom-in', true)).toBe('tutorial.zoom-in-touch');
        expect(tutorialCopyKey('tutorial.common.label-too-far-generic', true))
            .toBe('tutorial.common.label-too-far-generic-touch');
    });

    test('keeps the desktop key on a screen with hover', () => {
        expect(tutorialCopyKey('tutorial.zoom-in', false)).toBe('tutorial.zoom-in');
    });

    test('keeps a key that has no twin, whatever the screen', () => {
        expect(tutorialCopyKey('tutorial.walk-1', true)).toBe('tutorial.walk-1');
        expect(tutorialCopyKey('tutorial.adjust-heading-angle-1', true)).toBe('tutorial.adjust-heading-angle-1');
    });
});

describe('OnboardingStates wording by screen', () => {
    const stub = new Proxy({}, { get: () => () => undefined });

    test('a screen with hover shows no touch wording', () => {
        const { OnboardingStates } = loadOnboardingStates(true);
        const messages = messagesOf(new OnboardingStates(stub, stub, stub).get());
        expect(messages.filter((m) => m.includes('-touch'))).toEqual([]);
        expect(messages).toContain('tutorial.zoom-in');
    });

    test('a screen without hover shows every twin and none of the desktop strings they replace', () => {
        const { OnboardingStates, TOUCH_TUTORIAL_KEYS } = loadOnboardingStates(false);
        const messages = messagesOf(new OnboardingStates(stub, stub, stub).get()).join('\n');
        for (const key of TOUCH_TUTORIAL_KEYS) {
            expect(messages).toContain(`${key}-touch`);
            // A desktop key followed by anything but "-touch" means a call site still uses i18next.t directly.
            expect(messages).not.toMatch(new RegExp(`${key.replace(/\./g, '\\.')}(?!-touch)(?![\\w-])`));
        }
    });
});

describe('touch twins in the locale files', () => {
    const { TOUCH_TUTORIAL_KEYS } = loadOnboardingStates(true);
    const twins = [...TOUCH_TUTORIAL_KEYS].map((key) => `${key}-touch`);

    test.each(FULL_LOCALES)('%s has every twin, and the ending they share', (locale) => {
        const ns = audit(locale);
        for (const twin of [...twins, 'tutorial.common.label-too-far-end-touch']) {
            expect([twin, typeof lookup(ns, twin)]).toEqual([twin, 'string']);
        }
    });

    test.each(FULL_LOCALES)('%s: each label-too-far twin ends with the touch ending', (locale) => {
        const ns = audit(locale);
        for (const kind of ['generic', 'crosswalk', 'signal']) {
            const twin = lookup(ns, `tutorial.common.label-too-far-${kind}-touch`);
            expect(twin).toContain('$t(audit:tutorial.common.label-too-far-end-touch)');
            expect(twin).not.toContain('$t(audit:tutorial.common.label-too-far-end)');
        }
    });

    test('en-NZ overrides the twin of every string it overrides, so a tablet keeps the NZ terms', () => {
        const nz = audit('en-NZ');
        for (const key of TOUCH_TUTORIAL_KEYS) {
            if (lookup(nz, key) !== undefined) expect([key, typeof lookup(nz, `${key}-touch`)]).toEqual([key, 'string']);
        }
    });

    test('the English twins name no mouse, hover, or key', () => {
        const ns = audit('en');
        const offenders = [...twins, 'tutorial.common.label-too-far-end-touch']
            .filter((twin) => /click|hover|mous|press|kbd|\{\{key/i.test(lookup(ns, twin)));
        expect(offenders).toEqual([]);
    });
});

describe('the rating info card', () => {
    let ContextMenu;

    beforeEach(() => {
        window.i18next = { t: (key) => key };
        window.util = {
            escapeHTML: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
            misc: {},
        };
        window.svl = { tracker: { push: jest.fn() } };
        ({ ContextMenu } = loadModules('frontend/js/explore/canvas/ContextMenu.js'));
    });

    test('puts each example under the sentence, captioned, with its alt text', () => {
        const html = ContextMenu.severityInfoHtml('How bad is it?', [
            { src: 'data:image/png;base64,AAA', alt: 'Low severity example', caption: 'Low' },
            { src: 'data:image/png;base64,BBB', alt: 'High severity example', caption: 'High' },
        ]);
        document.body.innerHTML = html;
        expect(document.body.textContent.trim().startsWith('How bad is it?')).toBe(true);
        const figures = [...document.querySelectorAll('.severity-examples figure')];
        expect(figures.map((f) => f.querySelector('figcaption').textContent)).toEqual(['Low', 'High']);
        expect(figures.map((f) => f.querySelector('img').alt)).toEqual(['Low severity example', 'High severity example']);
    });

    test('escapes what it interpolates into attributes', () => {
        const html = ContextMenu.severityInfoHtml('x', [{ src: '"><script>', alt: '"', caption: '<b>' }]);
        document.body.innerHTML = html;
        expect(document.querySelector('script')).toBeNull();
        expect(document.querySelector('figcaption').textContent).toBe('<b>');
    });

    test('a tap on the icon logs the toggle with the state it moves to', () => {
        document.body.innerHTML = '<img id="severity-header-info" role="button" aria-expanded="false">';
        new ContextMenu(makeContextMenuUi());
        const icon = document.getElementById('severity-header-info');
        icon.click();
        icon.setAttribute('aria-expanded', 'true'); // What psTooltip does once it pins the card.
        icon.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(window.svl.tracker.push.mock.calls).toEqual([
            ['ContextMenu_SeverityInfoToggle', { LabelType: undefined, Pinned: true }],
            ['ContextMenu_SeverityInfoToggle', { LabelType: undefined, Pinned: false }],
        ]);
    });
});
