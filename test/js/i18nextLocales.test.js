/**
 * Runs the vendored i18next and i18next-http-backend over our real locale files, set up by the real AppManager.
 *
 * This is the check to lean on when bumping either library: it loads every supported language the way a page does
 * and confirms that plurals, interpolation, the distance formatter, the fallback to English, the regional English
 * overlays, and the country overrides all still come out right.
 *
 * Both libraries are read off disk by directory rather than by a pinned filename, so a version bump needs no edit
 * here. The only stand-in is `fetch`, which serves public/locales/ from disk and 404s anything that isn't there.
 */

const fs = require('fs');
const path = require('path');
const { loadGlobalScript, REPO_ROOT } = require('./loadGlobalScript');

const LOCALES_DIR = path.join(REPO_ROOT, 'public/locales');
const LANGUAGES = fs.readdirSync(LOCALES_DIR);
const NAMESPACES = fs.readdirSync(path.join(LOCALES_DIR, 'en'))
    .map((file) => file.replace('.json', '')).filter((ns) => !/-(india|zurich)$/.test(ns));
const UNIT_WORDS = { unitAbbr: 'km', unitAbbrSmall: 'm', unitName: 'kilometers', unitNameSingular: 'kilometer' };
const PLURAL_SUFFIX = /_(zero|one|other)$/;

/** Reads one locale file, or null where that language has no such file. */
function readLocale(language, namespace) {
    const file = path.join(LOCALES_DIR, language, `${namespace}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/** Flattens nested translations into `a.b.c` keys, the form `t()` takes. */
function flatten(tree, prefix = '', out = {}) {
    for (const [key, value] of Object.entries(tree)) {
        const full = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object') flatten(value, full, out);
        else out[full] = value;
    }
    return out;
}

/** Evaluates the one bundle in a vendor folder into the page. */
function loadVendored(folder) {
    const dir = path.join(REPO_ROOT, 'public/vendor', folder);
    const bundle = fs.readdirSync(dir).find((name) => name.endsWith('.js'));
    window.eval(fs.readFileSync(path.join(dir, bundle), 'utf8'));
}

/**
 * Starts i18next the way a page does and waits for its translations.
 * @param {string} language - The reader's language.
 * @param {string} [countryId] - The deployment's country, which decides the override namespaces.
 * @returns {Promise<string[]>} The locale files the page asked for, as `<language>/<namespace>.json`.
 */
async function startPage(language, countryId = 'usa') {
    const requested = [];
    window.fetch = async (url) => {
        const relative = String(url).replace('/assets/locales/', '');
        requested.push(relative);
        const file = path.join(LOCALES_DIR, relative);
        const found = fs.existsSync(file);
        const body = found ? fs.readFileSync(file, 'utf8') : '';
        return { ok: found, status: found ? 200 : 404, statusText: '', headers: new Map(), text: async () => body };
    };
    loadVendored('i18next');
    loadVendored('i18next-http-backend');
    document.documentElement.dataset.measurementSystem = 'metric';
    window.util = {
        isMetric: () => true,
        math: { metersToFeet: (m) => m * 3.28084, kmsToMiles: (km) => km * 0.621371, roundToTwentyFive: (n) => Math.round(n / 25) * 25 },
    };
    loadGlobalScript('public/js/common/AppManager.js');
    await window.appManager._setupI18next({
        language, supportedLanguages: LANGUAGES, defaultNS: 'common', namespaces: NAMESPACES, countryId,
        unitWords: UNIT_WORDS,
    });
    return requested;
}

describe('the vendored i18next over our locale files', () => {
    let consoleError;

    beforeEach(() => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleError.mockRestore();
        for (const name of ['appManager', 'i18next', 'i18nextHttpBackend', 'util', 'fetch']) delete window[name];
    });

    describe.each(LANGUAGES)('in %s', (language) => {
        let requested;

        beforeEach(async () => {
            requested = await startPage(language);
        });

        test('loads without an error, asking only for languages we have', () => {
            expect(consoleError).not.toHaveBeenCalled();
            expect(window.i18next.language).toBe(language);
            expect([...new Set(requested.map((file) => file.split('/')[0]))].sort())
                .toEqual([...new Set([language, 'en'])].sort());
        });

        test('has a finished string for every key English has', () => {
            const unfinished = [];
            for (const namespace of NAMESPACES) {
                for (const key of new Set(Object.keys(flatten(readLocale('en', namespace))))) {
                    const plural = PLURAL_SUFFIX.test(key);
                    const fullKey = `${namespace}:${key.replace(PLURAL_SUFFIX, '')}`;
                    if (!window.i18next.exists(fullKey, plural ? { count: 2 } : {})) unfinished.push(fullKey);
                }
            }
            expect(unfinished).toEqual([]);
        });

        test('picks the plural form the count calls for', () => {
            const own = flatten(readLocale(language, 'common'));
            const english = flatten(readLocale('en', 'common'));
            const key = Object.keys(english).find((k) => k.endsWith('_one') && `${k.slice(0, -4)}_other` in english)
                .slice(0, -4);
            const expected = (suffix, count) => (own[`${key}_${suffix}`] ?? english[`${key}_${suffix}`])
                .replace(/\{\{count(, number)?\}\}/, new Intl.NumberFormat(language).format(count));
            // Chinese has a single plural form, so a count of one reads the `_other` string there.
            const singular = new Intl.PluralRules(language).select(1);
            expect(window.i18next.t(`common:${key}`, { count: 1 })).toBe(expected(singular, 1));
            expect(window.i18next.t(`common:${key}`, { count: 5 })).toBe(expected('other', 5));
        });

        test('renders a distance through our formatter, with the unit the page was given', () => {
            const rendered = window.i18next.t('accessscore:length', { meters: 412 });
            expect(rendered).toContain(new Intl.NumberFormat(language).format(400));
            expect(rendered).toContain(UNIT_WORDS.unitAbbrSmall);
            expect(rendered).not.toContain('{{');
        });
    });

    describe.each(['en-US', 'en-NZ'])('the %s overlay', (language) => {
        test('uses its own strings where it has them and plain English everywhere else', async () => {
            await startPage(language);
            const plain = (strings) => Object.keys(strings).filter((k) => !PLURAL_SUFFIX.test(k)
                && !/\{\{|\$t\(/.test(strings[k]));
            const namespace = NAMESPACES.find((ns) => plain(flatten(readLocale(language, ns))).length > 0);
            const overlay = flatten(readLocale(language, namespace));
            const english = flatten(readLocale('en', namespace));
            const overridden = plain(overlay)[0];
            const inherited = plain(english).find((k) => !(k in overlay));
            expect(window.i18next.t(`${namespace}:${overridden}`)).toBe(overlay[overridden]);
            expect(window.i18next.t(`${namespace}:${inherited}`)).toBe(english[inherited]);
        });
    });

    describe.each([['india', 'india'], ['switzerland', 'zurich']])('a deployment in %s', (countryId, suffix) => {
        test('reads its override strings in place of the standard ones', async () => {
            await startPage('en', countryId);
            const namespace = NAMESPACES.find((ns) => readLocale('en', `${ns}-${suffix}`));
            const overrides = flatten(readLocale('en', `${namespace}-${suffix}`));
            const key = Object.keys(overrides).find((k) => !PLURAL_SUFFIX.test(k) && !/\{\{|\$t\(/.test(overrides[k]));
            expect(window.i18next.t(`${namespace}:${key}`)).toBe(overrides[key]);
            // A namespace with no override file 404s by design, and that must not be reported as an error.
            expect(consoleError).not.toHaveBeenCalled();
        });
    });
});
