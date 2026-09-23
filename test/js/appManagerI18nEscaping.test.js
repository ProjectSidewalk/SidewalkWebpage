/**
 * Tests for the interpolation contract `AppManager._setupI18next` hands i18next (#5389).
 *
 * Interpolated values reach a text node, an `aria-label`, a `title` or a `confirm()` far more often than they reach
 * `innerHTML`, so the init turns HTML-escaping off site-wide and the calls that build markup opt back in one by one
 * (the `ps/i18n-escape-in-markup` ESLint rule makes them). These cases pin the init option and then run the real
 * i18next with it, so what is asserted is what a reader sees rather than what the options object says.
 *
 * Runs under jsdom (jest.config.js). i18next is not an npm dependency — the page loads the vendored bundle under
 * public/vendor — so the library under test is read off disk by directory rather than by a pinned filename, which
 * would go stale the next time `make lint-vendor-versions` sees a newer one.
 */

const fs = require('fs');
const path = require('path');
const { loadGlobalScript, REPO_ROOT } = require('./loadGlobalScript');

/** The vendored i18next, evaluated into this jsdom context; returns the UMD's export. */
function loadVendoredI18next() {
    const dir = path.join(REPO_ROOT, 'public/vendor/i18next');
    const bundle = fs.readdirSync(dir).find((name) => name.endsWith('.js'));
    if (!bundle) throw new Error(`no i18next bundle in ${dir}`);
    window.eval(fs.readFileSync(path.join(dir, bundle), 'utf8'));
    return window.i18next;
}

/** What a labeler-facing string interpolates, in the shapes that broke: an apostrophe, a slash, an ampersand. */
const RESOURCES = {
    greeting: 'Welcome to {{regionName}}',
    updated: 'Updated {{date}}',
    team: 'You joined {{name}}',
    link: 'Read <a href="{{href}}">how it works</a>',
};

describe('AppManager i18next interpolation', () => {
    /** The options object `_setupI18next` passes to `i18next.init`, captured without touching the network. */
    let initOptions;

    beforeEach(() => {
        initOptions = null;
        window.i18next = {
            use: () => window.i18next,
            init: (options, callback) => {
                initOptions = options;
                if (callback) callback(null);
                return Promise.resolve();
            },
            // Called from the init callback once translations have loaded.
            languages: [],
            addResourceBundle: () => {},
            services: { formatter: { add: () => {} } },
        };
        window.i18nextHttpBackend = {};
        loadGlobalScript('public/js/common/AppManager.js');
        window.appManager._setupI18next({
            language: 'en', defaultNS: 'common', namespaces: ['common'], countryId: 'usa', unitWords: {},
        });
    });

    afterEach(() => {
        delete window.appManager;
        delete window.i18next;
        delete window.i18nextHttpBackend;
    });

    test('turns off HTML-escaping of interpolated values', () => {
        expect(initOptions.interpolation.escapeValue).toBe(false);
    });

    test('keeps the distance words available to every string with no argument at the call site', () => {
        expect(initOptions.interpolation.defaultVariables).toEqual({});
    });
});

describe('the vendored i18next under that configuration', () => {
    let i18next;

    beforeAll(() => {
        i18next = loadVendoredI18next();
    });

    afterAll(() => {
        delete window.i18next;
    });

    /** A fresh instance per test keeps one test's options from leaking into the next. */
    async function instance(escapeValue) {
        const inst = i18next.createInstance();
        await inst.init({
            lng: 'en', resources: { en: { translation: RESOURCES } }, interpolation: { escapeValue },
        });
        return inst;
    }

    test("a text sink gets the value as typed: an apostrophe, not &#39;", async () => {
        const t = (await instance(false)).t;
        expect(t('greeting', { regionName: "Al 'Ummah Community Center" }))
            .toBe("Welcome to Al 'Ummah Community Center");
    });

    test('a formatted date keeps its slashes', async () => {
        const t = (await instance(false)).t;
        expect(t('updated', { date: '9/16/2026, 8:57:30 PM' })).toBe('Updated 9/16/2026, 8:57:30 PM');
    });

    test('an ampersand in a team name survives', async () => {
        const t = (await instance(false)).t;
        expect(t('team', { name: 'Bikes & Boots' })).toBe('You joined Bikes & Boots');
    });

    test('a call that opts back in escapes its values for markup', async () => {
        const t = (await instance(false)).t;
        expect(t('greeting', { regionName: '<img src=x onerror=alert(1)>', interpolation: { escapeValue: true } }))
            .toBe('Welcome to &lt;img src=x onerror=alert(1)&gt;');
    });

    test('opting in escapes only the values, never the markup the translation itself carries', async () => {
        const t = (await instance(false)).t;
        // The anchor is the translation's own, so it survives as a tag; only the href it is given is escaped, and
        // `&#x2F;` decodes back to `/` when the parser reads the attribute.
        expect(t('link', { href: '/help', interpolation: { escapeValue: true } }))
            .toBe('Read <a href="&#x2F;help">how it works</a>');
    });
});
